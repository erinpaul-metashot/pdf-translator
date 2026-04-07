import { translateHtmlPage } from './translateHtmlPage';
import type { TranslateHtmlPageOptions, TranslatePagesResult } from './types';

export async function translateConvertedPages(
  pages: string[],
  options: TranslateHtmlPageOptions
): Promise<TranslatePagesResult> {
  if (!Array.isArray(pages) || pages.length === 0) {
    return {
      pages: [],
      warnings: [],
      totalNodes: 0,
      translatedNodes: 0,
      failedNodes: 0,
      pageFailures: 0,
    };
  }

  const warnings: string[] = [];
  const translatedPages: string[] = [];
  let totalNodes = 0;
  let translatedNodes = 0;
  let failedNodes = 0;
  let pageFailures = 0;

  for (let index = 0; index < pages.length; index += 1) {
    const pageHtml = pages[index];
    try {
      const result = await translateHtmlPage(pageHtml, options);
      translatedPages.push(result.translatedHtml);
      totalNodes += result.totalNodes;
      translatedNodes += result.translatedNodes;
      failedNodes += result.failedNodes;

      for (const warning of result.warnings) {
        warnings.push(`Page ${index + 1}: ${warning}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown page translation error';
      warnings.push(`Page ${index + 1}: ${message}`);
      translatedPages.push(pageHtml);
      pageFailures += 1;
    }
  }

  return {
    pages: translatedPages,
    warnings,
    totalNodes,
    translatedNodes,
    failedNodes,
    pageFailures,
  };
}
