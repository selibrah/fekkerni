/** In-memory fakes for the ports, for unit tests. Not shipped (not a tsup entry point). */
import type {
  ChunkStore,
  ConversationStore,
  CreatorStore,
  DedupeStore,
  EmbeddingPort,
  IgGraphPort,
  LlmPort,
  MediaIndexStore,
  MessageSender,
  OptOutStore,
  QueuePort,
  SecretStorePort,
  Clock,
} from '../lib/ports';
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
import { l2normalize } from '../lib/normalize';
import { loadConfig, type Config } from '../lib/config';

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({
    META_APP_SECRET: 's',
    VERIFY_TOKEN: 'v',
    GEMINI_API_KEY: 'k',
    ...over,
  } as NodeJS.ProcessEnv);
}
import type { ReplyPlan, RetrievePort } from '../retrieval/types';
import { createLogger, type Logger } from '../lib/logger';

export function silentLogger(): Logger {
  return createLogger('error', {}, () => {});
}

export class FakeDedupe implements DedupeStore {
  readonly seen = new Set<string>();
  async markSeen(mid: string): Promise<boolean> {
    if (this.seen.has(mid)) return false;
    this.seen.add(mid);
    return true;
  }
}

export class FakeCreators implements CreatorStore {
  readonly map = new Map<string, Creator>();
  seed(creator: Creator): this {
    this.map.set(creator.creatorId, creator);
    return this;
  }
  async get(creatorId: string): Promise<Creator | null> {
    return this.map.get(creatorId) ?? null;
  }
  async setStatus(creatorId: string, status: Creator['status']): Promise<void> {
    const c = this.map.get(creatorId);
    if (c) c.status = status;
  }
  async setPollHighWaterMark(creatorId: string, at: Date): Promise<void> {
    const c = this.map.get(creatorId);
    if (c) c.pollHighWaterMark = at;
  }
}

export class FakeOptOut implements OptOutStore {
  readonly out = new Set<string>();
  private key(c: string, u: string) {
    return `${c}_${u}`;
  }
  async isOptedOut(c: string, u: string): Promise<boolean> {
    return this.out.has(this.key(c, u));
  }
  async setOptOut(c: string, u: string): Promise<{ transitioned: boolean }> {
    const k = this.key(c, u);
    if (this.out.has(k)) return { transitioned: false };
    this.out.add(k);
    return { transitioned: true };
  }
  async clearOptOut(c: string, u: string): Promise<{ transitioned: boolean }> {
    const k = this.key(c, u);
    if (!this.out.has(k)) return { transitioned: false };
    this.out.delete(k);
    return { transitioned: true };
  }
}

export class FakeConversations implements ConversationStore {
  readonly disclosed = new Set<string>();
  async markDisclosedIfFirst(c: string, u: string): Promise<boolean> {
    const k = `${c}_${u}`;
    if (this.disclosed.has(k)) return false;
    this.disclosed.add(k);
    return true;
  }
}

export class FakeQueue implements QueuePort {
  readonly jobs: Job[] = [];
  async enqueue(job: Job): Promise<void> {
    this.jobs.push(job);
  }
}

export class FakeSender implements MessageSender {
  readonly sent: { creatorId: string; recipientId: string; text: string }[] = [];
  async send(creatorId: string, recipientId: string, text: string) {
    this.sent.push({ creatorId, recipientId, text });
    return { ok: true, messageId: `m_${this.sent.length}` };
  }
}

export class FakeRetrieve implements RetrievePort {
  constructor(private readonly fn: (creatorId: string, query: string) => ReplyPlan | null) {}
  async retrieve(creatorId: string, query: string): Promise<ReplyPlan | null> {
    return this.fn(creatorId, query);
  }
}

export function fixedClock(iso: string): Clock {
  const d = new Date(iso);
  return { now: () => d };
}

/** Deterministic embedding: maps text → a vector via a supplied function, then L2-normalizes. */
export class FakeEmbedding implements EmbeddingPort {
  readonly calls: { text: string; taskType: EmbedTaskType }[] = [];
  constructor(private readonly map: (text: string) => number[]) {}
  async embed(text: string, taskType: EmbedTaskType) {
    this.calls.push({ text, taskType });
    return l2normalize(this.map(text));
  }
}

