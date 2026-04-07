'use client';

import dynamic from 'next/dynamic';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';

import { Button } from '@/components/ui/button';
import FittedHtmlPreview from './FittedHtmlPreview';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { convertPdfToHtml as convertPdfToHtmlWithEngine } from '@/lib/pdf-to-html-engine';

const PdfPreviewPane = dynamic(() => import('./PdfPreviewPane'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">
      Loading PDF viewer...
    </div>
  ),
});

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_FILE_MB = 50;

type MuPdfMatrix = [number, number, number, number, number, number];
type MuPdfRect = [number, number, number, number];

type ConversionStatus = 'idle' | 'converting' | 'ready' | 'error';
type PreviewTab = 'faithful' | 'editable';

interface MuPdfStructuredTextLike {
  asHTML: (id: number) => string;
  destroy: () => void;
}

interface MuPdfBufferLike {
  asString: () => string;
  destroy: () => void;
}

interface MuPdfDeviceLike {
  fillPath?: (...args: unknown[]) => void;
  strokePath?: (...args: unknown[]) => void;
  clipPath?: (...args: unknown[]) => void;
  clipStrokePath?: (...args: unknown[]) => void;
  fillText?: (...args: unknown[]) => void;
  strokeText?: (...args: unknown[]) => void;
  clipText?: (...args: unknown[]) => void;
  clipStrokeText?: (...args: unknown[]) => void;
  ignoreText?: (...args: unknown[]) => void;
  fillShade?: (...args: unknown[]) => void;
  fillImage?: (...args: unknown[]) => void;
  fillImageMask?: (...args: unknown[]) => void;
  clipImageMask?: (...args: unknown[]) => void;
  popClip?: (...args: unknown[]) => void;
  beginMask?: (...args: unknown[]) => void;
  endMask?: (...args: unknown[]) => void;
  beginGroup?: (...args: unknown[]) => void;
  endGroup?: (...args: unknown[]) => void;
  beginTile?: (...args: unknown[]) => number;
  endTile?: (...args: unknown[]) => void;
  beginLayer?: (...args: unknown[]) => void;
  endLayer?: (...args: unknown[]) => void;
  close?: () => void;
  destroy: () => void;
}

interface MuPdfDocumentWriterLike {
  beginPage: (mediabox: MuPdfRect) => MuPdfDeviceLike;
  endPage: () => void;
  close: () => void;
  destroy: () => void;
}

interface MuPdfPageLike {
  getBounds: () => MuPdfRect;
  toStructuredText: (options?: string) => MuPdfStructuredTextLike;
  run: (device: MuPdfDeviceLike, matrix: MuPdfMatrix) => void;
  destroy: () => void;
}

interface MuPdfDocumentLike {
  countPages: () => number;
  loadPage: (index: number) => MuPdfPageLike;
  destroy: () => void;
}

interface MuPdfRuntime {
  Buffer: new () => MuPdfBufferLike;
  Device: new (callbacks: Partial<MuPdfDeviceLike>) => MuPdfDeviceLike;
  DocumentWriter: new (
    buffer: MuPdfBufferLike,
    format: string,
    options: string
  ) => MuPdfDocumentWriterLike;
  Matrix: {
    identity: MuPdfMatrix;
  };
  Document: {
    openDocument: (source: Uint8Array, magic?: string) => MuPdfDocumentLike;
  };
}

interface NormalizedMuPdfPage {
  pageHtml: string;
  headStyleCssBlocks: string[];
}

declare global {
  var $libmupdf_wasm_Module: {
    locateFile?: (fileName: string) => string;
    printErr?: (...args: unknown[]) => void;
  } | undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected error occurred.';
}

function createDownload(content: BlobPart, type: string, fileName: string): void {
  const blob = new Blob([content], { type });
  const blobUrl = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
}

function buildPdfPrintHtml(sourceHtml: string, documentTitle: string): string {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(sourceHtml, 'text/html');

  parsed.title = documentTitle;

  const printStyle = parsed.createElement('style');
  printStyle.textContent = [
    '@page { margin: 0; }',
    'html, body { margin: 0 !important; padding: 0 !important; background: #ffffff !important; }',
    'body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }',
    '.pdf-document { display: block !important; gap: 0 !important; }',
    '.pdf-page { margin: 0 auto !important; box-shadow: none !important; border-radius: 0 !important; break-after: page; page-break-after: always; }',
    '.pdf-page:last-child { break-after: auto; page-break-after: auto; }',
  ].join('\n');

  parsed.head.appendChild(printStyle);

  return ['<!doctype html>', parsed.documentElement.outerHTML].join('\n');
}

function printHtmlWithHiddenIframe(printableHtml: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.top = '0';
    iframe.style.left = '0';
    iframe.style.width = '100vw';
    iframe.style.height = '100vh';
    iframe.style.visibility = 'hidden';
    iframe.style.opacity = '0';
    iframe.style.zIndex = '-1';
    iframe.style.border = '0';
    iframe.style.pointerEvents = 'none';

    let hasTriggeredPrint = false;
    let hasFinalized = false;
    let hasSettled = false;
    let fallbackTimeout: ReturnType<typeof setTimeout> | null = null;
    let loadFallbackTimeout: ReturnType<typeof setTimeout> | null = null;
    let printEventTarget: Window | null = null;

    const finalize = (error?: Error) => {
      if (hasFinalized) {
        return;
      }

      hasFinalized = true;

      if (fallbackTimeout) {
        clearTimeout(fallbackTimeout);
        fallbackTimeout = null;
      }

      if (loadFallbackTimeout) {
        clearTimeout(loadFallbackTimeout);
        loadFallbackTimeout = null;
      }

      if (printEventTarget) {
        printEventTarget.removeEventListener('afterprint', handleAfterPrint);
      }

      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }

      if (error && !hasSettled) {
        hasSettled = true;
        reject(error);
      }
    };

    const handleAfterPrint = () => {
      finalize();
    };

    const waitForFrameAssets = async (frameDoc: Document): Promise<void> => {
      const imagePromises = Array.from(frameDoc.images).map((image) => {
        if (image.complete) {
          return Promise.resolve();
        }

        return new Promise<void>((assetResolve) => {
          const handleDone = () => assetResolve();
          image.addEventListener('load', handleDone, { once: true });
          image.addEventListener('error', handleDone, { once: true });
        });
      });

      const fontsReadyPromise =
        'fonts' in frameDoc && frameDoc.fonts
          ? frameDoc.fonts.ready.then(() => undefined).catch(() => undefined)
          : Promise.resolve();

      await Promise.all([fontsReadyPromise, ...imagePromises]);

      await new Promise<void>((nextFrame) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            nextFrame();
          });
        });
      });
    };

    const triggerPrint = async () => {
      if (hasTriggeredPrint) {
        return;
      }

      hasTriggeredPrint = true;

      const frameWindow = iframe.contentWindow;
      const frameDoc = iframe.contentDocument;

      if (!frameWindow || !frameDoc) {
        finalize(new Error('Unable to access print frame.'));
        return;
      }

      await waitForFrameAssets(frameDoc);

      try {
        frameWindow.focus();
        frameWindow.print();
      } catch {
        finalize(new Error('Unable to open print dialog.'));
        return;
      }

      if (!hasSettled) {
        hasSettled = true;
        resolve();
      }

      // Some browsers do not emit afterprint reliably for iframe printing.
      fallbackTimeout = setTimeout(() => {
        finalize();
      }, 120000);
    };

    iframe.addEventListener(
      'load',
      () => {
        if (!printEventTarget) {
          printEventTarget = iframe.contentWindow ?? window;
          printEventTarget.addEventListener('afterprint', handleAfterPrint, { once: true });
        }

        void triggerPrint();
      },
      { once: true }
    );

    document.body.appendChild(iframe);

    iframe.srcdoc = printableHtml;

    // Fallback for engines that do not reliably fire iframe load for srcdoc.
    loadFallbackTimeout = setTimeout(() => {
      if (!printEventTarget) {
        printEventTarget = iframe.contentWindow ?? window;
        printEventTarget.addEventListener('afterprint', handleAfterPrint, { once: true });
      }

      void triggerPrint();
    }, 1500);
  });
}

