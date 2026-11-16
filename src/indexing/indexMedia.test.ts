import { describe, it, expect } from 'vitest';
import { createIndexMedia, type IndexMediaDeps } from './indexMedia';
import type { GenAiClients } from '../lib/adapters/genai';
import {
  FakeChunkStore,
  FakeCreators,
  FakeEmbedding,
  FakeIg,
  FakeLlm,
  FakeMediaIndex,
  FakeSecrets,
  FakeUsage,
  silentLogger,
  testConfig,
} from '../testing/fakes';
import type { Creator, MediaItem, Segment } from '../types';

const creator: Creator = {
  creatorId: 'C',
  tokenSecretRef: 'local:C',
  tokenExpiresAt: null,
  status: 'active',
  pollHighWaterMark: null,
};

function setup(llmSegments: Segment[]) {
  const chunks = new FakeChunkStore();
  const mediaIndex = new FakeMediaIndex();
  const usage = new FakeUsage();
  const genai: GenAiClients = {
    embedding: new FakeEmbedding((t) => [t.length % 7, 1, 0]),
    llm: new FakeLlm({ segments: llmSegments }),
  };
  const deps: IndexMediaDeps = {
    creators: new FakeCreators().seed(creator),
    secrets: new FakeSecrets(),
    ig: new FakeIg(),
    genai,
    chunks,
    mediaIndex,
    cfg: testConfig(),
    logger: silentLogger(),
    usage,
  };
  return { deps, chunks, mediaIndex, genai, usage };
}

const videoMedia: MediaItem = {
  id: 'V',
  caption: 'reel caption',
  mediaType: 'VIDEO',
  mediaProductType: 'REELS',
  mediaUrl: 'https://cdn.test/v.mp4',
  permalink: 'https://instagram.com/reel/V',
  thumbnailUrl: null,
  timestamp: '2026-06-01T00:00:00.000Z',
};

describe('indexMedia idempotency (ADR 004)', () => {
  it('re-indexing identical content produces no duplicate chunks', async () => {
    const segs: Segment[] = [
      { startSec: 0, endSec: 30, text: 'intro' },
      { startSec: 30, endSec: 60, text: 'the trick' },
    ];
    const { deps, chunks } = setup(segs);
    const indexMedia = createIndexMedia(deps);

    await indexMedia('C', videoMedia);
    expect([...chunks.chunks.keys()].sort()).toEqual(['V_0', 'V_1']);

    await indexMedia('C', videoMedia); // identical re-run
    expect([...chunks.chunks.keys()].sort()).toEqual(['V_0', 'V_1']); // no duplicates
  });

  it('re-indexing with FEWER segments deletes the orphaned chunk (replace-by-mediaId)', async () => {
    const { deps, chunks } = setup([
      { startSec: 0, endSec: 30, text: 'intro' },
      { startSec: 30, endSec: 60, text: 'the trick' },
    ]);
    const indexMedia = createIndexMedia(deps);
    await indexMedia('C', videoMedia);
    expect([...chunks.chunks.keys()].sort()).toEqual(['V_0', 'V_1']);

    // Now the model returns a single segment (e.g. re-transcribe). Orphan V_1 must be removed.
    deps.genai.llm = new FakeLlm({ segments: [{ startSec: 0, endSec: 40, text: 'condensed' }] });
    await indexMedia('C', videoMedia);
    expect([...chunks.chunks.keys()].sort()).toEqual(['V_0']);
    expect(chunks.chunks.get('V_0')?.text).toBe('condensed');
  });

  it('marks complete and records segmentCount', async () => {
    const { deps, mediaIndex } = setup([{ startSec: 0, endSec: 30, text: 'x' }]);
    await createIndexMedia(deps)('C', videoMedia);
    const rec = await mediaIndex.get('C', 'V');
    expect(rec?.status).toBe('complete');
    expect(rec?.segmentCount).toBe(1);
  });
});

describe('indexMedia edge cases', () => {
  it('skips an IMAGE with an empty caption (no empty-text chunks)', async () => {
    const { deps, chunks, mediaIndex } = setup([]);
    const image: MediaItem = { ...videoMedia, id: 'I', mediaType: 'IMAGE', mediaProductType: 'FEED', caption: '   ' };
    await createIndexMedia(deps)('C', image);
    expect(await chunks.listIndexedMediaIds('C')).toEqual([]);
    expect((await mediaIndex.get('C', 'I'))?.status).toBe('skipped');
  });

  it('falls back to the caption when a video yields no transcript', async () => {
    const { deps, chunks } = setup([]); // silent video
    await createIndexMedia(deps)('C', videoMedia);
    const stored = [...chunks.chunks.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.text).toBe('reel caption');
  });

  it('does not transcribe a copyright-flagged video (no media_url) and uses the caption', async () => {
    const { deps, chunks } = setup([{ startSec: 0, endSec: 30, text: 'should not be used' }]);
    const flagged: MediaItem = { ...videoMedia, mediaUrl: null };
    await createIndexMedia(deps)('C', flagged);
    const stored = [...chunks.chunks.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.text).toBe('reel caption');
  });

  it('increments usage counters during transcription and embedding', async () => {
    const segs: Segment[] = [
      { startSec: 0, endSec: 30, text: 'intro' },
      { startSec: 30, endSec: 60, text: 'outro' },
    ];
    const { deps, usage } = setup(segs);
    await createIndexMedia(deps)('C', videoMedia);

    const counts = await usage.getToday('C');
    expect(counts.videosTranscribed).toBe(1);
    expect(counts.embeddingsGenerated).toBe(2); // 2 drafts -> 2 embeddings
  });
});
