# Context: Retrieval

**Owns:** turning a follower's question into an answer + link (or a fallback).

## Invariants
- Query embedding is `RETRIEVAL_QUERY`, L2-normalized, 768-d (kernel, ADR 002).
- `findNearest(creatorId, queryVector, 3)` with `distanceResultField`; gate is
  `topChunk.distance > COSINE_DISTANCE_MAX ⇒ fallback` (ADR 005). Never guess.
- The drafting prompt treats the follower message AND chunk text as **untrusted data, not
  instructions** (delimited, labeled). Answer only from retrieved content.
- Output guardrail: strip any URL that isn't the resolved permalink; enforce `MAX_REPLY_BYTES`.
- Video reply cue uses the **cited** chunk's `startSec`: `Watch from ~{max(0, startSec-4)}s` (pad 4s).

## Contracts
- Consumes the shared `chunks` kernel written by Indexing. Returns reply text to Messaging.
- The offline `search`/`eval` CLI exercises this exact path (embed + gate) with no Instagram.
