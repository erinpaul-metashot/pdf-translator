'use client';

import React, { useCallback, useRef, useState } from 'react';
import type { ConversionConfidenceDiagnostics } from '@/lib/pdf-to-html-engine';

interface ClaudeSourceUploadPanelProps {
  fileUrl: string | null;
  fileName: string;
  totalPages: number;
  confidence: ConversionConfidenceDiagnostics | null;
  error: string | null;
  onFileSelect: (file: File) => void;
}

export default function ClaudeSourceUploadPanel({
  fileUrl,
  fileName,
  totalPages,
  confidence,
  error,
  onFileSelect,
}: ClaudeSourceUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) {
        return;
      }
      onFileSelect(file);
    },
    [onFileSelect]
  );

  const onOpenPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      handleFile(event.dataTransfer.files?.[0]);
    },
    [handleFile]
  );

  return (
    <section className="claude-panel" id="claude-source-panel">
      <header className="claude-panel-header">
        <h2 className="claude-panel-title">SOURCE PDF</h2>
        {fileName ? <span className="claude-panel-meta">{fileName}</span> : null}
      </header>

      <div className="claude-panel-body">
        <input
          ref={inputRef}
          className="claude-hidden-input"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            handleFile(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />

        {fileUrl ? (
          <>
            <button type="button" className="claude-upload-btn" onClick={onOpenPicker}>
              Replace PDF
            </button>
            <p className="claude-upload-meta">
              {fileName ? `${fileName}${totalPages > 0 ? ` • ${totalPages} pages` : ''}` : 'PDF uploaded'}
            </p>
          </>
        ) : (
          <div
            className={`claude-upload-zone ${isDragOver ? 'drag-over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setIsDragOver(false);
            }}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            onClick={onOpenPicker}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpenPicker();
              }
            }}
          >
            <button type="button" className="claude-upload-btn">
              Upload PDF
            </button>
            <p className="claude-upload-hint">Click or drag a PDF to start Claude translation workflow.</p>
            <p className="claude-upload-meta">No file selected</p>
          </div>
        )}

        {fileUrl ? (
          <div className="claude-source-preview-wrap">
            <iframe title="Source PDF preview" src={fileUrl} className="claude-source-preview" />
          </div>
        ) : null}

        {confidence ? (
          <div className={`claude-confidence-box band-${confidence.summary.band}`}>
            <p className="claude-confidence-title">
              Conversion confidence: {confidence.summary.band.toUpperCase()} ({Math.round(confidence.summary.score * 100)}%)
            </p>
            <p className="claude-confidence-meta">
              {confidence.summary.warningPages + confidence.summary.criticalPages} flagged of {confidence.summary.totalPages} pages
            </p>
            {confidence.warnings.length > 0 ? (
              <ul className="claude-confidence-list">
                {confidence.warnings.slice(0, 3).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {error ? <div className="claude-panel-error">{error}</div> : null}
      </div>
    </section>
  );
}
