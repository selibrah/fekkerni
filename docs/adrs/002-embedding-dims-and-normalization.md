# ADR 002 — 768-dim embeddings with mandatory L2 normalization

**Status:** Accepted · **Date:** 2026-06-15

## Context
We embed with `gemini-embedding-001` at **output dimensionality 768** (Firestore's vector index cap
is 2048; 768 is cheap and within it). Verified fact: at any dimensionality **other than the native
3072**, `gemini-embedding-001` returns **non-normalized** vectors and the `@google/genai` SDK does
**not** normalize them. COSINE distance — and therefore the threshold gate — is only reliable on unit
vectors. We also embed asymmetrically (`RETRIEVAL_DOCUMENT` for chunks, `RETRIEVAL_QUERY` for queries).

## Decision
- A single `embed(text, taskType)` helper (`src/lib/adapters/genai`) that **L2-normalizes** every
  vector before returning, used identically by Indexing and Retrieval.
- Store `embeddingNorm` (the original norm) so a unit test can assert `||v|| ≈ 1`.
- Indexing passes `RETRIEVAL_DOCUMENT`; Retrieval passes `RETRIEVAL_QUERY`.
- `EMBED_DIMS=768` is the single source of truth; the vector index dimension must match exactly.

## Consequences
- Stable, comparable distances → a single tuned `COSINE_DISTANCE_MAX` holds across content.
- Alternative `gemini-embedding-2` (GA, auto-normalizes, multimodal, instruction-prefix instead of
  task_type) is a drop-in if we change `EMBED_MODEL`; normalization step then becomes a no-op but is
  kept defensively.
