import type { TranslateChunk } from './types';

const DEFAULT_MAX_CHARS = 1900;

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

export function splitTextIntoChunks(text: string, maxChars = DEFAULT_MAX_CHARS): TranslateChunk[] {
  if (isBlank(text)) {
    return [];
  }

  if (text.length <= maxChars) {
    return [{ text }];
  }

  const chunks: TranslateChunk[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    if (end < text.length) {
      const candidate = text.slice(start, end);
      const splitAt = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\n'));

      // Prefer boundary split only when it does not create tiny fragments.
      if (splitAt > maxChars / 2) {
        end = start + splitAt + 1;
      }
    }

    const chunkText = text.slice(start, end);
    if (chunkText.length > 0) {
      chunks.push({ text: chunkText });
    }
    start = end;
  }

  return chunks;
}
