# Document Pipeline Truths For Claude API

This file translates Claude platform capabilities into production document/PDF pipeline patterns.

## Pipeline Architecture Pattern

1. Ingest document and persist immutable version metadata.
2. Convert/extract text per page with stable page and chunk identifiers.
3. Run task-specific Claude calls per chunk or per page.
4. Validate, merge, and store artifacts.
5. Expose progress and partial results to clients.

## Task Patterns

### Extraction

- Use schema-first prompts and strict post-parse validation.
- Include page or chunk IDs in prompts so output can be traced to source.
- Maintain confidence metadata and route low-confidence outputs to fallback/human review.

### Translation

- Translate semantic units rather than arbitrary fixed-length slices where possible.
- Preserve document structure metadata (headings, lists, table-like segments).
- Add glossary and domain constraints in system prompt for terminology consistency.

### Summarization

- Use map-reduce for long documents: summarize each chunk, then synthesize.
- Keep per-chunk summaries structured for deterministic final synthesis.
- Keep citation pointers to chunk IDs to improve auditability.

## Chunking Truths

- Chunking strategy should balance context and cost, not just character count.
- Keep chunk boundaries deterministic for reproducibility and cache hit rates.
- Preserve chunk overlap where needed to avoid semantic breaks across paragraphs.

## Async and Batch Truths

- Large document workflows should run as async jobs, not synchronous API calls.
- Batch/offline processing is preferable for high-volume, non-interactive workloads.
- Persist job states and per-chunk status to support resume and partial completion.
