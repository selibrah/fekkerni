/**
 * Ports (interfaces) the domain logic depends on. Real adapters live in src/lib/adapters/*.
 * Services depend on these, never on the SDKs directly — so every service is unit-testable
 * with in-memory fakes and no GCP/Meta credentials.
 */
import type {
  ChunkInput,
  Creator,
  EmbedTaskType,
  Job,
  MediaIndexRecord,
  MediaItem,
  RetrievedChunk,
  Segment,
} from '../types';

/** Embeds text and returns an ALREADY L2-NORMALIZED vector (||v|| ≈ 1). */
export interface EmbeddingPort {
  embed(text: string, taskType: EmbedTaskType): Promise<{ vector: number[]; norm: number }>;
}

export interface VideoSource {
  /** A fetchable media_url (the adapter downloads + uploads to the Files API). */
  url: string;
  mimeType?: string;
}

export interface LlmPort {
  /** Transcribe a video into ~30s spoken-content segments. Returns [] for silent/visual video. */
  transcribeVideo(source: VideoSource): Promise<Segment[]>;
  /** Draft a 1–2 sentence answer from a fully-built, injection-safe prompt. */
  draftReply(prompt: string): Promise<string>;
  /** Optional one-line description of an image for searchability. */
  describeImage(source: VideoSource): Promise<string>;
}

export interface ChunkStore {
  /**
   * Replace the ENTIRE chunk set for one media: writes `chunks` and deletes any stale
   * chunks for that mediaId not in the new set. Idempotent; the unit of idempotency is
   * the per-mediaId set, not the individual chunk.
   */
  replaceChunksForMedia(creatorId: string, mediaId: string, chunks: ChunkInput[]): Promise<void>;
  deleteChunksForMedia(creatorId: string, mediaId: string): Promise<void>;
  /** Pre-filtered KNN: where(creatorId==).findNearest(embedding) with distanceResultField. */
  findNearest(creatorId: string, queryVector: number[], limit: number): Promise<RetrievedChunk[]>;
  /** All mediaIds currently having chunks for a creator (for the reconcile/delete pass). */
  listIndexedMediaIds(creatorId: string): Promise<string[]>;
}

export interface CreatorStore {
  get(creatorId: string): Promise<Creator | null>;
  setStatus(creatorId: string, status: Creator['status']): Promise<void>;
  setPollHighWaterMark(creatorId: string, at: Date): Promise<void>;
}

export interface MediaIndexStore {
  get(creatorId: string, mediaId: string): Promise<MediaIndexRecord | null>;
  set(record: MediaIndexRecord): Promise<void>;
}

export interface OptOutStore {
  isOptedOut(creatorId: string, userId: string): Promise<boolean>;
  /** Returns true iff the state transitioned (was not opted out → now opted out). */
  setOptOut(creatorId: string, userId: string): Promise<{ transitioned: boolean }>;
  /** Returns true iff the state transitioned (was opted out → now cleared). */
  clearOptOut(creatorId: string, userId: string): Promise<{ transitioned: boolean }>;
}

/** Webhook dedupe. markSeen must be durable and atomic across instances/cold starts. */
export interface DedupeStore {
  /** Returns true if `mid` was newly recorded (i.e. NOT seen before — safe to process). */
  markSeen(mid: string): Promise<boolean>;
}

export interface ConversationStore {
  /** Atomically: returns true if this is the FIRST reply in the conversation (=> disclose). */
  markDisclosedIfFirst(creatorId: string, userId: string): Promise<boolean>;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
}

export interface IgGraphPort {
  listMedia(token: string, opts: { since?: Date }): Promise<MediaItem[]>;
  getChildren(token: string, mediaId: string): Promise<MediaItem[]>;
  /** Send a text DM. Send is idempotent at the worker level via the `idempotencyKey`. */
  sendMessage(token: string, recipientId: string, text: string): Promise<SendResult>;
  subscribeMessages(token: string): Promise<void>;
  refreshLongLivedToken(token: string): Promise<{ token: string; expiresAt: Date }>;
}

export interface QueuePort {
  enqueue(job: Job): Promise<void>;
}

/**
 * Sends a DM to a follower. The implementation resolves the creator's token, calls the Graph API,
 * and maps auth failures to Creator.status='needs_reauth'. Keeps the worker free of token plumbing.
 */
export interface MessageSender {
  send(creatorId: string, recipientId: string, text: string): Promise<SendResult>;
}

export interface SecretStorePort {
  /** Resolve a creator's access token from its secret ref. */
  getCreatorToken(tokenSecretRef: string): Promise<string>;
  /** Store/rotate a creator's token; returns the (possibly new) secret ref. */
  setCreatorToken(creatorId: string, token: string): Promise<string>;
}

/** Injectable clock for testable time logic (the 24h window). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
