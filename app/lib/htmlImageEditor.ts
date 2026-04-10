export type EditableImageAsset = {
  id: string;
  kind: 'img' | 'svg-image';
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
  zIndex: number;
  isHidden: boolean;
  label: string;
};

export type EditableImagePatch = Partial<{
  left: number;
  top: number;
  width: number;
  height: number;
  zIndex: number;
  src: string;
  hidden: boolean;
}>;

export type PreparedImageDesignPage = {
  designHtml: string;
  assets: EditableImageAsset[];
  pageWidth: number;
  pageHeight: number;
};

export type DuplicateCroppedAssetResult = {
  html: string;
  newAssetId: string | null;
};

type MatrixTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

const IDENTITY_MATRIX: MatrixTransform = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

const DEFAULT_PAGE_WIDTH = 920;
const DEFAULT_PAGE_HEIGHT = 1300;

const ABSOLUTE_UNIT_TO_PX: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};

function parsePixelValue(value: string | null | undefined): number | null {
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

  const rawUnit = match[2]?.toLowerCase() ?? '';
  if (!rawUnit) {
    return numeric;
  }

  if (rawUnit in ABSOLUTE_UNIT_TO_PX) {
    return numeric * ABSOLUTE_UNIT_TO_PX[rawUnit];
  }

  return null;
}

function parseStyleNumber(styleValue: string, propertyName: string): number | null {
  const escapedPropertyName = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|;)\\s*${escapedPropertyName}\\s*:\\s*([-+]?\\d*\\.?\\d+)([a-z%]*)\\s*(?:;|$)`, 'i');
  const match = styleValue.match(pattern);
  if (!match) {
    return null;
  }

  return parsePixelValue(`${match[1]}${match[2] ?? ''}`);
}

function parseStyleProperty(styleValue: string, propertyName: string): string | null {
  const escapedPropertyName = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|;)\\s*${escapedPropertyName}\\s*:\\s*([^;]+?)\\s*(?:;|$)`, 'i');
  const match = styleValue.match(pattern);
  if (!match) {
    return null;
  }

  const value = match[1]?.trim();
  return value || null;
}

function isDesignHiddenElement(node: Element): boolean {
  return node.getAttribute('data-design-hidden') === 'true';
}

function parseMatrixTransform(value: string | null | undefined): MatrixTransform | null {
  if (!value) {
    return null;
  }

  const match = value.trim().match(/^matrix\(([^)]+)\)$/i);
  if (!match) {
    return null;
  }

  const parts = match[1]
    .split(',')
    .map((part) => Number.parseFloat(part.trim()));

  if (parts.length !== 6 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [a, b, c, d, e, f] = parts;
  return { a, b, c, d, e, f };
}

function formatMatrixTransform(matrix: MatrixTransform): string {
  return `matrix(${matrix.a},${matrix.b},${matrix.c},${matrix.d},${matrix.e},${matrix.f})`;
}

function multiplyMatrices(left: MatrixTransform, right: MatrixTransform): MatrixTransform {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function applyMatrixToPoint(matrix: MatrixTransform, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

function invertMatrix(matrix: MatrixTransform): MatrixTransform | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) {
    return null;
  }

  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

function readNodeMatrix(node: Element): MatrixTransform | null {
  const styleTransform = node instanceof HTMLElement || node instanceof SVGElement
    ? parseMatrixTransform((node as HTMLElement | SVGElement).style.transform)
    : null;
  if (styleTransform) {
    return styleTransform;
  }

  const styleAttrTransform = parseMatrixTransform(parseStyleProperty(node.getAttribute('style') ?? '', 'transform'));
  if (styleAttrTransform) {
    return styleAttrTransform;
  }

  return parseMatrixTransform(node.getAttribute('transform'));
}

function getAncestorMatrix(element: Element, stopAt: Element): MatrixTransform | null {
  const chain: MatrixTransform[] = [];
  let cursor = element.parentElement;

  while (cursor && cursor !== stopAt) {
    const matrix = readNodeMatrix(cursor);
    if (matrix) {
      chain.push(matrix);
    }

    cursor = cursor.parentElement;
  }

  if (chain.length === 0) {
    return null;
  }

  let combined = IDENTITY_MATRIX;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    combined = multiplyMatrices(combined, chain[index]);
  }

  return combined;
}

