'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'pdfTranslator.apiKeys.v1';

interface StoredApiKeys {
  claude?: string;
  [key: string]: unknown;
}

interface ClaudeApiSettingsModalProps {
  onClose: () => void;
  onError: (message: string) => void;
}

function readStoredApiKeys(): StoredApiKeys {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as StoredApiKeys) : {};
  } catch {
    return {};
  }
}

export default function ClaudeApiSettingsModal({ onClose, onError }: ClaudeApiSettingsModalProps) {
  const existing = useMemo(() => readStoredApiKeys(), []);
  const [keyInput, setKeyInput] = useState<string>(typeof existing.claude === 'string' ? existing.claude : '');
  const [savedPreview, setSavedPreview] = useState<string>(typeof existing.claude === 'string' ? existing.claude : '');
  const [verifyMessage, setVerifyMessage] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState(false);

  const saveKey = useCallback(() => {
    const current = readStoredApiKeys();
    const next: StoredApiKeys = {
      ...current,
      claude: keyInput.trim(),
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSavedPreview(next.claude || '');
      setVerifyMessage('Claude key saved locally.');
    } catch {
      onError('Unable to save Claude API key in local storage.');
    }
  }, [keyInput, onError]);

  const verifyKey = useCallback(async () => {
    const key = keyInput.trim();
    if (!key) {
      setVerifyMessage('Enter a Claude API key first.');
      return;
    }

    setIsVerifying(true);
    setVerifyMessage('Verifying key...');

    try {
      const response = await fetch('/api/keys/verify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ provider: 'claude', key }),
      });

      const payload = (await response.json()) as { valid?: boolean; message?: string };
      if (payload.valid) {
        setVerifyMessage(payload.message || 'Claude key verified.');
        return;
      }

      setVerifyMessage(payload.message || 'Claude key verification failed.');
    } catch {
      setVerifyMessage('Verification failed. Try again shortly.');
    } finally {
      setIsVerifying(false);
    }
  }, [keyInput]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const savedTail = savedPreview ? savedPreview.slice(-4) : '';

  return (
    <div className="claude-settings-backdrop" onClick={onClose}>
      <div className="claude-settings-modal" onClick={(event) => event.stopPropagation()}>
        <header className="claude-settings-header">
          <h3>Claude API Settings</h3>
          <button type="button" onClick={onClose} className="claude-settings-close">
            Close
          </button>
        </header>

        <div className="claude-settings-body">
          <p className="claude-settings-note">
            Key is stored only in your browser for this device. Current saved key: {savedTail ? `...${savedTail}` : 'none'}
          </p>

          <label className="claude-label" htmlFor="claude-api-key-input">
            Claude API key
          </label>
          <input
            id="claude-api-key-input"
            className="claude-input"
            type="password"
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            placeholder="sk-ant-..."
          />

          <div className="claude-settings-actions">
            <button type="button" className="claude-action-btn" onClick={verifyKey} disabled={isVerifying}>
              {isVerifying ? 'Verifying...' : 'Verify'}
            </button>
            <button type="button" className="claude-action-btn primary" onClick={saveKey}>
              Save
            </button>
          </div>

          {verifyMessage ? <p className="claude-settings-message">{verifyMessage}</p> : null}
        </div>
      </div>
    </div>
  );
}
