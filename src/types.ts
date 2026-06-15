/**
 * Core domain types for Fekkerni.
 *
 * Ubiquitous language (see docs/UBIQUITOUS_LANGUAGE.md):
 *  - Media  : one Instagram post (IMAGE | VIDEO | CAROUSEL_ALBUM). Reels are VIDEO + REELS product type.
 *  - Chunk  : one searchable unit. A Media fans out to N Chunks (1 caption, OR N transcript slices).
 *  - Creator: a tenant. creatorId (the IG account id) partitions ALL data.
 */

/** What the IG Graph API actually returns for `media_type` on READ. (No "REEL" here.) */
export type MediaType = 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';

/** `media_product_type` — reels are detected HERE, not via media_type. */
export type MediaProductType = 'FEED' | 'REELS' | 'STORY' | 'AD';

/** A raw media item from GET /me/media. */
export interface MediaItem {
  id: string;
  caption: string | null;
  mediaType: MediaType;
  mediaProductType: MediaProductType | null;
  mediaUrl: string | null; // absent for copyright-flagged media
  permalink: string;
  thumbnailUrl: string | null;
  timestamp: string; // ISO 8601 from the API
  children?: MediaItem[]; // CAROUSEL_ALBUM only, fetched from /{id}/children
}

/** A transcript segment produced by Gemini video understanding. */
export interface Segment {
  startSec: number;
  endSec: number;
  text: string;
}

/** Distinguishes asymmetric retrieval embeddings (gemini-embedding-001 task_type). */
export type EmbedTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/** A chunk ready to be written to Firestore (embedding is L2-normalized). */
export interface ChunkInput {
  chunkId: string; // deterministic: `${mediaId}_${index}`
  creatorId: string;
  mediaId: string;
  permalink: string;
  mediaType: MediaType;
  mediaProductType: MediaProductType | null;
  text: string; // never empty
  startSec: number | null;
  endSec: number | null;
  embedding: number[]; // 768-d, ||v|| ≈ 1
  embeddingNorm: number;
  postedAt: Date;
}

/** A chunk read back from Firestore, including the computed vector distance. */
export interface RetrievedChunk {
  chunkId: string;
  mediaId: string;
  permalink: string;
  mediaType: MediaType;
  text: string;
  startSec: number | null;
  endSec: number | null;
  distance: number; // COSINE distance in [0,2]; smaller = closer
}

export type CreatorStatus = 'active' | 'needs_reauth' | 'uninstalled';

export interface Creator {
  creatorId: string;
  tokenSecretRef: string;
  tokenExpiresAt: Date | null;
  status: CreatorStatus;
  pollHighWaterMark: Date | null;
}

export type MediaIndexStatus = 'pending' | 'partial' | 'complete' | 'skipped' | 'failed';

export interface MediaIndexRecord {
  creatorId: string;
  mediaId: string;
  status: MediaIndexStatus;
  segmentCount: number | null;
  contentHash: string;
  updatedAt: Date;
  lastError?: string;
}

/** A normalized inbound messaging event after webhook parsing. */
export interface InboundMessage {
  creatorId: string; // recipient IG id (the tenant)
  senderId: string; // sender IGSID
  mid: string; // message id (dedupe key)
  text: string;
  timestampMs: number; // when the user sent it (for the 24h window)
}

/** A job enqueued for the async worker. */
export type Job =
  | { kind: 'process_message'; message: InboundMessage }
  | { kind: 'index_media'; creatorId: string; media: MediaItem }
  | { kind: 'poll_creator'; creatorId: string };
