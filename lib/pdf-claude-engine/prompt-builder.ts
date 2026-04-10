import type { TranslateBatchRequest } from './types';

export function buildSystemPrompt(systemPrompt: string): string {
  const defaultSystemPrompt =
    'You are an expert multilingual PDF localization engine. Preserve meaning, formatting intent, and terminology consistency.';

  return systemPrompt.trim() || defaultSystemPrompt;
}

export function buildUserPrompt(request: TranslateBatchRequest): string {
  const nativeInsightsJson = JSON.stringify(request.documentContext?.nativeInsights ?? null);
  const documentContextJson = JSON.stringify(request.documentContext ?? null);
  const translationMemoryJson = JSON.stringify(request.translationMemory ?? []);
  const blocksJson = JSON.stringify(
    request.blocks.map((block) => ({ id: block.id, text: block.text }))
  );

  return [
    '<task>',
    'Translate the provided PDF text blocks.',
    '</task>',
    '<constraints>',
    `Target language: ${request.targetLanguage}`,
    '- Preserve legal, technical, and numeric fidelity.',
    '- Keep punctuation and list semantics natural for target language.',
    '- Respect document-level glossary and prior translation memory when present.',
    '- Do not omit any block.',
    '- Do not add commentary.',
    '- Return only strict JSON.',
    '</constraints>',
    '<document_context>',
    documentContextJson,
    '</document_context>',
    '<native_pdf_insights>',
    nativeInsightsJson,
    '</native_pdf_insights>',
    '<translation_memory>',
    translationMemoryJson,
    '</translation_memory>',
    '<translation_prompt>',
    request.prompt.translationPrompt,
    '</translation_prompt>',
    '<output_schema>',
    '{"translations":[{"id":"b0","text":"..."}]}',
    '</output_schema>',
    `<page_number>${request.pageNumber}</page_number>`,
    '<blocks>',
    blocksJson,
    '</blocks>',
  ].join('\n');
}

export function buildDocumentAnalysisPrompt(targetLanguage: string, translationPrompt: string): string {
  return [
    '<task>',
    'Analyze this PDF for translation guidance before block-level translation.',
    '</task>',
    '<goal>',
    `Target language: ${targetLanguage}`,
    '- Infer terminology, recurring phrases, and stylistic conventions from full document context.',
    '- Identify layout-sensitive content that must preserve structure and numbering.',
    '- Return strict JSON only.',
    '</goal>',
    '<translation_prompt>',
    translationPrompt,
    '</translation_prompt>',
    '<output_schema>',
    '{"summary":"...","glossary":["..."],"styleGuidance":["..."],"layoutNotes":["..."]}',
    '</output_schema>',
  ].join('\n');
}
