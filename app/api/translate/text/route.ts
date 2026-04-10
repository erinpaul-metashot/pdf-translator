import { NextRequest } from 'next/server';
import { normalizeLanguageCode } from '../../../lib/languageCodes';

const DEFAULT_SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const SARVAM_BASE = process.env.SARVAM_API_BASE_URL || 'https://api.sarvam.ai';
const MAX_UPSTREAM_TRANSLATE_RETRIES = 2;
const BASE_UPSTREAM_BACKOFF_MS = 700;
const MAX_UPSTREAM_BACKOFF_MS = 9000;
const MIN_RATE_LIMIT_BACKOFF_MS = 1200;

export const dynamic = 'force-dynamic';

interface SarvamErrorBody {
  error?: {
    message?: string;
    code?: string;
    request_id?: string;
  };
}

interface ClassifiedError {
  status: number;
  retriable: boolean;
  message: string;
  code: string;
  providerRequestId: string | null;
  retryAfterMs: number | null;
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

function parseSarvamErrorBody(rawText: string): SarvamErrorBody {
  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText) as SarvamErrorBody;
  } catch {
    return {};
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveUpstreamRetryDelayMs(
  attempt: number,
  retryAfterMs: number | null,
  isRateLimited: boolean
): number {
  const exponentialDelayMs = Math.min(
    MAX_UPSTREAM_BACKOFF_MS,
    BASE_UPSTREAM_BACKOFF_MS * (2 ** attempt)
  );

  const jitterFloorMs = Math.max(300, Math.floor(exponentialDelayMs / 2));
  const jitterDelayMs =
    jitterFloorMs + Math.floor(Math.random() * (exponentialDelayMs - jitterFloorMs + 1));

  const rateLimitFloorMs = isRateLimited ? MIN_RATE_LIMIT_BACKOFF_MS : 0;

  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return Math.max(retryAfterMs, jitterDelayMs, rateLimitFloorMs);
  }

  return Math.max(jitterDelayMs, rateLimitFloorMs);
}

function classifyUpstreamError(params: {
  upstreamStatus: number;
  upstreamBodyText: string;
  retryAfterHeader: string | null;
}): ClassifiedError {
  const parsed = parseSarvamErrorBody(params.upstreamBodyText);
  const errorCode = parsed.error?.code ?? 'upstream_error';
  const message = parsed.error?.message || `Translation failed: ${params.upstreamStatus}`;
  const providerRequestId = parsed.error?.request_id ?? null;
  const retryAfterMs = parseRetryAfterMs(params.retryAfterHeader);

  if (errorCode === 'insufficient_quota_error') {
    return {
      status: 429,
      retriable: false,
      message,
      code: errorCode,
      providerRequestId,
      retryAfterMs,
    };
  }

  if (errorCode === 'rate_limit_exceeded_error' || params.upstreamStatus === 429) {
    return {
      status: 429,
      retriable: true,
      message,
      code: errorCode,
      providerRequestId,
      retryAfterMs,
    };
  }

  if (errorCode === 'invalid_request_error' || params.upstreamStatus === 400 || params.upstreamStatus === 422) {
    return {
      status: params.upstreamStatus === 422 ? 422 : 400,
      retriable: false,
      message,
      code: errorCode,
      providerRequestId,
      retryAfterMs: null,
    };
  }

  if (params.upstreamStatus === 401 || params.upstreamStatus === 403) {
    return {
      status: params.upstreamStatus,
      retriable: false,
      message,
      code: errorCode,
      providerRequestId,
      retryAfterMs: null,
    };
  }

  if (params.upstreamStatus >= 500) {
    return {
      status: 503,
      retriable: true,
      message,
      code: errorCode,
      providerRequestId,
      retryAfterMs,
    };
  }

  return {
    status: 502,
    retriable: false,
    message,
    code: errorCode,
    providerRequestId,
    retryAfterMs,
  };
}

function inferLikelySourceLanguage(inputText: string): string | null {
  const input = inputText.trim();
  if (!input) {
    return 'en-IN';
  }

  const hasAsciiLetters = /[A-Za-z]/.test(input);
  const hasNonAsciiChars = /[^\x00-\x7F]/.test(input);
  const hasEnglishSignal = /\b(the|and|is|are|of|to|for|with|that|this|you|your|from)\b/i.test(input);

  // Keep this conservative to avoid misclassifying non-English ASCII text.
  if (hasAsciiLetters && !hasNonAsciiChars && hasEnglishSignal) {
    return 'en-IN';
  }

  return null;
}

