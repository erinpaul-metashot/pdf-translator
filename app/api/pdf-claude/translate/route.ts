import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import {
  translatePdfPagesWithClaude,
  type ClaudeEngineOptions,
  type ClaudePromptConfig,
  type PdfDocumentSource,
} from '@/lib/pdf-claude-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_SYSTEM_PROMPT =
  'You are a professional PDF translation engine that preserves document structure and terminology consistency.';
const DEFAULT_TRANSLATION_PROMPT =
  'Translate each block accurately for the target language while preserving factual meaning and formatting intent.';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const MAX_PAGES_PER_REQUEST = 12;
const MAX_PAGE_CHARS = 300_000;
const MAX_TOTAL_CHARS = 1_500_000;
const MAX_PROMPT_CHARS = 6_000;
const MAX_PDF_BYTES = 32 * 1024 * 1024;
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const CONTRACT_VERSION = '2026-04-08';
const STYLE_OR_SCRIPT_BLOCK_REGEX = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TEXT_BETWEEN_TAGS_REGEX = />([^<>]+)</g;

interface RateLimitBucket {
  count: number;
  startedAt: number;
}

interface RateLimitState {
  limited: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetEpochSeconds: number;
}

const rateLimitStore = new Map<string, RateLimitBucket>();

interface TranslateRequestBody {
  pages?: string[];
  targetLanguage?: string;
  prompt?: Partial<ClaudePromptConfig>;
  options?: Partial<ClaudeEngineOptions>;
  documentSource?: {
    type?: 'base64' | 'file' | 'url';
    data?: string;
    mediaType?: string;
    fileId?: string;
    url?: string;
    filename?: string;
  };
}

function toSafeOptions(options: Partial<ClaudeEngineOptions> | undefined): ClaudeEngineOptions {
  const model = options?.model?.trim() || DEFAULT_MODEL;

  const temperature = Number.isFinite(options?.temperature)
    ? Math.max(0, Math.min(1, Number(options?.temperature)))
    : 0.2;

  const maxTokens = Number.isFinite(options?.maxTokens)
    ? Math.max(512, Math.min(8000, Number(options?.maxTokens)))
    : 4000;

  const batchSize = Number.isFinite(options?.batchSize)
    ? Math.max(1, Math.min(30, Number(options?.batchSize)))
    : 12;

  const enableQualityChecks =
    typeof options?.enableQualityChecks === 'boolean' ? options.enableQualityChecks : true;

  const maxMemoryEntries = Number.isFinite(options?.maxMemoryEntries)
    ? Math.max(50, Math.min(2000, Number(options?.maxMemoryEntries)))
    : 400;

  const usePromptCaching = typeof options?.usePromptCaching === 'boolean' ? options.usePromptCaching : true;
  const useFilesApi = typeof options?.useFilesApi === 'boolean' ? options.useFilesApi : true;

  return {
    model,
    temperature,
    maxTokens,
    batchSize,
    integrationMode: 'integrated',
    enableQualityChecks,
    maxMemoryEntries,
    usePromptCaching,
    useFilesApi,
  };
}

function resolveApiKey(request: NextRequest): string | null {
  const headerKey = request.headers.get('x-claude-api-key')?.trim();
  return headerKey || null;
}

function getClientKey(apiKey: string): string {
  const apiKeyFingerprint = createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
  return apiKeyFingerprint;
}

function evaluateRateLimit(clientKey: string): RateLimitState {
  const now = Date.now();

  for (const [key, bucketEntry] of rateLimitStore.entries()) {
    if (now - bucketEntry.startedAt >= RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(key);
    }
  }

  const bucket = rateLimitStore.get(clientKey);

  if (!bucket || now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) {
    const startedAt = now;
    rateLimitStore.set(clientKey, { count: 1, startedAt });
    return {
      limited: false,
      remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - 1),
      retryAfterSeconds: 0,
      resetEpochSeconds: Math.floor((startedAt + RATE_LIMIT_WINDOW_MS) / 1000),
    };
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterMs = Math.max(0, RATE_LIMIT_WINDOW_MS - (now - bucket.startedAt));
    return {
      limited: true,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      resetEpochSeconds: Math.floor((bucket.startedAt + RATE_LIMIT_WINDOW_MS) / 1000),
    };
  }

  const nextCount = bucket.count + 1;
  rateLimitStore.set(clientKey, { ...bucket, count: nextCount });

  return {
    limited: false,
    remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - nextCount),
    retryAfterSeconds: 0,
    resetEpochSeconds: Math.floor((bucket.startedAt + RATE_LIMIT_WINDOW_MS) / 1000),
  };
}

