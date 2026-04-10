import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { normalizeLanguageCode } from '../../../lib/languageCodes';

const DEFAULT_SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const SARVAM_BASE = process.env.SARVAM_API_BASE_URL || 'https://api.sarvam.ai';
const TRANSLATE_RETRY_ATTEMPTS = 3;
const TRANSLATE_RETRY_BASE_MS = 500;
const TRANSLATE_RETRY_CAP_MS = 5000;

export const dynamic = 'force-dynamic';

interface SarvamTranslateError {
  message: string | null;
  code: string | null;
  requestId: string | null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function parseSarvamTranslateError(rawText: string): SarvamTranslateError {
  if (!rawText) {
    return {
      message: null,
      code: null,
      requestId: null,
    };
  }

  try {
    const parsed = JSON.parse(rawText) as {
      error?: {
        message?: string;
        code?: string;
        request_id?: string;
      };
    };

    return {
      message: parsed.error?.message ?? null,
      code: parsed.error?.code ?? null,
      requestId: parsed.error?.request_id ?? null,
    };
  } catch {
    return {
      message: null,
      code: null,
      requestId: null,
    };
  }
}

function isRetriableTranslateError(status: number, errorCode: string | null): boolean {
  if (errorCode === 'insufficient_quota_error') {
    return false;
  }

  if (errorCode === 'invalid_request_error') {
    return false;
  }

  return status === 429 || status >= 500;
}

function resolveRetryDelayMs(attempt: number, retryAfterMs: number | null): number {
  const exponentialDelayMs = Math.min(
    TRANSLATE_RETRY_CAP_MS,
    TRANSLATE_RETRY_BASE_MS * (2 ** attempt)
  );
  const jitterDelayMs = Math.floor(Math.random() * (exponentialDelayMs + 1));

  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return Math.max(retryAfterMs, jitterDelayMs);
  }

  return jitterDelayMs;
}

function buildSourceDetectionSample(pages: string[], fallbackHtml: string): string {
  const primarySource = pages.find((page) => page.trim().length > 0) ?? fallbackHtml;
  return primarySource.replace(/\s+/g, ' ').slice(0, 1000);
}

/**
 * GET /api/translate/download?jobId=xxx&targetLang=hi-IN
 * Downloads the translated output from Sarvam (HTML format),
 * then translates text nodes using Sarvam translate API.
 * Returns { html, pages }.
 */
