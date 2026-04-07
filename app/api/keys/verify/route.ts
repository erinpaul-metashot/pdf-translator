import { NextRequest } from 'next/server';

type ApiProvider = 'openai' | 'claude' | 'gemini' | 'sarvam';

interface VerifyRequestBody {
  provider?: ApiProvider;
  key?: string;
}

interface RateLimitBucket {
  count: number;
  startedAt: number;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const verifyRateLimitStore = new Map<string, RateLimitBucket>();

function getTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(10000);
}

function getUnauthorizedMessage(provider: ApiProvider): string {
  switch (provider) {
    case 'openai':
      return 'OpenAI key is invalid or does not have access.';
    case 'claude':
      return 'Claude key is invalid or does not have access.';
    case 'gemini':
      return 'Gemini key is invalid or does not have access.';
    case 'sarvam':
      return 'Sarvam key is invalid or does not have access.';
    default:
      return 'API key is invalid.';
  }
}

function getClientKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  return request.headers.get('x-real-ip') || 'unknown-client';
}

function isRateLimited(clientKey: string): boolean {
  const now = Date.now();
  const bucket = verifyRateLimitStore.get(clientKey);

  if (!bucket || now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) {
    verifyRateLimitStore.set(clientKey, { count: 1, startedAt: now });
    return false;
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  verifyRateLimitStore.set(clientKey, {
    ...bucket,
    count: bucket.count + 1,
  });

  return false;
}

async function verifyOpenAiKey(key: string): Promise<{ valid: boolean; message: string }> {
  const response = await fetch('https://api.openai.com/v1/models', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
    },
    signal: getTimeoutSignal(),
    cache: 'no-store',
  });

  if (response.ok) {
    return { valid: true, message: 'OpenAI key is working.' };
  }

  if (response.status === 401 || response.status === 403) {
    return { valid: false, message: getUnauthorizedMessage('openai') };
  }

  return {
    valid: false,
    message: `OpenAI verification failed (${response.status}).`,
  };
}

async function verifyClaudeKey(key: string): Promise<{ valid: boolean; message: string }> {
  const response = await fetch('https://api.anthropic.com/v1/models', {
    method: 'GET',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    signal: getTimeoutSignal(),
    cache: 'no-store',
  });

  if (response.ok) {
    return { valid: true, message: 'Claude key is working.' };
  }

  if (response.status === 401 || response.status === 403) {
    return { valid: false, message: getUnauthorizedMessage('claude') };
  }

  return {
    valid: false,
    message: `Claude verification failed (${response.status}).`,
  };
}

async function verifyGeminiKey(key: string): Promise<{ valid: boolean; message: string }> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    {
      method: 'GET',
      signal: getTimeoutSignal(),
      cache: 'no-store',
    }
  );

  if (response.ok) {
    return { valid: true, message: 'Gemini key is working.' };
  }

  if (response.status === 401 || response.status === 403 || response.status === 400) {
    return { valid: false, message: getUnauthorizedMessage('gemini') };
  }

  return {
    valid: false,
    message: `Gemini verification failed (${response.status}).`,
  };
}

async function verifySarvamKey(key: string): Promise<{ valid: boolean; message: string }> {
  const response = await fetch('https://api.sarvam.ai/text-lid', {
    method: 'POST',
    headers: {
      'api-subscription-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: 'Hello' }),
    signal: getTimeoutSignal(),
    cache: 'no-store',
  });

  if (response.ok) {
    return { valid: true, message: 'Sarvam key is working.' };
  }

  if (response.status === 401 || response.status === 403) {
    return { valid: false, message: getUnauthorizedMessage('sarvam') };
  }

  return {
    valid: false,
    message: `Sarvam verification failed (${response.status}).`,
  };
}

export async function POST(request: NextRequest) {
  try {
    const clientKey = getClientKey(request);
    if (isRateLimited(clientKey)) {
      return Response.json(
        { valid: false, message: 'Too many verification attempts. Please wait and retry.' },
        { status: 429 }
      );
    }

    const body = (await request.json()) as VerifyRequestBody;
    const provider = body.provider;
    const key = body.key?.trim();

    if (!provider || !['openai', 'claude', 'gemini', 'sarvam'].includes(provider)) {
      return Response.json({ valid: false, message: 'Unsupported provider.' }, { status: 400 });
    }

    if (!key) {
      return Response.json({ valid: false, message: 'API key is required.' }, { status: 400 });
    }

    if (key.length < 8) {
      return Response.json({ valid: false, message: 'API key format looks invalid.' }, { status: 400 });
    }

    const verifierMap: Record<ApiProvider, (k: string) => Promise<{ valid: boolean; message: string }>> = {
      openai: verifyOpenAiKey,
      claude: verifyClaudeKey,
      gemini: verifyGeminiKey,
      sarvam: verifySarvamKey,
    };

    const result = await verifierMap[provider](key);

    return Response.json(result, { status: result.valid ? 200 : 400 });
  } catch {
    return Response.json(
      { valid: false, message: 'Unable to verify API key right now.' },
      { status: 500 }
    );
  }
}
