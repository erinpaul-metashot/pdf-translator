'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { Rnd } from 'react-rnd';
import {
  applyImagePatchesToHtml,
  duplicateCroppedAssetInHtml,
  prepareImageDesignPage,
  removeAssetFromHtml,
  type EditableImagePatch,
} from '../lib/htmlImageEditor';

type HistoryState = {
  past: string[];
  future: string[];
};

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CropImageMetrics = {
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  displayHeight: number;
};

type CropDisplaySize = {
  width: number;
  height: number;
};

type PreviewContentSize = {
  width: number;
  height: number;
};

const MIN_CROP_SIZE = 16;
const DESIGN_ASSET_DRAG_MIME = 'application/x-pdf-translator-design-asset-id';
const DESIGN_VIEWPORT_PADDING = 8;
const PREVIEW_VIEWPORT_PADDING = 4;
const PREVIEW_CONTENT_OVERFLOW_TOLERANCE = 1.15;

interface HtmlImageDesignerProps {
  pageHtml: string;
  pageIndex: number;
  currentPageNumber: number;
  documentAssetCount: number;
  expectedPageAssetCount: number;
  editable: boolean;
  zoomMode: 'fit' | 'manual';
  manualZoom: number;
  onCommitHtml: (nextHtml: string) => void;
  onScroll: React.UIEventHandler<HTMLDivElement>;
  registerScrollElement: (node: HTMLDivElement | null) => void;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function clampCropRect(rect: CropRect, boundsWidth: number, boundsHeight: number): CropRect {
  const width = clamp(Math.round(rect.width), MIN_CROP_SIZE, Math.max(MIN_CROP_SIZE, Math.round(boundsWidth)));
  const height = clamp(Math.round(rect.height), MIN_CROP_SIZE, Math.max(MIN_CROP_SIZE, Math.round(boundsHeight)));
  const x = clamp(Math.round(rect.x), 0, Math.max(0, Math.round(boundsWidth) - width));
  const y = clamp(Math.round(rect.y), 0, Math.max(0, Math.round(boundsHeight) - height));

  return { x, y, width, height };
}

function isSafeImageRenderSrc(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (/^data:image\//i.test(trimmed) || /^blob:/i.test(trimmed)) {
    return true;
  }

  if (trimmed.startsWith('#')) {
    return true;
  }

  try {
    const parsed = new URL(trimmed, window.location.origin);
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    if (!isHttp || parsed.origin !== window.location.origin) {
      return false;
    }

    const pathname = parsed.pathname.toLowerCase();
    const isImagePath = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(pathname);
    const isKnownAssetPath = pathname.includes('/mupdf/') || pathname.startsWith('/_next/image');

    return isImagePath || isKnownAssetPath;
  } catch {
    return false;
  }
}

function sanitizeDesignHtmlMarkup(markup: string, options?: { allowStyleTags?: boolean }): string {
  const addTags = options?.allowStyleTags ? ['style'] : undefined;

  const sanitized = DOMPurify.sanitize(markup, {
    USE_PROFILES: {
      html: true,
      svg: true,
      svgFilters: true,
    },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
    ADD_TAGS: addTags,
    ADD_ATTR: ['data-asset-id', 'data-design-muted', 'data-design-hidden', 'data-design-page-root', 'xlink:href'],
  });

  const doc = new DOMParser().parseFromString(`<div id="sanitize-root">${sanitized}</div>`, 'text/html');
  const root = doc.getElementById('sanitize-root');
  if (!root) {
    return '';
  }

  for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    for (const attr of Array.from(element.attributes)) {
      if (/^on/i.test(attr.name)) {
        element.removeAttribute(attr.name);
      }
    }
  }

  for (const image of Array.from(root.querySelectorAll('img'))) {
    const src = image.getAttribute('src')?.trim() ?? '';
    if (!isSafeImageRenderSrc(src)) {
      image.removeAttribute('src');
    }
  }

  for (const svgImage of Array.from(root.querySelectorAll('image'))) {
    const href =
      svgImage.getAttribute('href')?.trim() ??
      svgImage.getAttribute('xlink:href')?.trim() ??
      '';

    if (!isSafeImageRenderSrc(href)) {
      svgImage.removeAttribute('href');
      svgImage.removeAttribute('xlink:href');
    }
  }

  return root.innerHTML;
}

function hideAssetsInMarkup(markup: string, hiddenAssetIds: Set<string>): string {
  if (hiddenAssetIds.size === 0) {
    return markup;
  }

  const doc = new DOMParser().parseFromString(`<div id="hidden-root">${markup}</div>`, 'text/html');
  const root = doc.getElementById('hidden-root');
  if (!root) {
    return markup;
  }

  for (const imageNode of Array.from(root.querySelectorAll('[data-asset-id]'))) {
    const assetId = imageNode.getAttribute('data-asset-id');
    if (!assetId || !hiddenAssetIds.has(assetId)) {
      continue;
    }

    imageNode.remove();
  }

  return root.innerHTML;
}

function prepareIframePreviewMarkup(markup: string): string {
  const doc = new DOMParser().parseFromString(`<div id="iframe-preview-root">${markup}</div>`, 'text/html');
  const root = doc.getElementById('iframe-preview-root');
  if (!root) {
    return '';
  }

  for (const blocked of Array.from(root.querySelectorAll('script, iframe, object, embed'))) {
    blocked.remove();
  }

  for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    for (const attr of Array.from(element.attributes)) {
      if (/^on/i.test(attr.name)) {
        element.removeAttribute(attr.name);
      }
    }
  }

  return root.innerHTML;
}

async function loadImageFromSource(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load selected image for cropping.'));
    image.src = src;
  });
}

async function createCroppedDataUrl(src: string, pixels: CropRect): Promise<string> {
  const image = await loadImageFromSource(src);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas context is not available for crop operation.');
  }

  const width = Math.max(1, Math.round(pixels.width));
  const height = Math.max(1, Math.round(pixels.height));
  const x = clamp(Math.round(pixels.x), 0, Math.max(0, image.naturalWidth - 1));
  const y = clamp(Math.round(pixels.y), 0, Math.max(0, image.naturalHeight - 1));
  const maxWidth = Math.max(1, image.naturalWidth - x);
  const maxHeight = Math.max(1, image.naturalHeight - y);
  const sourceWidth = Math.min(width, maxWidth);
  const sourceHeight = Math.min(height, maxHeight);

  canvas.width = sourceWidth;
  canvas.height = sourceHeight;

  context.drawImage(
    image,
    x,
    y,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight
  );

  return canvas.toDataURL('image/png', 0.92);
}

