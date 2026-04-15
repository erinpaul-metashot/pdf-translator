'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import TextEditor from './TextEditor';
import type { TranslationStatus, TextEdit } from '../lib/types';

type ZoomState = {
  mode: 'fit' | 'manual';
  manualZoom: number;
};

interface TranslatedPaneProps {
  status: TranslationStatus;
  translatedPages: string[];
  originalPageHtml?: string;
  currentPage: number;
  totalPages: number;
  targetLangCode: string | null;
  onPageChange: (page: number) => void;
  onEdit: (edit: TextEdit) => void;
  onUpdatePage: (pageIndex: number, html: string) => void;
  onEditToggle?: (isEditing: boolean) => void;
  onSelectionMappingChange?: (selection: { pageIndex: number; translatedText: string; originalText: string } | null) => void;
  sharedZoomState?: ZoomState;
  onSharedZoomStateChange?: (nextZoom: ZoomState) => void;
  sharedViewMode?: 'preview' | 'code';
  onSharedViewModeChange?: (nextViewMode: 'preview' | 'code') => void;
  sharedScrollRatio?: number;
  onSharedScrollRatioChange?: (nextRatio: number) => void;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function collectMeaningfulTextNodes(root: Node): Text[] {
  const owner = root.ownerDocument ?? document;
  const walker = owner.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();

  while (node) {
    const textNode = node as Text;
    if (normalizeWhitespace(textNode.nodeValue ?? '').length > 0) {
      nodes.push(textNode);
    }
    node = walker.nextNode();
  }

  return nodes;
}

function findFirstTextNode(root: Node): Text | null {
  const owner = root.ownerDocument ?? document;
  const walker = owner.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  return node ? (node as Text) : null;
}

function findLastTextNode(root: Node): Text | null {
  const nodes = collectMeaningfulTextNodes(root);
  return nodes.length > 0 ? nodes[nodes.length - 1] : null;
}

function resolveBoundaryTextNode(container: Node, offset: number, isStartBoundary: boolean): { node: Text; offset: number } | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const textNode = container as Text;
    return {
      node: textNode,
      offset: Math.max(0, Math.min(offset, textNode.length)),
    };
  }

  const element = container as Element;
  const childCount = element.childNodes.length;
  if (childCount === 0) {
    return null;
  }

  if (isStartBoundary) {
    const boundedOffset = Math.max(0, Math.min(offset, childCount));
    const directChild = boundedOffset < childCount ? element.childNodes[boundedOffset] : null;
    const firstInDirectChild = directChild ? findFirstTextNode(directChild) : null;
    if (firstInDirectChild) {
      return { node: firstInDirectChild, offset: 0 };
    }

    const previousChild = boundedOffset > 0 ? element.childNodes[boundedOffset - 1] : null;
    const lastInPreviousChild = previousChild ? findLastTextNode(previousChild) : null;
    if (lastInPreviousChild) {
      return { node: lastInPreviousChild, offset: lastInPreviousChild.length };
    }

    const firstInElement = findFirstTextNode(element);
    return firstInElement ? { node: firstInElement, offset: 0 } : null;
  }

  const boundedOffset = Math.max(0, Math.min(offset, childCount));
  const previousChild = boundedOffset > 0 ? element.childNodes[boundedOffset - 1] : null;
  const lastInPreviousChild = previousChild ? findLastTextNode(previousChild) : null;
  if (lastInPreviousChild) {
    return { node: lastInPreviousChild, offset: lastInPreviousChild.length };
  }

  const directChild = boundedOffset < childCount ? element.childNodes[boundedOffset] : null;
  const firstInDirectChild = directChild ? findFirstTextNode(directChild) : null;
  if (firstInDirectChild) {
    return { node: firstInDirectChild, offset: 0 };
  }

  const lastInElement = findLastTextNode(element);
  return lastInElement ? { node: lastInElement, offset: lastInElement.length } : null;
}

function buildNodePath(root: Node, target: Node): number[] | null {
  const path: number[] = [];
  let cursor: Node | null = target;

  while (cursor && cursor !== root) {
    const parentNode: Node | null = cursor.parentNode;
    if (!parentNode) {
      return null;
    }

    const index = Array.prototype.indexOf.call(parentNode.childNodes, cursor) as number;
    if (index < 0) {
      return null;
    }

    path.unshift(index);
    cursor = parentNode;
  }

  return cursor === root ? path : null;
}

