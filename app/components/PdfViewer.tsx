'use client';

import React, { useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  fileUrl: string;
  currentPage: number;
  totalPages: number;
  onDocumentLoad: (numPages: number) => void;
  onPageChange?: (page: number) => void;
  showNavigation?: boolean;
  width?: number;
}

export default function PdfViewer({
  fileUrl,
  currentPage,
  totalPages,
  onDocumentLoad,
  onPageChange,
  showNavigation = true,
  width,
}: PdfViewerProps) {
  const handleLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      onDocumentLoad(numPages);
    },
    [onDocumentLoad]
  );

  const goTo = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, totalPages));
      onPageChange?.(clamped);
    },
    [totalPages, onPageChange]
  );

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer-canvas">
        <Document
          file={fileUrl}
          onLoadSuccess={handleLoadSuccess}
          loading={
            <div className="pdf-viewer-loading">
              <div className="loading-spinner" />
              <span>Loading PDF...</span>
            </div>
          }
          error={
            <div className="pdf-viewer-error">
              <span>Failed to load PDF</span>
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            width={width || 480}
            renderTextLayer={false}
            renderAnnotationLayer={false}
          />
        </Document>
      </div>
    </div>
  );
}
