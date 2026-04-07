'use client';

import React, { useState, useCallback } from 'react';
import type { Language } from '../lib/types';
import { SUPPORTED_LANGUAGES } from '../lib/constants';

interface LanguageSelectorProps {
  selected: Language | null;
  onSelect: (lang: Language) => void;
  disabled?: boolean;
}

export default function LanguageSelector({ selected, onSelect, disabled = false }: LanguageSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = SUPPORTED_LANGUAGES.filter(
    (l) =>
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.nativeName.includes(search)
  );

  const handleSelect = useCallback(
    (lang: Language) => {
      if (disabled) return;
      onSelect(lang);
      setIsOpen(false);
      setSearch('');
    },
    [onSelect, disabled]
  );

  return (
    <div className="lang-selector" id="language-selector">
      <button
        className="lang-selector-trigger"
        onClick={() => {
          if (disabled) return;
          setIsOpen(!isOpen);
        }}
        id="lang-selector-btn"
        type="button"
        disabled={disabled}
      >
        {selected ? (
          <>
            <span className="lang-flag">{selected.flag}</span>
            <span className="lang-name">{selected.name}</span>
          </>
        ) : (
          <span className="lang-placeholder">Select language</span>
        )}
        <svg
          className={`lang-chevron ${isOpen ? 'open' : ''}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && !disabled && (
        <div className="lang-dropdown" id="lang-dropdown">
          <div className="lang-search-wrapper">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="lang-search"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              id="lang-search-input"
              disabled={disabled}
            />
          </div>
          <div className="lang-list">
            {filtered.map((lang) => (
              <button
                key={lang.code}
                className={`lang-option ${selected?.code === lang.code ? 'selected' : ''}`}
                onClick={() => handleSelect(lang)}
                id={`lang-opt-${lang.code}`}
                type="button"
                disabled={disabled}
              >
                <span className="lang-flag">{lang.flag}</span>
                <span className="lang-opt-name">{lang.name}</span>
                <span className="lang-opt-native">{lang.nativeName}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="lang-empty">No languages found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
