# ADR 001 — Default to gemini-3.5-flash, not gemini-2.5-flash

**Status:** Accepted · **Date:** 2026-06-15

## Context
The original spec pinned Gemini **2.5 Flash**. Verified against the Gemini deprecations page:
`gemini-2.5-flash` is **deprecated with a 2026-10-16 shutdown**. The current GA Flash is
`gemini-3.5-flash`. Building a greenfield MVP on a model with a published shutdown date guarantees a
forced migration within months.

## Decision
- Default `FLASH_MODEL=gemini-3.5-flash`; keep it env-configurable and re-confirm at build time.
- Split `INDEX_MODEL` (transcription, the token-dominant path) from `FLASH_MODEL` (reply drafting) so
  the cost-heavy path can use a cheaper model (e.g. `gemini-3.1-flash-lite`) independently.

## Consequences
- No forced migration at launch. `gemini-3.5-flash` is pricier ($1.50/$9.00 per 1M) than 2.5 Flash,
  which raises backfill cost — mitigated by `INDEX_MODEL` + the cost caps (ADR 005-adjacent).
- SDK is `@google/genai` (the deprecated `@google/generative-ai` / `@google-cloud/vertexai` are
  rejected in review/lint conventions).
