# Claude PDF Translation Engine

## Overview

The Claude PDF Translation Engine is the document translation pipeline used by the `pdf-claude` workflow in this project.

It translates PDF content while preserving layout intent by:

1. Converting a source PDF into portable HTML pages.
2. Segmenting each page into translatable text blocks.
3. Sending batched blocks to Anthropic Claude.
4. Reassembling translated blocks back into page HTML.
5. Reconstructing translated pages into a printable/downloadable document.

## What It Does

### Core capabilities

- Preserves page structure through HTML placeholder templating.
- Supports prompt-guided translation with editable system and translation prompts.
- Supports model selection (`claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-6`).
- Uses batch translation for performance and token control.
- Provides document context (glossary, repeated segments, style hints) in integrated mode.
- Maintains translation memory across blocks/pages for consistency.
- Performs quality checks for numeric fidelity and consistency overrides.
- Returns usage, cost estimate, warnings, and per-page metrics.
- Supports partial success behavior (translated output can still be produced with warnings).

### Runtime safeguards

- API key is required in request header (`x-claude-api-key`).
- In-memory rate limiting per client fingerprint:
  - Window: 60 seconds
  - Max requests: 8
- Input limits:
  - Max pages per request: 12
  - Max characters per page: 300000
  - Max total characters: 1500000
  - Max prompt length (each prompt): 6000 characters

## High-Level Architecture

### Client workflow (`app/pdf-claude`)

- `useClaudePdfWorkflow` handles state transitions:
  - `idle -> sourceReady -> converting -> translating -> translatedReady`
- Reads Claude API key from browser local storage (`pdfTranslator.apiKeys.v1`).
- Converts uploaded PDF to HTML pages using the PDF-to-HTML engine.
- Calls `POST /api/pdf-claude/translate` with pages, target language, prompt, and engine settings.
- Rebuilds translated pages into a portable HTML document for preview/edit/print.

### Server translation route (`app/api/pdf-claude/translate/route.ts`)

- Validates input, enforces limits, and applies safe option clamping.
- Calls `translatePdfPagesWithClaude` from `lib/pdf-claude-engine`.
- Aggregates metrics and returns:
  - `translatedPages`
  - `pageMetrics`
  - `warnings`
  - `usage`
  - `cost`
  - `quality`
  - `summary`
  - `provider`

### Engine modules (`lib/pdf-claude-engine`)

- `block-segmentation.ts`
  - Extracts translatable text between HTML tags.
  - Preserves style/script blocks.
  - Replaces block text with placeholders and restores translated text safely (HTML escaped).
- `document-context.ts`
  - Builds glossary terms and repeated segment lists from all blocks.
  - Adds style hints for consistent document-level translation behavior.
- `prompt-builder.ts`
  - Builds strict system and user prompts.
  - Embeds document context, translation memory, constraints, and output JSON schema.
- `client.ts`
  - Calls Anthropic Messages API (`https://api.anthropic.com/v1/messages`).
  - Retries transient failures (429 and 5xx).
  - Parses strict JSON translation payload from model output.
  - Extracts token usage including cache token fields.
- `quality.ts`
  - Detects numeric mismatches between source and translated text.
- `orchestrator.ts`
  - Orchestrates page and batch processing.
  - Handles integrated mode context + translation memory behavior.
  - Tracks warnings, quality issues, usage totals, cost estimate, and per-page metrics.

## Processing Flow

1. Source PDF is converted to portable HTML pages.
2. Each page is segmented into block IDs (`b0`, `b1`, ...).
3. Engine optionally builds document context from all pages.
4. Blocks are chunked by batch size.
5. Each batch is sent to Claude with:
   - target language
   - system prompt
   - translation prompt
   - document context
   - translation memory snapshot
6. Batch responses are parsed into `{ translations: [{ id, text }] }`.
7. Numeric fidelity checks run per block (optional, enabled by default).
8. Repeated-source consistency is enforced in integrated mode.
9. Translated blocks are merged back into page HTML.
10. Route returns translated pages plus operational telemetry.

## Tech Stack Used

