import { splitTextIntoChunks } from './chunking';
import { extractTextNodes, getNodeByPath } from './extractTextNodes';
import { translateTextViaApi } from './translateClient';
import type { TextNodePath, TranslateHtmlPageOptions, TranslateHtmlPageResult } from './types';

const DEFAULT_MAX_CHARS = 1900;
const DEFAULT_MAX_RETRIES = 0;
const DEFAULT_NODE_CONCURRENCY = 2;

async function translateNodeText(node: TextNodePath, options: Required<Pick<TranslateHtmlPageOptions, 'targetLang' | 'sourceLang' | 'maxCharsPerRequest' | 'maxRetries' | 'requestTimeoutMs'>>): Promise<string> {
  const chunks = splitTextIntoChunks(node.originalText, options.maxCharsPerRequest);
  if (chunks.length === 0) {
    return node.originalText;
  }

  const translatedParts: string[] = [];

  for (const chunk of chunks) {
    const translated = await translateTextViaApi({
      text: chunk.text,
      targetLang: options.targetLang,
      sourceLang: options.sourceLang ?? 'auto',
      maxRetries: options.maxRetries,
      timeoutMs: options.requestTimeoutMs,
    });
    translatedParts.push(translated);
  }

  return translatedParts.join('');
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

export async function translateHtmlPage(
  pageHtml: string,
  options: TranslateHtmlPageOptions
): Promise<TranslateHtmlPageResult> {
  const { nodes, document } = extractTextNodes(pageHtml);
  const preservedStyleBlocks = Array.from(document.head.querySelectorAll('style'))
    .map((styleNode) => styleNode.outerHTML)
    .join('\n');

  if (nodes.length === 0) {
    return {
      translatedHtml: pageHtml,
      totalNodes: 0,
      translatedNodes: 0,
      failedNodes: 0,
      warnings: [],
    };
  }

  const maxCharsPerRequest = options.maxCharsPerRequest ?? DEFAULT_MAX_CHARS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const requestTimeoutMs = options.requestTimeoutMs ?? 25000;
  const nodeConcurrency = options.nodeConcurrency ?? DEFAULT_NODE_CONCURRENCY;
  const translationByNodeId = new Map<string, string>();
  const translationPromiseCache = new Map<string, Promise<string>>();
  const failedCacheKeys = new Set<string>();
  const warnings: string[] = [];

  const tasks = nodes.map((node) => async () => {
    const cacheKey = node.originalText;
    let translationPromise = translationPromiseCache.get(cacheKey);

    if (!translationPromise) {
      translationPromise = translateNodeText(node, {
        targetLang: options.targetLang,
        sourceLang: options.sourceLang ?? 'auto',
        maxCharsPerRequest,
        maxRetries,
        requestTimeoutMs,
      });
      translationPromiseCache.set(cacheKey, translationPromise);
    }

    try {
      const translated = await translationPromise;
      translationByNodeId.set(node.id, translated);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown translation error';
      if (!failedCacheKeys.has(cacheKey)) {
        warnings.push(`Failed to translate text block (${node.id}): ${message}`);
        failedCacheKeys.add(cacheKey);
      }
      translationByNodeId.set(node.id, node.originalText);
      return { success: false };
    }
  });

  const statuses = await runWithConcurrency(tasks, nodeConcurrency);

  for (const node of nodes) {
    const targetNode = getNodeByPath(document, node.path);
    if (!targetNode || targetNode.nodeType !== Node.TEXT_NODE) {
      warnings.push(`Unable to map translated text back to ${node.id}`);
      continue;
    }

    targetNode.nodeValue = translationByNodeId.get(node.id) ?? node.originalText;
  }

  const translatedNodes = statuses.filter((status) => status.success).length;
  const failedNodes = nodes.length - translatedNodes;

  return {
    translatedHtml: preservedStyleBlocks
      ? `${preservedStyleBlocks}\n${document.body.innerHTML}`
      : document.body.innerHTML,
    totalNodes: nodes.length,
    translatedNodes,
    failedNodes,
    warnings,
  };
}