export class FakeIg implements IgGraphPort {
  media: MediaItem[] = [];
  children: Record<string, MediaItem[]> = {};
  readonly sent: { recipientId: string; text: string }[] = [];
  async listMedia(_token: string, opts: { since?: Date }): Promise<MediaItem[]> {
    return opts.since ? this.media.filter((m) => Date.parse(m.timestamp) > opts.since!.getTime()) : this.media;
  }
  async getChildren(_token: string, mediaId: string): Promise<MediaItem[]> {
    return this.children[mediaId] ?? [];
  }
  async sendMessage(_token: string, recipientId: string, text: string) {
    this.sent.push({ recipientId, text });
    return { ok: true, messageId: `m_${this.sent.length}` };
  }
  async subscribeMessages(): Promise<void> {}
  async refreshLongLivedToken(token: string) {
    return { token, expiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000) };
  }
}

export class FakeSecrets implements SecretStorePort {
  constructor(private readonly token = 'token') {}
  async getCreatorToken(): Promise<string> {
    return this.token;
  }
  async setCreatorToken(creatorId: string): Promise<string> {
    return `local:${creatorId}`;
  }
}

export class FakeLlm implements LlmPort {
  constructor(
    private readonly opts: {
      reply?: string;
      segments?: Segment[];
      description?: string;
    } = {},
  ) {}
  async transcribeVideo(): Promise<Segment[]> {
    return this.opts.segments ?? [];
  }
  async draftReply(): Promise<string> {
    return this.opts.reply ?? 'Here is the answer from the post.';
  }
  async describeImage(): Promise<string> {
    return this.opts.description ?? '';
  }
}

export class FakeMediaIndex implements MediaIndexStore {
  readonly map = new Map<string, MediaIndexRecord>();
  private key(c: string, m: string) {
    return `${c}_${m}`;
  }
  async get(creatorId: string, mediaId: string): Promise<MediaIndexRecord | null> {
    return this.map.get(this.key(creatorId, mediaId)) ?? null;
  }
  async set(record: MediaIndexRecord): Promise<void> {
    this.map.set(this.key(record.creatorId, record.mediaId), record);
  }
}

/** In-memory ChunkStore with brute-force cosine for findNearest (good enough for tests). */
export class FakeChunkStore implements ChunkStore {
  /** keyed by chunkId */
  readonly chunks = new Map<string, ChunkInput>();

  async replaceChunksForMedia(creatorId: string, mediaId: string, next: ChunkInput[]): Promise<void> {
    for (const [id, c] of this.chunks) {
      if (c.creatorId === creatorId && c.mediaId === mediaId) this.chunks.delete(id);
    }
    for (const c of next) this.chunks.set(c.chunkId, c);
  }
  async deleteChunksForMedia(creatorId: string, mediaId: string): Promise<void> {
    for (const [id, c] of this.chunks) {
      if (c.creatorId === creatorId && c.mediaId === mediaId) this.chunks.delete(id);
    }
  }
  async findNearest(creatorId: string, queryVector: number[], limit: number): Promise<RetrievedChunk[]> {
    const scored = [...this.chunks.values()]
      .filter((c) => c.creatorId === creatorId)
      .map((c) => ({ c, distance: cosineDistance(c.embedding, queryVector) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
    return scored.map(({ c, distance }) => ({
      chunkId: c.chunkId,
      mediaId: c.mediaId,
      permalink: c.permalink,
      mediaType: c.mediaType,
      text: c.text,
      startSec: c.startSec,
      endSec: c.endSec,
      distance,
    }));
  }
  async listIndexedMediaIds(creatorId: string): Promise<string[]> {
    const set = new Set<string>();
    for (const c of this.chunks.values()) if (c.creatorId === creatorId) set.add(c.mediaId);
    return [...set];
  }
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 2;
  return 1 - dot / denom;
}
