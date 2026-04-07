'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ApiProvider = 'openai' | 'claude' | 'gemini' | 'sarvam';
type ApiKeyMap = Partial<Record<ApiProvider, string>>;

type VerifyStatus = 'idle' | 'checking' | 'valid' | 'invalid';

type VerifyState = Record<
  ApiProvider,
  {
    status: VerifyStatus;
    message: string | null;
  }
>;

interface ApiSettingsModalProps {
  onClose: () => void;
  onError: (message: string) => void;
}

const STORAGE_KEY = 'pdfTranslator.apiKeys.v1';

const PROVIDERS: Array<{
  id: ApiProvider;
  title: string;
  placeholder: string;
}> = [
  { id: 'sarvam', title: 'Sarvam', placeholder: 'Your Sarvam API key' },
  // { id: 'openai', title: 'OpenAI', placeholder: 'sk-...' },
  // { id: 'claude', title: 'Claude', placeholder: 'sk-ant-...' },
  // { id: 'gemini', title: 'Gemini', placeholder: 'AIza...' },
];

const DEFAULT_VERIFY_STATE: VerifyState = {
  openai: { status: 'idle', message: null },
  claude: { status: 'idle', message: null },
  gemini: { status: 'idle', message: null },
  sarvam: { status: 'idle', message: null },
};

function parseStoredValue(raw: string | null): ApiKeyMap {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const map = parsed as Record<string, unknown>;
    return PROVIDERS.reduce((acc, provider) => {
      const value = map[provider.id];
      if (typeof value === 'string' && value.trim()) {
        acc[provider.id] = value.trim();
      }
      return acc;
    }, {} as ApiKeyMap);
  } catch {
    return {};
  }
}

function getMaskedPreview(value: string): string {
  if (!value) {
    return '';
  }

  const suffixLength = Math.min(4, value.length);
  const suffix = value.slice(-suffixLength);
  return `Saved (...${suffix})`;
}

function getStoredKeys(): ApiKeyMap {
  if (typeof window === 'undefined') {
    return {};
  }

  return parseStoredValue(localStorage.getItem(STORAGE_KEY));
}

