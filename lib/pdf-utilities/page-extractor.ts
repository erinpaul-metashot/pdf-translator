import type { TranslationScope } from '@/app/lib/types';

/**
 * Extract all pages from the portable HTML document.
 * Each page is expected to be a <div class="pdf-page" data-page="N"> element.
 *
 * @param fullHtml - Complete portable HTML from convertPdfToHtml()
 * @returns Array of HTML strings, one per page. Empty array if no pages found.
 * @throws Error if HTML is malformed and cannot be parsed
 */
export function extractPagesFromHtml(fullHtml: string): string[] {
  if (!fullHtml || typeof fullHtml !== 'string') {
    return [];
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(fullHtml, 'text/html');

    if (doc.documentElement.tagName === 'parsererror') {
      throw new Error('Failed to parse portable HTML: Invalid or malformed HTML');
    }

    const pageElements = Array.from(doc.querySelectorAll('.pdf-page[data-page]'));
    const preservedStyleBlocks = Array.from(new Set(Array.from(doc.head.querySelectorAll('style'))
      .map((styleElement) => styleElement.textContent?.trim() ?? '')
      .filter((cssText) => cssText.length > 0)
      ))
      .map((cssText) => `<style>${cssText}</style>`)
      .join('\n');

    if (pageElements.length === 0) {
      return [];
    }

    return pageElements.map((element) => {
      const section = element as HTMLElement;
      if (!preservedStyleBlocks) {
        return section.outerHTML;
      }

      // Keep page-scoped MuPDF CSS so text metrics and absolute positions remain faithful.
      return `${preservedStyleBlocks}\n${section.outerHTML}`;
    });
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error(`Failed to extract pages from HTML: ${String(err)}`);
  }
}

/**
 * Extract pages from portable HTML filtered by translation scope.
 * Handles 'full', 'range', and 'selected' scope modes.
 *
 * @param fullHtml - Complete portable HTML from convertPdfToHtml()
 * @param scope - Translation scope (mode, startPage, endPage, pages)
 * @param totalPages - Total number of pages in the PDF
 * @returns Array of extracted HTML pages matching the scope
 * @throws Error if HTML is malformed
 */
export function extractPagesByScope(
  fullHtml: string,
  scope: TranslationScope,
  totalPages: number
): string[] {
  const allPages = extractPagesFromHtml(fullHtml);

  if (totalPages <= 0 || allPages.length === 0) {
    return [];
  }

  const pageNumbersToExtract = getScopedPageNumbers(scope, totalPages);

  if (pageNumbersToExtract.length === 0) {
    return [];
  }

  const filteredPages: string[] = [];

  for (const pageNumber of pageNumbersToExtract) {
    const matchingPage = allPages.find((pageHtml) => {
      const pageMatch = pageHtml.match(/data-page="(\d+)"/);
      return pageMatch && parseInt(pageMatch[1], 10) === pageNumber;
    });

    if (matchingPage) {
      filteredPages.push(matchingPage);
    }
  }

  return filteredPages;
}

/**
 * Reconstruct a complete portable HTML document from individual page HTMLs.
 * Useful for combining filtered pages back into a full document.
 *
 * @param pages - Array of page HTML strings (should be .pdf-page divs)
 * @param title - Optional title for the document (defaults to "Converted PDF HTML")
 * @returns Complete portable HTML document ready for rendering or export
 */
export function reconstructPortableHtml(pages: string[], title?: string): string {
  const documentTitle = title || 'Converted PDF HTML';

  const htmlContent = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '  <meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; font-src data: blob:; connect-src \'none\'; media-src \'none\'; frame-src \'none\';" />',
    `  <title>${escapeHtml(documentTitle)}</title>`,
    '  <style>',
    '    body { margin: 0; padding: 24px; background: #e2e8f0; font-family: Helvetica, Arial, sans-serif; }',
    '    .pdf-document { display: grid; gap: 24px; justify-content: center; }',
    '    .pdf-page { overflow: hidden; border-radius: 8px; }',
    '    .pdf-page { position: relative; margin: 0 auto 20px auto; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12); background: white; }',
    '    body.show-edited-text .pdf-page [data-edited="true"], body.show-edited-text .pdf-page [data-edited="true"] * { background: #fef08a !important; }',
    '    .pdf-page-underlay { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }',
    '    .pdf-page-underlay > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }',
    '    .pdf-page p { position: absolute; z-index: 1; margin: 0; white-space: pre; }',
    '    .pdf-page img { position: absolute; z-index: 1; max-width: none; }',
    '    .pdf-page > svg { position: absolute; z-index: 1; overflow: visible; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div class="pdf-document">',
    pages.join('\n'),
    '  </div>',
    '</body>',
    '</html>',
  ].join('\n');

  return htmlContent;
}

function getScopedPageNumbers(scope: TranslationScope, totalPages: number): number[] {
  if (totalPages <= 0) {
    return [];
  }

  if (scope.mode === 'selected') {
    return (scope.pages || [])
      .filter((page) => page >= 1 && page <= totalPages)
      .sort((a, b) => a - b);
  }

  if (scope.mode === 'range') {
    const start = scope.startPage;
    const end = scope.endPage;

    if (start === undefined || end === undefined || start < 1 || end < start || end > totalPages) {
      return [];
    }

    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  return Array.from({ length: totalPages }, (_, index) => index + 1);
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}