/**
 * POST /api/translate/text
 * Translates a single text block (used for AI-assisted editing).
 * Body: { text, sourceLang, targetLang }
 * Returns { translatedText }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, sourceLang, targetLang } = body as {
      text?: string;
      sourceLang?: string;
      targetLang?: string;
    };

    if (!text || !targetLang) {
      return Response.json(
        { error: 'Missing text or targetLang' },
        { status: 400 }
      );
    }

    const headerApiKey = request.headers.get('x-sarvam-api-key')?.trim();

    const resolvedApiKey = headerApiKey || DEFAULT_SARVAM_API_KEY;

    if (!resolvedApiKey) {
      return Response.json(
        { error: 'Sarvam API key is missing. Save a key in settings or set SARVAM_API_KEY.' },
        { status: 400 }
      );
    }

    const headers = {
      'api-subscription-key': resolvedApiKey,
      'Content-Type': 'application/json',
    };

    const normalizedTargetLang = normalizeLanguageCode(targetLang, 'hi-IN');
    const normalizedSourceLang =
      !sourceLang || sourceLang === 'auto'
        ? normalizeLanguageCode(
            inferLikelySourceLanguage(text) ?? (await detectSourceLanguage(text, headers)),
            'en-IN'
          )
        : normalizeLanguageCode(sourceLang, 'en-IN');

    if (normalizedSourceLang === normalizedTargetLang) {
      return Response.json(
        {
          translatedText: text,
          sourceLanguage: normalizedSourceLang,
          skipped: true,
          reason: 'Source and target languages are the same.',
        },
        { status: 200 }
      );
    }

    let translateResponse: Response | null = null;
    let lastClassifiedError: ClassifiedError | null = null;

    for (let attempt = 0; attempt <= MAX_UPSTREAM_TRANSLATE_RETRIES; attempt += 1) {
      let upstreamResponse: Response;

      try {
        upstreamResponse = await fetch(`${SARVAM_BASE}/translate`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            input: text.slice(0, 2000), // max 2000 chars for sarvam-translate
            source_language_code: normalizedSourceLang,
            target_language_code: normalizedTargetLang,
            model: 'sarvam-translate:v1',
            mode: 'formal',
          }),
        });
      } catch {
        lastClassifiedError = {
          status: 503,
          retriable: true,
          message: 'Translation failed: temporary upstream network error',
          code: 'upstream_network_error',
          providerRequestId: null,
          retryAfterMs: null,
        };

        if (attempt >= MAX_UPSTREAM_TRANSLATE_RETRIES) {
          break;
        }

        await delay(resolveUpstreamRetryDelayMs(attempt, null, false));
        continue;
      }

      if (upstreamResponse.ok) {
        translateResponse = upstreamResponse;
        break;
      }

      const upstreamBodyText = await upstreamResponse.text();
      const classifiedError = classifyUpstreamError({
        upstreamStatus: upstreamResponse.status,
        upstreamBodyText,
        retryAfterHeader: upstreamResponse.headers.get('retry-after'),
      });
      lastClassifiedError = classifiedError;

      const shouldRetry =
        classifiedError.retriable && attempt < MAX_UPSTREAM_TRANSLATE_RETRIES;

      if (!shouldRetry) {
        break;
      }

      await delay(
        resolveUpstreamRetryDelayMs(
          attempt,
          classifiedError.retryAfterMs,
          classifiedError.status === 429
        )
      );
    }

    if (!translateResponse) {
      const classifiedError =
        lastClassifiedError ??
        ({
          status: 502,
          retriable: false,
          message: 'Translation failed: upstream unavailable',
          code: 'upstream_error',
          providerRequestId: null,
          retryAfterMs: null,
        } satisfies ClassifiedError);

      console.error('Translation failed:', {
        upstreamStatus: classifiedError.status,
        errorCode: classifiedError.code,
        providerRequestId: classifiedError.providerRequestId,
        retriable: classifiedError.retriable,
        retryAfterMs: classifiedError.retryAfterMs,
      });

      const responseHeaders = new Headers();
      if (typeof classifiedError.retryAfterMs === 'number' && classifiedError.retryAfterMs > 0) {
        responseHeaders.set('Retry-After', String(Math.ceil(classifiedError.retryAfterMs / 1000)));
      }

      return Response.json(
        {
          error: classifiedError.message,
          errorCode: classifiedError.code,
          retriable: classifiedError.retriable,
          retryAfterMs: classifiedError.retryAfterMs,
          providerRequestId: classifiedError.providerRequestId,
        },
        {
          status: classifiedError.status,
          headers: responseHeaders,
        }
      );
    }

    const data = await translateResponse.json();

    return Response.json({
      translatedText: data.translated_text,
      sourceLanguage: data.source_language_code,
    });
  } catch (err) {
    console.error('Text translation error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

async function detectSourceLanguage(
  text: string,
  headers: Record<string, string>
): Promise<string> {
  const input = text.trim().slice(0, 1000);
  if (!input) {
    return 'en-IN';
  }

  try {
    const res = await fetch(`${SARVAM_BASE}/text-lid`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input }),
    });

    if (!res.ok) {
      return 'en-IN';
    }

    const data = await res.json();
    return normalizeLanguageCode(data.language_code ?? null, 'en-IN');
  } catch {
    return 'en-IN';
  }
}
