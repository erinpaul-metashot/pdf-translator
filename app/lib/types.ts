// ── Translation State Machine ──────────────────────────────────────────
export type TranslationStatus =
  | 'idle'
  | 'fileReady'
  | 'processing'
  | 'convertedReady'
  | 'translating'
  | 'translatedSuccess'
  | 'convertingPdf'
  | 'pdfReady'
  | 'translationFailed'
  | 'editing';

export type WorkflowStage =
  | 'idle'
  | 'sourceReady'
  | 'processing'
  | 'convertedReady'
  | 'translating'
  | 'translatedReady'
  | 'convertingPdf'
  | 'pdfReady';

// ── Translation Scope ──────────────────────────────────────────────────
export type ScopeMode = 'full' | 'selected' | 'range';

export interface TranslationScope {
  mode: ScopeMode;
  pages?: number[];       // for 'selected' mode
  startPage?: number;     // for 'range' mode
  endPage?: number;       // for 'range' mode
}

// ── Language ───────────────────────────────────────────────────────────
export interface Language {
  code: string;           // BCP-47 code, e.g. "hi-IN"
  name: string;           // Display name, e.g. "Hindi"
  nativeName: string;     // Native name, e.g. "हिन्दी"
  flag: string;           // Flag or emoji
}

// ── Sarvam Job ─────────────────────────────────────────────────────────
export type SarvamJobState =
  | 'Accepted'
  | 'Pending'
  | 'Running'
  | 'Completed'
  | 'PartiallyCompleted'
  | 'Failed';

export interface SarvamJobProgress {
  jobId: string;
  state: SarvamJobState;
  totalPages: number;
  pagesProcessed: number;
  pagesSucceeded: number;
  pagesFailed: number;
  errorMessage?: string;
}

// ── Text Edit ──────────────────────────────────────────────────────────
export interface TextEdit {
  id: string;
  pageIndex: number;
  originalText: string;
  editedText: string;
  type: 'manual' | 'ai';
  timestamp: number;
}

// ── Translation State (hook return) ────────────────────────────────────
export interface TranslationState {
  status: TranslationStatus;
  file: File | null;
  fileUrl: string | null;
  totalPages: number;
  targetLanguage: Language | null;
  scope: TranslationScope;
  progress: SarvamJobProgress | null;
  translatedHtml: string | null;
  translatedPages: string[];
  edits: TextEdit[];
  error: string | null;
}

// ── API Payloads ───────────────────────────────────────────────────────
export interface TranslateStartResponse {
  jobId: string;
  state: SarvamJobState;
}

export interface TranslateStatusResponse {
  jobId: string;
  state: SarvamJobState;
  totalPages: number;
  pagesProcessed: number;
  pagesSucceeded: number;
  pagesFailed: number;
  errorMessage?: string;
}

export interface TranslateDownloadResponse {
  html: string;
  pages: string[];
}

export interface TranslateTextRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
}

export interface TranslateTextResponse {
  translatedText: string;
}

// ── Validation ─────────────────────────────────────────────────────────
export interface ValidationError {
  field: string;
  message: string;
}

