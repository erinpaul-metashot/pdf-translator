'use client';

import React, { useCallback } from 'react';
import LanguageSelector from './LanguageSelector';
import type { Language, WorkflowStage } from '../lib/types';

interface FloatingControlBarProps {
  stage: WorkflowStage;
  targetLanguage: Language | null;
  onLanguageSelect: (lang: Language) => void;
  buttonLabel: string;
  onButtonClick: () => void;
  onDownload: () => void;
  onSettingsClick: () => void;
  canTranslate: boolean;
  showLanguageSelectorAt?: 'sourceReady' | 'convertedReady';
}

export default function FloatingControlBar({
  stage,
  targetLanguage,
  onLanguageSelect,
  buttonLabel,
  onButtonClick,
  onDownload,
  onSettingsClick,
  canTranslate,
  showLanguageSelectorAt = 'convertedReady',
}: FloatingControlBarProps) {
  // Show language selector based on config - either from sourceReady (sarvam) or convertedReady (pdf-editor)
  const shouldShowLanguageSelector = showLanguageSelectorAt === 'sourceReady'
    ? stage === 'sourceReady' || stage === 'translating' || stage === 'translatedReady'
    : stage === 'convertedReady' || stage === 'translating' || stage === 'translatedReady';

  const isTranslating = stage === 'translating';
  const hasTranslation = stage === 'translatedReady' || stage === 'pdfReady';




  const handleDownload = useCallback(() => {
    if (hasTranslation) {
      onDownload();
    }
  }, [hasTranslation, onDownload]);

  return (
    <div className="floating-bar" id="floating-control-bar">
      <div className="floating-bar-inner">
        {/* Settings Button */}
        <button
          className="floating-icon-btn"
          onClick={onSettingsClick}
          title="Settings"
          type="button"
          id="settings-btn"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* Language Selector - Only show during translation phase */}
        {shouldShowLanguageSelector && (
          <div className="floating-lang-section">
            <span className="floating-lang-label">Translate to:</span>
            <LanguageSelector
              selected={targetLanguage}
              onSelect={onLanguageSelect}
              disabled={stage === 'translating'}
            />
          </div>
        )}

        {/* Primary Action Button */}
        <button
          className={`floating-primary-btn ${hasTranslation ? 'new-pdf' : ''}`}
          onClick={onButtonClick}
          disabled={isTranslating || !canTranslate}
          type="button"
          id="primary-action-btn"
        >
          {isTranslating ? (
            <>
              <div className="loading-spinner-small" />
              {buttonLabel}
            </>
          ) : hasTranslation ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              {buttonLabel}
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" />
              </svg>
              {buttonLabel}
            </>
          )}
        </button>

        {/* Download Button */}
        <button
          className={`floating-icon-btn download ${hasTranslation ? 'active' : ''}`}
          onClick={handleDownload}
          disabled={!hasTranslation}
          title="Download translated PDF"
          type="button"
          id="download-btn"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
