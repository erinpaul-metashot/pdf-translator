# Claude Integration Blueprint For This Repository

This file maps Claude API integration to the existing pdf-translator code structure.

## Current Architecture Highlights

- Existing flow supports async translation jobs and status polling via Sarvam endpoints.
- Current translation path is Sarvam-coupled through headers, env wiring, and model constants, so provider abstraction is a prerequisite for clean Claude integration.
- UI has reusable progress, editing, and key settings patterns, but Claude is not currently an active provider option in settings.

## Recommended Integration Phases

### Phase 1: Safe Post-Processing Path

- Add Claude as optional post-processor after current translated page output.
- Keep default behavior unchanged behind a feature flag.
- Persist provider metrics per request.

### Phase 2: Text Editor Provider Choice

- Extend existing text translation route to accept provider selection.
- Add Claude option in UI editor controls for context-aware rewriting/translation.
- Preserve existing provider as default fallback.

### Phase 3: Hybrid Page Translation Routing

- Route semantic-heavy blocks to Claude and short utility strings to existing provider.
- Keep deterministic merge order to preserve layout fidelity.
- Log per-block provider decisions for debugging and quality analysis.

### Phase 4: Full Job-Level Orchestration

- Add token-budget aware routing at page/chunk level.
- Add batch mode for high-volume offline tasks.
- Add operator-facing dashboards for spend, latency, and failure patterns.

## Repository Integration Targets

- app/api/keys/verify/route.ts: harden existing Claude verification branch with timeout handling, error mapping, and tests.
- app/api/translate/text/route.ts: add provider routing and output validation.
- app/api/translate/download/route.ts: add optional Claude refinement stage.
- app/hooks/useTranslationState.ts: persist provider and metrics in state.
- app/components/TextEditor.tsx: expose provider selector and usage feedback.
- app/components/ProgressOverlay.tsx: display provider and performance details.
- app/lib/types.ts: add ProviderType, ProviderMetrics, and routing result shapes.
- app/lib/constants.ts: add feature flags and token budget constants.

## Guardrails

- Never break existing default translation pipeline while adding Claude path.
- Keep all Claude features behind explicit flags until validated.
- Use schema validation on every structured output path.
- Enforce retries only for transient failures.
