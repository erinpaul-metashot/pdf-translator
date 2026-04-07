import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { normalizeLanguageCode } from '../../../lib/languageCodes';

const DEFAULT_SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const SARVAM_BASE = process.env.SARVAM_API_BASE_URL || 'https://api.sarvam.ai';

export const dynamic = 'force-dynamic';

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
    // translateHtmlContent will skip naturally when source and target match.
    if (htmlContent) {
      htmlContent = await translateHtmlContent(htmlContent, targetLang, headers);
      // Re-translate individual pages
      for (let i = 0; i < pages.length; i++) {
        pages[i] = await translateHtmlContent(pages[i], targetLang, headers);
      }
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
  headers: Record<string, string>
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

  const sourceLang = await detectSourceLanguage(
    matches
      .map((m) => m.text)
      .join(' ')
      .slice(0, 1000),
    headers
  );

  if (sourceLang === targetLang) {
    return html;
  }

  // Batch translate in chunks of 1000 chars
  let translatedHtml = html;

  for (const m of matches) {
    try {
      const translated = await translateText(m.text, sourceLang, targetLang, headers);
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

  if (!res.ok) {
    const errText = await res.text();
    console.error('Sarvam translate failed:', {
      status: res.status,
      sourceLang,
      targetLang,
      sample: text.slice(0, 80),
      errText,
    });
    return text;
  }

  const data = await res.json();
  return data.translated_text || text;
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