function buildRateLimitHeaders(state: RateLimitState): Headers {
  const headers = new Headers();
  headers.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX_REQUESTS));
  headers.set('X-RateLimit-Remaining', String(state.remaining));
  headers.set('X-RateLimit-Reset', String(state.resetEpochSeconds));

  if (state.limited && state.retryAfterSeconds > 0) {
    headers.set('Retry-After', String(state.retryAfterSeconds));
  }

  return headers;
}

function parseJsonField<T>(value: FormDataEntryValue | null, fallback: T): T {
  if (typeof value !== 'string') {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value) as T;
    return parsed;
  } catch {
    return fallback;
  }
}

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeDocumentSource(body: TranslateRequestBody): PdfDocumentSource | undefined {
  const source = body.documentSource;
  if (!source || typeof source.type !== 'string') {
    return undefined;
  }

  if (source.type === 'base64') {
    const data = source.data?.trim() || '';
    if (!data) {
      return undefined;
    }

    return {
      type: 'base64',
      mediaType: 'application/pdf',
      data,
      filename: source.filename?.trim() || undefined,
    };
  }

  if (source.type === 'file') {
    const fileId = source.fileId?.trim() || '';
    if (!fileId) {
      return undefined;
    }

    return {
      type: 'file',
      fileId,
      filename: source.filename?.trim() || undefined,
    };
  }

  if (source.type === 'url') {
    const url = source.url?.trim() || '';
    if (!url || !isSafeHttpUrl(url)) {
      return undefined;
    }

    return {
      type: 'url',
      url,
      filename: source.filename?.trim() || undefined,
    };
  }

  return undefined;
}

function estimateTranslatableChars(pageHtml: string): number {
  const withoutStylesAndScripts = pageHtml.replace(STYLE_OR_SCRIPT_BLOCK_REGEX, '');
  let totalChars = 0;

  withoutStylesAndScripts.replace(TEXT_BETWEEN_TAGS_REGEX, (_match, rawText: string) => {
    const trimmed = rawText.trim();
    if (trimmed && /\p{L}/u.test(trimmed)) {
      totalChars += trimmed.length;
    }
    return _match;
  });

  return totalChars;
}