function getAssetRectFromMatrix(
  left: number,
  top: number,
  width: number,
  height: number,
  matrix: MatrixTransform | null
): { left: number; top: number; width: number; height: number } {
  if (!matrix) {
    return { left, top, width, height };
  }

  const topLeft = applyMatrixToPoint(matrix, left, top);
  const topRight = applyMatrixToPoint(matrix, left + width, top);
  const bottomLeft = applyMatrixToPoint(matrix, left, top + height);
  const bottomRight = applyMatrixToPoint(matrix, left + width, top + height);

  const minX = Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);

  return {
    left: minX,
    top: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function normalizePatchForAncestorMatrix(
  patch: EditableImagePatch,
  ancestorMatrix: MatrixTransform | null
): EditableImagePatch {
  if (!ancestorMatrix) {
    return patch;
  }

  const normalizedPatch: EditableImagePatch = { ...patch };
  const inverse = invertMatrix(ancestorMatrix);

  if (
    inverse &&
    typeof patch.left === 'number' &&
    Number.isFinite(patch.left) &&
    typeof patch.top === 'number' &&
    Number.isFinite(patch.top)
  ) {
    const normalizedPoint = applyMatrixToPoint(inverse, patch.left, patch.top);
    normalizedPatch.left = normalizedPoint.x;
    normalizedPatch.top = normalizedPoint.y;
  }

  const ancestorScaleX = getScaleX(ancestorMatrix);
  const ancestorScaleY = getScaleY(ancestorMatrix);

  if (typeof patch.width === 'number' && Number.isFinite(patch.width)) {
    normalizedPatch.width = patch.width / ancestorScaleX;
  }

  if (typeof patch.height === 'number' && Number.isFinite(patch.height)) {
    normalizedPatch.height = patch.height / ancestorScaleY;
  }

  return normalizedPatch;
}

function getScaleX(matrix: MatrixTransform | null): number {
  if (!matrix) {
    return 1;
  }

  const scale = Math.hypot(matrix.a, matrix.b);
  return scale > 0 ? scale : 1;
}

function getScaleY(matrix: MatrixTransform | null): number {
  if (!matrix) {
    return 1;
  }

  const scale = Math.hypot(matrix.c, matrix.d);
  return scale > 0 ? scale : 1;
}

function readElementStyleMatrix(element: HTMLElement, styleValue: string): MatrixTransform | null {
  return (
    parseMatrixTransform(element.style.transform) ??
    parseMatrixTransform(parseStyleProperty(styleValue, 'transform'))
  );
}

function getBaseLeft(styleValue: string, leftStyle: string): number {
  return parseStyleNumber(styleValue, 'left') ?? parsePixelValue(leftStyle) ?? 0;
}

function getBaseTop(styleValue: string, topStyle: string): number {
  return parseStyleNumber(styleValue, 'top') ?? parsePixelValue(topStyle) ?? 0;
}

function applyMatrixGeometryToHtmlImage(
  image: HTMLImageElement,
  patch: EditableImagePatch,
  styleValue: string,
  matrix: MatrixTransform | null
): void {
  const baseLeft = getBaseLeft(styleValue, image.style.left);
  const baseTop = getBaseTop(styleValue, image.style.top);
  const scaleX = getScaleX(matrix);
  const scaleY = getScaleY(matrix);

  if (matrix && ((typeof patch.left === 'number' && Number.isFinite(patch.left)) || (typeof patch.top === 'number' && Number.isFinite(patch.top)))) {
    const nextMatrix: MatrixTransform = {
      ...matrix,
      e: typeof patch.left === 'number' && Number.isFinite(patch.left) ? patch.left - baseLeft : matrix.e,
      f: typeof patch.top === 'number' && Number.isFinite(patch.top) ? patch.top - baseTop : matrix.f,
    };
    image.style.transform = formatMatrixTransform(nextMatrix);
  } else {
    if (typeof patch.left === 'number' && Number.isFinite(patch.left)) {
      image.style.left = `${patch.left}px`;
      image.style.position = image.style.position || 'absolute';
    }

    if (typeof patch.top === 'number' && Number.isFinite(patch.top)) {
      image.style.top = `${patch.top}px`;
      image.style.position = image.style.position || 'absolute';
    }
  }

  if (typeof patch.width === 'number' && Number.isFinite(patch.width)) {
    image.style.width = `${Math.max(1, patch.width / scaleX)}px`;
  }

  if (typeof patch.height === 'number' && Number.isFinite(patch.height)) {
    image.style.height = `${Math.max(1, patch.height / scaleY)}px`;
  }
}

function applyMatrixGeometryToSvgImage(
  svgImage: Element,
  patch: EditableImagePatch,
  styleValue: string,
  matrix: MatrixTransform | null,
  matrixSource: 'style' | 'attr' | null
): void {
  const baseLeft = parseStyleNumber(styleValue, 'left') ?? parsePixelValue(svgImage.getAttribute('x')) ?? 0;
  const baseTop = parseStyleNumber(styleValue, 'top') ?? parsePixelValue(svgImage.getAttribute('y')) ?? 0;
  const scaleX = getScaleX(matrix);
  const scaleY = getScaleY(matrix);

  if (matrix && ((typeof patch.left === 'number' && Number.isFinite(patch.left)) || (typeof patch.top === 'number' && Number.isFinite(patch.top)))) {
    const nextMatrix: MatrixTransform = {
      ...matrix,
      e: typeof patch.left === 'number' && Number.isFinite(patch.left) ? patch.left - baseLeft : matrix.e,
      f: typeof patch.top === 'number' && Number.isFinite(patch.top) ? patch.top - baseTop : matrix.f,
    };

    if (matrixSource === 'attr') {
      svgImage.setAttribute('transform', formatMatrixTransform(nextMatrix));
    } else {
      (svgImage as SVGElement).style.transform = formatMatrixTransform(nextMatrix);
    }
  } else {
    if (typeof patch.left === 'number' && Number.isFinite(patch.left)) {
      svgImage.setAttribute('x', `${patch.left}`);
    }

    if (typeof patch.top === 'number' && Number.isFinite(patch.top)) {
      svgImage.setAttribute('y', `${patch.top}`);
    }
  }

  if (typeof patch.width === 'number' && Number.isFinite(patch.width)) {
    svgImage.setAttribute('width', `${Math.max(1, patch.width / scaleX)}`);
  }

  if (typeof patch.height === 'number' && Number.isFinite(patch.height)) {
    svgImage.setAttribute('height', `${Math.max(1, patch.height / scaleY)}`);
  }
}

function parseViewBoxDimension(value: string | null, index: number): number | null {
  if (!value) {
    return null;
  }

  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part))
    .filter((part) => Number.isFinite(part));

  if (parts.length < 4) {
    return null;
  }

  const dimension = parts[index];
  return dimension > 0 ? dimension : null;
}

