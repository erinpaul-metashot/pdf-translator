'use client';

import React from 'react';

interface ClaudeFloatingControlPanelProps {
  isWorking: boolean;
  canStart: boolean;
  canDownload: boolean;
  onSettings: () => void;
  onStart: () => void;
  onDownload: () => void;
}

export default function ClaudeFloatingControlPanel({
  isWorking,
  canStart,
  canDownload,
  onSettings,
  onStart,
  onDownload,
}: ClaudeFloatingControlPanelProps) {
  return (
    <div className="claude-floating-bar" id="claude-floating-bar">
      <div className="claude-floating-inner">
        <button type="button" className="claude-floating-icon" onClick={onSettings} title="Claude API settings">
          Settings
        </button>

        <button
          type="button"
          className="claude-floating-primary"
          disabled={isWorking || !canStart}
          onClick={onStart}
        >
          {isWorking ? 'Processing...' : 'Start Translation'}
        </button>

        <button
          type="button"
          className="claude-floating-icon"
          disabled={!canDownload || isWorking}
          onClick={onDownload}
          title="Download translated PDF"
        >
          Download
        </button>
      </div>
    </div>
  );
}