export default function ApiSettingsModal({ onClose, onError }: ApiSettingsModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [draftKeys, setDraftKeys] = useState<ApiKeyMap>(getStoredKeys);
  const [savedKeys, setSavedKeys] = useState<ApiKeyMap>(getStoredKeys);
  const [verifyState, setVerifyState] = useState<VerifyState>(DEFAULT_VERIFY_STATE);

  const hasPendingChanges = useMemo(() => {
    const current = PROVIDERS.reduce((acc, provider) => {
      const value = (draftKeys[provider.id] || '').trim();
      if (value) {
        acc[provider.id] = value;
      }
      return acc;
    }, {} as ApiKeyMap);

    return JSON.stringify(current) !== JSON.stringify(savedKeys);
  }, [draftKeys, savedKeys]);

  const persistToStorage = useCallback(
    (next: ApiKeyMap) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setSavedKeys(next);
      } catch {
        onError('Unable to save API keys to local storage.');
      }
    },
    [onError]
  );

  const handleInputChange = useCallback((provider: ApiProvider, value: string) => {
    setDraftKeys((prev) => ({ ...prev, [provider]: value }));
    setVerifyState((prev) => ({
      ...prev,
      [provider]: { status: 'idle', message: null },
    }));
  }, []);

  const handleDelete = useCallback(
    (provider: ApiProvider) => {
      setDraftKeys((prev) => ({ ...prev, [provider]: '' }));

      setSavedKeys((prevSaved) => {
        const nextSaved = { ...prevSaved };
        delete nextSaved[provider];

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSaved));
        } catch {
          onError('Unable to delete API key from local storage.');
        }

        return nextSaved;
      });

      setVerifyState((prev) => ({
        ...prev,
        [provider]: { status: 'idle', message: null },
      }));
    },
    [onError]
  );

  const handleSaveChanges = useCallback(() => {
    const normalized = PROVIDERS.reduce((acc, provider) => {
      const value = (draftKeys[provider.id] || '').trim();
      if (value) {
        acc[provider.id] = value;
      }
      return acc;
    }, {} as ApiKeyMap);

    persistToStorage(normalized);
  }, [draftKeys, persistToStorage]);

  const handleVerify = useCallback(async (provider: ApiProvider) => {
    const key = (draftKeys[provider] || '').trim();

    if (!key) {
      setVerifyState((prev) => ({
        ...prev,
        [provider]: { status: 'invalid', message: 'Enter a key first.' },
      }));
      return;
    }

    setVerifyState((prev) => ({
      ...prev,
      [provider]: { status: 'checking', message: 'Checking key...' },
    }));

    try {
      const response = await fetch('/api/keys/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider, key }),
      });

      const payload = (await response.json()) as {
        valid?: boolean;
        message?: string;
      };

      if (payload.valid) {
        setVerifyState((prev) => ({
          ...prev,
          [provider]: {
            status: 'valid',
            message: payload.message || 'Key looks valid.',
          },
        }));
        return;
      }

      setVerifyState((prev) => ({
        ...prev,
        [provider]: {
          status: 'invalid',
          message: payload.message || 'Key verification failed.',
        },
      }));
    } catch {
      setVerifyState((prev) => ({
        ...prev,
        [provider]: {
          status: 'invalid',
          message: 'Unable to verify right now. Try again in a moment.',
        },
      }));
    }
  }, [draftKeys]);

  const requestClose = useCallback(() => {
    if (hasPendingChanges) {
      const shouldClose = window.confirm('You have unsaved API key changes. Close anyway?');
      if (!shouldClose) {
        return;
      }
    }

    onClose();
  }, [hasPendingChanges, onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [requestClose]);

  useEffect(() => {
    modalRef.current?.focus();
  }, []);

  return (
    <div className="api-settings-backdrop" onClick={requestClose}>
      <div
        className="api-settings-modal"
        onClick={(event) => event.stopPropagation()}
        id="api-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-settings-title"
        tabIndex={-1}
        ref={modalRef}
      >
        <div className="api-settings-header">
          <h3 id="api-settings-title">API Settings</h3>
          <button className="api-settings-close-btn" onClick={requestClose} type="button" id="api-settings-close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="api-settings-body">
          <p className="api-settings-note">
            Keys are saved in your browser local storage on this device only.
          </p>

          {PROVIDERS.map((provider) => {
            const currentValue = draftKeys[provider.id] || '';
            const savedValue = savedKeys[provider.id] || '';
            const state = verifyState[provider.id];
            const statusClass =
              state.status === 'valid'
                ? 'valid'
                : state.status === 'invalid'
                ? 'invalid'
                : state.status === 'checking'
                ? 'checking'
                : '';

            return (
              <div className="api-key-row" key={provider.id}>
                <div className="api-key-row-top">
                  <label htmlFor={`api-key-${provider.id}`}>{provider.title}</label>
                  {savedValue ? (
                    <span className="api-key-saved-badge">{getMaskedPreview(savedValue)}</span>
                  ) : (
                    <span className="api-key-saved-badge empty">Not saved</span>
                  )}
                </div>

                <div className="api-key-input-wrap">
                  <input
                    id={`api-key-${provider.id}`}
                    className="api-key-input"
                    type="password"
                    autoComplete="off"
                    value={currentValue}
                    onChange={(event) => handleInputChange(provider.id, event.target.value)}
                    placeholder={provider.placeholder}
                  />

                  <button
                    type="button"
                    className="api-key-action-btn"
                    onClick={() => {
                      void handleVerify(provider.id);
                    }}
                    disabled={!currentValue.trim() || state.status === 'checking'}
                  >
                    {state.status === 'checking' ? 'Syncing...' : 'Sync'}
                  </button>

                  <button
                    type="button"
                    className="api-key-action-btn danger"
                    onClick={() => handleDelete(provider.id)}
                    disabled={!currentValue.trim() && !savedValue}
                  >
                    Delete
                  </button>
                </div>

                {state.message && (
                  <p className={`api-key-status ${statusClass}`}>{state.message}</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="api-settings-footer">
          <button className="api-settings-cancel-btn" onClick={requestClose} type="button">
            Close
          </button>
          <button
            className="api-settings-save-btn"
            onClick={handleSaveChanges}
            type="button"
            disabled={!hasPendingChanges}
            id="api-settings-save"
          >
            Save Keys
          </button>
        </div>
      </div>
    </div>
  );
}
