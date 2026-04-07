import type {
  MuPdfBufferLike,
  MuPdfDocumentWriterLike,
  MuPdfDeviceLike,
  MuPdfPageLike,
  MuPdfRuntime,
  NormalizedMuPdfPage,
} from './types';

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

const MATRIX_NUMBER_TOKEN = '[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?';

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

  let st: { destroy: () => void } | null = null;

  try {
    st = page.toStructuredText('preserve-images');

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
          };

          if (!mupdfImage.getPixmap) {
            return;
          }

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
              // Ignore image extraction failures for this block.
            }
          }
        } catch {
          // Ignore image extraction failures for this block.
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
        // Ignore cleanup errors.
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

  injected = injected.replace(/<image\s+([^>]*)\/?>(?=\s*(?:<|$))/g, (match) => {
    if (imageIndex < imageDataUris.size) {
      const dataUri = Array.from(imageDataUris.values())[imageIndex];
      imageIndex += 1;

      const attrsMatch = match.match(/<image\s+([^/>]*)/);
      const existingAttrs = attrsMatch?.[1] || '';

      return `<image ${existingAttrs} xlink:href="${dataUri}" />`;
    }

    return match;
  });

  return injected;
}

export function createTextFilteredVectorUnderlay(
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

  const dataUriMatches = svgMarkup.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi);
  if (!dataUriMatches) {
    return new Set();
  }

  return new Set(dataUriMatches.map((value) => normalizeDataImageUri(value)));
}

export function normalizeMuPdfPageHtml(
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

      if (hasKnownBlueBoxVectors(vectorUnderlaySvg)) {
        const remainingOverlayImages = Array.from(pageRoot.querySelectorAll('img'));

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
