import type { ChunkStore, EmbeddingPort, LlmPort } from '../lib/ports';
import type { Logger } from '../lib/logger';
import type { UsagePort } from '../lib/usage';
import type { ReplyPlan, RetrievePort } from './types';
import { buildPrompt } from './prompt';

export interface RetrieverDeps {
  chunks: ChunkStore;
  embedding: EmbeddingPort;
  llm: LlmPort;
  cosineDistanceMax: number;
  logger: Logger;
  usage: UsagePort;
  limit?: number;
}

/**
 * Embed the query → findNearest → distance gate (ADR 005) → injection-safe draft. Returns null
 * (⇒ caller sends the fallback) when there is no match or the top distance exceeds the threshold.
 * The cited chunk is rank-1 (the answer is instructed to ground in the top content); the video cue
 * uses its startSec.
 */
export function createRetriever(deps: RetrieverDeps): RetrievePort {
  const limit = deps.limit ?? 3;
  return {
    async retrieve(creatorId, query): Promise<ReplyPlan | null> {
      const trimmed = query.trim();
      if (!trimmed) return null;

      const { vector } = await deps.embedding.embed(trimmed, 'RETRIEVAL_QUERY');
      await deps.usage.increment(creatorId, { embeddingsGenerated: 1 });
      const top = await deps.chunks.findNearest(creatorId, vector, limit);
      const best = top[0];
      if (!best) {
        deps.logger.info('retrieval: no chunks', { creatorId });
        return null;
      }
      if (best.distance > deps.cosineDistanceMax) {
        deps.logger.info('retrieval: below threshold', { creatorId, distance: best.distance });
        return null;
      }

      const answer = await deps.llm.draftReply(buildPrompt(trimmed, top));
      await deps.usage.increment(creatorId, { llmCallsMade: 1 });
      if (!answer.trim()) {
        deps.logger.warn('retrieval: empty draft', { creatorId });
        return null;
      }

      return {
        answer: answer.trim(),
        permalink: best.permalink,
        isVideo: best.mediaType === 'VIDEO',
        citedStartSec: best.startSec,
      };
    },
  };
}
