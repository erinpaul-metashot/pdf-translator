'use client';

import React from 'react';
import type { SarvamJobProgress } from '../lib/types';

interface ProgressOverlayProps {
  progress: SarvamJobProgress | null;
  isVisible: boolean;
}

export default function ProgressOverlay({ progress, isVisible }: ProgressOverlayProps) {
  if (!isVisible) return null;

  const percent = progress
    ? Math.round((progress.pagesProcessed / Math.max(progress.totalPages, 1)) * 100)
    : 0;

  return (
    <div className="progress-overlay" id="translation-progress">
      <div className="progress-card">
        <div className="progress-spinner-ring">
          <svg viewBox="0 0 100 100" className="progress-ring-svg">
            <circle
              className="progress-ring-bg"
              cx="50"
              cy="50"
              r="42"
              fill="none"
              strokeWidth="6"
            />
            <circle
              className="progress-ring-fill"
              cx="50"
              cy="50"
              r="42"
              fill="none"
              strokeWidth="6"
              strokeDasharray={`${percent * 2.64} ${264 - percent * 2.64}`}
              strokeDashoffset="0"
              transform="rotate(-90 50 50)"
            />
          </svg>
          <span className="progress-percent">{percent}%</span>
        </div>
        <h3 className="progress-title">Translating Document</h3>
        <p className="progress-detail">
          {progress
            ? `Processing page ${progress.pagesProcessed} of ${progress.totalPages}`
            : 'Initializing...'}
        </p>
        <div className="progress-bar-track">
          <div
            className="progress-bar-fill"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="progress-status">
          {progress?.state === 'Running'
            ? 'Translation in progress...'
            : progress?.state === 'Pending'
            ? 'Preparing document...'
            : 'Starting...'}
        </p>
      </div>
    </div>
  );
}
