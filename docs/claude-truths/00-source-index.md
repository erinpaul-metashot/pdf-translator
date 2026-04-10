# Claude Docs Source Index

Last updated: 2026-04-07
Purpose: Track canonical sources for this truth pack and define what must be re-verified before implementation changes.

## Primary Source Set

- Anthropic docs home: https://docs.anthropic.com
- API overview: https://docs.anthropic.com/en/api/overview
- Messages API reference: https://docs.anthropic.com/en/api/messages
- Models overview: https://docs.anthropic.com/en/docs/models-overview
- Prompt engineering guides: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering
- Tool use: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
- Prompt caching: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- Batch processing: https://docs.anthropic.com/en/api/messages-batch-examples
- Errors: https://docs.anthropic.com/en/api/errors
- Rate limits: https://docs.anthropic.com/en/api/rate-limits
- Anthropic TypeScript SDK: https://github.com/anthropics/anthropic-sdk-typescript

## Re-Verification Checklist

- Confirm current model IDs and recommended model routing by quality/latency/cost.
- Confirm request and response fields in Messages API for your SDK version.
- Confirm exact streaming event names and helper methods in SDK.
- Confirm prompt caching controls and billing semantics.
- Confirm batch APIs, limits, and status lifecycle fields.
- Confirm account-specific rate limit headers and retry behavior.

## How This Pack Should Be Used

- Use as implementation guidance for this repository's PDF/document features.
- Validate uncertain items in 05-watchlist-and-uncertainties.md before production release.
- Update this index whenever links or verified assumptions change.
