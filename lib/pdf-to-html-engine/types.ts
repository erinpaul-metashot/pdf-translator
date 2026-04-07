export type MuPdfMatrix = [number, number, number, number, number, number];
export type MuPdfRect = [number, number, number, number];

export interface MuPdfStructuredTextLike {
  asHTML: (id: number) => string;
  destroy: () => void;
}

export interface MuPdfBufferLike {
  asString: () => string;
  destroy: () => void;
}

export interface MuPdfDeviceLike {
  fillPath?: (...args: unknown[]) => void;
  strokePath?: (...args: unknown[]) => void;
  clipPath?: (...args: unknown[]) => void;
  clipStrokePath?: (...args: unknown[]) => void;
  fillText?: (...args: unknown[]) => void;
  strokeText?: (...args: unknown[]) => void;
  clipText?: (...args: unknown[]) => void;
  clipStrokeText?: (...args: unknown[]) => void;
  ignoreText?: (...args: unknown[]) => void;
  fillShade?: (...args: unknown[]) => void;
  fillImage?: (...args: unknown[]) => void;
  fillImageMask?: (...args: unknown[]) => void;
  clipImageMask?: (...args: unknown[]) => void;
  popClip?: (...args: unknown[]) => void;
  beginMask?: (...args: unknown[]) => void;
  endMask?: (...args: unknown[]) => void;
  beginGroup?: (...args: unknown[]) => void;
  endGroup?: (...args: unknown[]) => void;
  beginTile?: (...args: unknown[]) => number;
  endTile?: (...args: unknown[]) => void;
  beginLayer?: (...args: unknown[]) => void;
  endLayer?: (...args: unknown[]) => void;
  close?: () => void;
  destroy: () => void;
}

export interface MuPdfDocumentWriterLike {
  beginPage: (mediabox: MuPdfRect) => MuPdfDeviceLike;
  endPage: () => void;
  close: () => void;
  destroy: () => void;
}

export interface MuPdfPageLike {
  getBounds: () => MuPdfRect;
  toStructuredText: (options?: string) => MuPdfStructuredTextLike;
  run: (device: MuPdfDeviceLike, matrix: MuPdfMatrix) => void;
  destroy: () => void;
}

export interface MuPdfDocumentLike {
  countPages: () => number;
  loadPage: (index: number) => MuPdfPageLike;
  destroy: () => void;
}

export interface MuPdfRuntime {
  Buffer: new () => MuPdfBufferLike;
  Device: new (callbacks: Partial<MuPdfDeviceLike>) => MuPdfDeviceLike;
  DocumentWriter: new (
    buffer: MuPdfBufferLike,
    format: string,
    options: string
  ) => MuPdfDocumentWriterLike;
  Matrix: {
    identity: MuPdfMatrix;
  };
  Document: {
    openDocument: (source: Uint8Array, magic?: string) => MuPdfDocumentLike;
  };
}

export interface NormalizedMuPdfPage {
  pageHtml: string;
  headStyleCssBlocks: string[];
}

export interface PdfToHtmlProgress {
  progress: number;
  statusMessage: string;
}

export interface ConvertPdfToHtmlOptions {
  onProgress?: (event: PdfToHtmlProgress) => void;
  signal?: AbortSignal;
}

export interface ConvertPdfToHtmlResult {
  html: string;
  pageCount: number;
}

declare global {
  var $libmupdf_wasm_Module:
    | {
        locateFile?: (fileName: string) => string;
        printErr?: (...args: unknown[]) => void;
      }
    | undefined;
}
