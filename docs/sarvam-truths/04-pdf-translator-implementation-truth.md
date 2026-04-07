# PDF Translator Implementation Truth (Sarvam)

## Objective

Build a PDF translator that:
- Accepts PDF upload
- Translates source text into selected target language
- Preserves original layout and images

## Confirmed API Strategy

1. Use Document Intelligence as the primary extraction and layout-preserving layer.
2. Use HTML output when preserving layout is the top priority.
3. Use text translation endpoint for segments needing explicit language conversion control.
4. Recompose translated text into the extracted structural representation without touching embedded images.

## Canonical Flow

1. Create doc job: `POST /doc-digitization/job/v1`
2. Get upload URL: `POST /doc-digitization/job/v1/upload-files`
3. Upload original PDF to pre-signed URL
4. Start processing: `POST /doc-digitization/job/v1/:job_id/start`
5. Poll status: `GET /doc-digitization/job/v1/:job_id/status`
6. Download processed outputs: `POST /doc-digitization/job/v1/:job_id/download-files`
7. Parse HTML/JSON blocks and translate text nodes via `POST /translate`
8. Reinject translated text into same structure (keep geometry/style/image refs untouched)
9. Render final translated PDF from preserved layout representation

## Why HTML Output

- Better layout fidelity than plain markdown
- Keeps block boundaries and ordering useful for deterministic text replacement
- Preserves image placement references in document structure

## Key Limits and Guardrails

- Input size limit: 200 MB
- Page limit: around 10 pages/job
- Translation model choice:
	- `mayura:v1`: stronger style controls (`mode`, `output_script`)
	- `sarvam-translate:v1`: broader Indic language coverage
- Keep API key in env var and send `api-subscription-key` header

## Minimal Data Model for App Layer

- `UploadJob`: `{ id, sourceFileName, sourceLang, targetLang, status }`
- `LayoutBlock`: `{ id, page, bbox, style, text, imageRef }`
- `TranslationUnit`: `{ blockId, sourceText, translatedText, model, confidence }`
- `RenderArtifact`: `{ htmlPath, translatedHtmlPath, outputPdfPath }`

## Non-Negotiable Invariants

- Never modify image bytes
- Never alter block coordinates unless overflow handling is explicitly enabled
- Keep page count and page order identical to source
- Preserve heading/table/list structure in translated output

## Overflow Handling (Practical)

- Indic target text can expand/shrink relative to source.
- Add deterministic fallback policy:
	- First: reduce font size within safe threshold
	- Second: tighten line-height slightly
	- Third: soft-wrap within same block bounds
	- Final: flag block as overflow warning for manual review

## Recommended MVP Phases

1. OCR + extraction pipeline with job lifecycle UI
2. Text-node translation + HTML structure reinjection
3. PDF renderer with layout-diff checker
4. Batch mode + retry/backoff + webhook completion path

## Source Docs

- https://docs.sarvam.ai/api-reference-docs/document-intelligence
- https://docs.sarvam.ai/api-reference-docs/document-intelligence/get-upload-links
- https://docs.sarvam.ai/api-reference-docs/document-intelligence/start
- https://docs.sarvam.ai/api-reference-docs/document-intelligence/get-status
- https://docs.sarvam.ai/api-reference-docs/document-intelligence/get-download-links
- https://docs.sarvam.ai/api-reference-docs/text/translate-text
- https://docs.sarvam.ai/api-reference-docs/text/identify-language
- https://docs.sarvam.ai/api-reference-docs/text/transliterate-text
