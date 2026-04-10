import type { SegmentedPage, TranslationBlock } from './types';

const STYLE_OR_SCRIPT_BLOCK_REGEX = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TEXT_BETWEEN_TAGS_REGEX = />([^<>]+)</g;

function isTranslatableText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  return /\p{L}/u.test(trimmed);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createNoncePrefix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function withoutStylesAndScripts(
  html: string,
  styleTokenPrefix: string
): { stripped: string; restore: (value: string) => string } {
  const preserved: string[] = [];

  const stripped = html.replace(STYLE_OR_SCRIPT_BLOCK_REGEX, (match) => {
    const token = `${styleTokenPrefix}${preserved.length}__`;
    preserved.push(match);
    return token;
  });

  return {
    stripped,
    restore: (value: string) => {
      let restored = value;
      preserved.forEach((block, index) => {
        restored = restored.replaceAll(`${styleTokenPrefix}${index}__`, block);
      });
      return restored;
    },
  };
}

export function segmentPageHtml(pageHtml: string): SegmentedPage {
  const noncePrefix = createNoncePrefix();
  const textPlaceholderPrefix = `__CLAUDE_BLOCK_${noncePrefix}_`;
  const styleTokenPrefix = `__CLAUDE_STYLE_${noncePrefix}_`;
  const { stripped, restore } = withoutStylesAndScripts(pageHtml, styleTokenPrefix);
  const blocks: TranslationBlock[] = [];

  let blockIndex = 0;
  const templated = stripped.replace(TEXT_BETWEEN_TAGS_REGEX, (fullMatch, rawText: string) => {
    if (!isTranslatableText(rawText)) {
      return fullMatch;
    }

    const leadingWhitespace = rawText.match(/^\s*/)?.[0] ?? '';
    const trailingWhitespace = rawText.match(/\s*$/)?.[0] ?? '';
    const trimmedText = rawText.trim();

    if (!trimmedText) {
      return fullMatch;
    }

    const id = `b${blockIndex}`;
    blockIndex += 1;

    blocks.push({
      id,
      text: trimmedText,
      leadingWhitespace,
      trailingWhitespace,
    });

    return `>${textPlaceholderPrefix}${id}__<`;
  });

  return {
    templatedHtml: restore(templated),
    blocks,
    placeholderPrefix: textPlaceholderPrefix,
  };
}

export function mergeTranslatedPage(segmented: SegmentedPage, translations: Record<string, string>): string {
  let merged = segmented.templatedHtml;

  segmented.blocks.forEach((block) => {
    const translated = translations[block.id];
    const resolvedText = typeof translated === 'string' && translated.trim()
      ? translated.trim()
      : block.text;

    const safeText = `${block.leadingWhitespace}${escapeHtml(resolvedText)}${block.trailingWhitespace}`;
    merged = merged.replaceAll(`${segmented.placeholderPrefix}${block.id}__`, safeText);
  });

  return merged;
}
