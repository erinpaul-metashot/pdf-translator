'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HtmlImageDesigner from './HtmlImageDesigner';

type ZoomState = {
  mode: 'fit' | 'manual';
  manualZoom: number;
};

type HtmlAsset = {
  id: string;
  src: string;
  pageNumber: number;
  kind: 'img' | 'svg-image';
  label: string;
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
  isCodeEditable?: boolean;
  onUpdatePage?: (pageIndex: number, html: string) => void;
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
  enableAssetsManager?: boolean;
  onDesignModeChange?: (isDesignMode: boolean) => void;
}

function normalizeAssetSrc(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!/^data:image\//i.test(trimmed)) {
    return trimmed;
  }

  const commaIndex = trimmed.indexOf(',');
  if (commaIndex === -1) {
    return trimmed;
  }

  const prefix = trimmed.slice(0, commaIndex + 1);
  const payload = trimmed.slice(commaIndex + 1).replace(/\s+/g, '');
  return `${prefix}${payload}`;
}

function getSafeAssetSrc(rawValue: string): string | null {
  const normalized = normalizeAssetSrc(rawValue);

  if (/^data:image\//i.test(normalized)) {
    return normalized;
  }

  if (/^blob:/i.test(normalized)) {
    return normalized;
  }

  return null;
}

function extractPageNumber(content: string, fallbackPageNumber: number): number {
  const match = content.match(/data-page="(\d+)"/);
  if (!match) {
    return fallbackPageNumber;
  }

  const parsedPage = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsedPage) || parsedPage <= 0) {
    return fallbackPageNumber;
  }

  return parsedPage;
}

function extractHtmlAssets(pages: string[]): HtmlAsset[] {
  const assets: HtmlAsset[] = [];

  pages.forEach((pageHtml, pageIndex) => {
    if (!pageHtml) {
      return;
    }

    const doc = new DOMParser().parseFromString(`<div id="asset-root">${pageHtml}</div>`, 'text/html');
    const root = doc.getElementById('asset-root');
    if (!root) {
      return;
    }

    const pageNumber = extractPageNumber(pageHtml, pageIndex + 1);
    let localIndex = 0;

    for (const image of Array.from(root.querySelectorAll('img'))) {
      const rawSrc = image.getAttribute('src')?.trim() ?? '';
      const src = getSafeAssetSrc(rawSrc);
      if (!src) {
        continue;
      }

      const altText = image.getAttribute('alt')?.trim();
      const titleText = image.getAttribute('title')?.trim();
      const label = altText || titleText || `Image ${localIndex + 1}`;

      assets.push({
        id: `p${pageNumber}-img-${localIndex}`,
        src,
        pageNumber,
        kind: 'img',
        label,
      });
      localIndex += 1;
    }

    for (const svgImage of Array.from(root.querySelectorAll('image'))) {
      const href =
        svgImage.getAttribute('href') ??
        svgImage.getAttribute('xlink:href') ??
        svgImage.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
        '';
      const src = getSafeAssetSrc(href);
      if (!src) {
        continue;
      }

      const titleText = svgImage.getAttribute('title')?.trim();
      const label = titleText || `SVG Image ${localIndex + 1}`;

      assets.push({
        id: `p${pageNumber}-svg-${localIndex}`,
        src,
        pageNumber,
        kind: 'svg-image',
        label,
      });
      localIndex += 1;
    }
  });

  return assets;
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

const ABSOLUTE_UNIT_TO_PX: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};

function parseLengthToPx(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^([-+]?\d*\.?\d+)([a-z%]*)$/i);
  if (!match) {
    return null;
  }

  const numeric = Number.parseFloat(match[1]);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const unit = (match[2] ?? '').toLowerCase();
  if (!unit) {
    return numeric;
  }

  if (unit in ABSOLUTE_UNIT_TO_PX) {
    return numeric * ABSOLUTE_UNIT_TO_PX[unit];
  }

  return null;
}

