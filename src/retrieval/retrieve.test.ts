import { describe, it, expect } from 'vitest';
import { createRetriever } from './retrieve';
import { FakeChunkStore, FakeEmbedding, FakeLlm, silentLogger } from '../testing/fakes';
import { l2normalize } from '../lib/normalize';
import type { ChunkInput } from '../types';

function chunk(over: Partial<ChunkInput> & { chunkId: string; embedding: number[] }): ChunkInput {
  const norm = l2normalize(over.embedding);
  return {
    creatorId: 'C',
    mediaId: over.chunkId.split('_')[0] ?? 'm',
    permalink: `https://instagram.com/p/${over.chunkId}`,
    mediaType: 'IMAGE',
    mediaProductType: 'FEED',
    text: 'some caption',
    startSec: null,
    endSec: null,
    embeddingNorm: norm.norm,
    postedAt: new Date('2026-01-01'),
    ...over,
    embedding: norm.vector,
  };
}

async function seedStore() {
  const store = new FakeChunkStore();
  await store.replaceChunksForMedia('C', 'A', [chunk({ chunkId: 'A_0', embedding: [1, 0] })]);
  await store.replaceChunksForMedia('C', 'B', [chunk({ chunkId: 'B_0', embedding: [0, 1] })]);
  return store;
}

describe('createRetriever (the gate)', () => {
  it('returns a plan for a close match and embeds the query as RETRIEVAL_QUERY', async () => {
    const store = await seedStore();
    const embedding = new FakeEmbedding((t) => (t === 'about A' ? [1, 0.02] : [0, 1]));
    const retrieve = createRetriever({
      chunks: store,
      embedding,
      llm: new FakeLlm({ reply: 'Use approach A.' }),
      cosineDistanceMax: 0.4,
      logger: silentLogger(),
    });
    const plan = await retrieve.retrieve('C', 'about A');
    expect(plan).not.toBeNull();
    expect(plan?.permalink).toBe('https://instagram.com/p/A_0');
    expect(plan?.answer).toBe('Use approach A.');
    expect(embedding.calls[0]?.taskType).toBe('RETRIEVAL_QUERY');
  });

  it('returns null (fallback) when the top distance exceeds COSINE_DISTANCE_MAX', async () => {
    const store = await seedStore();
    // Query equidistant-ish → distance to nearest ≈ 0.293, above a strict 0.1 cap.
    const embedding = new FakeEmbedding(() => [1, 1]);
    const retrieve = createRetriever({
      chunks: store,
      embedding,
      llm: new FakeLlm(),
      cosineDistanceMax: 0.1,
      logger: silentLogger(),
    });
    expect(await retrieve.retrieve('C', 'unrelated question')).toBeNull();
  });

  it('returns null when the creator has no chunks', async () => {
    const retrieve = createRetriever({
      chunks: new FakeChunkStore(),
      embedding: new FakeEmbedding(() => [1, 0]),
      llm: new FakeLlm(),
      cosineDistanceMax: 0.4,
      logger: silentLogger(),
    });
    expect(await retrieve.retrieve('C', 'anything')).toBeNull();
  });

  it('sets isVideo + citedStartSec from the matched chunk', async () => {
    const store = new FakeChunkStore();
    await store.replaceChunksForMedia('C', 'V', [
      chunk({ chunkId: 'V_2', embedding: [1, 0], mediaType: 'VIDEO', startSec: 22, endSec: 52 }),
    ]);
    const retrieve = createRetriever({
      chunks: store,
      embedding: new FakeEmbedding(() => [1, 0]),
      llm: new FakeLlm({ reply: 'Sear then add stock.' }),
      cosineDistanceMax: 0.4,
      logger: silentLogger(),
    });
    const plan = await retrieve.retrieve('C', 'q');
    expect(plan?.isVideo).toBe(true);
    expect(plan?.citedStartSec).toBe(22);
  });
});