const UNSAFE_STYLE_PATTERNS = [
  /expression\s*\(/i,
  /url\s*\(\s*['"]?\s*javascript:/i,
  /@import/i,
];

const UNSAFE_URL_PROTOCOL_PATTERNS = [
  /^\s*javascript:/i,
  /^\s*data\s*:\s*text\/html/i,
];

const SVG_URL_REFERENCE_ATTRIBUTES = new Set([
  'href',
  'xlink:href',
  'clip-path',
  'mask',
  'filter',
  'fill',
  'stroke',
  'marker-start',
  'marker-mid',
  'marker-end',
]);

function scopeStyleRule(selectorText: string, declarationText: string, pageNumber: number): string {
  const prefix = `[data-page="${pageNumber}"]`;
  const scopedSelectors = selectorText
    .split(',')
    .map((selector) => selector.trim())
    .filter(Boolean)
    .flatMap((selector) => {
      if (/^(html|body|:root)$/i.test(selector)) {
        return [prefix, `${prefix} *`];
      }

      return [`${prefix} ${selector}`];
    })
    .filter(Boolean);

  const uniqueSelectors = Array.from(new Set(scopedSelectors)).join(', ');

  if (!uniqueSelectors) {
    return '';
  }

  return `${uniqueSelectors} { ${declarationText} }`;
}

function scopeCssRule(rule: CSSRule, pageNumber: number): string {
  if ('selectorText' in rule) {
    const styleRule = rule as CSSStyleRule;
    return scopeStyleRule(styleRule.selectorText, styleRule.style.cssText, pageNumber);
  }

  if ('cssRules' in rule) {
    const groupingRule = rule as CSSRule & { cssRules: CSSRuleList };
    const openBraceIndex = rule.cssText.indexOf('{');
    if (openBraceIndex === -1) {
      return rule.cssText;
    }

    const header = rule.cssText.slice(0, openBraceIndex).trim();
    const scopedChildren = Array.from(groupingRule.cssRules)
      .map((childRule) => scopeCssRule(childRule, pageNumber))
      .filter(Boolean)
      .join('\n');

    return `${header} {\n${scopedChildren}\n}`;
  }

  return rule.cssText;
}

function scopeMuPdfCss(cssText: string, pageNumber: number): string {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);

    const scopedRules = Array.from(sheet.cssRules)
      .map((rule) => scopeCssRule(rule, pageNumber))
      .filter(Boolean);

    return scopedRules.join('\n');
  } catch {
    const fallbackScoped = cssText.replace(
      /([{}]|^)\s*([^@{}][^{}]*?)\s*\{/g,
      (fullMatch, boundary: string, selectorGroup: string) => {
        const scopedSelectors = selectorGroup
          .split(',')
          .map((selector) => selector.trim())
          .filter(Boolean)
          .flatMap((selector) => {
            if (/^(html|body|:root)$/i.test(selector)) {
              return [`[data-page="${pageNumber}"]`, `[data-page="${pageNumber}"] *`];
            }

            return [`[data-page="${pageNumber}"] ${selector}`];
          });

        if (scopedSelectors.length === 0) {
          return fullMatch;
        }

        const dedupedSelectors = Array.from(new Set(scopedSelectors)).join(', ');
        return `${boundary}\n${dedupedSelectors} {`;
      }
    );

    if (!fallbackScoped.trim()) {
      console.warn('Unable to scope MuPDF style block. Dropping this block.');
      return '';
    }

    return fallbackScoped;
  }
}

function extractMuPdfStyleBlocks(parsed: Document, pageNumber: number): string[] {
  const styles = Array.from(parsed.querySelectorAll('style'));
  const blocks: string[] = [];

  for (const style of styles) {
    // MuPDF can emit <style> tags inside inline SVG assets.
    // Those must stay in-place, otherwise vector fills/strokes degrade (often to black).
    if (style.closest('svg')) {
      continue;
    }

    const cssText = style.textContent?.trim() ?? '';
    if (!cssText) {
      continue;
    }

    if (UNSAFE_STYLE_PATTERNS.some((pattern) => pattern.test(cssText))) {
      console.warn('Skipped potentially unsafe MuPDF style block.');
      continue;
    }

    const scopedCss = scopeMuPdfCss(cssText, pageNumber).trim();
    if (!scopedCss) {
      continue;
    }

    blocks.push(scopedCss);

    // Body-level style nodes can duplicate styles in the final output; keep only extracted CSS.
    if (style.parentElement && style.parentElement.tagName.toLowerCase() !== 'head') {
      style.remove();
    }
  }

  return blocks;
}

function isUnsafeUrlValue(value: string): boolean {
  if (UNSAFE_URL_PROTOCOL_PATTERNS.some((pattern) => pattern.test(value))) {
    return true;
  }

  return /^\s*(https?:|data:)/i.test(value);
}

function isSafeInlineSvgImageUrl(value: string): boolean {
  const normalizedValue = value.trim();

  // Allow only inline image payloads for SVG <image> nodes.
  // This preserves MuPDF-generated mask/texture data while still blocking external URLs.
  return /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=._-]+)*(?:;base64)?,[\s\S]*$/i.test(normalizedValue);
}

function normalizeInlineSvgImageUrl(value: string): string {
  const trimmed = value.trim();
  const commaIndex = trimmed.indexOf(',');

  if (commaIndex === -1) {
    return trimmed;
  }

  const meta = trimmed.slice(0, commaIndex);
  const payload = trimmed.slice(commaIndex + 1);

  // MuPDF can emit whitespace-chunked base64 payloads; remove whitespace so browsers decode reliably.
  if (/;base64$/i.test(meta)) {
    const compactPayload = payload.replace(/\s+/g, '');
    return `${meta},${compactPayload}`;
  }

  return `${meta},${payload}`;
}

