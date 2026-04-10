import { createHash } from 'node:crypto';

import { buildDocumentAnalysisPrompt, buildSystemPrompt, buildUserPrompt } from './prompt-builder';
import type {
  AnalyzePdfDocumentRequest,
  ClaudeTokenUsage,
  ClaudeTranslatedBatch,
  NativePdfInsights,
  PdfBase64Source,
  PdfDocumentSource,
  TranslateBatchRequest,
} from './types';

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface UploadFileResponse {
  id?: string;
  error?: { message?: string };
}

interface DocumentSourcePayload {
  type: 'base64' | 'file' | 'url';
  media_type?: 'application/pdf';
  data?: string;
  file_id?: string;
  url?: string;
}

interface DocumentContentBlock {
  type: 'document';
  source: DocumentSourcePayload;
  title?: string;
  cache_control?: {
    type: 'ephemeral';
  };
}

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 8_000;
const FILES_API_BETA = 'files-api-2025-04-14';
const MAX_FILE_ID_CACHE_ENTRIES = 500;

const pdfFileIdCache = new Map<string, string>();

function isRetriableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const parsedDate = Date.parse(value);
  if (Number.isFinite(parsedDate)) {
    const delta = parsedDate - Date.now();
    return delta > 0 ? delta : 0;
  }

  return null;
}

