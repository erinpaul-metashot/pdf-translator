'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { SUPPORTED_LANGUAGES } from '@/app/lib/constants';
import { extractPagesFromHtml, reconstructPortableHtml } from '@/lib/pdf-utilities';
import { buildPdfPrintHtml, convertPdfToHtml, printHtmlWithHiddenIframe } from '@/lib/pdf-to-html-engine';

import type {
  ClaudeArtifactPageMetric,
  ClaudeArtifactQualityIssue,
  ClaudeArtifactQualitySummary,
  ClaudeEngineDraft,
  ClaudePromptDraft,
  ClaudeRunSummary,
  ClaudeTranslationArtifacts,
  ClaudeWorkflowProgress,
  ClaudeWorkflowState,
} from '../types';

const API_KEY_STORAGE_KEY = 'pdfTranslator.apiKeys.v1';
const CLAUDE_MAX_FILE_SIZE_BYTES = 32 * 1024 * 1024;
const CLAUDE_MAX_FILE_SIZE_LABEL = '32MB';
const CLAUDE_MAX_PAGES_PER_REQUEST = 12;
const CLAUDE_MAX_PAGE_CHARS = 300_000;
const CLAUDE_MAX_TOTAL_CHARS_PER_REQUEST = 1_500_000;
const CLAUDE_CHUNK_MAX_RETRIES = 4;
const CLAUDE_CHUNK_BASE_RETRY_MS = 700;
const CLAUDE_CHUNK_MAX_RETRY_MS = 10_000;
const STYLE_OR_SCRIPT_BLOCK_REGEX = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TEXT_BETWEEN_TAGS_REGEX = />([^<>]+)</g;

const DEFAULT_PROMPT: ClaudePromptDraft = {
  systemPrompt:
    'You are a professional PDF translation engine. Preserve structure, meaning, terminology, and numbering fidelity.',
  translationPrompt:
    'Translate for the target language while preserving legal, technical, and formatting intent. Return fluent, faithful output.',
};

const DEFAULT_ENGINE: ClaudeEngineDraft = {
  model: 'claude-sonnet-4-6',
  temperature: 0.2,
  maxTokens: 4000,
  batchSize: 12,
  usePromptCaching: true,
  useFilesApi: true,
};

const DEFAULT_LANGUAGE = SUPPORTED_LANGUAGES.find((language) => language.code === 'hi-IN') ?? SUPPORTED_LANGUAGES[0];

const INITIAL_STATE: ClaudeWorkflowState = {
  stage: 'idle',
  file: null,
  fileUrl: null,
  fileName: '',
  totalPages: 0,
  targetLanguage: DEFAULT_LANGUAGE,
  prompt: DEFAULT_PROMPT,
  engine: DEFAULT_ENGINE,
  convertedPages: [],
  translatedPages: [],
  translatedDocumentHtml: '',
  selectedTranslatedPage: 1,
  conversionConfidence: null,
  progress: null,
  runSummary: null,
  translationArtifacts: null,
  error: null,
};

interface ClaudeTranslateRoutePayload {
  translatedPages?: string[];
  pageMetrics?: ClaudeArtifactPageMetric[];
  summary?: {
    pageCount?: number;
    translatedBlocks?: number;
    failedBlocks?: number;
    memoryHits?: number;
    qualityIssues?: number;
  };
  warnings?: string[];
  usage?: ClaudeRunSummary['usage'];
  cost?: ClaudeRunSummary['cost'];
  quality?: {
    issues?: ClaudeArtifactQualityIssue[];
    summary?: ClaudeArtifactQualitySummary;
  };
  contractVersion?: string;
  provider?: {
    model?: string;
  };
  error?: string;
}

interface ClaudeTranslationChunk {
  startPageIndex: number;
  pages: string[];
}

function validateClaudePdfFile(file: File): string | null {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    return 'Only PDF files are accepted.';
  }

  if (file.size > CLAUDE_MAX_FILE_SIZE_BYTES) {
    return `File size exceeds ${CLAUDE_MAX_FILE_SIZE_LABEL}. Please upload a smaller file.`;
  }

  return null;
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