function getNodeByPath(root: Node, path: number[]): Node | null {
  let cursor: Node | null = root;

  for (const index of path) {
    if (!cursor || index < 0 || index >= cursor.childNodes.length) {
      return null;
    }

    cursor = cursor.childNodes[index];
  }

  return cursor;
}

function mapSelectionToOriginalText(
  selection: Selection,
  translatedHtml: string,
  originalHtml: string,
  liveBody: HTMLBodyElement
): string {
  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!range) {
    return '';
  }

  const startBoundary = resolveBoundaryTextNode(range.startContainer, range.startOffset, true);
  const endBoundary = resolveBoundaryTextNode(range.endContainer, range.endOffset, false);

  if (!startBoundary || !endBoundary) {
    return '';
  }

  const startPath = buildNodePath(liveBody, startBoundary.node);
  const endPath = buildNodePath(liveBody, endBoundary.node);

  if (!startPath || !endPath) {
    return '';
  }

  const translatedDoc = new DOMParser().parseFromString(`<body>${translatedHtml}</body>`, 'text/html');
  const originalDoc = new DOMParser().parseFromString(`<body>${originalHtml}</body>`, 'text/html');

  const translatedBody = translatedDoc.body;
  const originalBody = originalDoc.body;

  const translatedNodes = collectMeaningfulTextNodes(translatedBody);
  const originalNodes = collectMeaningfulTextNodes(originalBody);

  if (translatedNodes.length === 0 || originalNodes.length === 0) {
    return '';
  }

  const translatedStartNode = getNodeByPath(translatedBody, startPath);
  const translatedEndNode = getNodeByPath(translatedBody, endPath);

  if (!translatedStartNode || !translatedEndNode) {
    return '';
  }

  if (translatedStartNode.nodeType !== Node.TEXT_NODE || translatedEndNode.nodeType !== Node.TEXT_NODE) {
    return '';
  }

  const startIndex = translatedNodes.indexOf(translatedStartNode as Text);
  const endIndex = translatedNodes.indexOf(translatedEndNode as Text);

  if (startIndex < 0 || endIndex < 0) {
    return '';
  }

  const normalizedStart = Math.max(0, Math.min(startIndex, translatedNodes.length - 1));
  const normalizedEnd = Math.max(normalizedStart, Math.min(endIndex, translatedNodes.length - 1));

  if (normalizedStart >= originalNodes.length) {
    return '';
  }

  const output: string[] = [];

  for (let index = normalizedStart; index <= normalizedEnd; index += 1) {
    if (index >= originalNodes.length) {
      break;
    }

    const translatedText = translatedNodes[index].nodeValue ?? '';
    const originalText = originalNodes[index].nodeValue ?? '';

    if (index === normalizedStart && index === normalizedEnd) {
      const translatedLength = Math.max(1, translatedText.length);
      const startRatio = Math.max(0, Math.min(1, startBoundary.offset / translatedLength));
      const endRatio = Math.max(startRatio, Math.min(1, endBoundary.offset / translatedLength));
      const mappedStart = Math.floor(startRatio * originalText.length);
      const mappedEnd = Math.max(mappedStart, Math.ceil(endRatio * originalText.length));
      output.push(originalText.slice(mappedStart, mappedEnd));
      continue;
    }

    if (index === normalizedStart) {
      const translatedLength = Math.max(1, translatedText.length);
      const startRatio = Math.max(0, Math.min(1, startBoundary.offset / translatedLength));
      const mappedStart = Math.floor(startRatio * originalText.length);
      output.push(originalText.slice(mappedStart));
      continue;
    }

    if (index === normalizedEnd) {
      const translatedLength = Math.max(1, translatedText.length);
      const endRatio = Math.max(0, Math.min(1, endBoundary.offset / translatedLength));
      const mappedEnd = Math.ceil(endRatio * originalText.length);
      output.push(originalText.slice(0, Math.max(0, mappedEnd)));
      continue;
    }

    output.push(originalText);
  }

  return normalizeWhitespace(output.join(' '));
}

