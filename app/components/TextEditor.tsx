'use client';

import React, { useState, useCallback, useEffect } from 'react';

const API_KEY_STORAGE_KEY = 'pdfTranslator.apiKeys.v1';

function getStoredSarvamApiKey(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const value = (parsed as Record<string, unknown>).sarvam;
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

interface TextEditorProps {
  selectedText: string;
  originalText?: string;
  targetLang: string | null;
  onSave: (editedText: string, type: 'manual' | 'ai') => void;
  onCancel: () => void;
}

export default function TextEditor({
  selectedText,
  originalText,
  targetLang,
  onSave,
  onCancel,
}: TextEditorProps) {
  const [editedText, setEditedText] = useState(selectedText);
  const [isAiLoading, setIsAiLoading] = useState(false);

  useEffect(() => {
    setEditedText(selectedText);
  }, [selectedText]);

  const handleAiEdit = useCallback(async () => {
	if (!targetLang) {
		return;
	}

    setIsAiLoading(true);
    try {
      const apiKey = getStoredSarvamApiKey();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      if (apiKey) {
        headers['x-sarvam-api-key'] = apiKey;
      }

      const res = await fetch('/api/translate/text', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text: selectedText,
          sourceLang: 'auto',
          targetLang,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setEditedText(data.translatedText);
      }
    } catch (err) {
      console.error('AI edit failed:', err);
    } finally {
      setIsAiLoading(false);
    }
  }, [selectedText, targetLang]);

  return (
    <div className="text-editor-panel" id="text-editor">
      <div className="text-editor-header">
        <h4>Edit Translation</h4>
        <button className="text-editor-close" onClick={onCancel} id="text-editor-close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="text-editor-original">
        <label>Original (Source)</label>
        <p>{originalText?.trim() ? originalText : 'Source text unavailable for this selection.'}</p>
      </div>

      <div className="text-editor-original">
        <label>Current Translation</label>
        <p>{selectedText}</p>
      </div>

      <div className="text-editor-edit-area">
        <label>Edited</label>
        <textarea
          className="text-editor-textarea"
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          rows={4}
          id="text-editor-textarea"
        />
      </div>

      <div className="text-editor-actions">
        <button
          className="text-editor-ai-btn"
          onClick={handleAiEdit}
          disabled={isAiLoading || !targetLang}
          type="button"
          id="ai-edit-btn"
          title={targetLang ? 'Use AI to refine this translation' : 'Select a target language to enable AI refine'}
        >
          {isAiLoading ? (
            <>
              <div className="loading-spinner-small" />
              Refining...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              AI Refine
            </>
          )}
        </button>

        <div className="text-editor-save-group">
          <button
            className="text-editor-discard"
            onClick={onCancel}
            type="button"
          >
            Discard
          </button>
          <button
            className="text-editor-save"
            onClick={() => onSave(editedText, editedText !== selectedText ? 'manual' : 'ai')}
            type="button"
            id="text-editor-save"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
