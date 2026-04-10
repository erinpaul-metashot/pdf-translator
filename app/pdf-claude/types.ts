import type { Language } from '@/app/lib/types';
import type { ConversionConfidenceDiagnostics } from '@/lib/pdf-to-html-engine';

export type ClaudeWorkflowStage =
  | 'idle'
  | 'sourceReady'
  | 'converting'
  | 'translating'
  | 'translatedReady'
  | 'downloading'
  | 'error';

export interface ClaudePromptDraft {
  systemPrompt: string;
  translationPrompt: string;
}

export interface ClaudeEngineDraft {
  model: string;
  temperature: number;
  maxTokens: number;
  batchSize: number;
  usePromptCaching?: boolean;
  useFilesApi?: boolean;
}

export interface ClaudeWorkflowProgress {
  phase: 'convert' | 'analyze' | 'translate' | 'done';
  message: string;
  percent: number;
}

export interface ClaudeRunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
}

export interface ClaudeRunCost {
  model: string;
  currency: 'USD';
  estimatedUsd: number;
  inputCostUsd: number;
  outputCostUsd: number;
  cacheWriteCostUsd: number;
  cacheReadCostUsd: number;
  note: string;
}

export interface ClaudeRunSummary {
  usage: ClaudeRunUsage;
  cost: ClaudeRunCost;
}

export interface ClaudeArtifactPageMetric {
  pageNumber: number;
  totalBlocks: number;
  translatedBlocks: number;
  failedBlocks: number;
  memoryHits: number;
}

export interface ClaudeArtifactQualityIssue {
  pageNumber: number;
  blockId: string;
  type: 'numeric-mismatch' | 'consistency-overridden';
  message: string;
}

export interface ClaudeArtifactQualitySummary {
  totalIssues: number;
  numericMismatches: number;
  consistencyOverrides: number;
}

export interface ClaudeTranslationArtifacts {
  pageMetrics: ClaudeArtifactPageMetric[];
  warnings: string[];
  summary: {
    pageCount: number;
    translatedBlocks: number;
    failedBlocks: number;
    memoryHits: number;
    qualityIssues: number;
  } | null;
  quality: {
    issues: ClaudeArtifactQualityIssue[];
    summary: ClaudeArtifactQualitySummary;
  } | null;
  contractVersion: string | null;
  providerModel: string | null;
}

export interface ClaudeWorkflowState {
  stage: ClaudeWorkflowStage;
  file: File | null;
  fileUrl: string | null;
  fileName: string;
  totalPages: number;
  targetLanguage: Language;
  prompt: ClaudePromptDraft;
  engine: ClaudeEngineDraft;
  convertedPages: string[];
  translatedPages: string[];
  translatedDocumentHtml: string;
  selectedTranslatedPage: number;
  conversionConfidence: ConversionConfidenceDiagnostics | null;
  progress: ClaudeWorkflowProgress | null;
  runSummary: ClaudeRunSummary | null;
  translationArtifacts: ClaudeTranslationArtifacts | null;
  error: string | null;
}
