# Core Claude Platform Truths

This file captures stable, implementation-relevant truths for building document features with the Claude API.

## Core API Truths

- Messages API is the primary interface for text/document reasoning workflows.
- Use system instructions for invariant behavior, style, and extraction constraints.
- Use user content blocks for document chunks and task-specific instructions.
- Keep prompt templates stable and versioned to reduce regression risk.
- Always set explicit max_tokens to enforce output and cost boundaries.
- Use low temperature for extraction/classification tasks requiring consistency.

## Model and Runtime Truths

- Model choice is a routing problem: quality-sensitive pages should use stronger models, while simpler pages can use lower-cost tiers.
- Streaming improves UX for long operations and lets the frontend render progressive output.
- For very large documents, chunking plus hierarchical merge is more reliable than one monolithic call.

## Reliability Truths

- Retry only transient failures such as 429 and 5xx classes.
- Do not retry deterministic 4xx request-validation errors.
- Use exponential backoff with jitter and capped attempts.
- Store idempotency metadata per chunk/job so retries do not duplicate writes.

## Safety and Governance Truths

- Treat model output as untrusted until validated against a strict schema.
- Minimize sensitive text sent to API by pre-redaction and selective chunking.
- Keep API keys server-side only; never expose secrets in client bundles.
- Avoid logging raw document text unless explicitly required and access-controlled.

## Operational Truths

- Track per-call usage metrics: input tokens, output tokens, latency, retries, error class.
- Enforce per-tenant and per-job token budgets to avoid cost spikes.
- Keep model and API version pinning explicit and test on upgrades.
