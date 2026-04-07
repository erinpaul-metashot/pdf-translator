'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ZoomState = {
  mode: 'fit' | 'manual';
  manualZoom: number;
};

interface WorkflowPreviewPaneProps {
  title: string;
  statusLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  pages: string[];
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  variant: 'html' | 'pdf';
  id?: string;
  enableCodeViewToggle?: boolean;
  isLoading?: boolean;
  loadingLabel?: string;
  sharedZoomState?: ZoomState;
  onSharedZoomStateChange?: (nextZoom: ZoomState) => void;
  sharedViewMode?: 'preview' | 'code';
  onSharedViewModeChange?: (nextViewMode: 'preview' | 'code') => void;
  sharedScrollRatio?: number;
  onSharedScrollRatioChange?: (nextRatio: number) => void;
  highlightText?: string;
  highlightToken?: number;
}

function applyInlineHighlight(content: string, textToHighlight?: string): string {
  const target = textToHighlight?.trim();
  if (!target) {
    return content;
  }

  const doc = new DOMParser().parseFromString(`<div id="highlight-root">${content}</div>`, 'text/html');
  const root = doc.getElementById('highlight-root');
  if (!root) {
    return content;
  }

  const textNodes: Text[] = [];
  const nodeStartOffsets: number[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let rawContent = '';
  let runningOffset = 0;

  while (node) {
    const textNode = node as Text;
    const value = textNode.nodeValue ?? '';
    textNodes.push(textNode);
    nodeStartOffsets.push(runningOffset);
    rawContent += value;
    runningOffset += value.length;
    node = walker.nextNode();
  }

  if (textNodes.length === 0 || rawContent.length === 0) {
    return content;
  }

  const normalizeWithMap = (value: string) => {
    let normalized = '';
    const normalizedToRawIndex: number[] = [];
    let previousWasWhitespace = false;

    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      const isWhitespace = /\s/.test(char);

      if (isWhitespace) {
        if (previousWasWhitespace) {
          continue;
        }

        normalized += ' ';
        normalizedToRawIndex.push(index);
        previousWasWhitespace = true;
        continue;
      }

      normalized += char;
      normalizedToRawIndex.push(index);
      previousWasWhitespace = false;
    }

    return {
      normalized,
      normalizedLower: normalized.toLowerCase(),
      normalizedToRawIndex,
    };
  };

  const normalizedContent = normalizeWithMap(rawContent);
  const normalizedTarget = normalizeWithMap(target).normalizedLower.trim();

  if (!normalizedTarget) {
    return content;
  }

  const matchIndex = normalizedContent.normalizedLower.indexOf(normalizedTarget);
  if (matchIndex < 0) {
    return content;
  }

  const matchNormalizedEnd = matchIndex + normalizedTarget.length - 1;
  const rawStart = normalizedContent.normalizedToRawIndex[matchIndex];
  const rawEndInclusive = normalizedContent.normalizedToRawIndex[matchNormalizedEnd];

  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEndInclusive) || rawEndInclusive < rawStart) {
    return content;
  }

  const rawEnd = rawEndInclusive + 1;

  for (let index = textNodes.length - 1; index >= 0; index -= 1) {
    const textNode = textNodes[index];
    const text = textNode.nodeValue ?? '';
    if (!text) {
      continue;
    }

    const nodeStart = nodeStartOffsets[index];
    const nodeEnd = nodeStart + text.length;
    const overlapStart = Math.max(nodeStart, rawStart);
    const overlapEnd = Math.min(nodeEnd, rawEnd);

    if (overlapEnd <= overlapStart) {
      continue;
    }

    const localStart = overlapStart - nodeStart;
    const localEnd = overlapEnd - nodeStart;
    const before = text.slice(0, localStart);
    const matched = text.slice(localStart, localEnd);
    const after = text.slice(localEnd);

    const fragment = doc.createDocumentFragment();
    if (before) {
      fragment.appendChild(doc.createTextNode(before));
    }

    if (matched) {
      const mark = doc.createElement('mark');
      mark.className = 'workflow-inline-highlight';
      mark.textContent = matched;
      fragment.appendChild(mark);
    }

    if (after) {
      fragment.appendChild(doc.createTextNode(after));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return root.innerHTML;
}

function buildFrameDoc(
  content: string,
  variant: 'html' | 'pdf',
  zoomMode: 'fit' | 'manual',
  manualZoom: number
): string {
  const htmlPageZoom =
    zoomMode === 'fit' ? 'clamp(0.25, calc((100vw - 40px) / 920px), 1)' : `${manualZoom / 100}`;

  const styles =
    variant === 'pdf'
      ? `
        @page { margin: 0; }
        html, body {
          margin: 0;
          padding: 0;
          background: #f3f7f3;
          color: #1a1a1a;
          font-family: Inter, system-ui, sans-serif;
        }
        body {
          min-height: 100vh;
          padding: 20px;
          box-sizing: border-box;
        }
        .document-shell {
          max-width: 920px;
          margin: 0 auto;
        }
        .document-page {
          background: #fff;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
          border-radius: 16px;
          overflow: hidden;
          transform-origin: top left;
          zoom: ${htmlPageZoom};
          break-after: page;
          page-break-after: always;
          margin-bottom: 20px;
        }
        .pdf-page {
          transform-origin: top left;
          zoom: ${htmlPageZoom};
        }
        .document-page:last-child {
          break-after: auto;
          page-break-after: auto;
          margin-bottom: 0;
        }
      `
      : `
        html, body {
          margin: 0;
          padding: 0;
          background: #ffffff;
          color: #1a1a1a;
        }
        body {
          padding: 20px;
          box-sizing: border-box;
        }
        .document-shell {
          max-width: 920px;
          margin: 0 auto;
          background: #ffffff;
        }
        .document-page,
        .pdf-page {
          background: #fff;
          border: 1px solid #e2e8e2;
          border-radius: 16px;
          overflow: hidden;
          margin-bottom: 20px;
          transform-origin: top left;
          /* Keep zoom inside iframe content to avoid host-level blank space/scroll artifacts. */
          zoom: ${htmlPageZoom};
        }
        .document-page:last-child,
        .pdf-page:last-child {
          margin-bottom: 0;
        }
        .workflow-inline-highlight {
          background: #fff59d;
          color: #1b5e20;
          border-radius: 4px;
          padding: 0 1px;
        }
      `;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      ${styles}
    </style>
  </head>
  <body>
    ${content}
  </body>
</html>`;
}

export default function WorkflowPreviewPane({
  title,
  statusLabel,
  emptyTitle,
  emptyDescription,
  pages,
  currentPage,
  totalPages,
  onPageChange,
  variant,
  id,
  enableCodeViewToggle = false,
  isLoading = false,
  loadingLabel = 'Working... please wait.',
  sharedZoomState,
  onSharedZoomStateChange,
  sharedViewMode,
  onSharedViewModeChange,
  sharedScrollRatio,
  onSharedScrollRatioChange,
  highlightText,
  highlightToken,
}: WorkflowPreviewPaneProps): React.JSX.Element {
  const [localZoomMode, setLocalZoomMode] = useState<'fit' | 'manual'>('fit');
  const [localManualZoom, setLocalManualZoom] = useState(100);
  const [localViewMode, setLocalViewMode] = useState<'preview' | 'code'>('preview');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const codeViewRef = useRef<HTMLPreElement>(null);
  const detachScrollListenerRef = useRef<(() => void) | null>(null);
  const isApplyingExternalScrollRef = useRef(false);

  const zoomMode = sharedZoomState?.mode ?? localZoomMode;
  const manualZoom = sharedZoomState?.manualZoom ?? localManualZoom;
  const viewMode = sharedViewMode ?? localViewMode;
  const hasExternalScrollSync = typeof sharedScrollRatio === 'number' && typeof onSharedScrollRatioChange === 'function';
  const scrollRatio = sharedScrollRatio ?? 0;

  const setZoomState = useCallback(
    (nextZoom: ZoomState) => {
      if (onSharedZoomStateChange) {
        onSharedZoomStateChange(nextZoom);
        return;
      }

      setLocalZoomMode(nextZoom.mode);
      setLocalManualZoom(nextZoom.manualZoom);
    },
    [onSharedZoomStateChange]
  );

  const setPaneViewMode = useCallback(
    (nextViewMode: 'preview' | 'code') => {
      if (onSharedViewModeChange) {
        onSharedViewModeChange(nextViewMode);
        return;
      }

      setLocalViewMode(nextViewMode);
    },
    [onSharedViewModeChange]
  );

  const publishScrollRatio = useCallback(
    (nextRatio: number) => {
      const normalized = Math.max(0, Math.min(1, Number.isFinite(nextRatio) ? nextRatio : 0));

      if (onSharedScrollRatioChange) {
        onSharedScrollRatioChange(normalized);
      }
    },
    [onSharedScrollRatioChange]
  );

  const hasZoomControls = pages.length > 0;
  const hasViewToggle = enableCodeViewToggle && variant === 'html' && pages.length > 0;
  const zoomLabel = zoomMode === 'fit' ? 'Fit' : `${manualZoom}%`;

  const handleZoomOut = () => {
    setZoomState({ mode: 'manual', manualZoom: Math.max(50, manualZoom - 10) });
  };

  const handleZoomIn = () => {
    setZoomState({ mode: 'manual', manualZoom: Math.min(200, manualZoom + 10) });
  };

  const handleZoomFit = () => {
    setZoomState({ mode: 'fit', manualZoom });
  };

  const getIframeScrollMetrics = useCallback(() => {
    const iframeWindow = iframeRef.current?.contentWindow;
    const iframeDocument = iframeWindow?.document;
    if (!iframeWindow || !iframeDocument) {
      return null;
    }

    const candidates = [
      iframeDocument.scrollingElement,
      iframeDocument.documentElement,
      iframeDocument.body,
    ].filter(Boolean) as Array<{
      scrollTop?: number;
      scrollHeight?: number;
      clientHeight?: number;
    }>;

    let best: { scrollTop: number; maxScrollTop: number } | null = null;

    for (const candidate of candidates) {
      const scrollTop = typeof candidate.scrollTop === 'number' ? candidate.scrollTop : 0;
      const scrollHeight = typeof candidate.scrollHeight === 'number' ? candidate.scrollHeight : 0;
      const clientHeight = typeof candidate.clientHeight === 'number' ? candidate.clientHeight : 0;
      const maxScrollTop = Math.max(0, scrollHeight - clientHeight);

      if (!best || maxScrollTop > best.maxScrollTop) {
        best = { scrollTop, maxScrollTop };
      }
    }

    if (!best) {
      return null;
    }

    return best;
  }, []);

  const applyIframeScrollRatio = useCallback((ratio: number) => {
    const iframeWindow = iframeRef.current?.contentWindow;
    const iframeDocument = iframeWindow?.document;
    if (!iframeWindow || !iframeDocument) {
      return;
    }

    const candidates = [
      iframeDocument.scrollingElement,
      iframeDocument.documentElement,
      iframeDocument.body,
    ].filter(Boolean) as Array<{
      scrollTop?: number;
      scrollHeight?: number;
      clientHeight?: number;
    }>;

    for (const candidate of candidates) {
      const scrollHeight = typeof candidate.scrollHeight === 'number' ? candidate.scrollHeight : 0;
      const clientHeight = typeof candidate.clientHeight === 'number' ? candidate.clientHeight : 0;
      const maxScrollTop = Math.max(0, scrollHeight - clientHeight);

      if (typeof candidate.scrollTop === 'number') {
        candidate.scrollTop = maxScrollTop * ratio;
      }
    }
  }, []);

  const applyScrollToElement = useCallback((element: Element | null, ratio: number) => {
    if (!element) {
      return;
    }

    const scrollable = element as {
      scrollTop?: number;
      scrollHeight?: number;
      clientHeight?: number;
    };

    if (
      typeof scrollable.scrollTop !== 'number' ||
      typeof scrollable.scrollHeight !== 'number' ||
      typeof scrollable.clientHeight !== 'number'
    ) {
      return;
    }

    const maxScrollTop = Math.max(0, scrollable.scrollHeight - scrollable.clientHeight);
    scrollable.scrollTop = maxScrollTop * ratio;
  }, []);

  const syncScrollFromSharedState = useCallback(() => {
    isApplyingExternalScrollRef.current = true;

    if (viewMode === 'preview') {
      applyIframeScrollRatio(scrollRatio);
    } else {
      applyScrollToElement(codeViewRef.current, scrollRatio);
    }

    requestAnimationFrame(() => {
      isApplyingExternalScrollRef.current = false;
    });
  }, [applyIframeScrollRatio, applyScrollToElement, scrollRatio, viewMode]);

  useEffect(() => {
    if (!hasExternalScrollSync) {
      return;
    }

    syncScrollFromSharedState();
  }, [hasExternalScrollSync, syncScrollFromSharedState]);

  useEffect(() => {
    if (viewMode === 'preview') {
      return;
    }

    detachScrollListenerRef.current?.();
    detachScrollListenerRef.current = null;
  }, [viewMode]);

  useEffect(() => {
    return () => {
      detachScrollListenerRef.current?.();
      detachScrollListenerRef.current = null;
    };
  }, []);

  const handleFrameLoad = useCallback(() => {
    const iframeWindow = iframeRef.current?.contentWindow;
    const iframeDocument = iframeRef.current?.contentWindow?.document;
    if (!iframeWindow || !iframeDocument) {
      return;
    }

    detachScrollListenerRef.current?.();
    detachScrollListenerRef.current = null;

    const handleScroll = () => {
      if (isApplyingExternalScrollRef.current) {
        return;
      }

      const metrics = getIframeScrollMetrics();
      if (!metrics) {
        return;
      }

      const nextRatio = metrics.maxScrollTop > 0 ? metrics.scrollTop / metrics.maxScrollTop : 0;
      publishScrollRatio(nextRatio);
    };

    const listenerTargets: Array<EventTarget> = [
      iframeWindow,
      iframeDocument,
      iframeDocument.scrollingElement ?? iframeDocument.documentElement,
      iframeDocument.documentElement,
      iframeDocument.body,
    ].filter(Boolean) as Array<EventTarget>;

    for (const target of listenerTargets) {
      target.addEventListener('scroll', handleScroll, { passive: true });
    }

    detachScrollListenerRef.current = () => {
      for (const target of listenerTargets) {
        target.removeEventListener('scroll', handleScroll);
      }
    };

    if (hasExternalScrollSync) {
      syncScrollFromSharedState();
    }
  }, [getIframeScrollMetrics, hasExternalScrollSync, publishScrollRatio, syncScrollFromSharedState]);

  const handleCodeScroll: React.UIEventHandler<HTMLPreElement> = (event) => {
    if (isApplyingExternalScrollRef.current) {
      return;
    }

    const target = event.currentTarget;
    const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    const nextRatio = maxScrollTop > 0 ? target.scrollTop / maxScrollTop : 0;
    publishScrollRatio(nextRatio);
  };

  const frameDoc = useMemo(() => {
    const pageContent = pages[Math.max(0, Math.min(currentPage - 1, pages.length - 1))];

    if (!pageContent) {
      return '';
    }

    const highlightedContent = variant === 'html' ? applyInlineHighlight(pageContent, highlightText) : pageContent;
    const highlightNonce = typeof highlightToken === 'number' ? `<!-- highlight:${highlightToken} -->` : '';

    return buildFrameDoc(`${highlightNonce}${highlightedContent}`, variant, zoomMode, manualZoom);
  }, [currentPage, highlightText, highlightToken, manualZoom, pages, variant, zoomMode]);

  const currentPageHtml = useMemo(() => {
    const index = Math.max(0, Math.min(currentPage - 1, pages.length - 1));
    return pages[index] ?? '';
  }, [currentPage, pages]);

  const hasPagination = pages.length > 1;
  const effectiveTotalPages = Math.max(1, totalPages || pages.length);
  const page = Math.max(1, Math.min(currentPage, effectiveTotalPages));

  return (
    <div className="pane workflow-pane" id={id}>
      <div className="pane-header">
        <div className="workflow-pane-heading">
          <h2 className="pane-title">{title}</h2>
          <span className={`workflow-pane-badge workflow-pane-badge-${variant}`}>{statusLabel}</span>
        </div>

        <div className="workflow-pane-controls">
          {hasViewToggle ? (
            <div className="workflow-view-toggle" role="group" aria-label="Preview mode">
              <button
                className={`workflow-view-toggle-btn${viewMode === 'preview' ? ' active' : ''}`}
                onClick={() => setPaneViewMode('preview')}
                type="button"
                aria-label="View rendered HTML"
                aria-pressed={viewMode === 'preview'}
                title="View rendered HTML"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
              <button
                className={`workflow-view-toggle-btn workflow-view-toggle-code${viewMode === 'code' ? ' active' : ''}`}
                onClick={() => setPaneViewMode('code')}
                type="button"
                aria-label="View HTML code"
                aria-pressed={viewMode === 'code'}
                title="View HTML code"
              >
                {'</>'}
              </button>
            </div>
          ) : null}

          {hasZoomControls ? (
            <div className="translated-nav" role="group" aria-label="Zoom controls">
              <button
                className="pdf-nav-btn"
                onClick={handleZoomOut}
                type="button"
                aria-label="Zoom out"
                disabled={zoomMode === 'manual' && manualZoom <= 50}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <button className="pdf-nav-btn workflow-zoom-fit-btn" onClick={handleZoomFit} type="button" aria-label="Fit to panel">
                {zoomLabel}
              </button>
              <button
                className="pdf-nav-btn"
                onClick={handleZoomIn}
                type="button"
                aria-label="Zoom in"
                disabled={zoomMode === 'manual' && manualZoom >= 200}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          ) : null}

          {hasPagination ? (
            <div className="translated-nav" role="group" aria-label="Page navigation">
            <button
              className="pdf-nav-btn"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              type="button"
              aria-label="Previous page"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div className="pdf-nav-info">
              <input
                type="number"
                className="pdf-nav-input"
                value={page}
                onChange={(event) => onPageChange(parseInt(event.target.value, 10) || 1)}
                min={1}
                max={effectiveTotalPages}
                aria-label="Page number"
              />
              <span className="pdf-nav-total">{effectiveTotalPages}</span>
            </div>
            <button
              className="pdf-nav-btn"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= effectiveTotalPages}
              type="button"
              aria-label="Next page"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="pane-body workflow-pane-body">
        {pages.length > 0 ? (
          <>
            {viewMode === 'preview' ? (
              <iframe
                ref={iframeRef}
                className={`workflow-preview-frame workflow-preview-frame-${variant}`}
                srcDoc={frameDoc}
                title={title}
                sandbox="allow-same-origin"
                onLoad={handleFrameLoad}
              />
            ) : (
              <pre
                ref={codeViewRef}
                className="workflow-code-view"
                aria-label="Converted HTML code view"
                onScroll={handleCodeScroll}
              >
                <code>{currentPageHtml}</code>
              </pre>
            )}
            {isLoading ? (
              <div className="workflow-pane-loading" role="status" aria-live="polite" aria-label={loadingLabel}>
                <div className="loading-spinner" />
                <p>{loadingLabel}</p>
              </div>
            ) : null}
          </>
        ) : (
          <div className="workflow-empty-state">
            <div className="workflow-empty-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="16" y2="17" />
              </svg>
            </div>
            <h3>{emptyTitle}</h3>
            <p>{emptyDescription}</p>
          </div>
        )}
      </div>
    </div>
  );
}