### Framework and language

- Next.js 16 (App Router)
- TypeScript
- React 19

### PDF and document stack

- MuPDF (`mupdf`) for PDF processing integration
- `pdfjs-dist`, `react-pdf`, and internal `pdf-to-html-engine`
- Internal utilities in `lib/pdf-utilities`

### LLM integration

- Anthropic Claude Messages API
- Supported model presets:
  - Claude Haiku 4.5
  - Claude Sonnet 4.6
  - Claude Opus 4.6

### UI and state

- Client-side workflow hook with staged progress updates
- Local storage API key management for Claude settings
- Editable prompt and engine controls in UI

## Metrics and Observability Returned

- Per-page metrics:
  - total blocks
  - translated blocks
  - failed blocks
  - translation memory hits
- Quality summary:
  - total issues
  - numeric mismatches
  - consistency overrides
- Usage:
  - input tokens
  - output tokens
  - cache creation input tokens
  - cache read input tokens
  - total tokens
- Cost estimate (USD):
  - input/output/cache components
  - total estimated cost by selected model

## Current Defaults

- Default model: `claude-sonnet-4-6`
- Default temperature: `0.2`
- Default max tokens: `4000`
- Default batch size: `12`
- Default integration mode: `integrated`
- Quality checks: enabled
- Default max memory entries: `400`

## Known Constraints

- API key is currently user-provided in browser settings and sent per request header.
- Rate limiter is in-memory and process-local (not distributed).
- Cost values are estimates and may differ slightly from provider billing.
- HTML segmentation relies on text-between-tags strategy and may need extension for edge-case markup patterns.

## Implemented Status (April 2026)

- `POST /api/pdf-claude/translate` now supports both:
  - `multipart/form-data` (`pdf` file + `pages` + prompt/options fields)
  - JSON body with `documentSource` (`base64`, `file`, or `url`) plus `pages`
- Integrated mode is canonical and enforced; `documentSource` is required.
- The engine now runs one native PDF analysis stage before block translation.
- Native stage uses Claude document blocks and can use Files API upload/reuse (`file_id`) with base64 fallback on upload failure.
- Prompt caching can be toggled via engine options and is enabled by default.
- Final output remains editable page HTML with existing usage/cost/quality telemetry contract intact.

## Single Integrated Claude-Native Target (No Dual Path)

This is the recommended next architecture for the project.

- One user-facing flow only (`pdf-claude` UI).
- One backend translation endpoint only (`/api/pdf-claude/translate`).
- One orchestration pipeline only (no classic vs integrated branching in behavior).
- Claude native PDF capabilities are used as part of this same pipeline, while final output remains editable HTML pages.

### Why this is still one flow

- The pipeline starts with the raw PDF and uses Claude PDF/document capabilities for document-level understanding.
- The pipeline then normalizes into block-aligned HTML for editing, metrics, and reliable reconstruction.
- There is no second user mode and no second product path; these are internal stages in one orchestrator.

## Claude API Capabilities to Use in This Flow

Based on the Anthropic docs, the integrated flow should leverage:

- PDF `document` content blocks in Messages API.
- Files API path for upload-once and reuse by `file_id`.
- Prompt caching on stable inputs (PDF reference + stable instructions/context blocks).
- Vision-backed PDF understanding (charts, tables, scanned pages, mixed visual/text content).
- Batch processing support for high-volume processing where needed.

Operational limits to design around:

- Request size up to 32 MB payload (platform dependent).
- PDF support up to 600 pages on large-context models (lower on smaller-context models).
- Dense/visual PDFs can hit context limits before page limits.

## Implementation Plan (Single Integrated)

### Phase 1: Contract and behavior freeze

Goal: Lock one canonical Claude behavior without breaking current UI output.

Files:

- `app/api/pdf-claude/translate/route.ts`
  - Keep response contract stable.
  - Make integrated behavior canonical (accept legacy mode field but do not branch behavior).
  - Add additive-only metadata field such as `contractVersion`.
- `lib/pdf-claude-engine/types.ts`
  - Mark integrated behavior as canonical in comments/types.
  - Keep backward-compatible parsing types.
