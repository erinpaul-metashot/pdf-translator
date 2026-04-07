'use client';

import { useState, useCallback } from 'react';
import type {
  TranslationState,
  TranslationStatus,
  TranslationScope,
  Language,
  TextEdit,
  SarvamJobProgress,
} from '../lib/types';
import { POLL_INTERVAL_MS } from '../lib/constants';

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

const initialScope: TranslationScope = { mode: 'full' };

const initialState: TranslationState = {
  status: 'idle',
  file: null,
  fileUrl: null,
  totalPages: 0,
  targetLanguage: null,
  scope: initialScope,
  progress: null,
  translatedHtml: null,
  translatedPages: [],
  edits: [],
  error: null,
};

export function useTranslationState() {
  const [state, setState] = useState<TranslationState>(initialState);

  // ── File Management ────────────────────────────────────────────────
  const setFile = useCallback((file: File, url: string, totalPages: number) => {
    setState((prev) => ({
      ...prev,
      status: 'fileReady',
      file,
      fileUrl: url,
      totalPages,
      error: null,
      translatedHtml: null,
      translatedPages: [],
      edits: [],
      progress: null,
    }));
  }, []);

  const setError = useCallback((error: string) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  // ── Language ───────────────────────────────────────────────────────
  const setLanguage = useCallback((lang: Language) => {
    setState((prev) => ({ ...prev, targetLanguage: lang }));
  }, []);

  // ── Scope ──────────────────────────────────────────────────────────
  const setScope = useCallback((scope: TranslationScope) => {
    setState((prev) => ({ ...prev, scope }));
  }, []);

  // ── Translation Flow ──────────────────────────────────────────────
  const startTranslation = useCallback(async () => {
    const localSarvamKey = getStoredSarvamApiKey();
    const requestHeaders = localSarvamKey
      ? { 'x-sarvam-api-key': localSarvamKey }
      : undefined;

    setState((prev) => ({
      ...prev,
      status: 'translating',
      error: null,
      progress: null,
      translatedHtml: null,
      translatedPages: [],
    }));

    try {
      // Step 1: Start translation pipeline
      const formData = new FormData();
      if (state.file) {
        formData.append('file', state.file);
      }
      formData.append('targetLang', state.targetLanguage?.code || 'hi-IN');
      formData.append('scope', JSON.stringify(state.scope));

      const startRes = await fetch('/api/translate', {
        method: 'POST',
        headers: requestHeaders,
        body: formData,
      });

      if (!startRes.ok) {
        const errData = await startRes.json();
        throw new Error(errData.error || 'Failed to start translation');
      }

      const { jobId } = await startRes.json();

      // Step 2: Poll for status
      let completed = false;
      const startTime = Date.now();

      while (!completed) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

        if (Date.now() - startTime > 10 * 60 * 1000) {
          throw new Error('Translation timed out');
        }

        const statusResWithKey = await fetch(`/api/translate/status?jobId=${jobId}`, {
          headers: requestHeaders,
        });
        if (!statusResWithKey.ok) {
          const statusError = await statusResWithKey.json().catch(() => ({}));
          throw new Error(statusError.error || 'Failed to check status');
        }

        const statusData = await statusResWithKey.json();

        const progress: SarvamJobProgress = {
          jobId,
          state: statusData.state,
          totalPages: statusData.totalPages,
          pagesProcessed: statusData.pagesProcessed,
          pagesSucceeded: statusData.pagesSucceeded,
          pagesFailed: statusData.pagesFailed,
          errorMessage: statusData.errorMessage,
        };

        setState((prev) => ({ ...prev, progress }));

        if (['Completed', 'PartiallyCompleted'].includes(statusData.state)) {
          completed = true;
        } else if (statusData.state === 'Failed') {
          throw new Error(statusData.errorMessage || 'Translation failed');
        }
      }

      // Step 3: Download translated output
      const downloadRes = await fetch(`/api/translate/download?jobId=${jobId}&targetLang=${state.targetLanguage?.code || 'hi-IN'}`, {
        headers: requestHeaders,
      });
      if (!downloadRes.ok) {
        const downloadError = await downloadRes.json().catch(() => ({}));
        throw new Error(downloadError.error || 'Failed to download translation');
      }

      const { html, pages } = await downloadRes.json();

      setState((prev) => ({
        ...prev,
        status: 'translatedSuccess',
        translatedHtml: html,
        translatedPages: pages || [html],
        error: null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: 'translationFailed',
        error: err instanceof Error ? err.message : 'Translation failed',
      }));
    }
  }, [state.file, state.targetLanguage, state.scope]);

  const retry = useCallback(() => {
    startTranslation();
  }, [startTranslation]);

  const reset = useCallback(() => {
    if (state.fileUrl) {
      URL.revokeObjectURL(state.fileUrl);
    }
    setState(initialState);
  }, [state.fileUrl]);

  // ── Editing ────────────────────────────────────────────────────────
  const enterEditMode = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'editing' }));
  }, []);

  const exitEditMode = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'translatedSuccess' }));
  }, []);

  const addEdit = useCallback((edit: TextEdit) => {
    setState((prev) => ({
      ...prev,
      edits: [...prev.edits.filter((e) => e.id !== edit.id), edit],
    }));
  }, []);

  const updateTranslatedPage = useCallback((pageIndex: number, html: string) => {
    setState((prev) => {
      const pages = [...prev.translatedPages];
      pages[pageIndex] = html;
      return { ...prev, translatedPages: pages };
    });
  }, []);

  // ── Button Label ───────────────────────────────────────────────────
  const getButtonLabel = useCallback((): string => {
    switch (state.status) {
      case 'translating':
        return 'Processing...';
      case 'translationFailed':
        return 'RETRY';
      case 'translatedSuccess':
      case 'editing':
        return 'NEW PDF';
      default:
        return 'TRANSLATE';
    }
  }, [state.status]);

  const getButtonAction = useCallback(() => {
    switch (state.status) {
      case 'translationFailed':
        return retry;
      case 'translatedSuccess':
      case 'editing':
        return reset;
      default:
        return startTranslation;
    }
  }, [state.status, retry, reset, startTranslation]);

  return {
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
  };
}
