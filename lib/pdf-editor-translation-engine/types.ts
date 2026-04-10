export interface TextNodePath {
  id: string;
  path: number[];
  originalText: string;
}

export interface ExtractedTextNodes {
  nodes: TextNodePath[];
  document: Document;
}

export interface TranslateChunk {
  text: string;
}

export interface TranslateHtmlPageOptions {
  targetLang: string;
  sourceLang?: string;
  maxCharsPerRequest?: number;
  maxRetries?: number;
  requestTimeoutMs?: number;
  nodeConcurrency?: number;
  pageConcurrency?: number;
}

export interface TranslateHtmlPageResult {
  translatedHtml: string;
  totalNodes: number;
  translatedNodes: number;
  failedNodes: number;
  warnings: string[];
}

export interface TranslatePagesResult {
  pages: string[];
  warnings: string[];
  totalNodes: number;
  translatedNodes: number;
  failedNodes: number;
  pageFailures: number;
}
