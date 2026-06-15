# Context: Indexing

**Owns:** turning Media into Chunks. Orchestrator (paginate, decide new/changed, enqueue per media)
+ worker (download → transcribe → embed → idempotent write).

## Invariants
- Media-type routing keys on the **real** read values: `IMAGE | VIDEO | CAROUSEL_ALBUM`. Reels are
  `VIDEO` + `media_product_type='REELS'`. CAROUSEL_ALBUM also fetches `/children` for video children.
- Absent `media_url` (copyright-flagged) ⇒ skip + flag, never crash the batch.
- Chunks are written via **replace-by-mediaId** with deterministic ids (ADR 004); partial/failed
  media are repaired, not skipped (`media_index` status + `contentHash`).
- Empty/whitespace caption ⇒ skip (no empty-text chunks). Silent video ⇒ fall back to caption.
- Embeddings are `RETRIEVAL_DOCUMENT`, L2-normalized, 768-d (ADR 002, kernel).
- Backfill is async, resumable, and **cost-capped** (`MAX_BACKFILL_VIDEOS`, `BACKFILL_COST_CEILING_USD`);
  newest media first.
- Incremental poll uses the `pollHighWaterMark`, not the `paging.next` cursor.

## Contracts
- Reads token + status from Onboarding. Writes the shared `chunks` kernel consumed by Retrieval.