export default function HtmlImageDesigner({
  pageHtml,
  pageIndex,
  currentPageNumber,
  documentAssetCount,
  expectedPageAssetCount,
  editable,
  zoomMode,
  manualZoom,
  onCommitHtml,
  onScroll,
  registerScrollElement,
}: HtmlImageDesignerProps): React.JSX.Element {
  const [livePatches, setLivePatches] = useState<Record<string, EditableImagePatch>>({});
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [parkedAssetIds, setParkedAssetIds] = useState<Set<string>>(new Set());
  const [isCanvasDragOver, setIsCanvasDragOver] = useState(false);
  const [historyByPage, setHistoryByPage] = useState<Record<number, HistoryState>>({});
  const [cropAssetId, setCropAssetId] = useState<string | null>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropImageMetrics, setCropImageMetrics] = useState<CropImageMetrics | null>(null);
  const [cropDisplaySize, setCropDisplaySize] = useState<CropDisplaySize | null>(null);
  const [cropError, setCropError] = useState<string | null>(null);
  const [isCropApplying, setIsCropApplying] = useState(false);
  const [fitScale, setFitScale] = useState(1);
  const [previewFitScale, setPreviewFitScale] = useState(1);
  const [isPreviewScaleReady, setIsPreviewScaleReady] = useState(false);
  const [previewContentSize, setPreviewContentSize] = useState<PreviewContentSize>({
    width: 1,
    height: 1,
  });

  const viewportRef = useRef<HTMLDivElement>(null);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cropCloseRef = useRef<HTMLButtonElement>(null);
  const cropModalRef = useRef<HTMLDivElement>(null);
  const cropAreaRef = useRef<HTMLDivElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const preparedPage = useMemo(() => {
    return prepareImageDesignPage(pageHtml);
  }, [pageHtml]);

  const sanitizedDesignHtml = useMemo(() => {
    return sanitizeDesignHtmlMarkup(preparedPage.designHtml);
  }, [preparedPage.designHtml]);

  const renderedAssets = useMemo(() => {
    return preparedPage.assets.map((asset) => {
      const patch = livePatches[asset.id];
      if (!patch) {
        return asset;
      }

      return {
        ...asset,
        left: typeof patch.left === 'number' ? patch.left : asset.left,
        top: typeof patch.top === 'number' ? patch.top : asset.top,
        width: typeof patch.width === 'number' ? patch.width : asset.width,
        height: typeof patch.height === 'number' ? patch.height : asset.height,
        zIndex: typeof patch.zIndex === 'number' ? patch.zIndex : asset.zIndex,
        src: typeof patch.src === 'string' ? patch.src : asset.src,
        isHidden: typeof patch.hidden === 'boolean' ? patch.hidden : asset.isHidden,
      };
    });
  }, [livePatches, preparedPage.assets]);

  const hiddenAssetIds = useMemo(() => {
    return new Set(renderedAssets.filter((asset) => asset.isHidden).map((asset) => asset.id));
  }, [renderedAssets]);

  const parkedOrHiddenAssetIds = useMemo(() => {
    if (hiddenAssetIds.size === 0) {
      return parkedAssetIds;
    }

    const next = new Set(parkedAssetIds);
    for (const assetId of hiddenAssetIds) {
      next.add(assetId);
    }

    return next;
  }, [hiddenAssetIds, parkedAssetIds]);

  const visibleRenderedAssets = useMemo(() => {
    if (parkedOrHiddenAssetIds.size === 0) {
      return renderedAssets.filter((asset) => !asset.isHidden);
    }

    return renderedAssets.filter((asset) => !parkedOrHiddenAssetIds.has(asset.id) && !asset.isHidden);
  }, [parkedOrHiddenAssetIds, renderedAssets]);

  const safeDesignHtml = useMemo(() => {
    return hideAssetsInMarkup(sanitizedDesignHtml, parkedOrHiddenAssetIds);
  }, [parkedOrHiddenAssetIds, sanitizedDesignHtml]);

  const livePreviewHtml = useMemo(() => {
    const patchedHtml = applyImagePatchesToHtml(pageHtml, livePatches);
    return hideAssetsInMarkup(patchedHtml, parkedOrHiddenAssetIds);
  }, [livePatches, pageHtml, parkedOrHiddenAssetIds]);

  const iframePreviewHtml = useMemo(() => {
    return prepareIframePreviewMarkup(livePreviewHtml);
  }, [livePreviewHtml]);

  const effectiveSelectedAssetId = useMemo(() => {
    if (selectedAssetId && visibleRenderedAssets.some((asset) => asset.id === selectedAssetId)) {
      return selectedAssetId;
    }

    return visibleRenderedAssets[0]?.id ?? null;
  }, [selectedAssetId, visibleRenderedAssets]);

  const selectedAsset = useMemo(() => {
    if (!effectiveSelectedAssetId) {
      return null;
    }

    return visibleRenderedAssets.find((asset) => asset.id === effectiveSelectedAssetId) ?? null;
  }, [effectiveSelectedAssetId, visibleRenderedAssets]);

  const pageHistory = historyByPage[pageIndex] ?? { past: [], future: [] };
  const canReorderSelectedAsset = Boolean(selectedAsset);
  const parkedCount = parkedOrHiddenAssetIds.size;

  const manualScale = Math.max(0.2, manualZoom / 100);
  const requestedScale = zoomMode === 'manual' ? manualScale : fitScale;
  const designerScale = Math.max(fitScale, requestedScale);
  const stageWidth = Math.max(1, preparedPage.pageWidth * designerScale);
  const stageHeight = Math.max(1, preparedPage.pageHeight * designerScale);
  const previewRequestedScale = zoomMode === 'manual' ? manualScale : previewFitScale;
  const previewScale = Math.min(previewFitScale, previewRequestedScale);
  const previewBaseWidth = Math.max(1, previewContentSize.width);
  const previewBaseHeight = Math.max(1, previewContentSize.height);
  const previewStageWidth = Math.max(1, previewBaseWidth * previewScale);
  const previewStageHeight = Math.max(1, previewBaseHeight * previewScale);

  const livePreviewFrameDoc = useMemo(() => {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none';" />
    <style>
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible;
        background: #f0f6f1;
        color: #1a1a1a;
      }
      body {
        box-sizing: border-box;
      }
      #preview-root {
        position: relative;
      }
      #preview-root .pdf-page,
      #preview-root .document-page,
      #preview-root [data-design-page-root="true"] {
        margin: 0 !important;
        position: relative !important;
        overflow: visible !important;
      }
      #preview-root .pdf-page p,
      #preview-root .document-page p,
      #preview-root [data-design-page-root="true"] p {
        position: absolute !important;
        margin: 0 !important;
        white-space: pre !important;
      }
      #preview-root .pdf-page img,
      #preview-root .document-page img,
      #preview-root [data-design-page-root="true"] img {
        position: absolute !important;
        max-width: none !important;
      }
      #preview-root .pdf-page > svg,
      #preview-root .document-page > svg,
      #preview-root .pdf-page svg,
      #preview-root .document-page svg,
      #preview-root [data-design-page-root="true"] svg {
        position: absolute !important;
        overflow: visible !important;
      }
    </style>
  </head>
  <body><div id="preview-root">${iframePreviewHtml}</div></body>