export async function GET(request: NextRequest) {
  try {
    const requestApiKey = request.headers.get('x-sarvam-api-key')?.trim();
    const resolvedApiKey = requestApiKey || DEFAULT_SARVAM_API_KEY;

    if (!resolvedApiKey) {
      return Response.json(
        { error: 'Sarvam API key is missing. Save a key in settings or set SARVAM_API_KEY.' },
        { status: 400 }
      );
    }

    const jobId = request.nextUrl.searchParams.get('jobId');
    const targetLang = normalizeLanguageCode(
      request.nextUrl.searchParams.get('targetLang'),
      'hi-IN'
    );

    if (!jobId) {
      return Response.json({ error: 'Missing jobId parameter' }, { status: 400 });
    }

    const headers = {
      'api-subscription-key': resolvedApiKey,
      'Content-Type': 'application/json',
    };

    // Get download URLs
    const downloadRes = await fetch(
      `${SARVAM_BASE}/doc-digitization/job/v1/${jobId}/download-files`,
      { method: 'POST', headers, body: JSON.stringify({}) }
    );

    if (!downloadRes.ok) {
      return Response.json(
        { error: `Download URL fetch failed: ${downloadRes.status}` },
        { status: 500 }
      );
    }

    const downloadData = await downloadRes.json();
    const downloadUrls = downloadData.download_urls;

    if (!downloadUrls || Object.keys(downloadUrls).length === 0) {
      return Response.json({ error: 'No download URLs available' }, { status: 500 });
    }

    // Download file(s)
    let htmlContent = '';
    const pages: string[] = [];

    for (const [filename, meta] of Object.entries(downloadUrls)) {
      const fileUrl = (meta as { file_url: string }).file_url;
      const fileRes = await fetch(fileUrl);

      if (!fileRes.ok) continue;

      if (filename.endsWith('.zip')) {
        // Handle ZIP output
        const buffer = await fileRes.arrayBuffer();
        const zip = await JSZip.loadAsync(buffer);

        for (const [name, zipEntry] of Object.entries(zip.files)) {
          if (name.endsWith('.html') || name.endsWith('.htm')) {
            const content = await zipEntry.async('string');
            pages.push(content);
            if (!htmlContent) htmlContent = content;
          }
        }
      } else if (filename.endsWith('.html') || filename.endsWith('.htm')) {
        const content = await fileRes.text();
        pages.push(content);
        if (!htmlContent) htmlContent = content;
      } else if (filename.endsWith('.json')) {
        // Try to parse JSON and extract text
        const jsonContent = await fileRes.text();
        try {
          const parsed = JSON.parse(jsonContent);
          // Convert structured JSON to simple HTML
          if (parsed.pages) {
            for (const page of parsed.pages) {
              let pageHtml = `<div class="page" style="padding: 20px;">`;
              if (page.blocks) {
                for (const block of page.blocks) {
                  if (block.type === 'text') {
                    pageHtml += `<p style="margin: 8px 0;">${block.text}</p>`;
                  } else if (block.type === 'table') {
                    pageHtml += '<table style="border-collapse: collapse; width: 100%;">';
                    for (const row of block.rows || []) {
                      pageHtml += '<tr>';
                      for (const cell of row.cells || []) {
                        pageHtml += `<td style="border: 1px solid #ddd; padding: 4px;">${cell}</td>`;
                      }
                      pageHtml += '</tr>';
                    }
                    pageHtml += '</table>';
                  }
                }
              }
              pageHtml += '</div>';
              pages.push(pageHtml);
            }
            htmlContent = pages.join('\n');
          }
        } catch {
          // If JSON parsing fails, use as-is
          htmlContent = jsonContent;
          pages.push(jsonContent);
        }
      }
    }

    // Translate text content if we have HTML.
    // A single shared cache avoids re-translating repeated snippets across pages.
    const translationCache = new Map<string, string>();
    const sourceDetectionInput = buildSourceDetectionSample(pages, htmlContent);
    const sourceLangHint = sourceDetectionInput
      ? await detectSourceLanguage(sourceDetectionInput, headers)
      : null;

    if (pages.length > 0) {
      for (let i = 0; i < pages.length; i++) {
        pages[i] = await translateHtmlContent(
          pages[i],
          targetLang,
          headers,
          sourceLangHint,
          translationCache
        );
      }
      htmlContent = pages.join('\n');
    } else if (htmlContent) {
      htmlContent = await translateHtmlContent(
        htmlContent,
        targetLang,
        headers,
        sourceLangHint,
        translationCache
      );
      pages.push(htmlContent);
    }

    if (!htmlContent) {
      // Fallback: create placeholder
      htmlContent = '<div style="padding: 40px; text-align: center; color: #666;"><h2>Document processed</h2><p>The document has been digitized. Content extraction completed.</p></div>';
      pages.push(htmlContent);
    }

    return Response.json({ html: htmlContent, pages });
  } catch (err) {
    console.error('Download error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Extract text from HTML, translate in chunks, and re-inject.
 */
async function translateHtmlContent(
  html: string,
  targetLang: string,
  headers: Record<string, string>,
  sourceLangHint?: string | null,
  translationCache?: Map<string, string>
): Promise<string> {
  // Simple approach: extract text content between tags and translate
  const textRegex = />([^<]{5,})</g;
  const matches: { original: string; text: string }[] = [];
  let match;

  while ((match = textRegex.exec(html)) !== null) {
    const text = match[1].trim();
    if (text.length > 4) {
      matches.push({ original: match[0], text });
    }
  }

  if (matches.length === 0) {
    return html;
  }

  const sourceLang =
    sourceLangHint && sourceLangHint !== 'auto'
      ? sourceLangHint
      : await detectSourceLanguage(
          matches
            .map((m) => m.text)
            .join(' ')
            .slice(0, 1000),
          headers
        );

  if (sourceLang === targetLang) {
    return html;
  }

  // Batch translate in chunks and reuse cached text translations.
  let translatedHtml = html;
  const cache = translationCache ?? new Map<string, string>();

  for (const m of matches) {
    try {
      let translated = cache.get(m.text);
      if (!translated) {
        translated = await translateText(m.text, sourceLang, targetLang, headers);
        cache.set(m.text, translated);
      }

      if (translated) {
        translatedHtml = translatedHtml.replace(m.original, `>${translated}<`);
      }
    } catch {
      // Skip failed translations, keep original
    }
  }

  return translatedHtml;
}

async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
  headers: Record<string, string>
): Promise<string> {
  if (sourceLang === targetLang) {
    return text;
  }

  if (text.length > 2000) {
    // Chunk large texts
    const chunks = [];
    for (let i = 0; i < text.length; i += 1800) {
      chunks.push(text.slice(i, i + 1800));
    }
    const translated = [];
    for (const chunk of chunks) {
      translated.push(await translateText(chunk, sourceLang, targetLang, headers));
    }
    return translated.join('');
  }

  for (let attempt = 0; attempt < TRANSLATE_RETRY_ATTEMPTS; attempt += 1) {
    const res = await fetch(`${SARVAM_BASE}/translate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: text,
        source_language_code: sourceLang,
        target_language_code: targetLang,
        model: 'sarvam-translate:v1',
        mode: 'formal',
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return data.translated_text || text;
    }

    const errText = await res.text();
    const parsedError = parseSarvamTranslateError(errText);
    const retriable = isRetriableTranslateError(res.status, parsedError.code);

    if (!retriable || attempt === TRANSLATE_RETRY_ATTEMPTS - 1) {
      console.error('Sarvam translate failed:', {
        status: res.status,
        sourceLang,
        targetLang,
        sample: text.slice(0, 80),
        errCode: parsedError.code,
        requestId: parsedError.requestId,
        errMessage: parsedError.message,
      });
      return text;
    }

    const retryAfterMs = parseRetryAfterMs(res.headers.get('Retry-After'));
    await delay(resolveRetryDelayMs(attempt, retryAfterMs));
  }

  return text;
}

async function detectSourceLanguage(
  text: string,
  headers: Record<string, string>
): Promise<string> {
  const input = text.trim();
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
