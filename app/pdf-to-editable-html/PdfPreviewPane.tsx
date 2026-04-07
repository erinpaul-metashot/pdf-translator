'use client';

import { useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface PdfPreviewPaneProps {
  fileUrl: string;
  onLoadSuccess: (pageCount: number) => void;
  onLoadError: (message: string) => void;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unable to render the PDF preview.';
}

export default function PdfPreviewPane({
  fileUrl,
  onLoadSuccess,
  onLoadError,
}: PdfPreviewPaneProps): React.JSX.Element {
  const [pageCount, setPageCount] = useState(0);

  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount]
  );

  return (
    <div className="h-full overflow-auto rounded-lg bg-slate-100 p-3">
      <Document
        key={fileUrl}
        file={fileUrl}
        loading={
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">
            Loading PDF preview...
          </div>
        }
        onLoadSuccess={({ numPages }) => {
          setPageCount(numPages);
          onLoadSuccess(numPages);
        }}
        onLoadError={(error: unknown) => onLoadError(toErrorMessage(error))}
        error={
          <div className="flex h-48 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 text-center text-sm text-red-700">
            Unable to render this PDF in the browser preview.
          </div>
        }
      >
        {pages.map((pageNumber) => (
          <Page
            key={pageNumber}
            className="mx-auto mb-4 w-fit rounded-md bg-white shadow"
            pageNumber={pageNumber}
            renderTextLayer
            renderAnnotationLayer
            onRenderError={(error: unknown) => onLoadError(toErrorMessage(error))}
            onGetTextError={(error: unknown) => onLoadError(toErrorMessage(error))}
            width={800}
            loading={
              <div className="mb-4 flex h-32 items-center justify-center rounded-md bg-white text-sm text-slate-500">
                Rendering page {pageNumber}...
              </div>
            }
          />
        ))}
      </Document>
    </div>
  );
}
