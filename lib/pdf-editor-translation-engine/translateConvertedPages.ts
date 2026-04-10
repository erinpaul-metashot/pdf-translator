import { translateHtmlPage } from './translateHtmlPage';
import type { TranslateHtmlPageOptions, TranslatePagesResult } from './types';

const DEFAULT_PAGE_CONCURRENCY = 2;

interface PageTranslationOutcome {
  pageIndex: number;
  translatedPage: string;
  totalNodes: number;
  translatedNodes: number;
  failedNodes: number;
  warnings: string[];
  failed: boolean;
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let taskIndex = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (taskIndex < tasks.length) {
      const currentIndex = taskIndex;
      taskIndex += 1;
      results[currentIndex] = await tasks[currentIndex]();
    }
  });

  await Promise.all(workers);
  return results;
}

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
  const translatedPages: string[] = new Array(pages.length);
  let totalNodes = 0;
  let translatedNodes = 0;
  let failedNodes = 0;
  let pageFailures = 0;

  const pageConcurrency = Math.max(1, options.pageConcurrency ?? DEFAULT_PAGE_CONCURRENCY);
  const tasks = pages.map((pageHtml, pageIndex) => async (): Promise<PageTranslationOutcome> => {
    try {
      const result = await translateHtmlPage(pageHtml, options);

      return {
        pageIndex,
        translatedPage: result.translatedHtml,
        totalNodes: result.totalNodes,
        translatedNodes: result.translatedNodes,
        failedNodes: result.failedNodes,
        warnings: result.warnings,
        failed: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown page translation error';

      return {
        pageIndex,
        translatedPage: pageHtml,
        totalNodes: 0,
        translatedNodes: 0,
        failedNodes: 0,
        warnings: [message],
        failed: true,
      };
    }
  });

  const pageOutcomes = await runWithConcurrency(tasks, pageConcurrency);

  for (const outcome of pageOutcomes) {
    translatedPages[outcome.pageIndex] = outcome.translatedPage;
    totalNodes += outcome.totalNodes;
    translatedNodes += outcome.translatedNodes;
    failedNodes += outcome.failedNodes;
    pageFailures += outcome.failed ? 1 : 0;

    for (const warning of outcome.warnings) {
      warnings.push(`Page ${outcome.pageIndex + 1}: ${warning}`);
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
