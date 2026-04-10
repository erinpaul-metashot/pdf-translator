import type { QualityIssue } from './types';

const NUMERIC_TOKEN_REGEX = /[-+]?\d[\d,]*(?:\.\d+)?%?/g;

function normalizeNumericToken(token: string): string {
  return token.replace(/,/g, '').trim();
}

function extractNumericTokens(text: string): string[] {
  const matches = text.match(NUMERIC_TOKEN_REGEX) ?? [];
  return matches.map(normalizeNumericToken).filter(Boolean).sort();
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

export function getNumericFidelityIssue(
  pageNumber: number,
  blockId: string,
  sourceText: string,
  translatedText: string
): QualityIssue | null {
  const sourceNumbers = extractNumericTokens(sourceText);
  if (sourceNumbers.length === 0) {
    return null;
  }

  const translatedNumbers = extractNumericTokens(translatedText);
  if (arraysEqual(sourceNumbers, translatedNumbers)) {
    return null;
  }

  return {
    pageNumber,
    blockId,
    type: 'numeric-mismatch',
    message: `Numeric mismatch for ${blockId}. Source [${sourceNumbers.join(', ')}], translated [${translatedNumbers.join(', ')}].`,
  };
}