function normalizeSafeImageSrc(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  if (/^data:image\//i.test(trimmed)) {
    const commaIndex = trimmed.indexOf(',');
    if (commaIndex < 0) {
      return trimmed;
    }

    const prefix = trimmed.slice(0, commaIndex + 1);
    const payload = trimmed.slice(commaIndex + 1).replace(/\s+/g, '');
    return `${prefix}${payload}`;
  }

  if (/^blob:/i.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

  let index = 2;
  while (index + 8 < bytes.length) {
    if (bytes[index] !== 0xff) {
      index += 1;
      continue;
    }

    const marker = bytes[index + 1];
    index += 2;

    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }

    if (index + 1 >= bytes.length) {
      return null;
    }

    const segmentLength = (bytes[index] << 8) + bytes[index + 1];
    if (!Number.isFinite(segmentLength) || segmentLength < 2) {
      return null;
    }

    if (sofMarkers.has(marker)) {
      if (index + 7 >= bytes.length) {
        return null;
      }

      const height = (bytes[index + 3] << 8) + bytes[index + 4];
      const width = (bytes[index + 5] << 8) + bytes[index + 6];

      if (width > 0 && height > 0) {
        return { width, height };
      }

      return null;
    }

    index += segmentLength;
  }

  return null;
}

function getIntrinsicImageDimensions(src: string): { width: number; height: number } | null {
  if (!/^data:image\//i.test(src)) {
    return null;
  }

  const commaIndex = src.indexOf(',');
  if (commaIndex < 0) {
    return null;
  }

  const payload = src.slice(commaIndex + 1).replace(/\s+/g, '');
  if (!payload) {
    return null;
  }

  let binary: string;
  try {
    binary = atob(payload);
  } catch {
    return null;
  }

  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytes.length < 10) {
    return null;
  }

  // PNG signature
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const width =
      (bytes[16] << 24) |
      (bytes[17] << 16) |
      (bytes[18] << 8) |
      bytes[19];
    const height =
      (bytes[20] << 24) |
      (bytes[21] << 16) |
      (bytes[22] << 8) |
      bytes[23];

    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  // GIF header
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  return parseJpegDimensions(bytes);
}