- `lib/pdf-claude-engine/orchestrator.ts`
  - Ensure document context + memory logic is always active for translation path.

Exit criteria:

- Existing client still works unchanged.
- Response keys remain stable (`translatedPages`, `pageMetrics`, `warnings`, `usage`, `cost`, `quality`, `summary`, `provider`).

### Phase 2: Raw PDF intake on server

Goal: Move PDF intake server-side while keeping one endpoint and same output shape.

Files:

- `app/pdf-claude/hooks/useClaudePdfWorkflow.ts`
  - Send raw PDF (multipart or binary route contract) to backend instead of sending only extracted pages.
  - Keep UI stages and progress semantics.
- `app/api/pdf-claude/translate/route.ts`
  - Accept raw PDF upload.
  - Build one internal document package (PDF bytes + optional derived page HTML).
  - Keep output contract unchanged.

Exit criteria:

- Client still renders editable translated HTML pages.
- No new user toggle or alternate mode exposed.

### Phase 3: Claude native document stage + Files API

Goal: Add native PDF intelligence inside the same orchestrator.

Files:

- `lib/pdf-claude-engine/client.ts`
  - Add Files API upload helper (upload PDF once, reuse `file_id`).
  - Add request builder for document block source (`file`, fallback to `base64` if needed).
  - Add prompt caching directives for stable blocks.
- `lib/pdf-claude-engine/prompt-builder.ts`
  - Add document-intelligence prompt builder for visual/layout understanding guidance.
  - Keep strict JSON schema constraints for machine parsing.
- `lib/pdf-claude-engine/orchestrator.ts`
  - Add stage ordering:
    1. Native document understanding stage
    2. Structured translation stage
    3. Reconciliation into HTML blocks
    4. Existing quality/metrics aggregation

Exit criteria:

- Claude sees native PDF content.
- Final artifact remains block-aligned editable HTML pages.
- Existing quality and telemetry fields continue to work.

### Phase 4: Route and UI consolidation

Goal: Ensure one product translation route for users.

Files:

- `app/page.tsx`
  - Keep one primary translation CTA to `pdf-claude`.
- `next.config.ts`
  - Add redirects from legacy translation pages to `pdf-claude` where appropriate.
- `app/sarvam/page.tsx`
  - Route-level redirect fallback.

Exit criteria:

- User has one translation path.
- Legacy paths no longer split translation experience.

### Phase 5: Verification and rollout safety

Goal: Ship safely with observable quality/cost impact.

Test matrix:

- Text-dominant PDF.
- Scanned/image-heavy PDF.
- Table/chart-heavy PDF.
- Mixed-language PDF (including Malayalam-heavy cases).
- Large PDF near payload/page limits.

Must verify:

- HTML editability is preserved.
- Numeric fidelity checks still catch mismatches.
- Translation memory consistency still improves repeated blocks.
- Usage/cost telemetry still aggregates correctly.

## Minimal Next Commit Sequence

1. Lock integrated behavior and response compatibility.
2. Add raw PDF intake on `POST /api/pdf-claude/translate` while preserving output shape.
3. Add Files API + native PDF stage in `client.ts` and orchestrator.
4. Add prompt caching + stricter structured output validation.
5. Consolidate UI routes to one translation entrypoint.

## File Map

- API route: `app/api/pdf-claude/translate/route.ts`
- Client workflow: `app/pdf-claude/hooks/useClaudePdfWorkflow.ts`
- Engine entry: `lib/pdf-claude-engine/index.ts`
- Engine orchestrator: `lib/pdf-claude-engine/orchestrator.ts`
- Segmentation: `lib/pdf-claude-engine/block-segmentation.ts`
- Prompting: `lib/pdf-claude-engine/prompt-builder.ts`
- Claude client: `lib/pdf-claude-engine/client.ts`
- Document context: `lib/pdf-claude-engine/document-context.ts`
- Quality checks: `lib/pdf-claude-engine/quality.ts`
- Shared types: `lib/pdf-claude-engine/types.ts`
