# Node and Next.js Integration Truths

This file is a practical integration guide for TypeScript and Next.js route handlers.

- Repository caveat: this project uses a Next.js variant with breaking changes, so route/runtime conventions should be validated against local Next docs in node_modules/next/dist/docs before implementation.

## Server Integration Baseline

- Keep Claude API usage in server runtime only.
- Wrap API access behind a provider client interface to avoid route-level duplication.
- Keep route handlers thin: validate input, enqueue/dispatch work, return structured response.

## Suggested Request Pattern

- For short, interactive edits, call Claude synchronously and return immediate result.
- For full-document operations, return 202 Accepted and process in background workers.
- Include requestId and jobId in all logs and responses for traceability.

## Error Handling Matrix

- 400/401/403/404/422: no retry, return actionable message.
- 429/500/502/503/504: retry with exponential backoff and jitter.
- Timeout and upstream overload: retry with reduced concurrency.

## Cost and Token Controls

- Preflight estimate token volume per chunk before dispatching jobs.
- Enforce hard token caps per page/chunk and per job.
- Store usage metrics in job records for reporting and tuning.
- Route simple text tasks to lower-cost model tier when quality allows.

## Streaming and UX

- Stream incremental output for long-running interactive tasks.
- Render partial progress in UI so users are not blocked by full completion.
- Surface provider, latency, and failure state transparently in progress overlays.

## Security Checklist

- Prefer server env vars for platform-managed keys; if supporting per-user BYOK, store keys client-side only with explicit consent, never log raw keys, and proxy provider requests through server routes.
- Redact sensitive inputs from logs.
- Validate all model output against schema before writing to DB/storage.
- Enforce request size limits and file type validation at boundaries.
