# Claude Watchlist and Uncertainties

Use this as a release gate checklist before enabling Claude paths in production.

## Must-Verify Items

- Current model IDs and availability in your target region/account.
- Current TypeScript SDK request and stream event surface for your pinned SDK version.
- Prompt caching API details, limits, and billing behavior.
- Message batch APIs, quotas, and lifecycle semantics.
- Rate-limit headers and retry timing guidance in the current API docs.

## Implementation-Sensitive Unknowns

- Maximum practical payload size for your document chunk format.
- Best cost/quality routing thresholds for your language pairs and page types.
- Whether your existing page chunking boundaries maximize quality for Claude translation tasks.

## Validation Plan

1. Run smoke tests with fixed golden PDFs (small, medium, large).
2. Compare quality across provider-only and hybrid-provider routes.
3. Measure token usage, latency, retry rate, and output schema failure rate.
4. Roll out with feature flag and tenant allowlist.
5. Keep instant rollback path to existing provider-only mode.

## Done Criteria

- Model outputs pass schema validation at target reliability.
- Cost per page is within budget envelope.
- P95 latency for interactive flows remains acceptable.
- No regression in existing translation quality baseline.
