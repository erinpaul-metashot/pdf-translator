'use client';

import React, { useCallback } from 'react';
import dynamic from 'next/dynamic';
import PdfUploader from './PdfUploader';
import { validatePdfFile, validatePageCount } from '../lib/validators';
import type { TranslationScope } from '../lib/types';

const PdfViewer = dynamic(() => import('./PdfViewer'), {
  ssr: false,
  loading: () => (
    <div className="pdf-viewer-loading">
      <div className="loading-spinner" />
      <span>Loading PDF...</span>
    </div>
  ),
});

interface SourcePaneProps {
  fileUrl: string | null;
  totalPages: number;
  currentPage: number;
  scope: TranslationScope;
  onFileSelect: (file: File, url: string, totalPages: number) => void;
  onPageChange: (page: number) => void;
  onScopeChange: (scope: TranslationScope) => void;
  onError: (error: string) => void;
  error: string | null;
}

export default function SourcePane({
  fileUrl,
  totalPages,
  currentPage,
  scope,
  onFileSelect,
  onPageChange,
  onScopeChange,
  onError,
  error,
}: SourcePaneProps) {
  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, totalPages));
      onPageChange(clamped);
    },
    [totalPages, onPageChange]
  );

  const handleFileSelect = useCallback(
    (file: File) => {
      // Validate file type and size
      const fileError = validatePdfFile(file);
      if (fileError) {
        onError(fileError.message);
        return;
      }

      const url = URL.createObjectURL(file);
      // We'll get page count from PdfViewer's onDocumentLoad
      onFileSelect(file, url, 0);
    },
    [onFileSelect, onError]
  );

  const handleDocumentLoad = useCallback(
    (numPages: number) => {
      const pageError = validatePageCount(numPages);
      if (pageError) {
        onError(pageError.message);
        return;
      }
      // Update total pages from the actual PDF
      onFileSelect(
        // Re-use existing file reference
        new File([], 'update'),
        fileUrl || '',
        numPages
      );
    },
    [onError, onFileSelect, fileUrl]
  );

  return (
    <div className="pane source-pane" id="source-pane">
      <div className="pane-header">
        <h2 className="pane-title">SOURCE PDF</h2>
        {fileUrl && totalPages > 0 && (
          <div className="pdf-viewer-nav" id="pdf-page-nav">
            <button
              className="pdf-nav-btn"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              id="pdf-prev-page"
              aria-label="Previous page"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <div className="pdf-nav-info">
              <input
                type="number"
                className="pdf-nav-input"
                value={currentPage}
                onChange={(e) => goToPage(parseInt(e.target.value) || 1)}
                min={1}
                max={totalPages}
                id="pdf-page-input"
              />
              <span className="pdf-nav-total">{totalPages}</span>
            </div>

            <button
              className="pdf-nav-btn"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
              id="pdf-next-page"
              aria-label="Next page"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="pane-body">
        {fileUrl ? (
          <PdfViewer
            fileUrl={fileUrl}
            currentPage={currentPage}
            totalPages={totalPages}
            onDocumentLoad={handleDocumentLoad}
            onPageChange={onPageChange}
            showNavigation={totalPages > 1}
          />
        ) : (
          <PdfUploader onFileSelect={handleFileSelect} error={error} />
        )}
      </div>
    </div>
  );
}
