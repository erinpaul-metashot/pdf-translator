const DEFAULT_TIMEOUT_MS = 25000;
const API_KEY_STORAGE_KEY = 'pdfTranslator.apiKeys.v1';

class RetriableError extends Error {
  retriable: boolean;

  constructor(message: string, retriable: boolean) {
    super(message);
    this.retriable = retriable;
  }
}

interface TranslateTextResponse {
  translatedText?: string;
  error?: string;
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

      const response = await withTimeout(
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
      );

      if (!response.ok) {
        const isRetriable = response.status === 429 || response.status >= 500;
        const responseText = await response.text();
        throw new RetriableError(
          `Translation request failed (${response.status}): ${responseText || 'Unknown error'}`,
          isRetriable
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

      lastError = normalizedError;

      if (!retriable || attempt === params.maxRetries) {
        break;
      }

      await delay(250 * (2 ** attempt));
    }
  }

  throw lastError ?? new Error('Translation request failed');
}
