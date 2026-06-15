import { describe, it, expect } from 'vitest';
import { createBackfill, type BackfillDeps } from './backfill';
import {
  FakeChunkStore,
  FakeCreators,
  FakeIg,
  FakeQueue,
  FakeSecrets,
  silentLogger,
  testConfig,
} from '../testing/fakes';
import type { Creator, Job, MediaItem } from '../types';

const creator: Creator = {
  creatorId: 'C',
  tokenSecretRef: 'local:C',
  tokenExpiresAt: null,
  status: 'active',
  pollHighWaterMark: null,
};

const media = (id: string, type: MediaItem['mediaType'], day: number): MediaItem => ({
  id,
  caption: `cap ${id}`,
  mediaType: type,
  mediaProductType: type === 'VIDEO' ? 'REELS' : 'FEED',
  mediaUrl: 'https://cdn.test/x',
  permalink: `https://instagram.com/p/${id}`,
  thumbnailUrl: null,
  timestamp: `2026-06-${String(day).padStart(2, '0')}T00:00:00.000Z`,
});

describe('backfill cost cap (ADR-aligned)', () => {
  it('clamps videos by the dollar ceiling when it is tighter than the count cap', async () => {
    const ig = new FakeIg();
    // 5 videos + 2 images
    ig.media = [
      media('V1', 'VIDEO', 10),
      media('V2', 'VIDEO', 9),
      media('V3', 'VIDEO', 8),
      media('V4', 'VIDEO', 7),
      media('V5', 'VIDEO', 6),
      media('I1', 'IMAGE', 5),
      media('I2', 'IMAGE', 4),
    ];
    const queue = new FakeQueue();
    const deps: BackfillDeps = {
      creators: new FakeCreators().seed(creator),
      secrets: new FakeSecrets(),
      ig,
      chunks: new FakeChunkStore(),
      queue,
      // ceiling 0.06 / 0.03 per video => max 2 videos (tighter than maxBackfillVideos=200)
      cfg: testConfig({ BACKFILL_COST_CEILING_USD: '0.06' }),
      logger: silentLogger(),
    };

    const res = await createBackfill(deps)('C');
    // 2 images (always kept) + 2 newest videos = 4 enqueued; 3 videos deferred
    expect(res).toEqual({ enqueued: 4, deferredVideos: 3 });
    const videoJobs = queue.jobs.filter((j: Job) => j.kind === 'index_media' && j.media.mediaType === 'VIDEO');
    expect(videoJobs).toHaveLength(2);
    // newest videos kept (V1 day10, V2 day9)
    const keptIds = videoJobs.map((j) => (j.kind === 'index_media' ? j.media.id : '')).sort();
    expect(keptIds).toEqual(['V1', 'V2']);
  });
});
