import { NextRequest } from 'next/server';
import { normalizeLanguageCode } from '../../../lib/languageCodes';

const DEFAULT_SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const SARVAM_BASE = process.env.SARVAM_API_BASE_URL || 'https://api.sarvam.ai';

export const dynamic = 'force-dynamic';

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
        ? await detectSourceLanguage(text, headers)
        : normalizeLanguageCode(sourceLang, 'en-IN');

    const res = await fetch(`${SARVAM_BASE}/translate`, {
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

    if (!res.ok) {
      const errText = await res.text();
      console.error('Translation failed:', errText);
      return Response.json(
        { error: `Translation failed: ${res.status}` },
        { status: 500 }
      );
    }

    const data = await res.json();

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
