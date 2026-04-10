import { segmentPageHtml, mergeTranslatedPage } from './block-segmentation';
import { analyzePdfDocumentWithClaude, translateBatchWithClaude } from './client';
import { buildDocumentContext } from './document-context';
import { getNumericFidelityIssue } from './quality';
import type {
  ClaudeCostEstimate,
  ClaudeTokenUsage,
  PageTranslationMetrics,
  QualityIssue,
  QualitySummary,
  TranslatePdfPagesRequest,
  TranslatePdfPagesResult,
  TranslationMemoryEntry,
  TranslationBlock,
} from './types';

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const MODEL_PRICING_USD: Record<string, ModelPricing> = {
  'claude-haiku-4-5': { inputPerMillion: 1, outputPerMillion: 5 },
  'claude-sonnet-4-6': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-opus-4-6': { inputPerMillion: 15, outputPerMillion: 75 },
};

const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;
const DEFAULT_MAX_MEMORY_ENTRIES = 400;
const MAX_MEMORY_SNAPSHOT_CHARS = 12_000;

function chunkBlocks(blocks: TranslationBlock[], size: number): TranslationBlock[][] {
  if (size <= 0) {
    return [blocks];
  }

  const chunks: TranslationBlock[][] = [];
  for (let index = 0; index < blocks.length; index += size) {
    chunks.push(blocks.slice(index, index + size));
  }

  return chunks;
}

function createEmptyUsage(): ClaudeTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
  };
}

function addUsage(total: ClaudeTokenUsage, delta: ClaudeTokenUsage): ClaudeTokenUsage {
  const inputTokens = total.inputTokens + delta.inputTokens;
  const outputTokens = total.outputTokens + delta.outputTokens;
  const cacheCreationInputTokens = total.cacheCreationInputTokens + delta.cacheCreationInputTokens;
  const cacheReadInputTokens = total.cacheReadInputTokens + delta.cacheReadInputTokens;

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
  };
}

function resolveModelPricing(model: string): ModelPricing {
  const normalized = model.trim().toLowerCase();

  if (MODEL_PRICING_USD[normalized]) {
    return MODEL_PRICING_USD[normalized];
  }

  if (normalized.includes('haiku')) {
    return MODEL_PRICING_USD['claude-haiku-4-5'];
  }

  if (normalized.includes('opus')) {
    return MODEL_PRICING_USD['claude-opus-4-6'];
  }

  return MODEL_PRICING_USD['claude-sonnet-4-6'];
}

function toSafeMaxMemoryEntries(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_MEMORY_ENTRIES;
  }

  return Math.max(50, Math.min(2000, Number(value)));
}

function getTranslationMemorySnapshot(
  memory: Map<string, string>,
  maxEntries: number
): TranslationMemoryEntry[] {
  if (memory.size === 0) {
    return [];
  }

  const newestFirst = Array.from(memory.entries()).slice(-maxEntries).reverse();
  const snapshot: TranslationMemoryEntry[] = [];
  let totalChars = 0;

  for (const [sourceText, translatedText] of newestFirst) {
    const pairChars = sourceText.length + translatedText.length;
    if (totalChars + pairChars > MAX_MEMORY_SNAPSHOT_CHARS) {
      break;
    }

    snapshot.push({ sourceText, translatedText });
    totalChars += pairChars;
  }

  return snapshot.reverse();
}

function upsertTranslationMemory(
  memory: Map<string, string>,
  sourceText: string,
  translatedText: string,
  maxEntries: number
): void {
  if (memory.has(sourceText)) {
    memory.set(sourceText, translatedText);
    return;
  }

  if (memory.size >= maxEntries) {
    const oldestKey = memory.keys().next().value;
    if (typeof oldestKey === 'string') {
      memory.delete(oldestKey);
    }
  }

  memory.set(sourceText, translatedText);
}

function summarizeQuality(issues: QualityIssue[]): QualitySummary {
  const numericMismatches = issues.filter((issue) => issue.type === 'numeric-mismatch').length;
  const consistencyOverrides = issues.filter((issue) => issue.type === 'consistency-overridden').length;

  return {
    totalIssues: issues.length,
    numericMismatches,
    consistencyOverrides,
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function estimateCost(model: string, usage: ClaudeTokenUsage): ClaudeCostEstimate {
  const pricing = resolveModelPricing(model);
  const inputCostUsd = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCostUsd = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheWriteCostUsd =
    (usage.cacheCreationInputTokens / 1_000_000) * pricing.inputPerMillion * CACHE_WRITE_MULTIPLIER;
  const cacheReadCostUsd =
    (usage.cacheReadInputTokens / 1_000_000) * pricing.inputPerMillion * CACHE_READ_MULTIPLIER;

  return {
    model,
    currency: 'USD',
    estimatedUsd: roundUsd(inputCostUsd + outputCostUsd + cacheWriteCostUsd + cacheReadCostUsd),
    inputCostUsd: roundUsd(inputCostUsd),
    outputCostUsd: roundUsd(outputCostUsd),
    cacheWriteCostUsd: roundUsd(cacheWriteCostUsd),
    cacheReadCostUsd: roundUsd(cacheReadCostUsd),
    note: 'Estimated from model pricing. Final provider billing may vary slightly.',
  };
}

function uniquePush(target: string[], values: string[]): string[] {
  const seen = new Set(target.map((value) => value.toLowerCase()));
  const merged = [...target];

  values.forEach((value) => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }

    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(normalized);
    }
  });

  return merged;
}

