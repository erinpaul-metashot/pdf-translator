'use client';

import React, { useMemo } from 'react';

import { SUPPORTED_LANGUAGES } from '@/app/lib/constants';

import type { ClaudeEngineDraft, ClaudePromptDraft } from '../types';

interface ClaudePromptEditorPanelProps {
  prompt: ClaudePromptDraft;
  engine: ClaudeEngineDraft;
  targetLanguageCode: string;
  disabled: boolean;
  onPromptChange: (next: ClaudePromptDraft) => void;
  onEngineChange: (next: ClaudeEngineDraft) => void;
  onTargetLanguageChange: (languageCode: string) => void;
}

export default function ClaudePromptEditorPanel({
  prompt,
  engine,
  targetLanguageCode,
  disabled,
  onPromptChange,
  onEngineChange,
  onTargetLanguageChange,
}: ClaudePromptEditorPanelProps) {
  const modelOptions = useMemo(
    () => [
      { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    ],
    []
  );

  return (
    <section className="claude-panel" id="claude-prompt-panel">
      <header className="claude-panel-header">
        <h2 className="claude-panel-title">PROMPT ENGINE</h2>
        <span className="claude-panel-meta">Claude-guided page translation</span>
      </header>

      <div className="claude-panel-body claude-form-body">
        <label className="claude-label" htmlFor="claude-target-language">
          Target language
        </label>
        <select
          id="claude-target-language"
          className="claude-input"
          value={targetLanguageCode}
          disabled={disabled}
          onChange={(event) => onTargetLanguageChange(event.target.value)}
        >
          {SUPPORTED_LANGUAGES.map((language) => (
            <option key={language.code} value={language.code}>
              {language.name} ({language.code})
            </option>
          ))}
        </select>

        <label className="claude-label" htmlFor="claude-model">
          Model
        </label>
        <select
          id="claude-model"
          className="claude-input"
          value={engine.model}
          disabled={disabled}
          onChange={(event) => onEngineChange({ ...engine, model: event.target.value })}
        >
          {modelOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <div className="claude-grid-2">
          <div>
            <label className="claude-label" htmlFor="claude-temperature">
              Temperature
            </label>
            <input
              id="claude-temperature"
              className="claude-input"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={engine.temperature}
              disabled={disabled}
              onChange={(event) =>
                onEngineChange({
                  ...engine,
                  temperature: Number(event.target.value),
                })
              }
            />
          </div>

          <div>
            <label className="claude-label" htmlFor="claude-batch-size">
              Batch size
            </label>
            <input
              id="claude-batch-size"
              className="claude-input"
              type="number"
              min={1}
              max={30}
              step={1}
              value={engine.batchSize}
              disabled={disabled}
              onChange={(event) =>
                onEngineChange({
                  ...engine,
                  batchSize: Number(event.target.value),
                })
              }
            />
          </div>
        </div>

        <label className="claude-label" htmlFor="claude-system-prompt">
          System prompt
        </label>
        <textarea
          id="claude-system-prompt"
          className="claude-textarea"
          rows={4}
          value={prompt.systemPrompt}
          disabled={disabled}
          onChange={(event) => onPromptChange({ ...prompt, systemPrompt: event.target.value })}
        />

        <label className="claude-label" htmlFor="claude-translation-prompt">
          Translation prompt
        </label>
        <textarea
          id="claude-translation-prompt"
          className="claude-textarea"
          rows={8}
          value={prompt.translationPrompt}
          disabled={disabled}
          onChange={(event) => onPromptChange({ ...prompt, translationPrompt: event.target.value })}
        />
      </div>
    </section>
  );
}