async function parseRequestBody(request: NextRequest): Promise<TranslateRequestBody> {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.toLowerCase().includes('multipart/form-data')) {
    const form = await request.formData();

    const pages = parseJsonField<string[]>(form.get('pages'), []);
    const prompt = parseJsonField<Partial<ClaudePromptConfig>>(form.get('prompt'), {});
    const options = parseJsonField<Partial<ClaudeEngineOptions>>(form.get('options'), {});
    const targetLanguage = typeof form.get('targetLanguage') === 'string' ? String(form.get('targetLanguage')) : '';
    const multipartDocumentSource = parseJsonField<TranslateRequestBody['documentSource']>(
      form.get('documentSource'),
      undefined
    );

    const pdfEntry = form.get('pdf');
    if (pdfEntry instanceof File) {
      const bytes = await pdfEntry.arrayBuffer();
      if (bytes.byteLength > MAX_PDF_BYTES) {
        throw new Error(`PDF is too large. Maximum supported size is ${MAX_PDF_BYTES} bytes.`);
      }

      return {
        pages,
        targetLanguage,
        prompt,
        options,
        documentSource: {
          type: 'base64',
          mediaType: 'application/pdf',
          data: Buffer.from(bytes).toString('base64'),
          filename: pdfEntry.name || 'source.pdf',
        },
      };
    }

    return {
      pages,
      targetLanguage,
      prompt,
      options,
      documentSource: multipartDocumentSource,
    };
  }

  const contentLengthHeader = request.headers.get('content-length');
  const contentLength = Number.parseInt(contentLengthHeader ?? '', 10);
  if (!Number.isFinite(contentLength)) {
    throw new Error('JSON request must include a valid Content-Length header.');
  }

  if (contentLength > MAX_JSON_BODY_BYTES) {
    throw new Error(
      `JSON payload is too large. Maximum supported JSON body is ${MAX_JSON_BODY_BYTES} bytes. Use multipart upload for large PDFs.`
    );
  }

  const parsedBody = (await request.json()) as TranslateRequestBody;
  if (parsedBody.documentSource?.type === 'base64' && (parsedBody.documentSource.data?.length ?? 0) > 0) {
    throw new Error('Base64 PDF in JSON is not supported for large inputs. Use multipart upload or file/url documentSource.');
  }

  return parsedBody;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = resolveApiKey(request);
    if (!apiKey) {
      return Response.json(
        { error: 'Claude API key is missing. Add it in settings and retry.' },
        { status: 400 }
      );
    }

    const clientKey = getClientKey(apiKey);
    const rateLimitState = evaluateRateLimit(clientKey);
    const rateLimitHeaders = buildRateLimitHeaders(rateLimitState);

    if (rateLimitState.limited) {
      return Response.json(
        { error: 'Too many translation requests. Please wait and retry.' },
        { status: 429, headers: rateLimitHeaders }
      );
    }

    let body: TranslateRequestBody;
    try {
      body = await parseRequestBody(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request body.';
      const status = message.toLowerCase().includes('too large') ? 413 : 400;
      return Response.json({ error: message }, { status, headers: rateLimitHeaders });
    }
    const pages = Array.isArray(body.pages) ? body.pages.filter((value) => typeof value === 'string') : [];
    const targetLanguage = (body.targetLanguage || '').trim();
    const documentSource = normalizeDocumentSource(body);

    if (!documentSource) {
      return Response.json(
        { error: 'documentSource is required for integrated PDF translation.' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    if (!targetLanguage) {
      return Response.json({ error: 'targetLanguage is required.' }, { status: 400, headers: rateLimitHeaders });
    }

    if (pages.length === 0) {
      return Response.json(
        { error: 'At least one page is required for translation.' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    if (pages.length > MAX_PAGES_PER_REQUEST) {
      return Response.json(
        { error: `Too many pages in one request. Maximum is ${MAX_PAGES_PER_REQUEST}.` },
        { status: 413, headers: rateLimitHeaders }
      );
    }

    let totalChars = 0;
    for (const page of pages) {
      const pageTextChars = estimateTranslatableChars(page);

      if (pageTextChars > MAX_PAGE_CHARS) {
        return Response.json(
          { error: `A page has too much translatable text. Maximum per-page text size is ${MAX_PAGE_CHARS} characters.` },
          { status: 413, headers: rateLimitHeaders }
        );
      }

      totalChars += pageTextChars;
    }

    if (totalChars > MAX_TOTAL_CHARS) {
      return Response.json(
        { error: `Request is too large. Maximum combined page size is ${MAX_TOTAL_CHARS} characters.` },
        { status: 413, headers: rateLimitHeaders }
      );
    }

    const prompt: ClaudePromptConfig = {
      systemPrompt: body.prompt?.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT,
      translationPrompt: body.prompt?.translationPrompt?.trim() || DEFAULT_TRANSLATION_PROMPT,
    };

    if (prompt.systemPrompt.length > MAX_PROMPT_CHARS || prompt.translationPrompt.length > MAX_PROMPT_CHARS) {
      return Response.json(
        { error: `Prompt is too long. Keep each prompt under ${MAX_PROMPT_CHARS} characters.` },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    if (documentSource?.type === 'base64') {
      const approxBytes = Math.floor((documentSource.data.length * 3) / 4);
      if (approxBytes > MAX_PDF_BYTES) {
        return Response.json(
          { error: `PDF is too large. Maximum supported size is ${MAX_PDF_BYTES} bytes.` },
          { status: 413, headers: rateLimitHeaders }
        );
      }
    }

    const options = toSafeOptions(body.options);

    const result = await translatePdfPagesWithClaude(apiKey, {
      pages,
      targetLanguage,
      prompt,
      options,
      documentSource,
    });

    const translatedBlocks = result.pageMetrics.reduce((acc, metric) => acc + metric.translatedBlocks, 0);
    const failedBlocks = result.pageMetrics.reduce((acc, metric) => acc + metric.failedBlocks, 0);
    const memoryHits = result.pageMetrics.reduce((acc, metric) => acc + metric.memoryHits, 0);

    return Response.json({
      translatedPages: result.translatedPages,
      pageMetrics: result.pageMetrics,
      warnings: result.warnings,
      usage: result.usage,
      cost: result.cost,
      quality: result.quality,
      summary: {
        pageCount: result.translatedPages.length,
        translatedBlocks,
        failedBlocks,
        memoryHits,
        qualityIssues: result.quality.summary.totalIssues,
      },
      contractVersion: CONTRACT_VERSION,
      provider: {
        model: options.model,
        integrationMode: 'integrated',
      },
    }, { headers: rateLimitHeaders });
  } catch (error) {
    console.error('pdf-claude translate route failed', error);
    return Response.json(
      { error: 'Translation pipeline failed. Please retry in a moment.' },
      { status: 500 }
    );
  }
}