function splitPagesIntoClaudeChunks(pages: string[]): ClaudeTranslationChunk[] {
  const chunks: ClaudeTranslationChunk[] = [];

  let startPageIndex = 0;
  let currentPages: string[] = [];
  let currentTextChars = 0;

  pages.forEach((page, index) => {
    const pageTextChars = estimateTranslatableChars(page);

    if (pageTextChars > CLAUDE_MAX_PAGE_CHARS) {
      throw new Error(
        `Page ${index + 1} has too much translatable text. Maximum per-page text size is ${CLAUDE_MAX_PAGE_CHARS} characters.`
      );
    }

    const pageLimitReached = currentPages.length >= CLAUDE_MAX_PAGES_PER_REQUEST;
    const charLimitReached = currentTextChars + pageTextChars > CLAUDE_MAX_TOTAL_CHARS_PER_REQUEST;

    if (currentPages.length > 0 && (pageLimitReached || charLimitReached)) {
      chunks.push({
        startPageIndex,
        pages: currentPages,
      });
      startPageIndex = index;
      currentPages = [];
      currentTextChars = 0;
    }

    currentPages.push(page);
    currentTextChars += pageTextChars;
  });

  if (currentPages.length > 0) {
    chunks.push({
      startPageIndex,
      pages: currentPages,
    });
  }

  return chunks;
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
  const expDelay = Math.min(CLAUDE_CHUNK_MAX_RETRY_MS, CLAUDE_CHUNK_BASE_RETRY_MS * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 250);
  const fallbackDelay = expDelay + jitter;

  if (retryAfterMs === null) {
    return fallbackDelay;
  }

  return Math.max(retryAfterMs, fallbackDelay);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeTranslatePayload(payload: ClaudeTranslateRoutePayload) {
  const usage = payload.usage;
  const cost = payload.cost;

  const translatedPages = Array.isArray(payload.translatedPages)
    ? payload.translatedPages.filter((page): page is string => typeof page === 'string')
    : [];

  const pageMetrics = Array.isArray(payload.pageMetrics)
    ? payload.pageMetrics.filter(
        (metric): metric is ClaudeArtifactPageMetric =>
          typeof metric?.pageNumber === 'number' &&
          typeof metric?.totalBlocks === 'number' &&
          typeof metric?.translatedBlocks === 'number' &&
          typeof metric?.failedBlocks === 'number' &&
          typeof metric?.memoryHits === 'number'
      )
    : [];

  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.filter((warning): warning is string => typeof warning === 'string' && warning.trim().length > 0)
    : [];

  const qualityIssues = Array.isArray(payload.quality?.issues)
    ? payload.quality.issues.filter(
        (issue): issue is ClaudeArtifactQualityIssue =>
          typeof issue?.pageNumber === 'number' &&
          typeof issue?.blockId === 'string' &&
          (issue?.type === 'numeric-mismatch' || issue?.type === 'consistency-overridden') &&
          typeof issue?.message === 'string'
      )
    : [];

  const qualitySummary: ClaudeArtifactQualitySummary | null =
    typeof payload.quality?.summary?.totalIssues === 'number' &&
    typeof payload.quality?.summary?.numericMismatches === 'number' &&
    typeof payload.quality?.summary?.consistencyOverrides === 'number'
      ? payload.quality.summary
      : null;

  const summary =
    typeof payload.summary?.pageCount === 'number' &&
    typeof payload.summary?.translatedBlocks === 'number' &&
    typeof payload.summary?.failedBlocks === 'number' &&
    typeof payload.summary?.memoryHits === 'number' &&
    typeof payload.summary?.qualityIssues === 'number'
      ? {
          pageCount: payload.summary.pageCount,
          translatedBlocks: payload.summary.translatedBlocks,
          failedBlocks: payload.summary.failedBlocks,
          memoryHits: payload.summary.memoryHits,
          qualityIssues: payload.summary.qualityIssues,
        }
      : null;

  const hasUsageSummary =
    usage &&
    typeof usage.inputTokens === 'number' &&
    typeof usage.outputTokens === 'number' &&
    typeof usage.cacheCreationInputTokens === 'number' &&
    typeof usage.cacheReadInputTokens === 'number' &&
    typeof usage.totalTokens === 'number' &&
    cost &&
    typeof cost.model === 'string' &&
    typeof cost.estimatedUsd === 'number';

  const runSummary: ClaudeRunSummary | null = hasUsageSummary
    ? {
        usage,
        cost,
      }
    : null;

  return {
    translatedPages,
    pageMetrics,
    warnings,
    qualityIssues,
    qualitySummary,
    summary,
    runSummary,
    contractVersion: typeof payload.contractVersion === 'string' ? payload.contractVersion : null,
    providerModel: typeof payload.provider?.model === 'string' ? payload.provider.model : null,
  };
}

async function postClaudeTranslationChunkWithRetry(args: {
  file: File;
  pages: string[];
  targetLanguageCode: string;
  prompt: ClaudePromptDraft;
  engine: ClaudeEngineDraft;
  claudeApiKey: string;
}): Promise<Response> {
  const { file, pages, targetLanguageCode, prompt, engine, claudeApiKey } = args;

  for (let attempt = 0; attempt <= CLAUDE_CHUNK_MAX_RETRIES; attempt += 1) {
    const requestPayload = new FormData();
    requestPayload.append('pdf', file, file.name);
    requestPayload.append('pages', JSON.stringify(pages));
    requestPayload.append('targetLanguage', targetLanguageCode);
    requestPayload.append('prompt', JSON.stringify(prompt));
    requestPayload.append('options', JSON.stringify(engine));

    const response = await fetch('/api/pdf-claude/translate', {
      method: 'POST',
      headers: {
        'x-claude-api-key': claudeApiKey,
      },
      body: requestPayload,
    });

    if (response.ok) {
      return response;
    }

    const shouldRetry = response.status === 429 || response.status >= 500;
    if (!shouldRetry || attempt === CLAUDE_CHUNK_MAX_RETRIES) {
      return response;
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    await sleep(getRetryDelayMs(attempt, retryAfterMs));
  }

  throw new Error('Chunk request failed unexpectedly.');
}

interface StoredApiKeys {
  claude?: string;
  [key: string]: unknown;
}

function getStoredClaudeApiKey(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as StoredApiKeys;
    if (typeof parsed.claude !== 'string') {
      return null;
    }

    const trimmed = parsed.claude.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function createProgress(phase: ClaudeWorkflowProgress['phase'], message: string, percent: number): ClaudeWorkflowProgress {
  return {
    phase,
    message,
    percent: Math.max(0, Math.min(100, percent)),
  };
}

export function useClaudePdfWorkflow() {
  const [state, setState] = useState<ClaudeWorkflowState>(INITIAL_STATE);

  useEffect(() => {
    return () => {
      if (state.fileUrl) {
        URL.revokeObjectURL(state.fileUrl);
      }
    };
  }, [state.fileUrl]);

  const canStartTranslation = useMemo(() => {
    return state.file !== null && (state.stage === 'sourceReady' || state.stage === 'error' || state.stage === 'translatedReady');
  }, [state.file, state.stage]);

  const canDownload = useMemo(() => {
    return state.translatedPages.length > 0 && state.translatedDocumentHtml.length > 0;
  }, [state.translatedDocumentHtml, state.translatedPages.length]);

  const setError = useCallback((message: string) => {
    setState((prev) => ({
      ...prev,
      stage: 'error',
      error: message,
    }));
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const setFile = useCallback((file: File) => {
    const fileValidationError = validateClaudePdfFile(file);
    if (fileValidationError) {
      setError(fileValidationError);
      return;
    }

    const fileUrl = URL.createObjectURL(file);

    setState((prev) => {
      if (prev.fileUrl) {
        URL.revokeObjectURL(prev.fileUrl);
      }

      return {
        ...prev,
        stage: 'sourceReady',
        file,
        fileUrl,
        fileName: file.name,
        totalPages: 0,
        convertedPages: [],
        translatedPages: [],
        translatedDocumentHtml: '',
        selectedTranslatedPage: 1,
        conversionConfidence: null,
        progress: null,
        runSummary: null,
        translationArtifacts: null,
        error: null,
      };
    });
  }, [setError]);

  const setPrompt = useCallback((next: ClaudePromptDraft) => {
    setState((prev) => ({ ...prev, prompt: next }));
  }, []);

  const setEngine = useCallback((next: ClaudeEngineDraft) => {
    setState((prev) => ({ ...prev, engine: next }));
  }, []);

  const setTargetLanguage = useCallback((languageCode: string) => {
    const match = SUPPORTED_LANGUAGES.find((language) => language.code === languageCode);
    if (!match) {
      return;
    }

    setState((prev) => ({ ...prev, targetLanguage: match }));
  }, []);

  const setSelectedTranslatedPage = useCallback((nextPage: number) => {
    setState((prev) => {
      const maxPage = Math.max(1, prev.translatedPages.length);
      const clamped = Math.max(1, Math.min(nextPage, maxPage));
      return {
        ...prev,
        selectedTranslatedPage: clamped,
      };
    });
  }, []);

  const updateTranslatedPage = useCallback((pageIndex: number, nextHtml: string) => {
    setState((prev) => {
      if (pageIndex < 0 || pageIndex >= prev.translatedPages.length) {
        return prev;
      }

      const nextPages = [...prev.translatedPages];
      nextPages[pageIndex] = nextHtml;

      return {
        ...prev,
        translatedPages: nextPages,
        translatedDocumentHtml: reconstructPortableHtml(nextPages, 'Claude PDF Translation'),
      };
    });
  }, []);

  const reset = useCallback(() => {
    setState((prev) => {
      if (prev.fileUrl) {
        URL.revokeObjectURL(prev.fileUrl);
      }
      return INITIAL_STATE;
    });
  }, []);

  const startTranslation = useCallback(async () => {
    const currentFile = state.file;
    if (!currentFile) {
      setError('Upload a PDF before starting translation.');
      return;
    }

    const claudeKey = getStoredClaudeApiKey();
    if (!claudeKey) {
      setError('Claude API key is missing. Open Settings and save your Claude key.');
      return;
    }

    try {
      setState((prev) => ({
        ...prev,
        stage: 'converting',
        progress: createProgress('convert', 'Converting PDF to portable HTML...', 5),
        runSummary: null,
        translationArtifacts: null,
        error: null,
      }));

      const converted = await convertPdfToHtml(currentFile, {
        confidence: {
          enabled: true,
        },
        onProgress: (progress) => {
          setState((prev) => ({
            ...prev,
            progress: createProgress('convert', progress.statusMessage, progress.progress),
          }));
        },
      });

      const extractedPages = extractPagesFromHtml(converted.html);
      if (extractedPages.length === 0) {
        throw new Error('Unable to extract page content from converted PDF.');
      }

      const translationChunks = splitPagesIntoClaudeChunks(extractedPages);

      setState((prev) => ({
        ...prev,
        totalPages: converted.pageCount,
        convertedPages: extractedPages,
        conversionConfidence: converted.confidenceDiagnostics ?? null,
        stage: 'translating',
        progress: createProgress(
          'analyze',
          `Running document-level PDF analysis with Claude (1/${translationChunks.length})...`,
          62
        ),
      }));

      const translatedPagesByIndex: string[] = new Array(extractedPages.length).fill('');
      const mergedPageMetrics: ClaudeArtifactPageMetric[] = [];
      const mergedWarnings: string[] = [];
      const mergedQualityIssues: ClaudeArtifactQualityIssue[] = [];

      const mergedQualitySummary: ClaudeArtifactQualitySummary = {
        totalIssues: 0,
        numericMismatches: 0,
        consistencyOverrides: 0,
      };

      const mergedSummary = {
        pageCount: extractedPages.length,
        translatedBlocks: 0,
        failedBlocks: 0,
        memoryHits: 0,
        qualityIssues: 0,
      };

      let mergedRunSummary: ClaudeRunSummary = {
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          totalTokens: 0,
        },
        cost: {
          model: '',
          currency: 'USD',
          estimatedUsd: 0,
          inputCostUsd: 0,
          outputCostUsd: 0,
          cacheWriteCostUsd: 0,
          cacheReadCostUsd: 0,
          note: '',
        },
      };
      let hasMergedRunSummary = false;
      let contractVersion: string | null = null;
      let providerModel: string | null = null;

      for (let chunkIndex = 0; chunkIndex < translationChunks.length; chunkIndex += 1) {
        const chunk = translationChunks[chunkIndex];
        const chunkNumber = chunkIndex + 1;

        const progressPercent = 62 + Math.floor((chunkNumber / translationChunks.length) * 34);

        setState((prev) => ({
          ...prev,
          stage: 'translating',
          progress: createProgress(
            chunkNumber === 1 ? 'analyze' : 'translate',
            `Translating pages ${chunk.startPageIndex + 1}-${chunk.startPageIndex + chunk.pages.length} (${chunkNumber}/${translationChunks.length})...`,
            progressPercent
          ),
        }));

        const translationResponse = await postClaudeTranslationChunkWithRetry({
          file: currentFile,
          pages: chunk.pages,
          targetLanguageCode: state.targetLanguage.code,
          prompt: state.prompt,
          engine: state.engine,
          claudeApiKey: claudeKey,
        });

        if (!translationResponse.ok) {
          const payload = (await translationResponse.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || 'Claude translation request failed.');
        }

        const payload = normalizeTranslatePayload((await translationResponse.json()) as ClaudeTranslateRoutePayload);

        if (payload.translatedPages.length !== chunk.pages.length) {
          throw new Error('Claude returned an unexpected number of translated pages for a chunk.');
        }

        payload.translatedPages.forEach((translatedPage, pageOffset) => {
          translatedPagesByIndex[chunk.startPageIndex + pageOffset] = translatedPage;
        });

        mergedPageMetrics.push(
          ...payload.pageMetrics.map((metric) => ({
            ...metric,
            pageNumber: metric.pageNumber + chunk.startPageIndex,
          }))
        );

        const warningsWithChunkPrefix = payload.warnings.map((warning) =>
          translationChunks.length > 1 ? `[Chunk ${chunkNumber}/${translationChunks.length}] ${warning}` : warning
        );
        mergedWarnings.push(...warningsWithChunkPrefix);

        mergedQualityIssues.push(
          ...payload.qualityIssues.map((issue) => ({
            ...issue,
            pageNumber: issue.pageNumber + chunk.startPageIndex,
          }))
        );

        if (payload.summary) {
          mergedSummary.translatedBlocks += payload.summary.translatedBlocks;
          mergedSummary.failedBlocks += payload.summary.failedBlocks;
          mergedSummary.memoryHits += payload.summary.memoryHits;
          mergedSummary.qualityIssues += payload.summary.qualityIssues;
        }

        if (payload.qualitySummary) {
          mergedQualitySummary.totalIssues += payload.qualitySummary.totalIssues;
          mergedQualitySummary.numericMismatches += payload.qualitySummary.numericMismatches;
          mergedQualitySummary.consistencyOverrides += payload.qualitySummary.consistencyOverrides;
        }

        if (payload.runSummary) {
          mergedRunSummary = {
            usage: {
              inputTokens: mergedRunSummary.usage.inputTokens + payload.runSummary.usage.inputTokens,
              outputTokens: mergedRunSummary.usage.outputTokens + payload.runSummary.usage.outputTokens,
              cacheCreationInputTokens:
                mergedRunSummary.usage.cacheCreationInputTokens + payload.runSummary.usage.cacheCreationInputTokens,
              cacheReadInputTokens:
                mergedRunSummary.usage.cacheReadInputTokens + payload.runSummary.usage.cacheReadInputTokens,
              totalTokens: mergedRunSummary.usage.totalTokens + payload.runSummary.usage.totalTokens,
            },
            cost: {
              ...mergedRunSummary.cost,
              model: mergedRunSummary.cost.model || payload.runSummary.cost.model,
              currency: payload.runSummary.cost.currency,
              estimatedUsd: mergedRunSummary.cost.estimatedUsd + payload.runSummary.cost.estimatedUsd,
              inputCostUsd: mergedRunSummary.cost.inputCostUsd + payload.runSummary.cost.inputCostUsd,
              outputCostUsd: mergedRunSummary.cost.outputCostUsd + payload.runSummary.cost.outputCostUsd,
              cacheWriteCostUsd: mergedRunSummary.cost.cacheWriteCostUsd + payload.runSummary.cost.cacheWriteCostUsd,
              cacheReadCostUsd: mergedRunSummary.cost.cacheReadCostUsd + payload.runSummary.cost.cacheReadCostUsd,
              note: payload.runSummary.cost.note,
            },
          };
          hasMergedRunSummary = true;
        }

        if (!contractVersion && payload.contractVersion) {
          contractVersion = payload.contractVersion;
        }

        if (!providerModel && payload.providerModel) {
          providerModel = payload.providerModel;
        }
      }

      const translatedPages = translatedPagesByIndex.filter((page) => page.trim().length > 0);
      if (translatedPages.length !== extractedPages.length) {
        throw new Error('Claude returned an incomplete translated document.');
      }

      const translationArtifacts: ClaudeTranslationArtifacts = {
        pageMetrics: mergedPageMetrics,
        warnings: mergedWarnings,
        summary: mergedSummary,
        quality: {
          issues: mergedQualityIssues,
          summary: mergedQualitySummary,
        },
        contractVersion,
        providerModel,
      };

      const failedBlocks = mergedSummary.failedBlocks;
      if (failedBlocks > 0) {
        const warningText = mergedWarnings[0] ?? null;
        const partialWarning = warningText
          ? `Translation partially failed (${failedBlocks} blocks). ${warningText}`
          : `Translation partially failed (${failedBlocks} blocks).`;

        setState((prev) => ({
          ...prev,
          stage: 'translatedReady',
          translatedPages,
          translatedDocumentHtml: reconstructPortableHtml(translatedPages, 'Claude PDF Translation'),
          selectedTranslatedPage: 1,
          progress: createProgress('done', 'Translation completed with warnings.', 100),
          runSummary: hasMergedRunSummary ? mergedRunSummary : null,
          translationArtifacts,
          error: partialWarning,
        }));

        return;
      }

      setState((prev) => ({
        ...prev,
        stage: 'translatedReady',
        translatedPages,
        translatedDocumentHtml: reconstructPortableHtml(translatedPages, 'Claude PDF Translation'),
        selectedTranslatedPage: 1,
        progress: createProgress('done', 'Translation complete.', 100),
        runSummary: hasMergedRunSummary ? mergedRunSummary : null,
        translationArtifacts,
        error: null,
      }));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unexpected translation failure.');
    }
  }, [setError, state.engine, state.file, state.prompt, state.targetLanguage.code]);

  const downloadTranslatedPdf = useCallback(async () => {
    if (!state.translatedDocumentHtml) {
      return;
    }

    try {
      setState((prev) => ({
        ...prev,
        stage: 'downloading',
        progress: createProgress('done', 'Preparing printable PDF output...', 100),
      }));

      const printableHtml = buildPdfPrintHtml(state.translatedDocumentHtml, 'claude-translated-document');
      await printHtmlWithHiddenIframe(printableHtml);

      setState((prev) => ({
        ...prev,
        stage: 'translatedReady',
      }));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to prepare PDF download.');
    }
  }, [setError, state.translatedDocumentHtml]);

  return {
    state,
    canStartTranslation,
    canDownload,
    setError,
    setFile,
    setPrompt,
    setEngine,
    setTargetLanguage,
    setSelectedTranslatedPage,
    updateTranslatedPage,
    startTranslation,
    downloadTranslatedPdf,
    clearError,
    reset,
  };
}