function rewriteSvgFragmentReferences(value: string, idMap: Map<string, string>): string {
  let rewritten = value;

  rewritten = rewritten.replace(
    /url\(\s*(['"]?)#([^'"\)\s]+)\1\s*\)/gi,
    (fullMatch, quote: string, idValue: string) => {
      const nextId = idMap.get(idValue);
      if (!nextId) {
        return fullMatch;
      }

      return `url(${quote}#${nextId}${quote})`;
    }
  );

  rewritten = rewritten.replace(/^\s*#([^\s]+)\s*$/, (fullMatch, idValue: string) => {
    const nextId = idMap.get(idValue);
    return nextId ? `#${nextId}` : fullMatch;
  });

  return rewritten;
}

function sanitizeSvgMarkup(svgMarkup: string, pageNumber: number): string {
  if (!svgMarkup.trim()) {
    return '';
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(svgMarkup, 'image/svg+xml');

  if (parsed.querySelector('parsererror')) {
    return '';
  }

  const root = parsed.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    return '';
  }

  parsed.querySelectorAll('script,foreignObject,iframe,canvas,video,audio').forEach((element) => {
    element.remove();
  });

  const idMap = new Map<string, string>();
  parsed.querySelectorAll('[id]').forEach((element, index) => {
    const existingId = element.getAttribute('id');
    if (!existingId) {
      return;
    }

    const normalizedId = existingId.trim();
    if (!normalizedId) {
      return;
    }

    const replacementId = `p${pageNumber}-u${index}-${normalizedId}`;
    idMap.set(normalizedId, replacementId);
    element.setAttribute('id', replacementId);
  });

  parsed.querySelectorAll('*').forEach((element) => {
    const elementTagName = element.tagName.toLowerCase();

    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase();
      const attributeValue = attribute.value.trim();

      if (attributeName.startsWith('on')) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (SVG_URL_REFERENCE_ATTRIBUTES.has(attributeName)) {
        const rewrittenReferenceValue = rewriteSvgFragmentReferences(attributeValue, idMap);

        if (attributeName === 'href' || attributeName === 'xlink:href') {
          const normalizedReferenceValue =
            elementTagName === 'image'
              ? normalizeInlineSvgImageUrl(rewrittenReferenceValue)
              : rewrittenReferenceValue;

          const isFragmentReference = normalizedReferenceValue.startsWith('#');
          const isSafeImageDataUrl =
            elementTagName === 'image' && isSafeInlineSvgImageUrl(normalizedReferenceValue);

          if (!isFragmentReference && !isSafeImageDataUrl) {
            element.removeAttribute(attribute.name);
            continue;
          }

          if (!isFragmentReference && !isSafeImageDataUrl && isUnsafeUrlValue(normalizedReferenceValue)) {
            element.removeAttribute(attribute.name);
            continue;
          }

          if (normalizedReferenceValue !== attribute.value) {
            element.setAttribute(attribute.name, normalizedReferenceValue);
          }

          // Cross-browser compatibility: keep both href and xlink:href in inline SVG.
          if (elementTagName === 'image' || elementTagName === 'use') {
            element.setAttribute('href', normalizedReferenceValue);
            element.setAttribute('xlink:href', normalizedReferenceValue);
          }

          continue;
        }

        if (isUnsafeUrlValue(rewrittenReferenceValue)) {
          element.removeAttribute(attribute.name);
          continue;
        }

        if (rewrittenReferenceValue.includes('url(') && !/url\(\s*(['"]?)#[^\)]+\1\s*\)/i.test(rewrittenReferenceValue)) {
          element.removeAttribute(attribute.name);
          continue;
        }

        if (rewrittenReferenceValue !== attribute.value) {
          element.setAttribute(attribute.name, rewrittenReferenceValue);
        }

        continue;
      }

      if (attributeName === 'style') {
        const rewrittenStyle = rewriteSvgFragmentReferences(attributeValue, idMap);

        if (UNSAFE_STYLE_PATTERNS.some((pattern) => pattern.test(rewrittenStyle))) {
          element.removeAttribute(attribute.name);
          continue;
        }

        if (isUnsafeUrlValue(rewrittenStyle) || /url\(\s*(['"]?)(?!#)/i.test(rewrittenStyle)) {
          element.removeAttribute(attribute.name);
          continue;
        }

        if (rewrittenStyle !== attribute.value) {
          element.setAttribute(attribute.name, rewrittenStyle);
        }
      }
    }
  });

  parsed.querySelectorAll('style').forEach((styleElement) => {
    const cssText = styleElement.textContent ?? '';
    const rewrittenCss = rewriteSvgFragmentReferences(cssText, idMap);

    if (UNSAFE_STYLE_PATTERNS.some((pattern) => pattern.test(rewrittenCss))) {
      styleElement.remove();
      return;
    }

    if (isUnsafeUrlValue(rewrittenCss) || /url\(\s*(['"]?)(?!#)/i.test(rewrittenCss)) {
      styleElement.remove();
      return;
    }

    styleElement.textContent = rewrittenCss;
  });

  // Some engines only honor luminance masks when set as a style declaration.
  parsed.querySelectorAll('mask[mask-type="luminance"]').forEach((maskElement) => {
    const existingStyle = maskElement.getAttribute('style') ?? '';

    if (!/mask-type\s*:/i.test(existingStyle)) {
      const nextStyle = existingStyle.trim();
      maskElement.setAttribute(
        'style',
        nextStyle ? `${nextStyle}; mask-type:luminance` : 'mask-type:luminance'
      );
    }
  });

  // Fallback for engines that still fail SVG mask image decoding:
  // drop the known shadow-only masked groups so box fills remain visible.
  parsed.querySelectorAll('g[mask]').forEach((maskedGroup) => {
    const blendGroups = Array.from(maskedGroup.querySelectorAll('g[style*="mix-blend-mode:multiply"]'));

    if (blendGroups.length !== 1) {
      return;
    }

    const shadowPath = blendGroups[0].querySelector('path[fill="#231f20"][fill-opacity]');
    if (!shadowPath) {
      return;
    }

    const opacityValue = Number.parseFloat(shadowPath.getAttribute('fill-opacity') ?? '1');
    if (Number.isFinite(opacityValue) && opacityValue >= 0.25 && opacityValue <= 0.5) {
      maskedGroup.remove();
    }
  });

  // Keep only non-text visual assets in the SVG underlay.
  parsed.querySelectorAll('text, tspan, textPath').forEach((textElement) => {
    textElement.remove();
  });

  return root.outerHTML;
}

function extractPageImages(
  page: MuPdfPageLike,
  mupdf: MuPdfRuntime
): Map<string, string> {
  const imageDataUris = new Map<string, string>();

  let st: MuPdfStructuredTextLike | null = null;

  try {
    st = page.toStructuredText('preserve-images');

    // Walk the structured text to find image blocks
    (st as unknown as {
      walk?: (callbacks: {
        onImageBlock?: (bbox: unknown, transform: unknown, image: unknown) => void;
      }) => void;
    }).walk?.({
      onImageBlock: (bbox: unknown, transform: unknown, image: unknown) => {
        try {
          const mupdfImage = image as {
            getPixmap?: (colorspace: unknown, alpha: boolean) => {
              asPNG?: () => Uint8Array;
              asJPEG?: (quality: number) => Uint8Array;
              destroy?: () => void;
            };
            toString?: () => string;
          };

          if (!mupdfImage.getPixmap) {
            return;
          }

          // Try to get pixmap and convert to PNG
          try {
            const pixmap = mupdfImage.getPixmap(
              (mupdf as unknown as { ColorSpace?: { DeviceRGB?: unknown } }).ColorSpace?.DeviceRGB,
              false
            );

            if (pixmap && pixmap.asPNG) {
              const pngBuffer = pixmap.asPNG();
              const base64Data = Array.from(pngBuffer)
                .map((byte) => String.fromCharCode(byte))
                .join('');
              const dataUri = `data:image/png;base64,${btoa(base64Data)}`;

              const imageKey = `image_${imageDataUris.size}`;
              imageDataUris.set(imageKey, dataUri);
            }

            if (pixmap?.destroy) {
              pixmap.destroy();
            }
          } catch {
            // Fallback: try JPEG
            try {
              const pixmap = mupdfImage.getPixmap(
                (mupdf as unknown as { ColorSpace?: { DeviceRGB?: unknown } }).ColorSpace?.DeviceRGB,
                false
              );

              if (pixmap && (pixmap as unknown as { asJPEG?: (q: number) => Uint8Array }).asJPEG) {
                const jpegBuffer = (pixmap as unknown as { asJPEG?: (q: number) => Uint8Array }).asJPEG?.(90);
                if (jpegBuffer) {
                  const base64Data = Array.from(jpegBuffer)
                    .map((byte) => String.fromCharCode(byte))
                    .join('');
                  const dataUri = `data:image/jpeg;base64,${btoa(base64Data)}`;

                  const imageKey = `image_${imageDataUris.size}`;
                  imageDataUris.set(imageKey, dataUri);
                }
              }

              if (pixmap?.destroy) {
                pixmap.destroy();
              }
            } catch {
              // Skip this image if conversion fails
            }
          }
        } catch {
          // Skip this image block if processing fails
        }
      },
    });
  } catch (error: unknown) {
    console.warn('Failed to extract page images:', error);
  } finally {
    if (st) {
      try {
        st.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  return imageDataUris;
}

function injectImagesIntoSvg(svgMarkup: string, imageDataUris: Map<string, string>): string {
  if (imageDataUris.size === 0) {
    return svgMarkup;
  }

  let injected = svgMarkup;
  let imageIndex = 0;

  // Find empty <image> tags and inject data URIs
  injected = injected.replace(/<image\s+([^>]*)\/?>(?=\s*(?:<|$))/g, (match) => {
    if (imageIndex < imageDataUris.size) {
      const dataUri = Array.from(imageDataUris.values())[imageIndex];
      imageIndex += 1;

      // Extract existing attributes if it's a self-closing tag
      const attrsMatch = match.match(/<image\s+([^/>]*)/);
      const existingAttrs = attrsMatch?.[1] || '';

      return `<image ${existingAttrs} xlink:href="${dataUri}" />`;
    }

    return match;
  });

  return injected;
}

function createTextFilteredVectorUnderlay(
  page: MuPdfPageLike,
  pageNumber: number,
  mupdf: MuPdfRuntime
): string | null {
  const runSafeCleanup = (label: string, cleanup: (() => void) | undefined): void => {
    if (!cleanup) {
      return;
    }

    try {
      cleanup();
    } catch (cleanupError: unknown) {
      console.warn(`MuPDF cleanup failed (${label}).`, cleanupError);
    }
  };

  let svgBuffer: MuPdfBufferLike | null = null;
  let writer: MuPdfDocumentWriterLike | null = null;
  let writerPageOpen = false;
  let writerClosed = false;
  let targetDevice: MuPdfDeviceLike | null = null;

  try {
    // Extract images before generating SVG
    const imageDataUris = extractPageImages(page, mupdf);

    svgBuffer = new mupdf.Buffer();
    writer = new mupdf.DocumentWriter(svgBuffer, 'svg', 'text=text,no-reuse-images');

    targetDevice = writer.beginPage(page.getBounds());
    writerPageOpen = true;

    page.run(targetDevice, mupdf.Matrix.identity);

    writer.endPage();
    writerPageOpen = false;
    writer.close();
    writerClosed = true;

    let svgContent = svgBuffer.asString();

    // Inject extracted image data into empty <image> tags
    if (imageDataUris.size > 0) {
      svgContent = injectImagesIntoSvg(svgContent, imageDataUris);
    }

    const sanitizedSvg = sanitizeSvgMarkup(svgContent, pageNumber);
    return sanitizedSvg || null;
  } catch (error: unknown) {
    console.warn('Vector underlay generation failed for page. Continuing with MuPDF HTML only.', error);
    return null;
  } finally {
    runSafeCleanup('target device close', targetDevice?.close?.bind(targetDevice));
    runSafeCleanup('target device destroy', targetDevice?.destroy.bind(targetDevice));

    if (writer && writerPageOpen) {
      runSafeCleanup('writer endPage', writer.endPage.bind(writer));
    }

    if (writer && !writerClosed) {
      runSafeCleanup('writer close', writer.close.bind(writer));
    }

    runSafeCleanup('writer destroy', writer?.destroy.bind(writer));
    runSafeCleanup('svg buffer destroy', svgBuffer?.destroy.bind(svgBuffer));
  }
}

function normalizeDataImageUri(uri: string): string {
  const trimmed = uri.trim();
  const commaIndex = trimmed.indexOf(',');

  if (!/^data:image\//i.test(trimmed) || commaIndex === -1) {
    return trimmed;
  }

  const prefix = trimmed.slice(0, commaIndex + 1);
  const payload = trimmed.slice(commaIndex + 1);

  if (!/;base64,/i.test(prefix)) {
    return `${prefix}${payload}`;
  }

  const compactPayload = payload.replace(/\s+/g, '');
  return `${prefix}${compactPayload}`;
}

function isDataImageUri(value: string): boolean {
  return /^\s*data:image\//i.test(value);
}

function isBase64DataImageUri(value: string): boolean {
  return /^\s*data:image\/[a-z0-9.+-]+(?:;[a-z0-9=._-]+)*;base64,/i.test(value);
}

function isJpegDataImageUri(value: string): boolean {
  return /^\s*data:image\/jpeg(?:;[a-z0-9=._-]+)*;base64,/i.test(value);
}

function hasKnownBlueBoxVectors(svgMarkup: string): boolean {
  return /fill\s*=\s*"#(?:c7eafb|c5effc)"/i.test(svgMarkup);
}

function getPngDimensionsFromDataUri(value: string): { width: number; height: number } | null {
  const normalizedValue = normalizeDataImageUri(value);
  const match = normalizedValue.match(/^\s*data:image\/png(?:;[a-z0-9=._-]+)*;base64,([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  const payload = match[1].replace(/\s+/g, '');
  const encodedHeaderLength = 32;

  try {
    const decodedHeader = atob(payload.slice(0, encodedHeaderLength));
    const headerBytes = Uint8Array.from(decodedHeader, (char) => char.charCodeAt(0));

    if (headerBytes.length < 24) {
      return null;
    }

    const isPngSignature =
      headerBytes[0] === 0x89 &&
      headerBytes[1] === 0x50 &&
      headerBytes[2] === 0x4e &&
      headerBytes[3] === 0x47;

    if (!isPngSignature) {
      return null;
    }

    const width =
      ((headerBytes[16] << 24) | (headerBytes[17] << 16) | (headerBytes[18] << 8) | headerBytes[19]) >>> 0;
    const height =
      ((headerBytes[20] << 24) | (headerBytes[21] << 16) | (headerBytes[22] << 8) | headerBytes[23]) >>> 0;

    if (width === 0 || height === 0) {
      return null;
    }

    return { width, height };
  } catch {
    return null;
  }
}

const MATRIX_NUMBER_TOKEN = '[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?';

function extractMatrixScalesFromStyle(styleValue: string): { scaleX: number; scaleY: number } | null {
  const matrixPattern = new RegExp(
    `matrix\\(\\s*(${MATRIX_NUMBER_TOKEN})\\s*,\\s*${MATRIX_NUMBER_TOKEN}\\s*,\\s*${MATRIX_NUMBER_TOKEN}\\s*,\\s*(${MATRIX_NUMBER_TOKEN})`,
    'i'
  );

  const match = styleValue.match(matrixPattern);
  if (!match) {
    return null;
  }

  const scaleX = Number.parseFloat(match[1]);
  const scaleY = Number.parseFloat(match[2]);
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
    return null;
  }

  return { scaleX, scaleY };
}

function extractMatrixFromStyle(
  styleValue: string
): { scaleX: number; scaleY: number; translateX: number; translateY: number } | null {
  const matrixPattern = new RegExp(
    `matrix\\(\\s*(${MATRIX_NUMBER_TOKEN})\\s*,\\s*${MATRIX_NUMBER_TOKEN}\\s*,\\s*${MATRIX_NUMBER_TOKEN}\\s*,\\s*(${MATRIX_NUMBER_TOKEN})\\s*,\\s*(${MATRIX_NUMBER_TOKEN})\\s*,\\s*(${MATRIX_NUMBER_TOKEN})\\s*\\)`,
    'i'
  );

  const match = styleValue.match(matrixPattern);

  if (!match) {
    return null;
  }

  const scaleX = Number.parseFloat(match[1]);
  const scaleY = Number.parseFloat(match[2]);
  const translateX = Number.parseFloat(match[3]);
  const translateY = Number.parseFloat(match[4]);

  if (![scaleX, scaleY, translateX, translateY].every(Number.isFinite)) {
    return null;
  }

  return { scaleX, scaleY, translateX, translateY };
}

function isLikelyDiagramShadowOverlayImage(image: HTMLImageElement): boolean {
  const src = image.getAttribute('src') ?? '';
  if (!isJpegDataImageUri(src)) {
    return false;
  }

  const styleValue = image.getAttribute('style') ?? '';
  const matrixScales = extractMatrixScalesFromStyle(styleValue);
  if (!matrixScales) {
    return false;
  }

  const { scaleX, scaleY } = matrixScales;
  const hasKnownScale = scaleX >= 0.45 && scaleX <= 0.5 && scaleY >= 0.45 && scaleY <= 0.5;
  const scalesClose = Math.abs(scaleX - scaleY) <= 0.02;

  return hasKnownScale && scalesClose;
}

function isLikelyTopHeaderShadowOverlayImage(image: HTMLImageElement): boolean {
  const src = image.getAttribute('src') ?? '';
  const pngDimensions = getPngDimensionsFromDataUri(src);
  if (!pngDimensions) {
    return false;
  }

  const styleValue = image.getAttribute('style') ?? '';
  const matrix = extractMatrixFromStyle(styleValue);
  if (!matrix) {
    return false;
  }

  const { scaleX, scaleY, translateX, translateY } = matrix;
  const renderedWidth = pngDimensions.width * Math.abs(scaleX);
  const renderedHeight = pngDimensions.height * Math.abs(scaleY);

  const hasKnownScale = scaleX >= 0.55 && scaleX <= 0.7 && scaleY >= 0.55 && scaleY <= 0.7;
  const isNearTopHeader = translateY >= 120 && translateY <= 260;
  const isNearLeftMargin = translateX >= 60 && translateX <= 150;
  const hasBannerLikeSourceDimensions =
    pngDimensions.width >= 550 && pngDimensions.height <= 90 && pngDimensions.width / pngDimensions.height >= 6;
  const hasBannerLikeRenderedDimensions =
    renderedWidth >= 320 && renderedWidth <= 520 && renderedHeight >= 12 && renderedHeight <= 40;

  return (
    hasKnownScale &&
    isNearTopHeader &&
    isNearLeftMargin &&
    hasBannerLikeSourceDimensions &&
    hasBannerLikeRenderedDimensions
  );
}

function hasExcludedSvgImageAncestor(element: Element): boolean {
  let cursor: Element | null = element.parentElement;

  while (cursor) {
    const tagName = cursor.tagName.toLowerCase();
    if (
      tagName === 'defs' ||
      tagName === 'mask' ||
      tagName === 'clippath' ||
      tagName === 'pattern' ||
      tagName === 'filter' ||
      tagName === 'symbol'
    ) {
      return true;
    }

    cursor = cursor.parentElement;
  }

  return false;
}

function getSvgImageHref(image: Element): string {
  return image.getAttribute('href') ?? image.getAttribute('xlink:href') ?? '';
}

function collectRenderedSvgImageDataUris(svgMarkup: string): Set<string> {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(svgMarkup, 'image/svg+xml');

  if (parsed.querySelector('parsererror')) {
    return new Set();
  }

  const imageElements = Array.from(parsed.querySelectorAll('image'));
  const renderedImageUris = new Set<string>();

  for (const imageElement of imageElements) {
    if (hasExcludedSvgImageAncestor(imageElement)) {
      continue;
    }

    const href = getSvgImageHref(imageElement);
    const normalizedHref = normalizeDataImageUri(href);
    if (isBase64DataImageUri(normalizedHref)) {
      renderedImageUris.add(normalizedHref);
    }
  }

  return renderedImageUris;
}

function collectEmbeddedSvgImageDataUris(svgMarkup: string): Set<string> {
  const renderedImageUris = collectRenderedSvgImageDataUris(svgMarkup);
  if (renderedImageUris.size > 0) {
    return renderedImageUris;
  }

  // Fallback for malformed SVG that cannot be parsed but still contains data-image URLs.
  const dataUriMatches = svgMarkup.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi);
  if (!dataUriMatches) {
    return new Set();
  }

  return new Set(dataUriMatches.map((value) => normalizeDataImageUri(value)));
}

function normalizeMuPdfPageHtml(
  pageHtml: string,
  pageNumber: number,
  vectorUnderlaySvg: string | null
): NormalizedMuPdfPage {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(pageHtml, 'text/html');
  const headStyleCssBlocks = extractMuPdfStyleBlocks(parsed, pageNumber);
  const pageRoot = parsed.body.firstElementChild;

  if (!pageRoot || !(pageRoot instanceof HTMLElement)) {
    return {
      pageHtml: `<div class="pdf-page" data-page="${pageNumber}"></div>`,
      headStyleCssBlocks,
    };
  }

  pageRoot.classList.add('pdf-page');
  pageRoot.setAttribute('data-page', String(pageNumber));
  pageRoot.style.position = 'relative';
  pageRoot.style.margin = '0 auto 20px auto';
  pageRoot.style.boxShadow = '0 10px 30px rgba(15, 23, 42, 0.12)';
  pageRoot.style.background = 'white';

  // Prevent browser drag-ghost glitches for absolute bitmap layers.
  for (const image of Array.from(pageRoot.querySelectorAll('img'))) {
    image.setAttribute('draggable', 'false');
  }

  if (vectorUnderlaySvg) {
    const underlay = parsed.createElement('div');
    underlay.className = 'pdf-page-underlay';
    underlay.setAttribute('aria-hidden', 'true');
    underlay.innerHTML = vectorUnderlaySvg;
    pageRoot.insertBefore(underlay, pageRoot.firstChild);

    const underlayImageDataUris = collectEmbeddedSvgImageDataUris(vectorUnderlaySvg);
    if (underlayImageDataUris.size > 0) {
      // MuPDF can emit duplicate bitmap layers in page HTML and underlay SVG.
      // Removing duplicated top-layer bitmaps prevents them from obscuring vector fills.
      const overlayImages = Array.from(pageRoot.querySelectorAll('img'));

      for (const image of overlayImages) {
        const src = image.getAttribute('src') ?? '';
        if (!isDataImageUri(src)) {
          continue;
        }

        if (underlayImageDataUris.has(normalizeDataImageUri(src))) {
          image.remove();
        }
      }

      // Fallback for MuPDF outputs where duplicated diagram shadows are JPEG overlays
      // encoded differently than underlay mask assets (URI equality fails).
      if (hasKnownBlueBoxVectors(vectorUnderlaySvg)) {
        const remainingOverlayImages = Array.from(pageRoot.querySelectorAll('img'));

        // Remove known thin dark header-shadow overlays near the page title band.
        const topHeaderShadowOverlays = remainingOverlayImages.filter((image) =>
          isLikelyTopHeaderShadowOverlayImage(image)
        );
        for (const image of topHeaderShadowOverlays) {
          image.remove();
        }

        const remainingAfterHeaderCleanup = Array.from(pageRoot.querySelectorAll('img'));
        const diagramShadowOverlays = remainingAfterHeaderCleanup.filter((image) =>
          isLikelyDiagramShadowOverlayImage(image)
        );

        // Apply only when this looks like the known duplicated shadow tile pattern.
        if (diagramShadowOverlays.length >= 5) {
          for (const image of diagramShadowOverlays) {
            image.remove();
          }
        }
      }
    }
  }

  return {
    pageHtml: parsed.body.innerHTML,
    headStyleCssBlocks,
  };
}

function buildPortableHtml(pages: NormalizedMuPdfPage[]): string {
  const uniqueMuPdfStyles = Array.from(new Set(pages.flatMap((page) => page.headStyleCssBlocks)));
  const muPdfStyleTags = uniqueMuPdfStyles
    .map((cssText) => ['  <style>', cssText, '  </style>'].join('\n'))
    .join('\n');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '  <meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; font-src data: blob:; connect-src \'none\'; media-src \'none\'; frame-src \'none\';" />',
    '  <title>Converted PDF HTML</title>',
    '  <style>',
    '    body { margin: 0; padding: 24px; background: #e2e8f0; font-family: Helvetica, Arial, sans-serif; }',
    '    .pdf-document { display: grid; gap: 24px; justify-content: center; }',
    '    .pdf-page { overflow: hidden; border-radius: 8px; }',
    '    .pdf-page { position: relative; margin: 0 auto 20px auto; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12); background: white; }',
    '    body.show-edited-text .pdf-page [data-edited="true"], body.show-edited-text .pdf-page [data-edited="true"] * { background: #fef08a !important; }',
    '    .pdf-page-underlay { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }',
    '    .pdf-page-underlay > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }',
    '    .pdf-page p { position: absolute; z-index: 1; margin: 0; white-space: pre; }',
    '    .pdf-page img { position: absolute; z-index: 1; max-width: none; }',
    '    .pdf-page > svg { position: absolute; z-index: 1; overflow: visible; }',
    '  </style>',
    muPdfStyleTags,
    '</head>',
    '<body>',
    '  <div class="pdf-document">',
    pages.map((page) => page.pageHtml).join('\n'),
    '  </div>',
    '</body>',
    '</html>',
  ].join('\n');
}

function getEditableTextElements(root: ParentNode): HTMLElement[] {
  const elements = Array.from(
    root.querySelectorAll(
      [
        '.pdf-page p',
        '.pdf-page span',
      ].join(',')
    )
  ) as HTMLElement[];

  return elements.filter((element) => element.childElementCount === 0);
}

function extractEditableTextFromHtml(portableHtml: string): string {
  if (!portableHtml) {
    return '';
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(portableHtml, 'text/html');
  const textElements = getEditableTextElements(parsed);

  const lines = textElements.map((element) => (element.textContent ?? '').replace(/\u00A0/g, ' '));

  if (lines.length > 0) {
    return lines.join('\n');
  }

  return (parsed.body.textContent ?? '').trim();
}

function applyEditedTextToHtml(
  basePortableHtml: string,
  editedText: string,
  showEditedText: boolean
): string {
  if (!basePortableHtml) {
    return editedText;
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(basePortableHtml, 'text/html');
  const textElements = getEditableTextElements(parsed);

  if (textElements.length === 0) {
    return basePortableHtml;
  }

  const lines = editedText.split(/\r?\n/);

  textElements.forEach((element, index) => {
    const originalText = element.textContent ?? '';
    const nextText = lines[index] ?? '';

    element.textContent = nextText;

    if (showEditedText && nextText !== originalText) {
      element.setAttribute('data-edited', 'true');
    } else {
      element.removeAttribute('data-edited');
    }
  });

  if (showEditedText) {
    parsed.body.classList.add('show-edited-text');
  } else {
    parsed.body.classList.remove('show-edited-text');
  }

  return ['<!doctype html>', parsed.documentElement.outerHTML].join('\n');
}

function getPublicAssetPrefix(): string {
  const nextData = (globalThis as { __NEXT_DATA__?: { assetPrefix?: string } }).__NEXT_DATA__;
  const assetPrefix = nextData?.assetPrefix ?? '';
  if (assetPrefix) {
    return assetPrefix.endsWith('/') ? assetPrefix.slice(0, -1) : assetPrefix;
  }

  if (typeof window === 'undefined') {
    return '';
  }

  const currentPath = window.location.pathname.replace(/\/+$/, '');
  const routePath = '/pdf-to-editable-html';
  if (currentPath === routePath || currentPath.endsWith(routePath)) {
    return currentPath.slice(0, -routePath.length);
  }

  return '';
}

async function loadMuPdfRuntime(): Promise<MuPdfRuntime> {
  const assetPrefix = getPublicAssetPrefix();
  const mupdfBasePath = `${assetPrefix}/mupdf`;

  globalThis.$libmupdf_wasm_Module = {
    locateFile: (fileName: string) => `${mupdfBasePath}/${fileName}`,
    printErr: (...args: unknown[]) => {
      const message = args.map(String).join(' ');
      if (message.includes('Actualtext with no position')) {
        return;
      }
      console.warn(message);
    },
  };

  const mupdfModule = await import(/* webpackIgnore: true */ `${mupdfBasePath}/mupdf.js`) as {
    default: MuPdfRuntime;
  };
  return mupdfModule.default;
}

export default function PdfToEditableHtmlPage(): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileUrlRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const conversionAbortControllerRef = useRef<AbortController | null>(null);
  const lastPreviewErrorRef = useRef('');

  const [isDragActive, setIsDragActive] = useState(false);
  const [status, setStatus] = useState<ConversionStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('Waiting for a PDF upload');
  const [progress, setProgress] = useState(0);
  const [pdfPageCount, setPdfPageCount] = useState(0);

  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  const [convertedHtml, setConvertedHtml] = useState('');
  const [editedText, setEditedText] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PreviewTab>('faithful');
  const [isPreparingPdfDownload, setIsPreparingPdfDownload] = useState(false);

  const canDownloadOriginal = Boolean(file);
  const canDownloadConverted = convertedHtml.length > 0;
  const originalExtractedText = useMemo(
    () => extractEditableTextFromHtml(convertedHtml),
    [convertedHtml]
  );

  const effectiveEditedText = useMemo(
    () => editedText ?? originalExtractedText,
    [editedText, originalExtractedText]
  );

  const hasTextEdits = useMemo(
    () => {
      if (editedText === null) {
        return false;
      }

      const originalLines = originalExtractedText.split(/\r?\n/);
      const editedLines = editedText.split(/\r?\n/);

      for (let index = 0; index < originalLines.length; index += 1) {
        if ((editedLines[index] ?? '') !== originalLines[index]) {
          return true;
        }
      }

      return false;
    },
    [editedText, originalExtractedText]
  );

  const editedPreviewHtml = useMemo(
    () => applyEditedTextToHtml(convertedHtml, effectiveEditedText, hasTextEdits),
    [convertedHtml, effectiveEditedText, hasTextEdits]
  );

  const editedDownloadHtml = useMemo(
    () => {
      if (!hasTextEdits) {
        return convertedHtml;
      }

      return applyEditedTextToHtml(convertedHtml, effectiveEditedText, false);
    },
    [convertedHtml, effectiveEditedText, hasTextEdits]
  );

  const canDownloadEdited = editedDownloadHtml.length > 0;

  const previewDocHtml = useMemo(() => {
    if (hasTextEdits && editedPreviewHtml) {
      return editedPreviewHtml;
    }

    return convertedHtml;
  }, [convertedHtml, editedPreviewHtml, hasTextEdits]);

  const cleanupObjectUrl = useCallback(() => {
    if (fileUrlRef.current) {
      URL.revokeObjectURL(fileUrlRef.current);
      fileUrlRef.current = null;
    }
  }, []);

  const resetConversionState = useCallback(() => {
    setStatus('idle');
    setStatusMessage('Waiting for a PDF upload');
    setProgress(0);
    setConvertedHtml('');
    setEditedText(null);
    setActiveTab('faithful');
    setPdfPageCount(0);
    lastPreviewErrorRef.current = '';
  }, []);

  const convertPdfToHtml = useCallback(async (sourceFile: File) => {
    const requestId = ++requestIdRef.current;

    conversionAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    conversionAbortControllerRef.current = abortController;

    setStatus('converting');
    setStatusMessage('Reading PDF file');
    setProgress(8);

    try {
      const result = await convertPdfToHtmlWithEngine(sourceFile, {
        signal: abortController.signal,
        onProgress: ({ progress: nextProgress, statusMessage: nextStatusMessage }) => {
          if (requestIdRef.current !== requestId) {
            return;
          }

          setProgress(nextProgress);
          setStatusMessage(nextStatusMessage);
        },
      });

      if (requestIdRef.current !== requestId) {
        return;
      }

      setConvertedHtml(result.html);
      setEditedText(extractEditableTextFromHtml(result.html));
      setStatus('ready');
      setStatusMessage(`Conversion complete (${result.pageCount} pages)`);
      setProgress(100);
      setPdfPageCount(result.pageCount);
      setActiveTab('faithful');

      toast.success('PDF converted to editable HTML successfully');
    } catch (error: unknown) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      setStatus('error');
      setStatusMessage('Conversion failed');
      setProgress(0);
      setConvertedHtml('');
      setEditedText(null);

      toast.error(`Conversion failed: ${toErrorMessage(error)}`);
    } finally {
      if (conversionAbortControllerRef.current === abortController) {
        conversionAbortControllerRef.current = null;
      }
    }
  }, []);

  const validatePdfFile = useCallback((candidate: File): string | null => {
    const isPdfMime = candidate.type === 'application/pdf';
    const isPdfName = candidate.name.toLowerCase().endsWith('.pdf');

    if (!isPdfMime && !isPdfName) {
      return 'Only PDF files are supported.';
    }

    if (candidate.size > MAX_FILE_BYTES) {
      return `File is too large. Maximum size is ${MAX_FILE_MB}MB.`;
    }

    return null;
  }, []);

  const processNewFile = useCallback(
    (candidate: File) => {
      const validationError = validatePdfFile(candidate);

      if (validationError) {
        toast.error(validationError);
        return;
      }

      requestIdRef.current += 1;
      conversionAbortControllerRef.current?.abort();
      cleanupObjectUrl();
      resetConversionState();
      lastPreviewErrorRef.current = '';

      const nextFileUrl = URL.createObjectURL(candidate);
      fileUrlRef.current = nextFileUrl;

      setFile(candidate);
      setFileUrl(nextFileUrl);
      setStatusMessage('File accepted. Starting conversion...');

      void convertPdfToHtml(candidate);
    },
    [cleanupObjectUrl, convertPdfToHtml, resetConversionState, validatePdfFile]
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const candidate = event.target.files?.[0];
      if (!candidate) {
        return;
      }

      processNewFile(candidate);
      event.target.value = '';
    },
    [processNewFile]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragActive(false);

      const candidate = event.dataTransfer.files?.[0];
      if (!candidate) {
        return;
      }

      processNewFile(candidate);
    },
    [processNewFile]
  );

  const handleDownloadOriginal = useCallback(() => {
    if (!file) {
      toast.error('Please upload a PDF first.');
      return;
    }

    createDownload(file, 'application/pdf', file.name);
  }, [file]);

  const handleDownloadConverted = useCallback(() => {
    if (!convertedHtml) {
      toast.error('No converted HTML available yet.');
      return;
    }

    const baseName = file?.name.replace(/\.pdf$/i, '') ?? 'document';
    createDownload(convertedHtml, 'text/html;charset=utf-8', `${baseName}-converted.html`);
  }, [convertedHtml, file]);

  const handleDownloadEdited = useCallback(() => {
    const baseName = file?.name.replace(/\.pdf$/i, '') ?? 'document';
    createDownload(editedDownloadHtml, 'text/html;charset=utf-8', `${baseName}-edited.html`);
  }, [editedDownloadHtml, file]);

  const handleDownloadEditedPdf = useCallback(async () => {
    if (!editedDownloadHtml) {
      toast.error('No edited HTML is available yet.');
      return;
    }

    if (isPreparingPdfDownload) {
      return;
    }

    const baseName = file?.name.replace(/\.pdf$/i, '') ?? 'document';
    const printTitle = `${baseName}-edited`;
    const printableHtml = buildPdfPrintHtml(editedDownloadHtml, printTitle);

    setIsPreparingPdfDownload(true);

    try {
      await printHtmlWithHiddenIframe(printableHtml);
      toast.success('Print dialog opened. Choose "Save as PDF" to download.');
    } catch {
      toast.error('Unable to open print dialog. Please try again.');
    } finally {
      setIsPreparingPdfDownload(false);
    }
  }, [editedDownloadHtml, file, isPreparingPdfDownload]);

  const handleEnterEditMode = useCallback(() => {
    if (!convertedHtml) {
      toast.error('Convert a PDF first before editing.');
      return;
    }

    if (editedText === null) {
      setEditedText(extractEditableTextFromHtml(convertedHtml));
    }

    setActiveTab('editable');
    toast.success('Editable mode enabled');
  }, [convertedHtml, editedText]);

  const handleResetLayout = useCallback(() => {
    if (!convertedHtml) {
      toast.error('No converted HTML to reset.');
      return;
    }

    setEditedText(extractEditableTextFromHtml(convertedHtml));
    setActiveTab('faithful');
    toast.success('Reset to original converted layout');
  }, [convertedHtml]);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      conversionAbortControllerRef.current?.abort();
      cleanupObjectUrl();
    };
  }, [cleanupObjectUrl]);

  return (
    <div className="h-screen overflow-auto bg-linear-to-br from-slate-100 via-slate-50 to-emerald-50">
      <Toaster richColors position="top-right" />

      <main className="mx-auto max-w-425 space-y-4 p-4 md:p-6">
        <Card className="border-slate-200/80 bg-white/85 backdrop-blur">
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-xl">PDF to Editable HTML</CardTitle>
              <CardDescription>
                Client-side MuPDF conversion with faithful layout and in-browser editing.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={handleDownloadOriginal}
                disabled={!canDownloadOriginal}
              >
                Download original PDF
              </Button>
              <Button
                variant="secondary"
                onClick={handleDownloadConverted}
                disabled={!canDownloadConverted}
              >
                Download converted HTML
              </Button>
              <Button
                onClick={handleDownloadEdited}
                disabled={!canDownloadEdited}
              >
                Download edited HTML
              </Button>
              <Button
                variant="outline"
                onClick={handleDownloadEditedPdf}
                disabled={!canDownloadEdited || isPreparingPdfDownload}
              >
                {isPreparingPdfDownload ? 'Preparing PDF...' : 'Download edited PDF'}
              </Button>
            </div>
          </CardHeader>
        </Card>

        {(status === 'converting' || status === 'error') && (
          <Card className="border-slate-200/80 bg-white/85 backdrop-blur">
            <CardContent className="space-y-2 p-4" role="status" aria-live="polite" aria-atomic="true">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">{statusMessage}</span>
                <span className="font-semibold text-slate-900">{progress}%</span>
              </div>
              <Progress
                value={progress}
                aria-label="Conversion progress"
                aria-valuetext={`${progress}% complete`}
              />
              {status === 'error' && (
                <p className="text-sm text-red-600">
                  Conversion failed. Upload again or try a smaller/cleaner PDF.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {!fileUrl && (
          <Card className="border-slate-200/80 bg-white/90 backdrop-blur">
            <CardContent className="p-5 md:p-8">
              <div
                role="button"
                tabIndex={0}
                aria-label="Upload PDF"
                className={`rounded-xl border-2 border-dashed p-10 text-center transition ${
                  isDragActive
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-slate-300 bg-slate-50 hover:border-emerald-400 hover:bg-emerald-50/60'
                }`}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragActive(true);
                }}
                onDragLeave={() => setIsDragActive(false)}
                onDrop={handleDrop}
              >
                <h2 className="text-lg font-semibold text-slate-900">Drop a PDF here</h2>
                <p className="mt-2 text-sm text-slate-600">
                  or click to upload. Single file only, maximum {MAX_FILE_MB}MB.
                </p>
                <span className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm">
                  Select PDF
                </span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={handleInputChange}
              />
            </CardContent>
          </Card>
        )}

        {fileUrl && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 h-auto xl:h-[calc(100vh-200px)]">
            <Card className="border-slate-200/80 bg-white/90 backdrop-blur flex flex-col">
              <CardHeader>
                <CardTitle>Original PDF</CardTitle>
                <CardDescription>
                  Searchable/selectable text layer preview.
                  {pdfPageCount > 0 ? ` ${pdfPageCount} pages.` : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-4">
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">
                      Loading PDF preview...
                    </div>
                  }
                >
                  <PdfPreviewPane
                    fileUrl={fileUrl}
                    onLoadSuccess={(count) => {
                      setPdfPageCount(count);
                    }}
                    onLoadError={(message) => {
                        if (lastPreviewErrorRef.current !== message) {
                          lastPreviewErrorRef.current = message;
                          toast.error(message);
                        }
                    }}
                  />
                </Suspense>
              </CardContent>
            </Card>

            <Card className="border-slate-200/80 bg-white/90 backdrop-blur flex flex-col">
              <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle>Converted HTML</CardTitle>
                  <CardDescription>
                    Faithful MuPDF layout plus rich-text editing mode.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={handleEnterEditMode}
                    disabled={!canDownloadConverted}
                  >
                    Edit Content
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleResetLayout}
                    disabled={!canDownloadConverted}
                  >
                    Reset to Original Layout
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-4">
                <Tabs
                  value={activeTab}
                  onValueChange={(next) => setActiveTab(next as PreviewTab)}
                  className="flex flex-col h-full"
                >
                  <TabsList>
                    <TabsTrigger value="faithful">Faithful Preview</TabsTrigger>
                    <TabsTrigger value="editable">Editable</TabsTrigger>
                  </TabsList>

                  <TabsContent value="faithful" className="flex-1 overflow-hidden">
                    {previewDocHtml ? (
                      <FittedHtmlPreview
                        title="Converted HTML preview"
                        srcDoc={previewDocHtml}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center rounded-lg border border-slate-200 bg-slate-100 px-5 text-center text-sm text-slate-500">
                        Converted HTML will appear here after upload and conversion.
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="editable" className="flex-1 overflow-hidden">
                    {canDownloadConverted ? (
                      <textarea
                        value={editedText ?? extractEditableTextFromHtml(convertedHtml)}
                        onChange={(e) => setEditedText(e.target.value)}
                        className="h-full w-full rounded-lg border border-slate-200 bg-slate-900 p-4 font-mono text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        placeholder="Edit extracted text here (one line per text fragment)..."
                        spellCheck="false"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">
                        Convert a PDF first, then edit the extracted text.
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      <style jsx global>{`
        .react-pdf__Page__textContent {
          position: absolute;
          inset: 0;
          transform-origin: 0 0;
          z-index: 2;
          line-height: 1;
          white-space: pre;
          color: transparent;
          user-select: text;
          pointer-events: none;
        }

        .react-pdf__Page__textContent span {
          position: absolute;
          transform-origin: 0 0;
          pointer-events: auto;
        }

        .react-pdf__Page__annotations {
          position: absolute;
          inset: 0;
          z-index: 3;
        }
      `}</style>
    </div>
  );
}
