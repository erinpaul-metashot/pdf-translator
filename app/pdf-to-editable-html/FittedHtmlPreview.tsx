'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface FittedHtmlPreviewProps {
  srcDoc: string;
  title: string;
}

interface PreviewLayout {
  contentWidth: number;
  contentHeight: number;
  scale: number;
}

const INITIAL_LAYOUT: PreviewLayout = {
  contentWidth: 0,
  contentHeight: 0,
  scale: 1,
};

function getContentDimensions(doc: Document): { width: number; height: number } {
  const root = doc.documentElement;
  const body = doc.body;

  if (!root) {
    return {
      width: 0,
      height: 0,
    };
  }

  const width = Math.max(
    root.scrollWidth,
    root.clientWidth,
    root.offsetWidth,
    body?.scrollWidth ?? 0,
    body?.clientWidth ?? 0,
    body?.offsetWidth ?? 0
  );

  const height = Math.max(
    root.scrollHeight,
    root.clientHeight,
    root.offsetHeight,
    body?.scrollHeight ?? 0,
    body?.clientHeight ?? 0,
    body?.offsetHeight ?? 0
  );

  return {
    width,
    height,
  };
}

export default function FittedHtmlPreview({ srcDoc, title }: FittedHtmlPreviewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const contentResizeObserverRef = useRef<ResizeObserver | null>(null);
  const fitModeRef = useRef<'fit-page' | 'native-scroll'>('fit-page');
  const [layout, setLayout] = useState<PreviewLayout>(INITIAL_LAYOUT);
  const [fitMode, setFitMode] = useState<'fit-page' | 'native-scroll'>('fit-page');

  const disconnectContentObserver = useCallback(() => {
    if (contentResizeObserverRef.current) {
      contentResizeObserverRef.current.disconnect();
      contentResizeObserverRef.current = null;
    }
  }, []);

  useEffect(() => {
    fitModeRef.current = fitMode;
  }, [fitMode]);

  const recomputeLayout = useCallback(() => {
    if (fitModeRef.current !== 'fit-page') {
      return;
    }

    const container = containerRef.current;
    const iframe = iframeRef.current;

    if (!container || !iframe) {
      return;
    }

    const doc = iframe.contentDocument;
    if (!doc) {
      return;
    }

    const root = doc.documentElement;
    if (!root) {
      setFitMode('native-scroll');
      setLayout(INITIAL_LAYOUT);
      return;
    }

    root.style.overflow = 'hidden';
    if (doc.body) {
      doc.body.style.overflow = 'hidden';
    }

    const availableWidth = container.clientWidth;
    const availableHeight = container.clientHeight;
    if (availableWidth === 0 || availableHeight === 0) {
      return;
    }

    const { width: contentWidth, height: contentHeight } = getContentDimensions(doc);
    if (contentWidth === 0 || contentHeight === 0) {
      return;
    }

    const nextScale = Math.min(
      availableWidth / contentWidth,
      availableHeight / contentHeight,
      1
    );

    setLayout((previous) => {
      if (
        previous.contentWidth === contentWidth
        && previous.contentHeight === contentHeight
        && Math.abs(previous.scale - nextScale) < 0.001
      ) {
        return previous;
      }

      return {
        contentWidth,
        contentHeight,
        scale: nextScale,
      };
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      recomputeLayout();
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [recomputeLayout]);

  useEffect(() => {
    return () => {
      disconnectContentObserver();
    };
  }, [disconnectContentObserver]);

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) {
      return;
    }

    disconnectContentObserver();

    const pageCount = doc.querySelectorAll('.pdf-page').length;
    const shouldFitPage = pageCount <= 1;
    fitModeRef.current = shouldFitPage ? 'fit-page' : 'native-scroll';
    setFitMode(shouldFitPage ? 'fit-page' : 'native-scroll');

    if (!shouldFitPage) {
      setLayout(INITIAL_LAYOUT);
      return;
    }

    const contentObserver = new ResizeObserver(() => {
      recomputeLayout();
    });

    const root = doc.documentElement;
    if (!root) {
      return;
    }

    contentObserver.observe(root);
    if (doc.body) {
      contentObserver.observe(doc.body);
    }

    contentResizeObserverRef.current = contentObserver;

    requestAnimationFrame(() => {
      recomputeLayout();
    });
  }, [disconnectContentObserver, recomputeLayout]);

  if (fitMode === 'native-scroll') {
    return (
      <div
        ref={containerRef}
        className="h-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
      >
        <iframe
          ref={iframeRef}
          title={title}
          className="h-full w-full border-0 bg-white"
          sandbox="allow-same-origin"
          srcDoc={srcDoc}
          onLoad={handleIframeLoad}
        />
      </div>
    );
  }

  const frameWidth = layout.contentWidth || 1;
  const frameHeight = layout.contentHeight || 1;

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: frameWidth,
          height: frameHeight,
          transform: `translate(-50%, -50%) scale(${layout.scale})`,
          transformOrigin: 'center center',
        }}
      >
        <iframe
          ref={iframeRef}
          title={title}
          className="h-full w-full border-0 bg-white"
          sandbox="allow-same-origin"
          srcDoc={srcDoc}
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
}