function ensureAssetIds(images: HTMLImageElement[]): void {
  images.forEach((image, index) => {
    if (!image.dataset.assetId) {
      image.dataset.assetId = `asset-img-${index + 1}`;
    }
  });
}

function ensureSvgImageAssetIds(svgImages: Element[], startIndex: number): void {
  svgImages.forEach((svgImage, index) => {
    if (!svgImage.getAttribute('data-asset-id')) {
      svgImage.setAttribute('data-asset-id', `asset-svg-${startIndex + index + 1}`);
    }
  });
}

function isLikelyPageRoot(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.hasAttribute('data-page')) {
    return true;
  }

  if (element.classList.contains('document-page') || element.classList.contains('pdf-page')) {
    return true;
  }

  return false;
}

function getEditablePageRoot(container: HTMLElement): HTMLElement | null {
  const explicitDesignRoot = container.querySelector<HTMLElement>('[data-design-page-root="true"]');
  if (explicitDesignRoot) {
    return explicitDesignRoot;
  }

  if (container.children.length === 1) {
    return container.firstElementChild as HTMLElement;
  }

  const directPageRoots = Array.from(container.children).filter(isLikelyPageRoot);
  if (directPageRoots.length > 0) {
    return directPageRoots[0];
  }

  const nestedPageRoot = container.querySelector<HTMLElement>('[data-page], .document-page, .pdf-page');
  if (nestedPageRoot) {
    return nestedPageRoot;
  }

  return container;
}

