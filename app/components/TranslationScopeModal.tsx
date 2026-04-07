'use client';

import React, { useState, useCallback } from 'react';
import type { TranslationScope, ScopeMode } from '../lib/types';

interface TranslationScopeModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalPages: number;
  scope: TranslationScope;
  onScopeChange: (scope: TranslationScope) => void;
}

export default function TranslationScopeModal({
  isOpen,
  onClose,
  totalPages,
  scope,
  onScopeChange,
}: TranslationScopeModalProps) {
  const [localMode, setLocalMode] = useState<ScopeMode>(scope.mode);
  const [selectedPages, setSelectedPages] = useState<number[]>(scope.pages || []);
  const [startPage, setStartPage] = useState(scope.startPage || 1);
  const [endPage, setEndPage] = useState(scope.endPage || totalPages);

  const handleApply = useCallback(() => {
    const newScope: TranslationScope = { mode: localMode };
    if (localMode === 'selected') {
      newScope.pages = selectedPages.sort((a, b) => a - b);
    } else if (localMode === 'range') {
      newScope.startPage = startPage;
      newScope.endPage = endPage;
    }
    onScopeChange(newScope);
    onClose();
  }, [localMode, selectedPages, startPage, endPage, onScopeChange, onClose]);

  const togglePage = useCallback((page: number) => {
    setSelectedPages((prev) =>
      prev.includes(page) ? prev.filter((p) => p !== page) : [...prev, page]
    );
  }, []);

  if (!isOpen) return null;

  return (
    <div className="scope-modal-backdrop" onClick={onClose}>
      <div className="scope-modal" onClick={(e) => e.stopPropagation()} id="scope-modal">
        <div className="scope-modal-header">
          <h3>Translation Scope</h3>
          <button className="scope-close-btn" onClick={onClose} id="scope-close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="scope-modal-body">
          {/* Mode Selector */}
          <div className="scope-modes">
            {(['full', 'selected', 'range'] as ScopeMode[]).map((mode) => (
              <button
                key={mode}
                className={`scope-mode-btn ${localMode === mode ? 'active' : ''}`}
                onClick={() => setLocalMode(mode)}
                id={`scope-mode-${mode}`}
                type="button"
              >
                {mode === 'full' ? 'Full PDF' : mode === 'selected' ? 'Selected Pages' : 'Page Range'}
              </button>
            ))}
          </div>

          {/* Selected Pages */}
          {localMode === 'selected' && (
            <div className="scope-pages-grid">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  className={`scope-page-chip ${selectedPages.includes(page) ? 'active' : ''}`}
                  onClick={() => togglePage(page)}
                  type="button"
                >
                  {page}
                </button>
              ))}
            </div>
          )}

          {/* Range */}
          {localMode === 'range' && (
            <div className="scope-range">
              <div className="scope-range-field">
                <label>Start Page</label>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={startPage}
                  onChange={(e) => setStartPage(parseInt(e.target.value) || 1)}
                  id="scope-start-page"
                />
              </div>
              <span className="scope-range-sep">to</span>
              <div className="scope-range-field">
                <label>End Page</label>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={endPage}
                  onChange={(e) => setEndPage(parseInt(e.target.value) || totalPages)}
                  id="scope-end-page"
                />
              </div>
            </div>
          )}
        </div>

        <div className="scope-modal-footer">
          <button className="scope-cancel-btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="scope-apply-btn" onClick={handleApply} type="button" id="scope-apply">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