export default function TranslatedPane({
  status,
  translatedPages,
  originalPageHtml,
  currentPage,
  totalPages,
  targetLangCode,
  onPageChange,
  onEdit,
  onUpdatePage,
  onEditToggle,
  onSelectionMappingChange,
  sharedZoomState,
  onSharedZoomStateChange,
  sharedViewMode,
  onSharedViewModeChange,
  sharedScrollRatio,
  onSharedScrollRatioChange,
}: TranslatedPaneProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [localZoomMode, setLocalZoomMode] = useState<'fit' | 'manual'>('fit');
  const [localManualZoom, setLocalManualZoom] = useState(100);
  const [localViewMode, setLocalViewMode] = useState<'preview' | 'code'>('preview');
  const [previewWidth, setPreviewWidth] = useState(0);
  const [selectedText, setSelectedText] = useState('');
  const [selectedOriginalText, setSelectedOriginalText] = useState('');
  const [selectedPageIndex, setSelectedPageIndex] = useState<number | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const codeViewRef = useRef<HTMLPreElement>(null);
  const detachMouseUpListenerRef = useRef<(() => void) | null>(null);
  const detachScrollListenerRef = useRef<(() => void) | null>(null);
  const isApplyingExternalScrollRef = useRef(false);
  const selectionMappingChangeRef = useRef(onSelectionMappingChange);

  useEffect(() => {
    selectionMappingChangeRef.current = onSelectionMappingChange;
  }, [onSelectionMappingChange]);

  const zoomMode = sharedZoomState?.mode ?? localZoomMode;
  const manualZoom = sharedZoomState?.manualZoom ?? localManualZoom;
  const viewMode = sharedViewMode ?? localViewMode;
  const hasExternalScrollSync = typeof sharedScrollRatio === 'number' && typeof onSharedScrollRatioChange === 'function';
  const scrollRatio = sharedScrollRatio ?? 0;
  const isBusy = status === 'convertingPdf' || status === 'processing' || status === 'translating';

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

  const hasContent = translatedPages.length > 0 && status !== 'idle' && status !== 'fileReady';

  const currentPageIndex = Math.max(0, Math.min(currentPage - 1, translatedPages.length - 1));
  const currentHtml = translatedPages[currentPageIndex] || '';
  const zoomLabel = zoomMode === 'fit' ? 'Fit' : `${manualZoom}%`;

  useEffect(() => {
    if (!hasContent) {
      return;
    }

    const container = previewContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') {
      return;
    }

    const updateWidth = (nextWidth: number) => {
      setPreviewWidth((prev) => (Math.abs(prev - nextWidth) < 0.5 ? prev : nextWidth));
    };

    updateWidth(container.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      updateWidth(entry.contentRect.width);
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [hasContent]);

  const fitZoom = useMemo(() => {
    if (previewWidth <= 0) {
      return 1;
    }

    // 922 = 920 content width + 2px border; 48 accounts for iframe body padding and rounding.
    return Math.max(0.25, Math.min(1, (previewWidth - 48) / 922));
  }, [previewWidth]);

  const handleZoomOut = useCallback(() => {
    setZoomState({ mode: 'manual', manualZoom: Math.max(50, manualZoom - 10) });
  }, [manualZoom, setZoomState]);

  const handleZoomIn = useCallback(() => {
    setZoomState({ mode: 'manual', manualZoom: Math.min(200, manualZoom + 10) });
  }, [manualZoom, setZoomState]);

  const handleZoomFit = useCallback(() => {
    setZoomState({ mode: 'fit', manualZoom });
  }, [manualZoom, setZoomState]);

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

  const effectiveTotalPages = Math.max(1, totalPages || translatedPages.length);

  useEffect(() => {
    selectionMappingChangeRef.current?.(null);
  }, [currentPageIndex, currentHtml]);

  useEffect(() => {
    if (!isBusy || !isEditing) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      setIsEditing(false);
      onEditToggle?.(false);
      setSelectedText('');
      setSelectedOriginalText('');
      setSelectedPageIndex(null);
      setEditMessage(null);
      selectionMappingChangeRef.current?.(null);
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [isBusy, isEditing, onEditToggle]);

  useEffect(() => {
    return () => {
      detachMouseUpListenerRef.current?.();
      detachMouseUpListenerRef.current = null;

      detachScrollListenerRef.current?.();
      detachScrollListenerRef.current = null;
    };
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

    detachMouseUpListenerRef.current?.();
    detachMouseUpListenerRef.current = null;
    detachScrollListenerRef.current?.();
    detachScrollListenerRef.current = null;
  }, [viewMode]);

  // Handle text selection inside iframe
  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    const iframeWindow = iframe?.contentWindow;
    if (!iframeWindow) {
      return;
    }

    const iframeDocument = iframeWindow.document;

    detachMouseUpListenerRef.current?.();
    detachMouseUpListenerRef.current = null;
    detachScrollListenerRef.current?.();
    detachScrollListenerRef.current = null;

    const handleMouseUp = () => {
      const selection = iframeWindow.getSelection();
      const nextSelectedText = selection?.toString().trim() ?? '';

      if (nextSelectedText.length > 2) {
        const mappedOriginalText = originalPageHtml
          ? mapSelectionToOriginalText(selection as Selection, currentHtml, originalPageHtml, iframeDocument.body as HTMLBodyElement)
          : '';
        const fallbackOriginal = normalizeWhitespace(mappedOriginalText) || nextSelectedText;

        setSelectedText(nextSelectedText);
        setSelectedOriginalText(fallbackOriginal);
        setSelectedPageIndex(currentPageIndex);
        setEditMessage(null);
        selectionMappingChangeRef.current?.({
          pageIndex: currentPageIndex,
          translatedText: nextSelectedText,
          originalText: fallbackOriginal,
        });
        return;
      }

      setSelectedText('');
      setSelectedOriginalText('');
      setSelectedPageIndex(null);
      selectionMappingChangeRef.current?.(null);
    };

    iframeDocument.addEventListener('mouseup', handleMouseUp);
    detachMouseUpListenerRef.current = () => {
      iframeDocument.removeEventListener('mouseup', handleMouseUp);
    };

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
  }, [
    currentHtml,
    currentPageIndex,
    getIframeScrollMetrics,
    hasExternalScrollSync,
    originalPageHtml,
    publishScrollRatio,
    syncScrollFromSharedState,
  ]);

  const handleCodeScroll: React.UIEventHandler<HTMLPreElement> = (event) => {
    if (isApplyingExternalScrollRef.current) {
      return;
    }

    const target = event.currentTarget;
    const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    const nextRatio = maxScrollTop > 0 ? target.scrollTop / maxScrollTop : 0;
    publishScrollRatio(nextRatio);
  };

  const handleSaveEdit = useCallback(
    (editedText: string, type: 'manual' | 'ai') => {
      const occurrences = currentHtml.split(selectedText).length - 1;
      if (occurrences !== 1) {
        setEditMessage('Selected text appears multiple times on this page. Please select a more specific phrase.');
        return;
      }

      const edit: TextEdit = {
        id: `edit-${Date.now()}`,
        pageIndex: currentPageIndex,
        originalText: selectedText,
        editedText,
        type,
        timestamp: Date.now(),
      };
      onEdit(edit);

      // Only apply replacement when there is exactly one unambiguous match.
      const updatedHtml = currentHtml.replace(selectedText, editedText);
      onUpdatePage(currentPageIndex, updatedHtml);

      setSelectedText('');
      setSelectedOriginalText('');
      setSelectedPageIndex(null);
      setEditMessage(null);
      setIsEditing(false);
      selectionMappingChangeRef.current?.(null);
    },
    [currentPageIndex, currentHtml, onEdit, onUpdatePage, selectedText]
  );

  // Build the iframe content with proper styling
  const iframeContent = useMemo(() => {
    if (!currentHtml) {
      return '';
    }

    const htmlPageZoom = zoomMode === 'fit' ? fitZoom.toFixed(4) : `${manualZoom / 100}`;

    return `<!DOCTYPE html>
<html>
<head>
  <style>
    html, body {
      width: 100%;
      overflow-x: hidden;
    }
    body {
      margin: 0;
      padding: 20px;
      font-family: 'Inter', system-ui, sans-serif;
      color: #1a1a1a;
      line-height: 1.6;
      background: #ffffff;
    }
    * { box-sizing: border-box; }
    ::selection { background: #a5d6a7; color: #1B5E20; }
    .document-shell {
      width: min(100%, 920px);
      margin: 0 auto;
      background: #ffffff;
    }
    .translated-zoom-root {
      width: 100%;
      transform-origin: top left;
      zoom: ${htmlPageZoom};
    }
    .document-page,
    .pdf-page {
      background: #fff;
      border: 1px solid #e2e8e2;
      border-radius: 16px;
      overflow: hidden;
      margin-bottom: 20px;
    }
    .document-page:last-child,
    .pdf-page:last-child {
      margin-bottom: 0;
    }
    img { max-width: 100%; height: auto; }
    svg, canvas, iframe, object, embed, pre { max-width: 100%; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    td, th { border: 1px solid #e0e0e0; padding: 8px; text-align: left; }
    p { margin: 8px 0; }
    h1, h2, h3 { color: #2E7D32; }
  </style>
</head>
<body><div class="translated-zoom-root">${currentHtml}</div></body>
</html>`
  }, [currentHtml, fitZoom, zoomMode, manualZoom]);

  return (
    <div className="pane translated-pane" id="translated-pane">
      <div className="pane-header">
        <h2 className="pane-title">TRANSLATED DOCUMENT</h2>

        <div className="workflow-pane-controls">
          {hasContent && (
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
                onClick={() => {
                  setPaneViewMode('code');
                  if (isEditing) {
                    setIsEditing(false);
                    onEditToggle?.(false);
                    setSelectedText('');
                    setSelectedOriginalText('');
                    setSelectedPageIndex(null);
                    setEditMessage(null);
                    selectionMappingChangeRef.current?.(null);
                  }
                }}
                type="button"
                aria-label="View HTML code"
                aria-pressed={viewMode === 'code'}
                title="View HTML code"
              >
                {'</>'}
              </button>
            </div>
          )}

          {hasContent && (
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
          )}

          {hasContent && translatedPages.length > 1 && (
            <div className="translated-nav" role="group" aria-label="Page navigation">
            <button
              className="pdf-nav-btn"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              type="button"
              aria-label="Previous page"
              id="translated-prev-page"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div className="pdf-nav-info">
              <input
                type="number"
                className="pdf-nav-input"
                value={currentPage}
                onChange={(e) => onPageChange(parseInt(e.target.value) || 1)}
                min={1}
                max={effectiveTotalPages}
                aria-label="Page number"
              />
              <span className="pdf-nav-total">{effectiveTotalPages}</span>
            </div>
            <button
              className="pdf-nav-btn"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= effectiveTotalPages}
              type="button"
              aria-label="Next page"
              id="translated-next-page"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
          )}

          {hasContent && (
            <button
              className={`pane-action-link ${isEditing ? 'active' : ''}`}
              onClick={() => {
				if (isBusy) {
					return;
				}

                const nextIsEditing = !isEditing;
                setIsEditing(nextIsEditing);
                if (nextIsEditing) {
                  setPaneViewMode('preview');
                } else {
                  setSelectedText('');
                  setSelectedOriginalText('');
                  setSelectedPageIndex(null);
                  setEditMessage(null);
                  selectionMappingChangeRef.current?.(null);
                }
                onEditToggle?.(nextIsEditing);
              }}
              disabled={isBusy}
              type="button"
              id="edit-toggle-btn"
            >
              {isEditing ? 'Done Editing' : 'Edit'}
            </button>
          )}
        </div>
      </div>

      <div className="pane-body">
        {hasContent ? (
          <div className="translated-preview" ref={previewContainerRef}>
            {viewMode === 'preview' ? (
              <iframe
                ref={iframeRef}
                className="translated-iframe"
                srcDoc={iframeContent}
                onLoad={handleIframeLoad}
                title="Translated Document Preview"
                sandbox="allow-same-origin"
                id="translated-iframe"
              />
            ) : (
              <pre
                ref={codeViewRef}
                className="workflow-code-view"
                aria-label="Translated HTML code view"
                onScroll={handleCodeScroll}
              >
                <code>{currentHtml}</code>
              </pre>
            )}

            {isEditing && viewMode === 'preview' && selectedText && selectedPageIndex === currentPageIndex && (
              <TextEditor
                selectedText={selectedText}
                originalText={selectedOriginalText}
                targetLang={targetLangCode}
                onSave={handleSaveEdit}
                onCancel={() => {
                  setSelectedText('');
                  setSelectedOriginalText('');
                  setSelectedPageIndex(null);
                  setEditMessage(null);
                  selectionMappingChangeRef.current?.(null);
                }}
              />
            )}

            {isEditing && viewMode === 'preview' && editMessage && (
              <div className="edit-hint" role="status" aria-live="polite">
                {editMessage}
              </div>
            )}

            {isEditing && viewMode === 'preview' && (selectedPageIndex !== currentPageIndex || !selectedText) && (
              <div className="edit-hint">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Select text in the preview to edit
              </div>
            )}
          </div>
        ) : (
          <div className="translated-empty">
            <div className="translated-empty-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <p className="translated-empty-text">
              {status === 'translating'
                ? 'Translation in progress...'
                : 'Translated document will appear here'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
