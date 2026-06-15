# ADR 004 — Idempotency: deterministic chunkIds + replace-by-mediaId

**Status:** Accepted · **Date:** 2026-06-15

## Context
One Media fans out to many Chunks (1 caption OR N transcript slices). "Idempotent on mediaId" is
ambiguous: a re-transcribe yielding a different segment count, or an edited caption, would orphan
stale chunks under Firestore auto-ids — the bot then cites content that no longer matches. A naive
"skip if any chunk exists for this mediaId" permanently leaves partially-indexed videos half-done.

## Decision
- `chunkId = ${mediaId}_${index}` (caption ⇒ index 0; video ⇒ 0..N-1) — deterministic.
- **Replace-by-mediaId**: writing a media's chunks also deletes any existing chunks for that mediaId
  not in the new set, in a batch, flipping `media_index` to `complete` atomically.
- A per-media `media_index` record tracks `status` (pending/partial/complete/failed/skipped) and a
  `contentHash`. Re-index when `contentHash` changes; **repair** `partial`/`failed`, don't skip.
- Deletion path: media gone from `/me/media` ⇒ delete all its chunks (reconcile pass).

## Consequences
- Re-runs converge; no orphans; partial failures self-heal on retry.
- The unit of idempotency is the per-media chunk set, asserted by a "index twice, no orphans" test.
