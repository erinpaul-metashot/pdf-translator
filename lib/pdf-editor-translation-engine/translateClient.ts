const DEFAULT_TIMEOUT_MS = 25000;
const API_KEY_STORAGE_KEY = 'pdfTranslator.apiKeys.v1';
const MAX_PARALLEL_REQUESTS = 1;
const REQUEST_START_INTERVAL_MS = 700;
const BASE_RETRY_BACKOFF_MS = 800;
const MAX_RETRY_BACKOFF_MS = 8000;
const RATE_LIMIT_COOLDOWN_FLOOR_MS = 1500;

interface QueueJob {
  execute: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface TranslateApiErrorResponse {
  error?: string;
  errorCode?: string;
  retriable?: boolean;
  retryAfterMs?: number;
}

const queuedJobs: QueueJob[] = [];
let activeRequests = 0;
let nextAllowedRequestAt = 0;
let queueWakeTimer: ReturnType<typeof setTimeout> | null = null;
let queueWakeAt = 0;

class RetriableError extends Error {
  retriable: boolean;
  retryAfterMs: number | null;

  constructor(message: string, retriable: boolean, retryAfterMs: number | null = null) {
    super(message);
    this.retriable = retriable;
    this.retryAfterMs = retryAfterMs;
  }
}

interface TranslateTextResponse {
  translatedText?: string;
  error?: string;
}

function parseRetryAfterMs(rawValue: string | null): number | null {
  if (!rawValue) {
    return null;
  }

  const seconds = Number(rawValue);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.floor(seconds * 1000);
  }

  const asDate = Date.parse(rawValue);
  if (Number.isNaN(asDate)) {
    return null;
  }

  const waitMs = asDate - Date.now();
  return waitMs > 0 ? waitMs : null;
}

function parseTranslateApiError(rawText: string): TranslateApiErrorResponse | null {
  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText) as TranslateApiErrorResponse;
  } catch {
    return null;
  }
}

function getStoredSarvamApiKey(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const value = (parsed as Record<string, unknown>).sarvam;
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function scheduleQueueProcessing(waitMs: number): void {
  const dueAt = Date.now() + waitMs;

  if (queueWakeTimer && queueWakeAt <= dueAt) {
    return;
  }

  if (queueWakeTimer) {
    clearTimeout(queueWakeTimer);
  }

  queueWakeAt = dueAt;

  queueWakeTimer = setTimeout(() => {
    queueWakeTimer = null;
    queueWakeAt = 0;
    processRequestQueue();
  }, waitMs);
}

function applyGlobalRateLimitCooldown(retryAfterMs: number | null): void {
  const cooldownMs = Math.max(
    RATE_LIMIT_COOLDOWN_FLOOR_MS,
    typeof retryAfterMs === 'number' && retryAfterMs > 0 ? retryAfterMs : 0
  );
  nextAllowedRequestAt = Math.max(nextAllowedRequestAt, Date.now() + cooldownMs);
  scheduleQueueProcessing(cooldownMs);
}

function processRequestQueue(): void {
  if (queuedJobs.length === 0) {
    return;
  }

  if (activeRequests >= MAX_PARALLEL_REQUESTS) {
    return;
  }

  const waitMs = Math.max(0, nextAllowedRequestAt - Date.now());
  if (waitMs > 0) {
    scheduleQueueProcessing(waitMs);
    return;
  }

  const nextJob = queuedJobs.shift();
  if (!nextJob) {
    return;
  }

  activeRequests += 1;
  nextAllowedRequestAt = Date.now() + REQUEST_START_INTERVAL_MS;

  void nextJob
    .execute()
    .then((value) => {
      nextJob.resolve(value);
    })
    .catch((error) => {
      nextJob.reject(error);
    })
    .finally(() => {
      activeRequests = Math.max(0, activeRequests - 1);
      processRequestQueue();
    });

  if (activeRequests < MAX_PARALLEL_REQUESTS) {
    processRequestQueue();
  }
}

function runWithRequestLimiter<T>(execute: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queuedJobs.push({
      execute: execute as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    processRequestQueue();
  });
}

function resolveRetryDelayMs(attempt: number, retryAfterMs: number | null): number {
  const exponentialDelayMs = Math.min(
    MAX_RETRY_BACKOFF_MS,
    BASE_RETRY_BACKOFF_MS * (2 ** attempt)
  );
  const jitterFloorMs = Math.max(250, Math.floor(exponentialDelayMs / 2));
  const jitterDelayMs =
    jitterFloorMs + Math.floor(Math.random() * (exponentialDelayMs - jitterFloorMs + 1));

  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return Math.max(retryAfterMs, jitterDelayMs, RATE_LIMIT_COOLDOWN_FLOOR_MS);
  }

  return jitterDelayMs;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout();
      reject(new RetriableError('Translation request timed out', true));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function translateTextViaApi(params: {
  text: string;
  targetLang: string;
  sourceLang?: string;
  maxRetries: number;
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sarvamApiKey = getStoredSarvamApiKey();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= params.maxRetries; attempt += 1) {
    try {
      const controller = new AbortController();
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (sarvamApiKey) {
        requestHeaders['x-sarvam-api-key'] = sarvamApiKey;
      }

      const response = await runWithRequestLimiter(() =>
        withTimeout(
          fetch('/api/translate/text', {
            method: 'POST',
            headers: requestHeaders,
            signal: controller.signal,
            body: JSON.stringify({
              text: params.text,
              sourceLang: params.sourceLang ?? 'auto',
              targetLang: params.targetLang,
            }),
          }),
          timeoutMs,
          () => controller.abort()
        )
      );

      if (!response.ok) {
        const responseText = await response.text();
        const parsedError = parseTranslateApiError(responseText);
        const retryAfterMs =
          parsedError?.retryAfterMs ?? parseRetryAfterMs(response.headers.get('Retry-After'));
        const isRetriable =
          typeof parsedError?.retriable === 'boolean'
            ? parsedError.retriable
            : response.status === 429 || response.status >= 500;
        const message =
          parsedError?.error ||
          responseText ||
          `Translation request failed (${response.status})`;

        if (response.status === 429) {
          applyGlobalRateLimitCooldown(retryAfterMs);
        }

        throw new RetriableError(
          `Translation request failed (${response.status}): ${message}`,
          isRetriable,
          retryAfterMs
        );
      }

      const data = (await response.json()) as TranslateTextResponse;
      if (!data.translatedText) {
        throw new Error(data.error || 'Translation response missing translatedText');
      }

      return data.translatedText;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      const retriable =
        (normalizedError instanceof RetriableError && normalizedError.retriable) ||
        (normalizedError instanceof DOMException && normalizedError.name === 'AbortError');
      const retryAfterMs =
        normalizedError instanceof RetriableError ? normalizedError.retryAfterMs : null;

      if (retriable) {
        applyGlobalRateLimitCooldown(retryAfterMs);
      }

      lastError = normalizedError;

      if (!retriable || attempt === params.maxRetries) {
        break;
      }

      await delay(resolveRetryDelayMs(attempt, retryAfterMs));
    }
  }

  throw lastError ?? new Error('Translation request failed');
}
