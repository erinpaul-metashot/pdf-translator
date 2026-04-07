'use client';

import React, { useCallback, useRef, useState } from 'react';
import SourcePane from '../components/SourcePane';
import TranslatedPane from '../components/TranslatedPane';
import FloatingControlBar from '../components/FloatingControlBar';
import ProgressOverlay from '../components/ProgressOverlay';
import ApiSettingsModal from '@/app/components/ApiSettingsModal';
import { useTranslationState } from '../hooks/useTranslationState';
import { usePdfDocument } from '../hooks/usePdfDocument';
import { validatePdfFile, validatePageCount } from '../lib/validators';

export default function SarvamPage() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const {
    state,
    setFile,
    setError,
    clearError,
    setLanguage,
    setScope,
    startTranslation,
    retry,
    reset,
    enterEditMode,
    exitEditMode,
    addEdit,
    updateTranslatedPage,
    getButtonLabel,
    getButtonAction,
  } = useTranslationState();

  const sourceDoc = usePdfDocument();
  const translatedDoc = usePdfDocument();

  const fileRef = useRef<File | null>(null);

  const handleFileSelect = useCallback(
    (file: File, url: string, totalPages: number) => {
      if (file.name === 'update' && state.file) {
        const pageErr = validatePageCount(totalPages);
        if (pageErr) {
          setError(pageErr.message);
          return;
        }
        setFile(state.file, state.fileUrl || url, totalPages);
        sourceDoc.setTotalPages(totalPages);
        return;
      }

      const fileErr = validatePdfFile(file);
      if (fileErr) {
        setError(fileErr.message);
        return;
      }

      fileRef.current = file;
      setFile(file, url, totalPages);
      if (totalPages > 0) {
        sourceDoc.setTotalPages(totalPages);
      }
    },
    [state.file, state.fileUrl, setFile, setError, sourceDoc]
  );

  const handleDownload = useCallback(() => {
    if (!state.translatedHtml) return;

    const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Translated Document</title>
  <style>
    body { font-family: 'Inter', sans-serif; margin: 0; padding: 24px; color: #1a1a1a; }
    img { max-width: 100%; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ddd; padding: 8px; }
  </style>
</head>
<body>
${state.translatedPages.join('<div style="page-break-after: always;"></div>')}
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'translated-document.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [state.translatedHtml, state.translatedPages]);

  const handleShare = useCallback(() => {
    if (navigator.share) {
      navigator.share({
        title: 'Translated Document',
        text: 'Check out this translated document',
      });
    } else {
      navigator.clipboard.writeText(window.location.href);
    }
  }, []);

  const canTranslate =
    state.status === 'fileReady' &&
    state.file !== null &&
    state.targetLanguage !== null;

  // Map TranslationStatus to WorkflowStage for FloatingControlBar
  const getWorkflowStageFn = (): 'idle' | 'sourceReady' | 'processing' | 'convertedReady' | 'translating' | 'translatedReady' | 'convertingPdf' | 'pdfReady' => {
    switch (state.status) {
      case 'idle':
        return 'idle';
      case 'fileReady':
        return 'sourceReady';
      case 'processing':
        return 'processing';
      case 'convertedReady':
        return 'convertedReady';
      case 'translating':
        return 'translating';
      case 'translatedSuccess':
      case 'editing':
        return 'translatedReady';
      case 'convertingPdf':
        return 'convertingPdf';
      case 'pdfReady':
        return 'pdfReady';
      case 'translationFailed':
        return 'sourceReady';
      default:
        return 'idle';
    }
  };
  const stage = getWorkflowStageFn();



  return (
    <>
      <div className="translator-layout workflow-layout">
        <SourcePane
          fileUrl={state.fileUrl}
          totalPages={state.totalPages}
          currentPage={sourceDoc.currentPage}
          scope={state.scope}
          onFileSelect={handleFileSelect}
          onPageChange={sourceDoc.goToPage}
          onScopeChange={setScope}
          onError={setError}
          error={state.error}
        />

        <TranslatedPane
          status={state.status}
          translatedPages={state.translatedPages}
          currentPage={translatedDoc.currentPage}
          totalPages={state.translatedPages.length}
          targetLangCode={state.targetLanguage?.code || 'hi-IN'}
          onPageChange={translatedDoc.goToPage}
          onEdit={addEdit}
          onUpdatePage={updateTranslatedPage}
        />
      </div>

      <ProgressOverlay
        progress={state.progress}
        isVisible={state.status === 'translating'}
      />

      <FloatingControlBar
        stage={stage}
        targetLanguage={state.targetLanguage}
        onLanguageSelect={setLanguage}
        buttonLabel={getButtonLabel()}
        onButtonClick={getButtonAction()}
        onDownload={handleDownload}
        onSettingsClick={() => setIsSettingsOpen(true)}
        canTranslate={canTranslate}
        showLanguageSelectorAt="sourceReady"
      />

      {state.error && state.status !== 'idle' && state.fileUrl && (
        <div className="error-toast" id="error-toast">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {state.error}
          <button className="error-toast-close" onClick={clearError}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {isSettingsOpen && (
        <ApiSettingsModal
          onClose={() => setIsSettingsOpen(false)}
          onError={setError}
        />
      )}
    </>
  );
}





