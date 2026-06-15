# Ubiquitous Language

Canonical terms. Code, docs, and conversation use these exact words.

| Term | Definition | Notes / pitfalls |
|---|---|---|
| **Creator** | A tenant. Identified by `creatorId` (the Instagram account id of the connected Business/Creator account). | `creatorId` partitions **all** data; every query filters by it. |
| **Follower** | An end user who DMs the creator. Identified by `senderId` (an **IGSID**, Instagram-scoped id). | Not a username. Comes from the webhook `sender.id`. |
| **Media** | One Instagram post. `media_type ∈ {IMAGE, VIDEO, CAROUSEL_ALBUM}` on read. | There is **no `REEL` media_type on read** — a reel is `VIDEO` with `media_product_type = REELS`. |
| **Chunk** | One searchable unit: a caption, OR one ~30s transcript slice. A Media fans out to **N** chunks. | `chunkId = ${mediaId}_${index}` (deterministic). |
| **Segment** | A `{startSec,endSec,text}` slice from video transcription. Becomes a video chunk. | Gemini emits `MM:SS`; we convert to seconds. ~1s granularity. |
| **Embedding** | A 768-d vector from `gemini-embedding-001`, **L2-normalized**. | At dims ≠ 3072 the SDK does NOT normalize — we must. Index & query use identical dims/model/normalization. |
| **COSINE distance** | Firestore's `vector_distance`, range **[0,2]**, **smaller = closer**. | NOT a similarity score. The gate var is `COSINE_DISTANCE_MAX`; `distance > max ⇒ fallback`. |
| **Threshold gate** | "Never guess": if the top chunk's distance exceeds `COSINE_DISTANCE_MAX`, send a fallback. | Requires `distanceResultField` on `findNearest`. |
| **Fallback** | The graceful "couldn't find that — rephrase?" reply, plus a human-escalation hint. | Sent instead of a low-confidence answer. |
| **Cited chunk** | The single chunk the drafted answer is grounded in. | The video timestamp cue uses the **cited** chunk's `startSec`, not rank-1. |
| **Opt-out** | Per `{creatorId, senderId}` suppression, toggled by `STOP`/`START`. | STOP confirmation is sent only on a real state **transition**. |
| **Disclosure** | The one-time "you're chatting with an automated assistant" line on first reply in a conversation. | Policy/legal requirement; tracked per conversation. |
| **mid** | Message id. The webhook **dedupe** key. | Persisted before async work; durable across instances. |
| **Echo** | A webhook callback for the account's own outbound message (`is_echo`). | Ignored. |
| **24h window** | The standard messaging window, measured from the follower's inbound message timestamp. | Recompute on send; never use `HUMAN_AGENT` to bypass it for a bot. |
| **High-water mark** | Newest `postedAt` successfully indexed; the incremental-poll marker. | Distinct from the `paging.next` cursor (intra-fetch only). |
| **Backfill** | Indexing a creator's whole archive on subscribe. Async, resumable, **cost-capped**. | `MAX_BACKFILL_VIDEOS`, `BACKFILL_COST_CEILING_USD`. |
| **Replace-by-mediaId** | Re-indexing a media replaces its entire chunk set (deletes orphans). | The unit of idempotency is the per-media set, not the chunk. |