function getRetryDelayMs(attempt: number, retryAfterMs: number | null): number {
  const expDelay = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** attempt);
  const jitterMs = Math.floor(Math.random() * 250);
  const fallbackDelay = expDelay + jitterMs;

  if (retryAfterMs === null) {
    return fallbackDelay;
  }

  return Math.max(retryAfterMs, fallbackDelay);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stripMarkdownCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\n?/, '')
    .replace(/```$/, '')
    .trim();
}

function parseJsonResponse(rawText: string): Record<string, string> {
  const cleaned = stripMarkdownCodeFence(rawText);
  const parsed = JSON.parse(cleaned) as { translations?: Array<{ id?: string; text?: string }> };

  if (!Array.isArray(parsed.translations)) {
    throw new Error('Claude response does not contain a translations array.');
  }

  const map: Record<string, string> = {};
  parsed.translations.forEach((entry) => {
    if (!entry || typeof entry.id !== 'string') {
      return;
    }

    map[entry.id] = typeof entry.text === 'string' ? entry.text : '';
  });

  return map;
}

function parseDocumentInsights(rawText: string): NativePdfInsights {
  const cleaned = stripMarkdownCodeFence(rawText);
  const parsed = JSON.parse(cleaned) as Partial<NativePdfInsights>;

  const toStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    glossary: toStringArray(parsed.glossary),
    styleGuidance: toStringArray(parsed.styleGuidance),
    layoutNotes: toStringArray(parsed.layoutNotes),
  };
}

function extractResponseText(data: AnthropicResponse): string {
  const text = (data.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!text) {
    throw new Error(data.error?.message || 'Claude returned an empty response.');
  }

  return text;
}

function toSafeNumber(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function extractUsage(data: AnthropicResponse): ClaudeTokenUsage {
  const inputTokens = toSafeNumber(data.usage?.input_tokens);
  const outputTokens = toSafeNumber(data.usage?.output_tokens);
  const cacheCreationInputTokens = toSafeNumber(data.usage?.cache_creation_input_tokens);
  const cacheReadInputTokens = toSafeNumber(data.usage?.cache_read_input_tokens);

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
  };
}

function withCommonHeaders(apiKey: string, includeFilesApiBeta: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  if (includeFilesApiBeta) {
    headers['anthropic-beta'] = FILES_API_BETA;
  }

  return headers;
}

async function fetchAnthropicWithRetry(
  makeRequest: () => Promise<Response>,
  maxRetries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await makeRequest();
      if (response.ok || !isRetriableStatus(response.status) || attempt === maxRetries) {
        return response;
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      response.body?.cancel();
      await delay(getRetryDelayMs(attempt, retryAfterMs));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown Claude API request error.');

      if (attempt === maxRetries) {
        throw lastError;
      }

      await delay(getRetryDelayMs(attempt, null));
    }
  }

  throw lastError ?? new Error('Claude API request failed unexpectedly.');
}

function getSourceFingerprint(apiKey: string, source: PdfBase64Source): string {
  const apiKeyHash = createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  const hash = createHash('sha256').update(source.data).digest('hex');
  return `${apiKeyHash}:${source.filename || 'pdf'}:${hash}`;
}

async function uploadPdfToFilesApi(apiKey: string, source: PdfBase64Source): Promise<string> {
  const cacheKey = getSourceFingerprint(apiKey, source);
  const cachedFileId = pdfFileIdCache.get(cacheKey);
  if (cachedFileId) {
    return cachedFileId;
  }

  const bytes = Buffer.from(source.data, 'base64');
  const response = await fetchAnthropicWithRetry(() => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), source.filename || 'source.pdf');

    return fetch('https://api.anthropic.com/v1/files', {
      method: 'POST',
      headers: withCommonHeaders(apiKey, true),
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  });

  const payload = (await response.json().catch(() => ({}))) as UploadFileResponse;
  if (!response.ok || !payload.id) {
    const reason = payload.error?.message || 'Unknown Files API upload error.';
    throw new Error(`Files API upload failed (${response.status}): ${reason}`);
  }

  if (pdfFileIdCache.size >= MAX_FILE_ID_CACHE_ENTRIES) {
    const oldestKey = pdfFileIdCache.keys().next().value;
    if (typeof oldestKey === 'string') {
      pdfFileIdCache.delete(oldestKey);
    }
  }

  pdfFileIdCache.set(cacheKey, payload.id);
  return payload.id;
}

async function resolveDocumentSourceForRequest(
  apiKey: string,
  source: PdfDocumentSource,
  useFilesApi: boolean
): Promise<{ sourcePayload: DocumentSourcePayload; includeFilesApiBeta: boolean; warnings: string[] }> {
  if (source.type === 'file') {
    return {
      sourcePayload: {
        type: 'file',
        file_id: source.fileId,
      },
      includeFilesApiBeta: true,
      warnings: [],
    };
  }

  if (source.type === 'url') {
    return {
      sourcePayload: {
        type: 'url',
        url: source.url,
      },
      includeFilesApiBeta: false,
      warnings: [],
    };
  }

  if (useFilesApi) {
    try {
      const uploadedFileId = await uploadPdfToFilesApi(apiKey, source);
      return {
        sourcePayload: {
          type: 'file',
          file_id: uploadedFileId,
        },
        includeFilesApiBeta: true,
        warnings: [],
      };
    } catch (error) {
      return {
        sourcePayload: {
          type: 'base64',
          media_type: 'application/pdf',
          data: source.data,
        },
        includeFilesApiBeta: false,
        warnings: [
          `Files API upload failed, continued with base64 PDF source: ${
            error instanceof Error ? error.message : 'Unknown upload error.'
          }`,
        ],
      };
    }
  }

  return {
    sourcePayload: {
      type: 'base64',
      media_type: 'application/pdf',
      data: source.data,
    },
    includeFilesApiBeta: false,
    warnings: [],
  };
}

function buildDocumentBlock(
  sourcePayload: DocumentSourcePayload,
  filename: string | undefined,
  usePromptCaching: boolean
): DocumentContentBlock {
  return {
    type: 'document',
    source: sourcePayload,
    title: filename,
    ...(usePromptCaching ? { cache_control: { type: 'ephemeral' as const } } : {}),
  };
}

export async function analyzePdfDocumentWithClaude(
  apiKey: string,
  request: AnalyzePdfDocumentRequest
): Promise<{ insights: NativePdfInsights | null; usage: ClaudeTokenUsage; warnings: string[] }> {
  const useFilesApi = request.options.useFilesApi ?? true;
  const usePromptCaching = request.options.usePromptCaching ?? true;

  const sourceResolution = await resolveDocumentSourceForRequest(apiKey, request.source, useFilesApi);
  const documentBlock = buildDocumentBlock(
    sourceResolution.sourcePayload,
    request.source.filename,
    usePromptCaching
  );

  const includeFilesApiBeta = sourceResolution.includeFilesApiBeta;
  const body: Record<string, unknown> = {
    model: request.options.model,
    max_tokens: request.options.maxTokens,
    temperature: 0,
    system: buildSystemPrompt(request.prompt.systemPrompt),
    messages: [
      {
        role: 'user',
        content: [
          documentBlock,
          {
            type: 'text',
            text: buildDocumentAnalysisPrompt(request.targetLanguage, request.prompt.translationPrompt),
          },
        ],
      },
    ],
  };

  if (usePromptCaching) {
    body.cache_control = { type: 'ephemeral' };
  }

  const serializedBody = JSON.stringify(body);
  const response = await fetchAnthropicWithRetry(() =>
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        ...withCommonHeaders(apiKey, includeFilesApiBeta),
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: serializedBody,
    })
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude PDF analysis failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const data = (await response.json()) as AnthropicResponse;
  const responseText = extractResponseText(data);
  const insights = parseDocumentInsights(responseText);

  return {
    insights,
    usage: extractUsage(data),
    warnings: sourceResolution.warnings,
  };
}

export async function translateBatchWithClaude(apiKey: string, request: TranslateBatchRequest): Promise<ClaudeTranslatedBatch> {
  const usePromptCaching = request.options.usePromptCaching ?? true;

  const body: Record<string, unknown> = {
    model: request.options.model,
    max_tokens: request.options.maxTokens,
    temperature: request.options.temperature,
    system: buildSystemPrompt(request.prompt.systemPrompt),
    messages: [
      {
        role: 'user',
        content: buildUserPrompt(request),
      },
    ],
  };

  if (usePromptCaching) {
    body.cache_control = { type: 'ephemeral' };
  }

  const serializedBody = JSON.stringify(body);

  const response = await fetchAnthropicWithRetry(() =>
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        ...withCommonHeaders(apiKey, false),
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: serializedBody,
    })
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const data = (await response.json()) as AnthropicResponse;
  const responseText = extractResponseText(data);

  return {
    translations: parseJsonResponse(responseText),
    rawText: responseText,
    usage: extractUsage(data),
  };
}