function getPositiveDimension(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

function getStructuredPageDimension(root: HTMLElement, dimension: 'width' | 'height'): number | null {
  const isWidth = dimension === 'width';
  const viewBoxIndex = isWidth ? 2 : 3;

  const candidateSvgs: SVGSVGElement[] = [];

  if (root instanceof SVGSVGElement) {
    candidateSvgs.push(root);
  }

  const nestedSvg = root.querySelector('svg');
  if (nestedSvg instanceof SVGSVGElement) {
    candidateSvgs.push(nestedSvg);
  }

  for (const svg of candidateSvgs) {
    const attrDimension = getPositiveDimension(parsePixelValue(svg.getAttribute(dimension)));
    if (attrDimension) {
      return attrDimension;
    }

    const viewBoxDimension = getPositiveDimension(parseViewBoxDimension(svg.getAttribute('viewBox'), viewBoxIndex));
    if (viewBoxDimension) {
      return viewBoxDimension;
    }
  }

  return null;
}

function parseDimensionsFromRoot(root: HTMLElement): { width: number; height: number } {
  const styleValue = root.getAttribute('style') ?? '';
  const styleWidth =
    getPositiveDimension(parseStyleNumber(styleValue, 'width')) ??
    getPositiveDimension(parsePixelValue(root.style.width));
  const styleHeight =
    getPositiveDimension(parseStyleNumber(styleValue, 'height')) ??
    getPositiveDimension(parsePixelValue(root.style.height));
  const attrWidth = getPositiveDimension(parsePixelValue(root.getAttribute('width')));
  const attrHeight = getPositiveDimension(parsePixelValue(root.getAttribute('height')));
  const structuredWidth = getStructuredPageDimension(root, 'width');
  const structuredHeight = getStructuredPageDimension(root, 'height');
  // Prefer structured dimensions (for example SVG viewBox/width/height) because
  // styled page width/height can be inflated by unit conversions and create dead space.
  const explicitWidth = structuredWidth ?? attrWidth ?? styleWidth ?? DEFAULT_PAGE_WIDTH;
  const explicitHeight = structuredHeight ?? attrHeight ?? styleHeight ?? DEFAULT_PAGE_HEIGHT;

  return {
    width: Math.max(300, Math.round(explicitWidth)),
    height: Math.max(300, Math.round(explicitHeight)),
  };
}

function parseAssetsFromRoot(root: HTMLElement): EditableImageAsset[] {
  const images = Array.from(root.querySelectorAll('img'));
  ensureAssetIds(images);
  const svgImages = Array.from(root.querySelectorAll('image'));
  ensureSvgImageAssetIds(svgImages, images.length);

  const rasterAssets = images
    .map((image, index) => {
      const src = normalizeSafeImageSrc(image.getAttribute('src') ?? '');
      if (!src) {
        return null;
      }

      const styleValue = image.getAttribute('style') ?? '';
      const intrinsicSize = getIntrinsicImageDimensions(src);
      const ownMatrix = readElementStyleMatrix(image, styleValue);
      const ancestorMatrix = getAncestorMatrix(image, root);
      const matrix = ancestorMatrix
        ? multiplyMatrices(ancestorMatrix, ownMatrix ?? IDENTITY_MATRIX)
        : ownMatrix;
      const baseLeft = getBaseLeft(styleValue, image.style.left);
      const baseTop = getBaseTop(styleValue, image.style.top);
      const baseWidth =
        parseStyleNumber(styleValue, 'width') ??
        parsePixelValue(image.style.width) ??
        parsePixelValue(image.getAttribute('width')) ??
        intrinsicSize?.width ??
        120;
      const baseHeight =
        parseStyleNumber(styleValue, 'height') ??
        parsePixelValue(image.style.height) ??
        parsePixelValue(image.getAttribute('height')) ??
        intrinsicSize?.height ??
        120;
      const rect = getAssetRectFromMatrix(baseLeft, baseTop, baseWidth, baseHeight, matrix);
      const zIndex =
        parseStyleNumber(styleValue, 'z-index') ??
        parsePixelValue(image.style.zIndex) ??
        1;
      const isHidden = isDesignHiddenElement(image);

      const label =
        image.getAttribute('alt')?.trim() ||
        image.getAttribute('title')?.trim() ||
        `Image ${index + 1}`;

      return {
        id: image.dataset.assetId ?? `asset-img-${index + 1}`,
        kind: 'img',
        src,
        left: rect.left,
        top: rect.top,
        width: Math.max(12, rect.width),
        height: Math.max(12, rect.height),
        zIndex,
        isHidden,
        label,
      } satisfies EditableImageAsset;
    })
    .filter((asset): asset is EditableImageAsset => Boolean(asset));

  const vectorAssets = svgImages
    .map((svgImage, index) => {
      const src = normalizeSafeImageSrc(
        svgImage.getAttribute('href') ??
        svgImage.getAttribute('xlink:href') ??
        svgImage.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
        ''
      );
      if (!src) {
        return null;
      }

      const styleValue = svgImage.getAttribute('style') ?? '';
      const intrinsicSize = getIntrinsicImageDimensions(src);
      const styleMatrix = parseMatrixTransform((svgImage as SVGElement).style.transform) ?? parseMatrixTransform(parseStyleProperty(styleValue, 'transform'));
      const attrMatrix = parseMatrixTransform(svgImage.getAttribute('transform'));
      const ownMatrix = styleMatrix ?? attrMatrix;
      const ancestorMatrix = getAncestorMatrix(svgImage, root);
      const matrix = ancestorMatrix
        ? multiplyMatrices(ancestorMatrix, ownMatrix ?? IDENTITY_MATRIX)
        : ownMatrix;
      const baseLeft =
        parseStyleNumber(styleValue, 'left') ??
        parsePixelValue(svgImage.getAttribute('x')) ??
        0;
      const baseTop =
        parseStyleNumber(styleValue, 'top') ??
        parsePixelValue(svgImage.getAttribute('y')) ??
        0;
      const baseWidth =
        parseStyleNumber(styleValue, 'width') ??
        parsePixelValue(svgImage.getAttribute('width')) ??
        intrinsicSize?.width ??
        120;
      const baseHeight =
        parseStyleNumber(styleValue, 'height') ??
        parsePixelValue(svgImage.getAttribute('height')) ??
        intrinsicSize?.height ??
        120;
      const rect = getAssetRectFromMatrix(baseLeft, baseTop, baseWidth, baseHeight, matrix);
      const zIndex =
        parseStyleNumber(styleValue, 'z-index') ??
        parsePixelValue((svgImage as SVGElement).style.zIndex) ??
        parsePixelValue(svgImage.getAttribute('data-design-z-index')) ??
        1;
      const isHidden = isDesignHiddenElement(svgImage);

      const label =
        svgImage.getAttribute('title')?.trim() ||
        `SVG Image ${index + 1}`;

      return {
        id: svgImage.getAttribute('data-asset-id') ?? `asset-svg-${index + 1}`,
        kind: 'svg-image',
        src,
        left: rect.left,
        top: rect.top,
        width: Math.max(12, rect.width),
        height: Math.max(12, rect.height),
        zIndex,
        isHidden,
        label,
      } satisfies EditableImageAsset;
    })
    .filter((asset): asset is EditableImageAsset => Boolean(asset));

  return [...rasterAssets, ...vectorAssets];
}

export function prepareImageDesignPage(html: string): PreparedImageDesignPage {
  const doc = new DOMParser().parseFromString(`<div id="design-root">${html}</div>`, 'text/html');
  const container = doc.getElementById('design-root');

  if (!container) {
    return {
      designHtml: html,
      assets: [],
      pageWidth: DEFAULT_PAGE_WIDTH,
      pageHeight: DEFAULT_PAGE_HEIGHT,
    };
  }

  const pageRoot = getEditablePageRoot(container);
  if (!pageRoot) {
    return {
      designHtml: html,
      assets: [],
      pageWidth: DEFAULT_PAGE_WIDTH,
      pageHeight: DEFAULT_PAGE_HEIGHT,
    };
  }

  const assets = parseAssetsFromRoot(pageRoot);
  const dimensions = parseDimensionsFromRoot(pageRoot);

  pageRoot.dataset.designPageRoot = 'true';
  pageRoot.style.position = pageRoot.style.position || 'relative';
  pageRoot.style.margin = '0';
  pageRoot.style.width = `${dimensions.width}px`;
  pageRoot.style.height = `${dimensions.height}px`;

  for (const image of Array.from(pageRoot.querySelectorAll('img'))) {
    if (!image.dataset.assetId) {
      continue;
    }

    image.dataset.designMuted = 'true';
  }

  for (const svgImage of Array.from(pageRoot.querySelectorAll('image'))) {
    if (!svgImage.getAttribute('data-asset-id')) {
      continue;
    }

    svgImage.setAttribute('data-design-muted', 'true');
  }

  const styleMarkup = Array.from(container.querySelectorAll('style'))
    .map((styleElement) => styleElement.outerHTML)
    .join('');
  const pageMarkup = pageRoot.outerHTML;

  return {
    designHtml: `${styleMarkup}${pageMarkup}`,
    assets,
    pageWidth: dimensions.width,
    pageHeight: dimensions.height,
  };
}

function createUniqueAssetId(existingAssetIds: Set<string>, basePrefix: string): string {
  let nextIndex = 1;
  let candidate = `${basePrefix}-${nextIndex}`;

  while (existingAssetIds.has(candidate)) {
    nextIndex += 1;
    candidate = `${basePrefix}-${nextIndex}`;
  }

  return candidate;
}

function hideImageNodeForDesign(node: HTMLImageElement | SVGImageElement): void {
  const previousDisplay = node.style.display.trim();
  if (previousDisplay) {
    node.setAttribute('data-design-display-before-hide', previousDisplay);
  } else {
    node.removeAttribute('data-design-display-before-hide');
  }

  node.setAttribute('data-design-hidden', 'true');
  node.style.display = 'none';
}

function clearDesignHidden(node: HTMLImageElement | SVGImageElement): void {
  node.removeAttribute('data-design-hidden');
  node.removeAttribute('data-design-display-before-hide');
  node.style.removeProperty('display');
}

export function duplicateCroppedAssetInHtml(
  html: string,
  sourceAssetId: string,
  croppedSrc: string
): DuplicateCroppedAssetResult {
  const safeSrc = normalizeSafeImageSrc(croppedSrc);
  if (!safeSrc) {
    return {
      html,
      newAssetId: null,
    };
  }

  const doc = new DOMParser().parseFromString(`<div id="crop-duplicate-root">${html}</div>`, 'text/html');
  const container = doc.getElementById('crop-duplicate-root');
  if (!container) {
    return {
      html,
      newAssetId: null,
    };
  }

  const pageRoot = getEditablePageRoot(container);
  if (!pageRoot) {
    return {
      html,
      newAssetId: null,
    };
  }

  const images = Array.from(pageRoot.querySelectorAll('img'));
  ensureAssetIds(images);
  const svgImages = Array.from(pageRoot.querySelectorAll('image'));
  ensureSvgImageAssetIds(svgImages, images.length);

  const existingAssetIds = new Set<string>();
  images.forEach((image) => {
    if (image.dataset.assetId) {
      existingAssetIds.add(image.dataset.assetId);
    }
  });
  svgImages.forEach((svgImage) => {
    const id = svgImage.getAttribute('data-asset-id');
    if (id) {
      existingAssetIds.add(id);
    }
  });

  const sourceRaster = images.find((image) => image.dataset.assetId === sourceAssetId) ?? null;
  if (sourceRaster) {
    const nextAssetId = createUniqueAssetId(existingAssetIds, 'asset-img-crop');
    const clone = sourceRaster.cloneNode(true) as HTMLImageElement;

    clone.removeAttribute('id');
    clone.dataset.assetId = nextAssetId;
    clone.setAttribute('src', safeSrc);
    clearDesignHidden(clone);

    const sourceAlt = sourceRaster.getAttribute('alt')?.trim() ?? '';
    clone.setAttribute('alt', sourceAlt ? `${sourceAlt} (cropped)` : 'Cropped image');

    hideImageNodeForDesign(sourceRaster);
    sourceRaster.parentNode?.insertBefore(clone, sourceRaster.nextSibling);

    return {
      html: container.innerHTML,
      newAssetId: nextAssetId,
    };
  }

  const sourceSvg = svgImages.find((svgImage) => svgImage.getAttribute('data-asset-id') === sourceAssetId) ?? null;
  if (!sourceSvg) {
    return {
      html,
      newAssetId: null,
    };
  }

  const nextAssetId = createUniqueAssetId(existingAssetIds, 'asset-svg-crop');
  const clone = sourceSvg.cloneNode(true) as SVGImageElement;

  clone.removeAttribute('id');
  clone.setAttribute('data-asset-id', nextAssetId);
  clone.setAttribute('href', safeSrc);
  clone.setAttribute('xlink:href', safeSrc);
  clearDesignHidden(clone);

  hideImageNodeForDesign(sourceSvg as SVGImageElement);
  sourceSvg.parentNode?.insertBefore(clone, sourceSvg.nextSibling);

  return {
    html: container.innerHTML,
    newAssetId: nextAssetId,
  };
}

export function removeAssetFromHtml(html: string, assetId: string): string {
  if (!assetId.trim()) {
    return html;
  }

  const doc = new DOMParser().parseFromString(`<div id="remove-asset-root">${html}</div>`, 'text/html');
  const container = doc.getElementById('remove-asset-root');
  if (!container) {
    return html;
  }

  const pageRoot = getEditablePageRoot(container);
  if (!pageRoot) {
    return html;
  }

  const images = Array.from(pageRoot.querySelectorAll('img'));
  ensureAssetIds(images);
  const svgImages = Array.from(pageRoot.querySelectorAll('image'));
  ensureSvgImageAssetIds(svgImages, images.length);

  let removed = false;

  images.forEach((image) => {
    if (image.dataset.assetId === assetId) {
      image.remove();
      removed = true;
    }
  });

  svgImages.forEach((svgImage) => {
    if (svgImage.getAttribute('data-asset-id') === assetId) {
      svgImage.remove();
      removed = true;
    }
  });

  return removed ? container.innerHTML : html;
}

export function applyImagePatchesToHtml(html: string, patches: Record<string, EditableImagePatch>): string {
  const patchEntries = Object.entries(patches).filter(([, patch]) => Object.keys(patch).length > 0);
  if (patchEntries.length === 0) {
    return html;
  }

  const doc = new DOMParser().parseFromString(`<div id="patch-root">${html}</div>`, 'text/html');
  const container = doc.getElementById('patch-root');
  if (!container) {
    return html;
  }

  const pageRoot = getEditablePageRoot(container);
  if (!pageRoot) {
    return html;
  }

  const images = Array.from(pageRoot.querySelectorAll('img'));
  ensureAssetIds(images);
  const svgImages = Array.from(pageRoot.querySelectorAll('image'));
  ensureSvgImageAssetIds(svgImages, images.length);
  const svgParentsNeedingReorder = new Set<Element>();

  const getEffectiveDesignZIndex = (node: Element): number => {
    const styleValue = node.getAttribute('style') ?? '';
    return (
      parseStyleNumber(styleValue, 'z-index') ??
      parsePixelValue((node as SVGElement | HTMLElement).style.zIndex) ??
      parsePixelValue(node.getAttribute('data-design-z-index')) ??
      0
    );
  };

  for (const image of images) {
    const assetId = image.dataset.assetId;
    if (!assetId) {
      continue;
    }

    const patch = patches[assetId];
    if (!patch) {
      image.removeAttribute('data-design-muted');
      continue;
    }

    const styleValue = image.getAttribute('style') ?? '';
    const matrix = readElementStyleMatrix(image, styleValue);
    const ancestorMatrix = getAncestorMatrix(image, pageRoot);
    const normalizedPatch = normalizePatchForAncestorMatrix(patch, ancestorMatrix);
    applyMatrixGeometryToHtmlImage(image, normalizedPatch, styleValue, matrix);

    if (typeof patch.zIndex === 'number' && Number.isFinite(patch.zIndex)) {
      image.style.zIndex = `${Math.round(patch.zIndex)}`;
    }

    if (typeof patch.src === 'string') {
      const safeSrc = normalizeSafeImageSrc(patch.src);
      if (safeSrc) {
        image.setAttribute('src', safeSrc);
      }
    }

    if (typeof patch.hidden === 'boolean') {
      if (patch.hidden) {
        const previousDisplay = image.style.display.trim();
        if (previousDisplay) {
          image.setAttribute('data-design-display-before-hide', previousDisplay);
        } else {
          image.removeAttribute('data-design-display-before-hide');
        }

        image.dataset.designHidden = 'true';
        image.style.display = 'none';
      } else {
        const previousDisplay = image.getAttribute('data-design-display-before-hide');
        image.removeAttribute('data-design-hidden');
        image.removeAttribute('data-design-display-before-hide');
        if (previousDisplay) {
          image.style.display = previousDisplay;
        } else {
          image.style.removeProperty('display');
        }
      }
    }

    image.removeAttribute('data-design-muted');
  }

  for (const svgImage of svgImages) {
    const assetId = svgImage.getAttribute('data-asset-id');
    if (!assetId) {
      continue;
    }

    const patch = patches[assetId];
    if (!patch) {
      svgImage.removeAttribute('data-design-muted');
      continue;
    }

    const styleValue = svgImage.getAttribute('style') ?? '';
    const styleMatrix = parseMatrixTransform((svgImage as SVGElement).style.transform) ?? parseMatrixTransform(parseStyleProperty(styleValue, 'transform'));
    const attrMatrix = parseMatrixTransform(svgImage.getAttribute('transform'));
    const matrix = styleMatrix ?? attrMatrix;
    const matrixSource: 'style' | 'attr' | null = styleMatrix ? 'style' : attrMatrix ? 'attr' : null;
    const ancestorMatrix = getAncestorMatrix(svgImage, pageRoot);
    const normalizedPatch = normalizePatchForAncestorMatrix(patch, ancestorMatrix);
    applyMatrixGeometryToSvgImage(svgImage, normalizedPatch, styleValue, matrix, matrixSource);

    if (typeof patch.zIndex === 'number' && Number.isFinite(patch.zIndex)) {
      const nextZIndex = `${Math.round(patch.zIndex)}`;
      (svgImage as SVGElement).style.zIndex = nextZIndex;
      svgImage.setAttribute('data-design-z-index', nextZIndex);

      if (svgImage.parentElement) {
        svgParentsNeedingReorder.add(svgImage.parentElement);
      }
    }

    if (typeof patch.src === 'string') {
      const safeSrc = normalizeSafeImageSrc(patch.src);
      if (safeSrc) {
        svgImage.setAttribute('href', safeSrc);
        svgImage.setAttribute('xlink:href', safeSrc);
      }
    }

    if (typeof patch.hidden === 'boolean') {
      if (patch.hidden) {
        const previousDisplay = (svgImage as SVGElement).style.display.trim();
        if (previousDisplay) {
          svgImage.setAttribute('data-design-display-before-hide', previousDisplay);
        } else {
          svgImage.removeAttribute('data-design-display-before-hide');
        }

        svgImage.setAttribute('data-design-hidden', 'true');
        (svgImage as SVGElement).style.display = 'none';
      } else {
        const previousDisplay = svgImage.getAttribute('data-design-display-before-hide');
        svgImage.removeAttribute('data-design-hidden');
        svgImage.removeAttribute('data-design-display-before-hide');
        if (previousDisplay) {
          (svgImage as SVGElement).style.display = previousDisplay;
        } else {
          (svgImage as SVGElement).style.removeProperty('display');
        }
      }
    }

    svgImage.removeAttribute('data-design-muted');
  }

  for (const parent of svgParentsNeedingReorder) {
    const ordered = Array.from(parent.children)
      .filter((child) => child.hasAttribute('data-asset-id'))
      .map((child, index) => ({
        child,
        index,
        zIndex: getEffectiveDesignZIndex(child),
      }))
      .sort((left, right) => left.zIndex - right.zIndex || left.index - right.index)
      .map((entry) => entry.child);

    ordered.forEach((child) => {
      parent.appendChild(child);
    });
  }

  return container.innerHTML;
}
