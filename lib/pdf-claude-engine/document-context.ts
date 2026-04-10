import type { DocumentContext, TranslationBlock } from './types';

interface IndexedBlock {
  pageNumber: number;
  block: TranslationBlock;
}

const MAX_GLOSSARY_TERMS = 80;
const MAX_REPEATED_SEGMENTS = 120;

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function collectGlossaryTerms(blocks: IndexedBlock[]): string[] {
  const termScores = new Map<string, number>();

  for (const { block } of blocks) {
    const text = cleanText(block.text);
    if (!text) {
      continue;
    }

    const acronymMatches = text.match(/\b[A-Z][A-Z0-9-]{1,24}\b/g) ?? [];
    const titleCaseMatches = text.match(/\b(?:[A-Z][a-z]+\s){1,4}[A-Z][a-z]+\b/g) ?? [];
    const identifierMatches = text.match(/\b[A-Za-z]{2,}[\/_-][A-Za-z0-9\/_-]{2,}\b/g) ?? [];

    for (const candidate of [...acronymMatches, ...titleCaseMatches, ...identifierMatches]) {
      const term = cleanText(candidate);
      if (term.length < 2 || term.length > 60) {
        continue;
      }

      const nextScore = (termScores.get(term) ?? 0) + 1;
      termScores.set(term, nextScore);
    }
  }

  return Array.from(termScores.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_GLOSSARY_TERMS)
    .map(([term]) => term);
}

function collectRepeatedSegments(blocks: IndexedBlock[]): string[] {
  const segmentFrequency = new Map<string, number>();

  for (const { block } of blocks) {
    const normalized = cleanText(block.text);
    if (normalized.length < 8 || normalized.length > 180) {
      continue;
    }

    const nextCount = (segmentFrequency.get(normalized) ?? 0) + 1;
    segmentFrequency.set(normalized, nextCount);
  }

  return Array.from(segmentFrequency.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_REPEATED_SEGMENTS)
    .map(([segment]) => segment);
}

export function buildDocumentContext(blocks: IndexedBlock[], targetLanguage: string): DocumentContext {
  const glossary = collectGlossaryTerms(blocks);
  const repeatedSegments = collectRepeatedSegments(blocks);

  return {
    targetLanguage,
    glossary,
    repeatedSegments,
    styleHints: [
      'Preserve legal and technical fidelity.',
      'Keep list numbering and punctuation coherent.',
      'Keep defined terms and abbreviations consistent across the full document.',
    ],
  };
}
