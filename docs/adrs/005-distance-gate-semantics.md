# ADR 005 — Distance-gate semantics (COSINE_DISTANCE_MAX)

**Status:** Accepted · **Date:** 2026-06-15

## Context
`findNearest` does **not** return the distance unless `distanceResultField` is set — it only orders
results. The value is COSINE **distance** in `[0,2]`, **smaller = closer**. The original
`SIMILARITY_THRESHOLD` name + "worse than threshold" wording invites an inverted comparison, which is
silent and catastrophic (answer everything, or fallback-reject everything).

## Decision
- `findNearest({ vectorField, queryVector, limit, distanceMeasure:'COSINE', distanceResultField:'vector_distance' })`.
- Env var named **`COSINE_DISTANCE_MAX`** (distance, 0..2). Gate is literally:
  `if (topChunk.distance > COSINE_DISTANCE_MAX) → fallback`.
- Seed `0.4`; tune via the eval harness. A unit test pins the comparison **direction**.

## Consequences
- The gate is implementable and unambiguous.
- The offline `search`/`eval` CLI uses the exact same embed()+gate so the eval reflects production.