export async function translatePdfPagesWithClaude(
  apiKey: string,
  request: TranslatePdfPagesRequest
): Promise<TranslatePdfPagesResult> {
  const translatedPages: string[] = [];
  const pageMetrics: PageTranslationMetrics[] = [];
  const warnings: string[] = [];
  const qualityIssues: QualityIssue[] = [];
  let usageTotals = createEmptyUsage();

  const qualityChecksEnabled = request.options.enableQualityChecks ?? true;
  const maxMemoryEntries = toSafeMaxMemoryEntries(request.options.maxMemoryEntries);

  const segmentedPages = request.pages.map((pageHtml, index) => {
    const segmented = segmentPageHtml(pageHtml);
    return {
      pageNumber: index + 1,
      segmented,
    };
  });

  const indexedBlocks = segmentedPages.flatMap(({ pageNumber, segmented }) =>
    segmented.blocks.map((block) => ({ pageNumber, block }))
  );

  let documentContext = buildDocumentContext(indexedBlocks, request.targetLanguage);

  if (request.documentSource) {
    try {
      const documentAnalysis = await analyzePdfDocumentWithClaude(apiKey, {
        targetLanguage: request.targetLanguage,
        prompt: request.prompt,
        options: request.options,
        source: request.documentSource,
      });

      usageTotals = addUsage(usageTotals, documentAnalysis.usage);
      warnings.push(...documentAnalysis.warnings);

      if (documentAnalysis.insights) {
        documentContext = {
          ...documentContext,
          glossary: uniquePush(documentContext.glossary, documentAnalysis.insights.glossary),
          styleHints: uniquePush(documentContext.styleHints, documentAnalysis.insights.styleGuidance),
          nativeInsights: documentAnalysis.insights,
        };
      }
    } catch (error) {
      warnings.push(
        `Document-level PDF analysis failed. Continued with block translation context only: ${
          error instanceof Error ? error.message : 'Unknown analysis error.'
        }`
      );
    }
  }

  const translationMemory = new Map<string, string>();

  for (let pageIndex = 0; pageIndex < segmentedPages.length; pageIndex += 1) {
    const { pageNumber, segmented } = segmentedPages[pageIndex];

    if (segmented.blocks.length === 0) {
      translatedPages.push(request.pages[pageIndex]);
      pageMetrics.push({
        pageNumber,
        totalBlocks: 0,
        translatedBlocks: 0,
        failedBlocks: 0,
        memoryHits: 0,
      });
      continue;
    }

    const translationMap: Record<string, string> = {};
    let translatedCount = 0;
    let failedCount = 0;
    let memoryHits = 0;

    const pendingBlocks: TranslationBlock[] = [];
    for (const block of segmented.blocks) {
      const memoryTranslation = translationMemory.get(block.text);
      if (memoryTranslation && memoryTranslation.trim()) {
        translationMap[block.id] = memoryTranslation;
        translatedCount += 1;
        memoryHits += 1;
      } else {
        pendingBlocks.push(block);
      }
    }

    const blockChunks = chunkBlocks(pendingBlocks, request.options.batchSize);

    for (const batch of blockChunks) {
      try {
        const batchResult = await translateBatchWithClaude(apiKey, {
          pageNumber,
          blocks: batch,
          targetLanguage: request.targetLanguage,
          prompt: request.prompt,
          options: request.options,
          documentContext,
          translationMemory: getTranslationMemorySnapshot(translationMemory, maxMemoryEntries),
        });

        usageTotals = addUsage(usageTotals, batchResult.usage);

        batch.forEach((block) => {
          const translated = batchResult.translations[block.id];
          if (typeof translated === 'string' && translated.trim()) {
            let resolvedTranslation = translated.trim();

            const existingTranslation = translationMemory.get(block.text);
            if (existingTranslation && existingTranslation !== resolvedTranslation) {
              resolvedTranslation = existingTranslation;
              qualityIssues.push({
                pageNumber,
                blockId: block.id,
                type: 'consistency-overridden',
                message: `Consistency override for ${block.id}: reused prior translation for repeated source segment.`,
              });
            }

            if (!translationMemory.has(block.text)) {
              upsertTranslationMemory(translationMemory, block.text, resolvedTranslation, maxMemoryEntries);
            }

            translationMap[block.id] = resolvedTranslation;
            translatedCount += 1;

            if (qualityChecksEnabled) {
              const numericIssue = getNumericFidelityIssue(pageNumber, block.id, block.text, resolvedTranslation);
              if (numericIssue) {
                qualityIssues.push(numericIssue);
                warnings.push(`Page ${pageNumber}: ${numericIssue.message}`);
              }
            }
          } else {
            failedCount += 1;
            warnings.push(`Page ${pageNumber}: missing translation for ${block.id}.`);
          }
        });
      } catch (error) {
        failedCount += batch.length;
        const message = error instanceof Error ? error.message : 'Unknown translation error';
        warnings.push(`Page ${pageNumber}: ${message}`);
      }
    }

    translatedPages.push(mergeTranslatedPage(segmented, translationMap));

    pageMetrics.push({
      pageNumber,
      totalBlocks: segmented.blocks.length,
      translatedBlocks: translatedCount,
      failedBlocks: failedCount,
      memoryHits,
    });
  }

  return {
    translatedPages,
    pageMetrics,
    warnings,
    usage: usageTotals,
    cost: estimateCost(request.options.model, usageTotals),
    quality: {
      issues: qualityIssues,
      summary: summarizeQuality(qualityIssues),
    },
  };
}
