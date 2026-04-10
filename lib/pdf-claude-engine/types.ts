export interface ClaudePromptConfig {
  systemPrompt: string;
  translationPrompt: string;
}

export interface ClaudeEngineOptions {
  model: string;
  temperature: number;
  maxTokens: number;
  batchSize: number;
  integrationMode?: 'integrated';
  enableQualityChecks?: boolean;
  maxMemoryEntries?: number;
  usePromptCaching?: boolean;
  useFilesApi?: boolean;
}

export interface PdfBase64Source {
  type: 'base64';
  mediaType: 'application/pdf';
  data: string;
  filename?: string;
}

export interface PdfFileIdSource {
  type: 'file';
  fileId: string;
  filename?: string;
}

export interface PdfUrlSource {
  type: 'url';
  url: string;
  filename?: string;
}

export type PdfDocumentSource = PdfBase64Source | PdfFileIdSource | PdfUrlSource;

export interface NativePdfInsights {
  summary: string;
  glossary: string[];
  styleGuidance: string[];
  layoutNotes: string[];
}

export interface DocumentContext {
  targetLanguage: string;
  glossary: string[];
  repeatedSegments: string[];
  styleHints: string[];
  nativeInsights?: NativePdfInsights;
}

export interface TranslationMemoryEntry {
  sourceText: string;
  translatedText: string;
}

export interface ClaudeTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
}

export interface ClaudeCostEstimate {
  model: string;
  currency: 'USD';
  estimatedUsd: number;
  inputCostUsd: number;
  outputCostUsd: number;
  cacheWriteCostUsd: number;
  cacheReadCostUsd: number;
  note: string;
}

export interface TranslationBlock {
  id: string;
  text: string;
  leadingWhitespace: string;
  trailingWhitespace: string;
}

export interface SegmentedPage {
  templatedHtml: string;
  blocks: TranslationBlock[];
  placeholderPrefix: string;
}

export interface TranslateBatchRequest {
  pageNumber: number;
  blocks: TranslationBlock[];
  targetLanguage: string;
  prompt: ClaudePromptConfig;
  options: ClaudeEngineOptions;
  documentContext?: DocumentContext;
  translationMemory?: TranslationMemoryEntry[];
}

export interface AnalyzePdfDocumentRequest {
  targetLanguage: string;
  prompt: ClaudePromptConfig;
  options: ClaudeEngineOptions;
  source: PdfDocumentSource;
}

export interface ClaudeTranslatedBatch {
  translations: Record<string, string>;
  rawText: string;
  usage: ClaudeTokenUsage;
}

export interface TranslatePdfPagesRequest {
  pages: string[];
  targetLanguage: string;
  prompt: ClaudePromptConfig;
  options: ClaudeEngineOptions;
  documentSource?: PdfDocumentSource;
}

export interface PageTranslationMetrics {
  pageNumber: number;
  totalBlocks: number;
  translatedBlocks: number;
  failedBlocks: number;
  memoryHits: number;
}

export type QualityIssueType = 'numeric-mismatch' | 'consistency-overridden';

export interface QualityIssue {
  pageNumber: number;
  blockId: string;
  type: QualityIssueType;
  message: string;
}

export interface QualitySummary {
  totalIssues: number;
  numericMismatches: number;
  consistencyOverrides: number;
}

export interface TranslatePdfPagesResult {
  translatedPages: string[];
  pageMetrics: PageTranslationMetrics[];
  warnings: string[];
  usage: ClaudeTokenUsage;
  cost: ClaudeCostEstimate;
  quality: {
    issues: QualityIssue[];
    summary: QualitySummary;
  };
}
