import { buildPortableHtml } from './html-utils';
import { loadMuPdfRuntime } from './runtime';
import {
  createTextFilteredVectorUnderlay,
  normalizeMuPdfPageHtml,
} from './sanitization';
import type {
  ConvertPdfToHtmlOptions,
  ConvertPdfToHtmlResult,
  NormalizedMuPdfPage,
} from './types';

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  throw new DOMException('Conversion aborted', 'AbortError');
}

function emitProgress(
  options: ConvertPdfToHtmlOptions | undefined,
  progress: number,
  statusMessage: string
): void {
  options?.onProgress?.({ progress, statusMessage });
}

async function toArrayBuffer(source: File | ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
  if (source instanceof File) {
    return source.arrayBuffer();
  }

  if (source instanceof Uint8Array) {
    return (source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer);
  }

  return source;
}

export async function convertPdfToHtml(
  source: File | ArrayBuffer | Uint8Array,
  options?: ConvertPdfToHtmlOptions
): Promise<ConvertPdfToHtmlResult> {
  emitProgress(options, 8, 'Reading PDF file');
  const arrayBuffer = await toArrayBuffer(source);

  throwIfAborted(options?.signal);

  emitProgress(options, 20, 'Initializing MuPDF conversion engine');
  const mupdf = await loadMuPdfRuntime();

  throwIfAborted(options?.signal);

  emitProgress(options, 30, 'Converting pages to faithful HTML');

  const doc = mupdf.Document.openDocument(
    new Uint8Array(arrayBuffer),
    'application/pdf'
  );

  const pageHtmlChunks: NormalizedMuPdfPage[] = [];
  let totalPages = 0;

  try {
    totalPages = doc.countPages();

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
      throwIfAborted(options?.signal);

      const page = doc.loadPage(pageIndex);

      try {
        const structuredText = page.toStructuredText('preserve-images');

        try {
          const htmlChunk = structuredText.asHTML(pageIndex + 1);
          const vectorUnderlaySvg = createTextFilteredVectorUnderlay(page, pageIndex + 1, mupdf);
          pageHtmlChunks.push(
            normalizeMuPdfPageHtml(htmlChunk, pageIndex + 1, vectorUnderlaySvg)
          );
        } finally {
          structuredText.destroy();
        }
      } finally {
        page.destroy();
      }

      const completedRatio = (pageIndex + 1) / Math.max(totalPages, 1);
      emitProgress(options, 30 + Math.round(completedRatio * 65), `Converting page ${pageIndex + 1} of ${totalPages}`);

      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    doc.destroy();
  }

  throwIfAborted(options?.signal);

  const html = buildPortableHtml(pageHtmlChunks);
  emitProgress(options, 100, `Conversion complete (${totalPages} pages)`);

  return {
    html,
    pageCount: totalPages,
  };
}