</html>`;
  }, [iframePreviewHtml]);

  const measurePreviewContent = useCallback(() => {
    const iframe = previewFrameRef.current;
    const iframeDocument = iframe?.contentWindow?.document;
    if (!iframeDocument) {
      return;
    }

    const root = iframeDocument.getElementById('preview-root');
    const rootRect = root?.getBoundingClientRect() ?? null;

    let boundsWidth = 0;
    let boundsHeight = 0;

    if (root && rootRect) {
      const descendants = Array.from(root.querySelectorAll<HTMLElement | SVGElement>('*'));
      for (const element of descendants) {
        const rect = element.getBoundingClientRect();
        boundsWidth = Math.max(boundsWidth, rect.right - rootRect.left);
        boundsHeight = Math.max(boundsHeight, rect.bottom - rootRect.top);
      }

      boundsWidth = Math.max(boundsWidth, root.scrollWidth, root.clientWidth);
      boundsHeight = Math.max(boundsHeight, root.scrollHeight, root.clientHeight);
    }

    const documentElement = iframeDocument.documentElement;
    const body = iframeDocument.body;

    const measuredWidth = Math.max(
      boundsWidth,
      documentElement?.scrollWidth ?? 0,
      documentElement?.clientWidth ?? 0,
      body?.scrollWidth ?? 0,
      body?.clientWidth ?? 0,
      preparedPage.pageWidth
    );

    const measuredHeight = Math.max(
      boundsHeight,
      documentElement?.scrollHeight ?? 0,
      documentElement?.clientHeight ?? 0,
      body?.scrollHeight ?? 0,
      body?.clientHeight ?? 0,
      preparedPage.pageHeight
    );

    const pageRoot = root?.querySelector<HTMLElement | SVGElement>('[data-design-page-root="true"], .pdf-page, .document-page') ?? null;
    const pageRootRect = pageRoot?.getBoundingClientRect() ?? null;
    const trustedPageWidth = Math.max(preparedPage.pageWidth, Math.ceil(pageRootRect?.width ?? 0));
    const trustedPageHeight = Math.max(preparedPage.pageHeight, Math.ceil(pageRootRect?.height ?? 0));

    const maxTrustedWidth = trustedPageWidth * PREVIEW_CONTENT_OVERFLOW_TOLERANCE;
    const maxTrustedHeight = trustedPageHeight * PREVIEW_CONTENT_OVERFLOW_TOLERANCE;

    const clampedWidth = Math.min(measuredWidth, maxTrustedWidth);
    const clampedHeight = Math.min(measuredHeight, maxTrustedHeight);

    setPreviewContentSize({
      width: Math.max(1, Math.ceil(clampedWidth)),
      height: Math.max(1, Math.ceil(clampedHeight)),
    });
    setIsPreviewScaleReady(true);
  }, [preparedPage.pageHeight, preparedPage.pageWidth]);

  const handlePreviewFrameLoad = useCallback(() => {
    measurePreviewContent();
    requestAnimationFrame(() => {
      measurePreviewContent();
    });
  }, [measurePreviewContent]);

  useEffect(() => {
    setIsPreviewScaleReady(false);
  }, [livePreviewFrameDoc]);

  const commitHtmlChange = useCallback(
    (nextHtml: string) => {
      if (nextHtml === pageHtml) {
        return;
      }

      setHistoryByPage((prev) => {
        const current = prev[pageIndex] ?? { past: [], future: [] };
        const nextPast = [...current.past.slice(-24), pageHtml];

        return {
          ...prev,
          [pageIndex]: {
            past: nextPast,
            future: [],
          },
        };
      });

      onCommitHtml(nextHtml);
    },
    [onCommitHtml, pageHtml, pageIndex]
  );

  const applySinglePatch = useCallback(
    (assetId: string, patch: EditableImagePatch) => {
      const nextHtml = applyImagePatchesToHtml(pageHtml, {
        [assetId]: patch,
      });

      if (nextHtml !== pageHtml) {
        commitHtmlChange(nextHtml);
      }
    },
    [commitHtmlChange, pageHtml]
  );

  const parkAsset = useCallback((assetId: string) => {
    setParkedAssetIds((prev) => {
      if (prev.has(assetId)) {
        return prev;
      }

      const next = new Set(prev);
      next.add(assetId);
      return next;
    });

    setSelectedAssetId((prev) => (prev === assetId ? null : prev));
    applySinglePatch(assetId, { hidden: true });
  }, [applySinglePatch]);

  const unparkAsset = useCallback((assetId: string, persist = true) => {
    setParkedAssetIds((prev) => {
      if (!prev.has(assetId)) {
        return prev;
      }

      const next = new Set(prev);
      next.delete(assetId);
      return next;
    });

    if (persist) {
      applySinglePatch(assetId, { hidden: false });
    }
  }, [applySinglePatch]);

  const deleteAsset = useCallback((assetId: string) => {
    if (!editable) {
      return;
    }

    const targetAsset = renderedAssets.find((asset) => asset.id === assetId);
    if (!targetAsset) {
      return;
    }

    const shouldDelete = window.confirm(
      `Delete "${targetAsset.label}" from this page?\n\nThis removes the asset from page markup. You can use Undo to restore it.`
    );
    if (!shouldDelete) {
      return;
    }

    const nextHtml = removeAssetFromHtml(pageHtml, assetId);
    if (nextHtml === pageHtml) {
      return;
    }

    setLivePatches((prev) => {
      if (!(assetId in prev)) {
        return prev;
      }

      const next = { ...prev };
      delete next[assetId];
      return next;
    });

    setParkedAssetIds((prev) => {
      if (!prev.has(assetId)) {
        return prev;
      }

      const next = new Set(prev);
      next.delete(assetId);
      return next;
    });

    setSelectedAssetId((prev) => (prev === assetId ? null : prev));

    if (cropAssetId === assetId) {
      setCropAssetId(null);
      setCropRect(null);
      setCropImageMetrics(null);
      setCropDisplaySize(null);
      setCropError(null);
    }

    commitHtmlChange(nextHtml);
  }, [commitHtmlChange, cropAssetId, editable, pageHtml, renderedAssets]);

  const placeAssetAtPointer = useCallback(
    (assetId: string, clientX: number, clientY: number) => {
      const stage = stageRef.current;
      const asset = renderedAssets.find((entry) => entry.id === assetId);

      if (!stage || !asset) {
        return;
      }

      const stageRect = stage.getBoundingClientRect();
      const rawLeft = (clientX - stageRect.left) / designerScale - asset.width / 2;
      const rawTop = (clientY - stageRect.top) / designerScale - asset.height / 2;
      const maxLeft = Math.max(0, preparedPage.pageWidth - asset.width);
      const maxTop = Math.max(0, preparedPage.pageHeight - asset.height);

      const nextLeft = clamp(rawLeft, 0, maxLeft);
      const nextTop = clamp(rawTop, 0, maxTop);

      unparkAsset(assetId, false);

      setLivePatches((prev) => ({
        ...prev,
        [assetId]: {
          ...(prev[assetId] ?? {}),
          left: nextLeft,
          top: nextTop,
          hidden: false,
        },
      }));

      applySinglePatch(assetId, {
        left: nextLeft,
        top: nextTop,
        hidden: false,
      });

      setSelectedAssetId(assetId);
    },
    [applySinglePatch, designerScale, preparedPage.pageHeight, preparedPage.pageWidth, renderedAssets, unparkAsset]
  );

  const handleCanvasDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!editable) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setIsCanvasDragOver(true);
  }, [editable]);

  const handleCanvasDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!editable) {
      return;
    }

    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setIsCanvasDragOver(false);
  }, [editable]);

  const handleCanvasDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!editable) {
        return;
      }

      event.preventDefault();
      setIsCanvasDragOver(false);

      const droppedAssetId = event.dataTransfer.getData(DESIGN_ASSET_DRAG_MIME);
      if (!droppedAssetId) {
        return;
      }

      placeAssetAtPointer(droppedAssetId, event.clientX, event.clientY);
    },
    [editable, placeAssetAtPointer]
  );

  useEffect(() => {
    setLivePatches({});
    setParkedAssetIds(new Set());
    setIsCanvasDragOver(false);
    setIsPreviewScaleReady(false);
    setPreviewContentSize({
      width: Math.max(1, preparedPage.pageWidth),
      height: Math.max(1, preparedPage.pageHeight),
    });
  }, [pageIndex, preparedPage.pageHeight, preparedPage.pageWidth]);

  useEffect(() => {
    setParkedAssetIds((prev) => {
      const next = new Set(
        preparedPage.assets
          .filter((asset) => asset.isHidden)
          .map((asset) => asset.id)
      );

      return areSetsEqual(prev, next) ? prev : next;
    });
  }, [preparedPage.assets]);

  useEffect(() => {
    setLivePatches((prev) => {
      const patchEntries = Object.entries(prev);
      if (patchEntries.length === 0) {
        return prev;
      }

      let changed = false;
      const next: Record<string, EditableImagePatch> = { ...prev };

      for (const [assetId, patch] of patchEntries) {
        const baseAsset = preparedPage.assets.find((asset) => asset.id === assetId);
        if (!baseAsset) {
          delete next[assetId];
          changed = true;
          continue;
        }

        const leftSynced = typeof patch.left !== 'number' || Math.abs(baseAsset.left - patch.left) < 0.5;
        const topSynced = typeof patch.top !== 'number' || Math.abs(baseAsset.top - patch.top) < 0.5;
        const widthSynced = typeof patch.width !== 'number' || Math.abs(baseAsset.width - patch.width) < 0.5;
        const heightSynced = typeof patch.height !== 'number' || Math.abs(baseAsset.height - patch.height) < 0.5;
        const zIndexSynced = typeof patch.zIndex !== 'number' || Math.abs(baseAsset.zIndex - patch.zIndex) < 0.5;
        const srcSynced = typeof patch.src !== 'string' || baseAsset.src === patch.src;
        const hiddenSynced = typeof patch.hidden !== 'boolean' || baseAsset.isHidden === patch.hidden;

        if (leftSynced && topSynced && widthSynced && heightSynced && zIndexSynced && srcSynced && hiddenSynced) {
          delete next[assetId];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [preparedPage.assets]);

  const handleUndo = useCallback(() => {
    if (pageHistory.past.length === 0) {
      return;
    }

    const previousHtml = pageHistory.past[pageHistory.past.length - 1];

    setHistoryByPage((prev) => {
      const current = prev[pageIndex] ?? { past: [], future: [] };
      const nextPast = current.past.slice(0, -1);
      const nextFuture = [pageHtml, ...current.future].slice(0, 24);

      return {
        ...prev,
        [pageIndex]: {
          past: nextPast,
          future: nextFuture,
        },
      };
    });

    setLivePatches({});
    onCommitHtml(previousHtml);
  }, [onCommitHtml, pageHistory.past, pageHtml, pageIndex]);

  const handleRedo = useCallback(() => {
    if (pageHistory.future.length === 0) {
      return;
    }

    const [redoHtml, ...remainingFuture] = pageHistory.future;

    setHistoryByPage((prev) => {
      const current = prev[pageIndex] ?? { past: [], future: [] };
      const nextPast = [...current.past, pageHtml].slice(-24);

      return {
        ...prev,
        [pageIndex]: {
          past: nextPast,
          future: remainingFuture,
        },
      };
    });

    setLivePatches({});
    onCommitHtml(redoHtml);
  }, [onCommitHtml, pageHistory.future, pageHtml, pageIndex]);

  const handleCropOpen = useCallback(() => {
    if (!selectedAsset || !editable) {
      return;
    }

    setCropAssetId(selectedAsset.id);
    setCropError(null);
    setCropImageMetrics(null);
    setCropDisplaySize(null);
    setCropRect(null);
  }, [editable, selectedAsset]);

  const handleCropApply = useCallback(async () => {
    const cropTarget = renderedAssets.find((asset) => asset.id === cropAssetId) ?? null;
    if (!cropTarget || !cropRect || !cropImageMetrics) {
      return;
    }

    setIsCropApplying(true);
    setCropError(null);

    try {
      const scaleX = cropImageMetrics.naturalWidth / cropImageMetrics.displayWidth;
      const scaleY = cropImageMetrics.naturalHeight / cropImageMetrics.displayHeight;
      const sourceRect: CropRect = {
        x: cropRect.x * scaleX,
        y: cropRect.y * scaleY,
        width: cropRect.width * scaleX,
        height: cropRect.height * scaleY,
      };

      const croppedDataUrl = await createCroppedDataUrl(cropTarget.src, sourceRect);
      const duplicateResult = duplicateCroppedAssetInHtml(pageHtml, cropTarget.id, croppedDataUrl);
      const nextHtml = duplicateResult.html;

      if (nextHtml !== pageHtml) {
        commitHtmlChange(nextHtml);
      }

      if (duplicateResult.newAssetId) {
        setSelectedAssetId(duplicateResult.newAssetId);
      }

      setCropAssetId(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to crop this image.';
      setCropError(message);
    } finally {
      setIsCropApplying(false);
    }
  }, [commitHtmlChange, cropAssetId, cropImageMetrics, cropRect, pageHtml, renderedAssets]);

  const cropTarget = useMemo(() => {
    if (!cropAssetId) {
      return null;
    }

    return renderedAssets.find((asset) => asset.id === cropAssetId) ?? null;
  }, [cropAssetId, renderedAssets]);

  const syncCropMetricsFromImage = useCallback(() => {
    const imageElement = cropImageRef.current;
    if (!imageElement) {
      return;
    }

    const nextNaturalWidth = Math.max(1, imageElement.naturalWidth || imageElement.clientWidth || 1);
    const nextNaturalHeight = Math.max(1, imageElement.naturalHeight || imageElement.clientHeight || 1);
    const cropArea = cropAreaRef.current;
    const availableWidth = Math.max(1, (cropArea?.clientWidth ?? imageElement.clientWidth) - 24);
    const availableHeight = Math.max(1, (cropArea?.clientHeight ?? imageElement.clientHeight) - 24);
    const fitScale = Math.min(availableWidth / nextNaturalWidth, availableHeight / nextNaturalHeight, 1);
    const nextDisplayWidth = Math.max(1, Math.round(nextNaturalWidth * fitScale));
    const nextDisplayHeight = Math.max(1, Math.round(nextNaturalHeight * fitScale));

    setCropDisplaySize((prev) => {
      if (prev && prev.width === nextDisplayWidth && prev.height === nextDisplayHeight) {
        return prev;
      }

      return {
        width: nextDisplayWidth,
        height: nextDisplayHeight,
      };
    });

    setCropImageMetrics((prev) => {
      if (
        prev &&
        prev.naturalWidth === nextNaturalWidth &&
        prev.naturalHeight === nextNaturalHeight &&
        prev.displayWidth === nextDisplayWidth &&
        prev.displayHeight === nextDisplayHeight
      ) {
        return prev;
      }

      return {
        naturalWidth: nextNaturalWidth,
        naturalHeight: nextNaturalHeight,
        displayWidth: nextDisplayWidth,
        displayHeight: nextDisplayHeight,
      };
    });

    setCropRect((prev) => {
      if (!prev) {
        return {
          x: 0,
          y: 0,
          width: nextDisplayWidth,
          height: nextDisplayHeight,
        };
      }

      return clampCropRect(prev, nextDisplayWidth, nextDisplayHeight);
    });
  }, []);

  const handleCropImageLoad = useCallback(() => {
    syncCropMetricsFromImage();
  }, [syncCropMetricsFromImage]);

  const handleCropReset = useCallback(() => {
    if (!cropImageMetrics) {
      return;
    }

    setCropRect({
      x: 0,
      y: 0,
      width: cropImageMetrics.displayWidth,
      height: cropImageMetrics.displayHeight,
    });
    setCropError(null);
  }, [cropImageMetrics]);

  useEffect(() => {
    if (!cropTarget) {
      if (previouslyFocusedRef.current) {
        previouslyFocusedRef.current.focus();
        previouslyFocusedRef.current = null;
      }

      return;
    }

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    requestAnimationFrame(() => {
      cropCloseRef.current?.focus();
    });

    const handleKeyboard = (event: KeyboardEvent) => {
      if (!cropModalRef.current) {
        return;
      }

      if (event.key === 'Escape') {
        if (isCropApplying) {
          return;
        }

        event.preventDefault();
        setCropAssetId(null);
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = Array.from(
        cropModalRef.current.querySelectorAll<HTMLElement>(
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
    };

    document.addEventListener('keydown', handleKeyboard);

    return () => {
      document.removeEventListener('keydown', handleKeyboard);
    };
  }, [cropTarget, isCropApplying]);

  useEffect(() => {
    if (!cropTarget) {
      return;
    }

    const cropArea = cropAreaRef.current;
    if (!cropArea) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      syncCropMetricsFromImage();
    });

    resizeObserver.observe(cropArea);

    const handleWindowResize = () => {
      syncCropMetricsFromImage();
    };

    window.addEventListener('resize', handleWindowResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [cropTarget, syncCropMetricsFromImage]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const updateScale = () => {
      const availableWidth = Math.max(1, viewport.clientWidth - DESIGN_VIEWPORT_PADDING);
      const availableHeight = Math.max(1, viewport.clientHeight - DESIGN_VIEWPORT_PADDING);
      const widthScale = availableWidth / preparedPage.pageWidth;
      const heightScale = availableHeight / preparedPage.pageHeight;
      const computedScale = Math.min(1, widthScale, heightScale);
      setFitScale(computedScale);
    };

    updateScale();

    const resizeObserver = new ResizeObserver(() => {
      updateScale();
    });

    resizeObserver.observe(viewport);

    return () => {
      resizeObserver.disconnect();
    };
  }, [preparedPage.pageHeight, preparedPage.pageWidth]);

  useLayoutEffect(() => {
    const previewViewport = previewViewportRef.current;
    if (!previewViewport) {
      return;
    }

    const updatePreviewScale = () => {
      const availableWidth = Math.max(1, previewViewport.clientWidth - PREVIEW_VIEWPORT_PADDING);
      const availableHeight = Math.max(1, previewViewport.clientHeight - PREVIEW_VIEWPORT_PADDING);
      const widthScale = availableWidth / previewBaseWidth;
      const heightScale = availableHeight / previewBaseHeight;
      const computedScale = Math.min(1, widthScale, heightScale);
      setPreviewFitScale(computedScale);
    };

    updatePreviewScale();

    const resizeObserver = new ResizeObserver(() => {
      updatePreviewScale();
    });

    resizeObserver.observe(previewViewport);

    return () => {
      resizeObserver.disconnect();
    };
  }, [previewBaseHeight, previewBaseWidth]);

  useEffect(() => {
    if (!editable || !selectedAsset || cropAssetId) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName ?? '';

      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return;
      }

      if (!viewport.contains(target)) {
        return;
      }

      const step = event.shiftKey ? 10 : 1;
      let deltaX = 0;
      let deltaY = 0;

      if (event.key === 'ArrowLeft') {
        deltaX = -step;
      }

      if (event.key === 'ArrowRight') {
        deltaX = step;
      }

      if (event.key === 'ArrowUp') {
        deltaY = -step;
      }

      if (event.key === 'ArrowDown') {
        deltaY = step;
      }

      if (deltaX === 0 && deltaY === 0) {
        return;
      }

      event.preventDefault();

      const maxLeft = Math.max(0, preparedPage.pageWidth - selectedAsset.width);
      const maxTop = Math.max(0, preparedPage.pageHeight - selectedAsset.height);
      const nextLeft = clamp(selectedAsset.left + deltaX, 0, maxLeft);
      const nextTop = clamp(selectedAsset.top + deltaY, 0, maxTop);

      applySinglePatch(selectedAsset.id, {
        left: nextLeft,
        top: nextTop,
      });
    };

    viewport.addEventListener('keydown', handleKeyboard);

    return () => {
      viewport.removeEventListener('keydown', handleKeyboard);
    };
  }, [applySinglePatch, cropAssetId, editable, preparedPage.pageHeight, preparedPage.pageWidth, selectedAsset]);

  const handleViewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node;
      registerScrollElement(node);
    },
    [registerScrollElement]
  );

  const bringSelectedForward = useCallback(() => {
    if (!selectedAsset || !editable) {
      return;
    }

    applySinglePatch(selectedAsset.id, {
      zIndex: selectedAsset.zIndex + 1,
    });
  }, [applySinglePatch, editable, selectedAsset]);

  const sendSelectedBackward = useCallback(() => {
    if (!selectedAsset || !editable) {
      return;
    }

    applySinglePatch(selectedAsset.id, {
      zIndex: Math.max(0, selectedAsset.zIndex - 1),
    });
  }, [applySinglePatch, editable, selectedAsset]);

  return (
    <div className="workflow-design-root">
      <div className="workflow-design-toolbar" role="group" aria-label="Image design controls">
        <button
          className="workflow-design-btn"
          type="button"
          onClick={handleUndo}
          disabled={pageHistory.past.length === 0 || !editable}
        >
          Undo
        </button>
        <button
          className="workflow-design-btn"
          type="button"
          onClick={handleRedo}
          disabled={pageHistory.future.length === 0 || !editable}
        >
          Redo
        </button>
        <button
          className="workflow-design-btn"
          type="button"
          onClick={sendSelectedBackward}
          disabled={!canReorderSelectedAsset || !editable}
        >
          Back
        </button>
        <button
          className="workflow-design-btn"
          type="button"
          onClick={bringSelectedForward}
          disabled={!canReorderSelectedAsset || !editable}
        >
          Front
        </button>
        <button
          className="workflow-design-btn workflow-design-btn-primary"
          type="button"
          onClick={handleCropOpen}
          disabled={!selectedAsset || !editable}
        >
          Crop
        </button>
        <span className="workflow-design-toolbar-meta">
          {selectedAsset
            ? `${selectedAsset.label} selected${parkedCount > 0 ? ` | Parked: ${parkedCount}` : ''}`
            : parkedCount > 0
              ? `Parked assets: ${parkedCount}`
              : 'Select an image to edit'}
        </span>
      </div>

      <div className="workflow-design-workspace">
        <aside className="workflow-design-assets" aria-label="Design assets">
          <div className="workflow-design-assets-header">
            <span>Assets ({renderedAssets.length})</span>
            <span className="workflow-design-assets-header-meta">
              P{currentPageNumber}: {expectedPageAssetCount} | Doc: {documentAssetCount}
            </span>
          </div>

          {renderedAssets.length > 0 ? (
            <div className="workflow-design-assets-list">
              {renderedAssets.map((asset) => {
                const isParked = parkedOrHiddenAssetIds.has(asset.id);
                const isSelected = !isParked && effectiveSelectedAssetId === asset.id;

                return (
                  <div
                    key={asset.id}
                    className={`workflow-design-assets-item${isSelected ? ' active' : ''}${isParked ? ' parked' : ''}`}
                  >
                    <button
                      className="workflow-design-assets-select"
                      type="button"
                      onClick={() => {
                        if (isParked) {
                          unparkAsset(asset.id);
                        }

                        setSelectedAssetId(asset.id);
                      }}
                      aria-pressed={isSelected}
                      title={isParked ? `${asset.label} (parked)` : asset.label}
                      draggable={editable}
                      onDragStart={(event) => {
                        if (!editable) {
                          return;
                        }

                        event.dataTransfer.setData(DESIGN_ASSET_DRAG_MIME, asset.id);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                    >
                      <img
                        src={asset.src}
                        alt={asset.label}
                        className="workflow-design-assets-thumb"
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="workflow-design-assets-label">{asset.label}</span>
                    </button>

                    <div className="workflow-design-assets-actions">
                      <button
                        className="workflow-design-assets-action"
                        type="button"
                        onClick={() => {
                          if (isParked) {
                            unparkAsset(asset.id);
                            setSelectedAssetId(asset.id);
                            return;
                          }

                          parkAsset(asset.id);
                        }}
                        disabled={!editable}
                      >
                        {isParked ? 'Insert' : 'Remove'}
                      </button>

                      <button
                        className="workflow-design-assets-action workflow-design-assets-action-delete"
                        type="button"
                        onClick={() => deleteAsset(asset.id)}
                        disabled={!editable}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="workflow-design-assets-empty">
              {expectedPageAssetCount > 0
                ? 'Assets were detected for this page, but they are not currently editable in design mode. Open Assets for preview or switch page and try again.'
                : 'No image assets detected on this page. If the PDF page is fully vector-only, selection is unavailable.'}
            </div>
          )}
        </aside>

        <div
          className={`workflow-design-viewport${isCanvasDragOver ? ' drag-over' : ''}`}
          ref={handleViewportRef}
          onScroll={onScroll}
          onDragOver={handleCanvasDragOver}
          onDragLeave={handleCanvasDragLeave}
          onDrop={handleCanvasDrop}
          tabIndex={0}
          aria-label="Image design canvas"
        >
          <div
            className="workflow-design-stage"
            ref={stageRef}
            style={{
              width: `${stageWidth}px`,
              height: `${stageHeight}px`,
            }}
          >
            <div
              className="workflow-design-canvas"
              style={{
                width: `${preparedPage.pageWidth}px`,
                height: `${preparedPage.pageHeight}px`,
                transform: `scale(${designerScale})`,
              }}
            >
              <div
                className="workflow-design-page"
                onMouseDown={(event) => {
                  const target = event.target as Element | null;
                  const imgElement = target?.closest<HTMLImageElement>('img[data-asset-id]');
                  if (imgElement?.dataset.assetId) {
                    setSelectedAssetId(imgElement.dataset.assetId);
                    return;
                  }

                  const svgImageElement = target?.closest('image[data-asset-id]');
                  const svgAssetId = svgImageElement?.getAttribute('data-asset-id');
                  if (svgAssetId) {
                    setSelectedAssetId(svgAssetId);
                  }
                }}
                dangerouslySetInnerHTML={{ __html: safeDesignHtml }}
              />

              <div className="workflow-design-overlay">
                {visibleRenderedAssets.map((asset) => {
                  const isSelected = selectedAsset?.id === asset.id;

                  return (
                    <Rnd
                      key={asset.id}
                      bounds="parent"
                      size={{ width: asset.width, height: asset.height }}
                      position={{ x: asset.left, y: asset.top }}
                      scale={designerScale}
                      disableDragging={!editable}
                      enableResizing={editable}
                      dragHandleClassName="workflow-design-drag-handle"
                      onMouseDown={() => setSelectedAssetId(asset.id)}
                      onDrag={(_, data) => {
                        if (!editable) {
                          return;
                        }

                        setLivePatches((prev) => ({
                          ...prev,
                          [asset.id]: {
                            ...(prev[asset.id] ?? {}),
                            left: data.x,
                            top: data.y,
                          },
                        }));
                      }}
                      onDragStop={(_, data) => {
                        if (!editable) {
                          return;
                        }

                        const maxLeft = Math.max(0, preparedPage.pageWidth - asset.width);
                        const maxTop = Math.max(0, preparedPage.pageHeight - asset.height);

                        applySinglePatch(asset.id, {
                          left: clamp(data.x, 0, maxLeft),
                          top: clamp(data.y, 0, maxTop),
                        });
                      }}
                      onResizeStop={(_, __, ref, ___, position) => {
                        if (!editable) {
                          return;
                        }

                        const nextWidth = Math.max(12, ref.offsetWidth);
                        const nextHeight = Math.max(12, ref.offsetHeight);
                        const maxLeft = Math.max(0, preparedPage.pageWidth - nextWidth);
                        const maxTop = Math.max(0, preparedPage.pageHeight - nextHeight);

                        applySinglePatch(asset.id, {
                          left: clamp(position.x, 0, maxLeft),
                          top: clamp(position.y, 0, maxTop),
                          width: nextWidth,
                          height: nextHeight,
                        });
                      }}
                      onResize={(_, __, ref, ___, position) => {
                        if (!editable) {
                          return;
                        }

                        const nextWidth = Math.max(12, ref.offsetWidth);
                        const nextHeight = Math.max(12, ref.offsetHeight);
                        const maxLeft = Math.max(0, preparedPage.pageWidth - nextWidth);
                        const maxTop = Math.max(0, preparedPage.pageHeight - nextHeight);

                        setLivePatches((prev) => ({
                          ...prev,
                          [asset.id]: {
                            ...(prev[asset.id] ?? {}),
                            left: clamp(position.x, 0, maxLeft),
                            top: clamp(position.y, 0, maxTop),
                            width: nextWidth,
                            height: nextHeight,
                          },
                        }));
                      }}
                      className={`workflow-design-box${isSelected ? ' selected' : ''}`}
                      style={{ zIndex: asset.zIndex }}
                    >
                      <div className="workflow-design-drag-handle">
                        {editable ? (
                          <button
                            className="workflow-design-remove-chip"
                            type="button"
                            title="Remove from canvas"
                            aria-label={`Remove ${asset.label} from canvas`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              parkAsset(asset.id);
                            }}
                          >
                            x
                          </button>
                        ) : null}
                        <img
                          src={asset.src}
                          alt={asset.label}
                          className="workflow-design-image"
                          draggable={false}
                        />
                        <span className="workflow-design-label">{asset.label}</span>
                      </div>
                    </Rnd>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <aside className="workflow-design-preview" aria-label="Live HTML preview">
          <div className="workflow-design-preview-header">Live HTML Preview</div>
          <div className="workflow-design-preview-viewport" ref={previewViewportRef}>
            <div
              className="workflow-design-preview-stage"
              style={{
                width: `${previewStageWidth}px`,
                height: `${previewStageHeight}px`,
              }}
            >
              <iframe
                ref={previewFrameRef}
                className="workflow-design-preview-frame"
                title={`Live HTML Preview Page ${currentPageNumber}`}
                sandbox="allow-same-origin"
                srcDoc={livePreviewFrameDoc}
                onLoad={handlePreviewFrameLoad}
                style={{
                  width: `${previewBaseWidth}px`,
                  height: `${previewBaseHeight}px`,
                  transform: `scale(${previewScale})`,
                  transformOrigin: 'top left',
                  visibility: isPreviewScaleReady ? 'visible' : 'hidden',
                }}
              />
            </div>
          </div>
        </aside>
      </div>

      {cropTarget ? (
        <div
          className="workflow-crop-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workflow-crop-title"
          aria-describedby="workflow-crop-help"
        >
          <div className="workflow-crop-modal" ref={cropModalRef}>
            <div className="workflow-crop-header">
              <h3 id="workflow-crop-title">Crop Image</h3>
              <button
                ref={cropCloseRef}
                className="workflow-assets-close"
                type="button"
                onClick={() => setCropAssetId(null)}
                aria-label="Close crop modal"
                disabled={isCropApplying}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="workflow-crop-area" ref={cropAreaRef}>
              <div
                className="workflow-crop-stage"
                style={cropDisplaySize ? { width: `${cropDisplaySize.width}px`, height: `${cropDisplaySize.height}px` } : undefined}
              >
                <img
                  ref={cropImageRef}
                  src={cropTarget.src}
                  alt={cropTarget.label}
                  className="workflow-crop-image"
                  style={cropDisplaySize ? { width: `${cropDisplaySize.width}px`, height: `${cropDisplaySize.height}px` } : undefined}
                  onLoad={handleCropImageLoad}
                  onError={() => {
                    setCropImageMetrics(null);
                    setCropDisplaySize(null);
                    setCropRect(null);
                    setCropError('Unable to load selected image for cropping. Close and reopen crop to retry.');
                  }}
                  draggable={false}
                />

                {cropRect && cropImageMetrics ? (
                  <Rnd
                    bounds="parent"
                    size={{ width: cropRect.width, height: cropRect.height }}
                    position={{ x: cropRect.x, y: cropRect.y }}
                    minWidth={MIN_CROP_SIZE}
                    minHeight={MIN_CROP_SIZE}
                    disableDragging={isCropApplying}
                    enableResizing={!isCropApplying}
                    onDrag={(_, data) => {
                      setCropRect((prev) => {
                        const next = {
                          x: data.x,
                          y: data.y,
                          width: prev?.width ?? cropRect.width,
                          height: prev?.height ?? cropRect.height,
                        };

                        return clampCropRect(next, cropImageMetrics.displayWidth, cropImageMetrics.displayHeight);
                      });
                    }}
                    onDragStop={(_, data) => {
                      setCropRect((prev) => {
                        const next = {
                          x: data.x,
                          y: data.y,
                          width: prev?.width ?? cropRect.width,
                          height: prev?.height ?? cropRect.height,
                        };

                        return clampCropRect(next, cropImageMetrics.displayWidth, cropImageMetrics.displayHeight);
                      });
                    }}
                    onResize={(_, __, ref, ___, position) => {
                      const next = {
                        x: position.x,
                        y: position.y,
                        width: ref.offsetWidth,
                        height: ref.offsetHeight,
                      };

                      setCropRect(clampCropRect(next, cropImageMetrics.displayWidth, cropImageMetrics.displayHeight));
                    }}
                    onResizeStop={(_, __, ref, ___, position) => {
                      const next = {
                        x: position.x,
                        y: position.y,
                        width: ref.offsetWidth,
                        height: ref.offsetHeight,
                      };

                      setCropRect(clampCropRect(next, cropImageMetrics.displayWidth, cropImageMetrics.displayHeight));
                    }}
                    className="workflow-crop-selection"
                  >
                    <div className="workflow-crop-selection-inner">
                      <span className="workflow-crop-selection-badge">KEEP</span>
                    </div>
                  </Rnd>
                ) : null}
              </div>
            </div>

            <div className="workflow-crop-controls">
              <div className="workflow-crop-controls-top">
                <p id="workflow-crop-help" className="workflow-crop-help">
                  Drag inside the selection to move it. Pull any edge/corner to trim from all sides.
                </p>
                <button
                  className="workflow-crop-reset"
                  type="button"
                  onClick={handleCropReset}
                  disabled={isCropApplying || !cropImageMetrics}
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="workflow-crop-actions">
              <button
                className="workflow-design-btn"
                type="button"
                onClick={() => setCropAssetId(null)}
                disabled={isCropApplying}
              >
                Cancel
              </button>
              <button
                className="workflow-design-btn workflow-design-btn-primary"
                type="button"
                onClick={handleCropApply}
                disabled={isCropApplying || !cropRect || !cropImageMetrics}
              >
                {isCropApplying ? 'Applying...' : 'Apply Crop'}
              </button>
            </div>

            {cropError ? (
              <p className="workflow-crop-error" role="alert" aria-live="assertive">
                {cropError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