function parseStyleLength(styleValue: string, propertyName: string): number | null {
  const pattern = new RegExp(`${propertyName}\\s*:\\s*([-+]?\\d*\\.?\\d+)([a-z%]*)`, 'i');
  const match = styleValue.match(pattern);
  if (!match) {
    return null;
  }

  return parseLengthToPx(`${match[1]}${match[2] ?? ''}`);
}

function extractPageWidthPx(content: string): number {
  const doc = new DOMParser().parseFromString(`<div id="frame-root">${content}</div>`, 'text/html');
  const root = doc.getElementById('frame-root');
  if (!root) {
    return 920;
  }

  const pageRoot =
    root.querySelector<HTMLElement>('[data-page], .document-page, .pdf-page') ??
    (root.firstElementChild as HTMLElement | null);

  if (!pageRoot) {
    return 920;
  }

  const styleValue = pageRoot.getAttribute('style') ?? '';
  const styleWidth = parseStyleLength(styleValue, 'width') ?? parseLengthToPx(pageRoot.style.width);
  const attrWidth = parseLengthToPx(pageRoot.getAttribute('width'));
  const width = styleWidth ?? attrWidth ?? 920;

  return Math.max(300, Math.round(width));
}

function buildFrameDoc(
  content: string,
  variant: 'html' | 'pdf',
  zoomMode: 'fit' | 'manual',
  manualZoom: number,
  pageWidth: number
): string {
  const safePageWidth = Math.max(300, Math.round(pageWidth));
  const htmlPageZoom =
    zoomMode === 'fit' ? `clamp(0.25, calc((100vw - 40px) / ${safePageWidth}px), 1)` : `${manualZoom / 100}`;

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
          max-width: ${safePageWidth}px;
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
          max-width: ${safePageWidth}px;
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
  isCodeEditable = false,
  onUpdatePage,
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
  enableAssetsManager = false,
  onDesignModeChange,
}: WorkflowPreviewPaneProps): React.JSX.Element {
  const [localZoomMode, setLocalZoomMode] = useState<'fit' | 'manual'>('fit');
  const [localManualZoom, setLocalManualZoom] = useState(100);
  const [localViewMode, setLocalViewMode] = useState<'preview' | 'code'>('preview');
  const [isDesignMode, setIsDesignMode] = useState(false);
  const [editableCodeDraftByPage, setEditableCodeDraftByPage] = useState<Record<number, string>>({});
  const [isAssetsOpen, setIsAssetsOpen] = useState(false);
  const [selectedAssetIndex, setSelectedAssetIndex] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const assetsTriggerRef = useRef<HTMLButtonElement>(null);
  const assetsCloseRef = useRef<HTMLButtonElement>(null);
  const assetsPanelRef = useRef<HTMLDivElement>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);
  const wasAssetsDialogOpenRef = useRef(false);
  const codeDraftDebounceRef = useRef<number | null>(null);
  const codeScrollElementRef = useRef<HTMLElement | null>(null);
  const detachScrollListenerRef = useRef<(() => void) | null>(null);
  const isApplyingExternalScrollRef = useRef(false);

  const handleCodeViewRef = useCallback((node: HTMLPreElement | null) => {
    codeScrollElementRef.current = node;
  }, []);

  const handleCodeEditorRef = useCallback((node: HTMLTextAreaElement | null) => {
    codeScrollElementRef.current = node;
  }, []);

  const registerDesignScrollElement = useCallback((node: HTMLDivElement | null) => {
    codeScrollElementRef.current = node;
  }, []);

  const zoomMode = sharedZoomState?.mode ?? localZoomMode;
  const manualZoom = sharedZoomState?.manualZoom ?? localManualZoom;
  const canDesign = variant === 'html' && isCodeEditable && typeof onUpdatePage === 'function';
  const designModeActive = isDesignMode && canDesign;
  const viewMode = designModeActive ? 'design' : (sharedViewMode ?? localViewMode);
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
      setIsDesignMode(false);

      if (onSharedViewModeChange) {
        onSharedViewModeChange(nextViewMode);
        return;
      }

      setLocalViewMode(nextViewMode);
    },
    [onSharedViewModeChange]
  );

  useEffect(() => {
    if (!onDesignModeChange) {
      return;
    }

    onDesignModeChange(designModeActive);
  }, [designModeActive, onDesignModeChange]);

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
  const showAssetsButton = enableAssetsManager && variant === 'html' && pages.length > 0;

  const assets = useMemo(() => {
    if (!showAssetsButton) {
      return [];
    }

    return extractHtmlAssets(pages);
  }, [pages, showAssetsButton]);

  const clampedSelectedAssetIndex = assets.length > 0
    ? Math.max(0, Math.min(selectedAssetIndex, assets.length - 1))
    : 0;
  const selectedAsset = assets[clampedSelectedAssetIndex] ?? null;
  const assetsDialogOpen = isAssetsOpen && showAssetsButton;
  const zoomLabel = zoomMode === 'fit' ? 'Fit' : `${manualZoom}%`;
  const currentPageAssets = useMemo(
    () => assets.filter((asset) => asset.pageNumber === currentPage),
    [assets, currentPage]
  );

  useEffect(() => {
    if (!assetsDialogOpen) {
      return;
    }

    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAssetsOpen(false);
        return;
      }

      if (event.key === 'Tab') {
        const panel = assetsPanelRef.current;
        if (!panel) {
          return;
        }

        const focusableElements = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((element) => !element.hasAttribute('disabled'));

        if (focusableElements.length === 0) {
          return;
        }

        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];
        const activeElement = document.activeElement as HTMLElement | null;

        if (event.shiftKey && activeElement === firstFocusable) {
          event.preventDefault();
          lastFocusable.focus();
          return;
        }

        if (!event.shiftKey && activeElement === lastFocusable) {
          event.preventDefault();
          firstFocusable.focus();
        }
      }

      if (assets.length <= 1) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        setSelectedAssetIndex((prev) => Math.max(0, prev - 1));
      }

      if (event.key === 'ArrowRight') {
        setSelectedAssetIndex((prev) => Math.min(assets.length - 1, prev + 1));
      }
    };

    window.addEventListener('keydown', handleKeyboard);

    return () => {
      window.removeEventListener('keydown', handleKeyboard);
    };
  }, [assets.length, assetsDialogOpen]);

  useEffect(() => {
    if (isAssetsOpen && !showAssetsButton) {
      const timeoutId = window.setTimeout(() => {
        setIsAssetsOpen(false);
      }, 0);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }
  }, [isAssetsOpen, showAssetsButton]);

  useEffect(() => {
    if (assetsDialogOpen && !wasAssetsDialogOpenRef.current) {
      previousFocusedElementRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

      requestAnimationFrame(() => {
        assetsCloseRef.current?.focus();
      });
    }

    if (!assetsDialogOpen && wasAssetsDialogOpenRef.current) {
      assetsTriggerRef.current?.focus();
      previousFocusedElementRef.current = null;
    }

    wasAssetsDialogOpenRef.current = assetsDialogOpen;
  }, [assetsDialogOpen]);

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
      applyScrollToElement(codeScrollElementRef.current, scrollRatio);
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

  const handleCodeScroll: React.UIEventHandler<HTMLElement> = (event) => {
    if (isApplyingExternalScrollRef.current) {
      return;
    }

    const target = event.currentTarget;
    const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    const nextRatio = maxScrollTop > 0 ? target.scrollTop / maxScrollTop : 0;
    publishScrollRatio(nextRatio);
  };

  const frameDoc = useMemo(() => {
    if (viewMode !== 'preview') {
      return '';
    }

    const pageIndex = Math.max(0, Math.min(currentPage - 1, pages.length - 1));
    const pageContent = pages[pageIndex];

    if (!pageContent) {
      return '';
    }

    const highlightedContent = variant === 'html' ? applyInlineHighlight(pageContent, highlightText) : pageContent;
    const highlightNonce = typeof highlightToken === 'number' ? `<!-- highlight:${highlightToken} -->` : '';
    const pageWidth = extractPageWidthPx(pageContent);

    return buildFrameDoc(`${highlightNonce}${highlightedContent}`, variant, zoomMode, manualZoom, pageWidth);
  }, [currentPage, highlightText, highlightToken, manualZoom, pages, variant, viewMode, zoomMode]);

  const currentPageIndex = Math.max(0, Math.min(currentPage - 1, pages.length - 1));

  const currentPageHtml = useMemo(() => {
    return pages[currentPageIndex] ?? '';
  }, [currentPageIndex, pages]);

  const canEditCode = variant === 'html' && isCodeEditable && typeof onUpdatePage === 'function';
  const editableCodeDraft = editableCodeDraftByPage[currentPageIndex] ?? currentPageHtml;
  const hasLocalDraftForCurrentPage = Object.prototype.hasOwnProperty.call(
    editableCodeDraftByPage,
    currentPageIndex
  );

  useEffect(() => {
    if (viewMode !== 'code') {
      return;
    }

    if (!canEditCode || !onUpdatePage || !hasLocalDraftForCurrentPage) {
      return;
    }

    if (editableCodeDraft === currentPageHtml) {
      return;
    }

    if (codeDraftDebounceRef.current) {
      window.clearTimeout(codeDraftDebounceRef.current);
    }

    codeDraftDebounceRef.current = window.setTimeout(() => {
      onUpdatePage(currentPageIndex, editableCodeDraft);
    }, 150);

    return () => {
      if (codeDraftDebounceRef.current) {
        window.clearTimeout(codeDraftDebounceRef.current);
        codeDraftDebounceRef.current = null;
      }
    };
  }, [canEditCode, currentPageHtml, currentPageIndex, editableCodeDraft, hasLocalDraftForCurrentPage, onUpdatePage, viewMode]);

  useEffect(() => {
    return () => {
      if (codeDraftDebounceRef.current) {
        window.clearTimeout(codeDraftDebounceRef.current);
        codeDraftDebounceRef.current = null;
      }
    };
  }, []);

  const handleCodeEditChange: React.ChangeEventHandler<HTMLTextAreaElement> = (event) => {
    const nextValue = event.target.value;
    setEditableCodeDraftByPage((prev) => ({
      ...prev,
      [currentPageIndex]: nextValue,
    }));
  };

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
          {showAssetsButton ? (
            <button
              ref={assetsTriggerRef}
              className={`workflow-assets-btn${isAssetsOpen ? ' active' : ''}`}
              onClick={() => setIsAssetsOpen(true)}
              type="button"
              aria-label="Browse extracted image assets"
              aria-haspopup="dialog"
              aria-expanded={isAssetsOpen}
              title="Browse extracted image assets"
            >
              ASSETS
              <span className="workflow-assets-count">{assets.length}</span>
            </button>
          ) : null}

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
              <button
                className={`workflow-view-toggle-btn workflow-view-toggle-design${viewMode === 'design' ? ' active' : ''}`}
                onClick={() => {
                  if (!canDesign) {
                    return;
                  }

                  setIsDesignMode(true);
                }}
                type="button"
                aria-label="Design image layout"
                aria-pressed={viewMode === 'design'}
                title="Design image layout"
                disabled={!canDesign}
              >
                DSGN
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
            ) : viewMode === 'design' && canDesign && onUpdatePage ? (
              <HtmlImageDesigner
                pageHtml={currentPageHtml}
                pageIndex={currentPageIndex}
                currentPageNumber={page}
                documentAssetCount={assets.length}
                expectedPageAssetCount={currentPageAssets.length}
                editable={canEditCode}
                zoomMode={zoomMode}
                manualZoom={manualZoom}
                onCommitHtml={(nextHtml) => {
                  setEditableCodeDraftByPage((prev) => ({
                    ...prev,
                    [currentPageIndex]: nextHtml,
                  }));
                  onUpdatePage(currentPageIndex, nextHtml);
                }}
                onScroll={handleCodeScroll as React.UIEventHandler<HTMLDivElement>}
                registerScrollElement={registerDesignScrollElement}
              />
            ) : (
              canEditCode ? (
                <textarea
                  ref={handleCodeEditorRef}
                  className="workflow-code-editor"
                  aria-label="Editable converted HTML code"
                  value={editableCodeDraft}
                  onChange={handleCodeEditChange}
                  onScroll={handleCodeScroll}
                  wrap="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  disabled={isLoading}
                />
              ) : (
                <pre
                  ref={handleCodeViewRef}
                  className="workflow-code-view"
                  aria-label="Converted HTML code view"
                  onScroll={handleCodeScroll}
                >
                  <code>{currentPageHtml}</code>
                </pre>
              )
            )}
            {isLoading ? (
              <div className="workflow-pane-loading" role="status" aria-live="polite" aria-label={loadingLabel}>
                <div className="loading-spinner" />
                <p>{loadingLabel}</p>
              </div>
            ) : null}

            {assetsDialogOpen ? (
              <div
                className="workflow-assets-overlay"
                role="dialog"
                aria-modal="true"
                aria-label="Converted HTML image assets"
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    setIsAssetsOpen(false);
                  }
                }}
              >
                <div className="workflow-assets-panel" ref={assetsPanelRef}>
                  <div className="workflow-assets-header">
                    <div className="workflow-assets-title-wrap">
                      <h3 className="workflow-assets-title">Assets</h3>
                      <span className="workflow-assets-meta">{assets.length} image(s)</span>
                    </div>
                    <button
                      ref={assetsCloseRef}
                      className="workflow-assets-close"
                      onClick={() => setIsAssetsOpen(false)}
                      type="button"
                      aria-label="Close assets panel"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>

                  {assets.length > 0 ? (
                    <div className="workflow-assets-content">
                      <div className="workflow-assets-list" aria-label="Available image assets">
                        {assets.map((asset, index) => {
                          const isSelected = index === clampedSelectedAssetIndex;

                          return (
                            <button
                              key={asset.id}
                              className={`workflow-assets-item${isSelected ? ' active' : ''}`}
                              type="button"
                              aria-label={`Preview ${asset.label}`}
                              aria-pressed={isSelected}
                              onClick={() => setSelectedAssetIndex(index)}
                            >
                              <img
                                src={asset.src}
                                alt={asset.label}
                                className="workflow-assets-item-thumb"
                                loading="lazy"
                                decoding="async"
                              />
                              <span className="workflow-assets-item-label">P{asset.pageNumber}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="workflow-assets-preview-wrap">
                        {selectedAsset ? (
                          <>
                            <div className="workflow-assets-preview-meta">
                              <span className="workflow-assets-preview-tag">Page {selectedAsset.pageNumber}</span>
                              <span className="workflow-assets-preview-kind">
                                {selectedAsset.kind === 'img' ? 'IMG' : 'SVG'}
                              </span>
                            </div>
                            <div className="workflow-assets-preview-canvas">
                              <img
                                src={selectedAsset.src}
                                alt={selectedAsset.label}
                                className="workflow-assets-preview-image"
                              />
                            </div>
                            <p className="workflow-assets-preview-label">{selectedAsset.label}</p>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="workflow-assets-empty">
                      <p>No images were detected in the converted HTML yet.</p>
                    </div>
                  )}
                </div>
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