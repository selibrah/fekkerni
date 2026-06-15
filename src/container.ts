import { loadConfig, type Config } from './lib/config';
import { createLogger, type Logger } from './lib/logger';
import { systemClock } from './lib/ports';
import {
  firestoreChunks,
  firestoreConversations,
  firestoreCreators,
  firestoreDedupe,
  firestoreMediaIndex,
  firestoreOptOut,
  getDb,
} from './lib/adapters/firestore';
import { igGraphAdapter } from './lib/adapters/ig-graph';
import { secretStore } from './lib/adapters/secrets';
import { genaiAdapter } from './lib/adapters/genai';
import { cloudTasksQueue, localQueue, type JobHandlers } from './lib/queue';
import type { QueuePort } from './lib/ports';
import { createMessageSender } from './messaging/messageSender';
import { processMessage } from './messaging/processMessage';
import { defaultCopy } from './messaging/copy';
import { handleInbound, type WebhookDeps } from './messaging/handleWebhook';
import { createRetriever } from './retrieval/retrieve';
import { createIndexMedia } from './indexing/indexMedia';
import { createPollCreator } from './indexing/poll';
import { createBackfill } from './indexing/backfill';
import type { ChunkStore, EmbeddingPort } from './lib/ports';
import type { RetrievePort } from './retrieval/types';

export interface Container {
  config: Config;
  logger: Logger;
  webhookDeps: WebhookDeps;
  handlers: JobHandlers;
  queue: QueuePort;
  /** Exposed for the offline search/eval CLI and indexing scripts. */
  chunks: ChunkStore;
  embedding: EmbeddingPort;
  retrieve: RetrievePort;
  backfill(creatorId: string): Promise<{ enqueued: number; deferredVideos: number }>;
  pollCreator(creatorId: string): Promise<void>;
  /** Await all in-flight local-queue jobs (no-op for the Cloud Tasks driver). */
  drain(): Promise<void>;
  ingest(body: unknown): Promise<void>;
}

/**
 * Composition root: Config → adapters → services → job handlers → queue. Constructing this touches
 * GCP (Firestore init), so it runs at server/script start, never at import time.
 */
export function createContainer(cfg: Config = loadConfig()): Container {
  const logger = createLogger(cfg.logLevel, { service: 'fekkerni' });

  const db = getDb(cfg);
  const dedupe = firestoreDedupe(db);
  const creators = firestoreCreators(db);
  const optout = firestoreOptOut(db);
  const conversations = firestoreConversations(db);
  const chunks = firestoreChunks(db);
  const mediaIndex = firestoreMediaIndex(db);

  const secrets = secretStore(cfg);
  const ig = igGraphAdapter(cfg);
  const genai = genaiAdapter(cfg);

  const sender = createMessageSender({ creators, secrets, ig, logger });
  const retrieve = createRetriever({
    chunks,
    embedding: genai.embedding,
    llm: genai.llm,
    cosineDistanceMax: cfg.cosineDistanceMax,
    logger,
  });

  // Late-bound so handlers can enqueue more jobs (poll → index_media).
  let queueRef: QueuePort;
  const queue: QueuePort = { enqueue: (job) => queueRef.enqueue(job) };

  const indexMedia = createIndexMedia({ creators, secrets, ig, genai, chunks, mediaIndex, cfg, logger });
  const pollCreator = createPollCreator({ creators, secrets, ig, queue, cfg, logger });

  const handlers: JobHandlers = {
    processMessage: (message) =>
      processMessage(message, {
        optout,
        conversations,
        sender,
        retrieve,
        clock: systemClock,
        copy: defaultCopy,
        windowHours: cfg.messagingWindowHours,
        maxReplyBytes: cfg.maxReplyBytes,
        logger,
      }),
    indexMedia,
    pollCreator,
  };

  let drain: () => Promise<void> = async () => undefined;
  if (cfg.queueDriver === 'cloudtasks') {
    queueRef = cloudTasksQueue(cfg, logger);
  } else {
    const handle = localQueue(() => handlers, logger);
    queueRef = handle.queue;
    drain = handle.drain;
  }

  const backfill = createBackfill({ creators, secrets, ig, chunks, queue, cfg, logger });
  const webhookDeps: WebhookDeps = { dedupe, creators, queue, logger };

  return {
    config: cfg,
    logger,
    webhookDeps,
    handlers,
    queue,
    chunks,
    embedding: genai.embedding,
    retrieve,
    backfill,
    pollCreator,
    drain,
    async ingest(body) {
      const { parseWebhook } = await import('./webhook/parse');
      const { messages } = parseWebhook(body);
      await handleInbound(messages, webhookDeps);
    },
  };
}
