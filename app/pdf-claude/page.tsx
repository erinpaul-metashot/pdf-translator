'use client';

import React, { useMemo, useState } from 'react';

import ClaudeApiSettingsModal from './components/ClaudeApiSettingsModal';
import ClaudeFloatingControlPanel from './components/ClaudeFloatingControlPanel';
import ClaudePromptEditorPanel from './components/ClaudePromptEditorPanel';
import ClaudeSourceUploadPanel from './components/ClaudeSourceUploadPanel';
import ClaudeTranslatedPdfPanel from './components/ClaudeTranslatedPdfPanel';
import { useClaudePdfWorkflow } from './hooks/useClaudePdfWorkflow';

export default function PdfClaudePage() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const {
    state,
    canStartTranslation,
    canDownload,
    setError,
    setFile,
    setPrompt,
    setEngine,
    setTargetLanguage,
    setSelectedTranslatedPage,
    updateTranslatedPage,
    startTranslation,
    downloadTranslatedPdf,
    clearError,
  } = useClaudePdfWorkflow();

  const runSummaryText = useMemo(() => {
    if (!state.runSummary) {
      return null;
    }

    const { usage, cost } = state.runSummary;
    const formatInt = new Intl.NumberFormat('en-US');
    const formatUsd = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
    const cacheTokens = usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
    const cacheBreakdown =
      cacheTokens > 0
        ? `, cache ${formatInt.format(cacheTokens)} (write ${formatInt.format(usage.cacheCreationInputTokens)}, read ${formatInt.format(usage.cacheReadInputTokens)})`
        : '';

    return `Tokens ${formatInt.format(usage.totalTokens)} (in ${formatInt.format(usage.inputTokens)}, out ${formatInt.format(usage.outputTokens)}${cacheBreakdown}) • Est. ${formatUsd.format(cost.estimatedUsd)} (${cost.model})`;
  }, [state.runSummary]);

  const statusText = useMemo(() => {
    if (!state.progress) {
      return null;
    }

    return `${state.progress.message} (${state.progress.percent}%)`;
  }, [state.progress]);

  const confidenceText = useMemo(() => {
    if (!state.conversionConfidence) {
      return null;
    }

    const scorePercent = Math.round(state.conversionConfidence.summary.score * 100);
    return `Extraction confidence: ${state.conversionConfidence.summary.band.toUpperCase()} (${scorePercent}%) • ${state.conversionConfidence.summary.warningPages + state.conversionConfidence.summary.criticalPages} pages flagged`;
  }, [state.conversionConfidence]);

  const confidenceBand = state.conversionConfidence?.summary.band ?? null;

  const isBusy = state.stage === 'converting' || state.stage === 'translating' || state.stage === 'downloading';

  return (
    <>
      <div className="claude-page-layout">
        <ClaudeSourceUploadPanel
          fileUrl={state.fileUrl}
          fileName={state.fileName}
          totalPages={state.totalPages}
          confidence={state.conversionConfidence}
          error={state.error}
          onFileSelect={setFile}
        />

        <ClaudePromptEditorPanel
          prompt={state.prompt}
          engine={state.engine}
          targetLanguageCode={state.targetLanguage.code}
          disabled={isBusy}
          onPromptChange={setPrompt}
          onEngineChange={setEngine}
          onTargetLanguageChange={setTargetLanguage}
        />

        <ClaudeTranslatedPdfPanel
          pages={state.translatedPages}
          convertedPages={state.convertedPages}
          fileName={state.fileName}
          sourcePageCount={state.totalPages}
          runSummary={state.runSummary}
          artifacts={state.translationArtifacts}
          currentPage={state.selectedTranslatedPage}
          busy={isBusy}
          onPageChange={setSelectedTranslatedPage}
          onPageHtmlChange={updateTranslatedPage}
        />
      </div>

      {statusText ? <div className="claude-status-chip">{statusText}</div> : null}

      {runSummaryText ? <div className="claude-run-summary-chip">{runSummaryText}</div> : null}

      {confidenceText ? (
        <div className={`claude-confidence-chip ${confidenceBand ? `band-${confidenceBand}` : ''}`}>{confidenceText}</div>
      ) : null}

      {state.error ? (
        <div className="claude-error-toast" role="alert">
          <span>{state.error}</span>
          <button type="button" onClick={clearError}>
            Dismiss
          </button>
        </div>
      ) : null}

      <ClaudeFloatingControlPanel
        isWorking={isBusy}
        canStart={canStartTranslation}
        canDownload={canDownload}
        onSettings={() => setSettingsOpen(true)}
        onStart={() => {
          void startTranslation();
        }}
        onDownload={() => {
          void downloadTranslatedPdf();
        }}
      />

      {settingsOpen ? (
        <ClaudeApiSettingsModal
          onClose={() => setSettingsOpen(false)}
          onError={(message) => {
            setError(message);
          }}
        />
      ) : null}
    </>
  );
}
