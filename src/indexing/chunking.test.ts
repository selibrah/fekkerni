import { describe, it, expect } from 'vitest';
import { buildChunkDrafts, computeContentHash, type ChunkInputs } from './chunking';

describe('buildChunkDrafts', () => {
  it('IMAGE → one caption chunk', () => {
    expect(buildChunkDrafts({ mediaType: 'IMAGE', caption: 'sourdough tips', segments: [] })).toEqual([
      { index: 0, text: 'sourdough tips', startSec: null, endSec: null },
    ]);
  });

  it('IMAGE with empty caption and no description → no chunks (skip)', () => {
    expect(buildChunkDrafts({ mediaType: 'IMAGE', caption: '   ', segments: [] })).toEqual([]);
  });

  it('IMAGE with description enrichment adds a second chunk', () => {
    const out = buildChunkDrafts({ mediaType: 'IMAGE', caption: 'cap', segments: [], imageDescription: 'a loaf' });
    expect(out.map((c) => c.text)).toEqual(['cap', 'a loaf']);
    expect(out.map((c) => c.index)).toEqual([0, 1]);
  });

  it('VIDEO → one chunk per segment with timestamps', () => {
    const out = buildChunkDrafts({
      mediaType: 'VIDEO',
      caption: 'reel caption',
      segments: [
        { startSec: 0, endSec: 30, text: 'intro' },
        { startSec: 30, endSec: 60, text: 'the trick' },
      ],
    });
    expect(out).toEqual([
      { index: 0, text: 'intro', startSec: 0, endSec: 30 },
      { index: 1, text: 'the trick', startSec: 30, endSec: 60 },
    ]);
  });

  it('VIDEO with no segments falls back to the caption', () => {
    const out = buildChunkDrafts({ mediaType: 'VIDEO', caption: 'silent reel caption', segments: [] });
    expect(out).toEqual([{ index: 0, text: 'silent reel caption', startSec: null, endSec: null }]);
  });

  it('CAROUSEL_ALBUM → caption + child-video segments', () => {
    const out = buildChunkDrafts({
      mediaType: 'CAROUSEL_ALBUM',
      caption: 'swipe for steps',
      segments: [{ startSec: 5, endSec: 35, text: 'slide 2 video' }],
    });
    expect(out.map((c) => c.text)).toEqual(['swipe for steps', 'slide 2 video']);
  });
});

describe('computeContentHash', () => {
  it('is stable for identical inputs and changes when the chunk set changes', () => {
    const base: ChunkInputs = { mediaType: 'IMAGE', caption: 'hello', segments: [] };
    const h1 = computeContentHash(base);
    expect(computeContentHash({ ...base })).toBe(h1);
    expect(computeContentHash({ ...base, caption: 'hello!' })).not.toBe(h1);
  });

  it('changes when a video gains/loses a segment', () => {
    const a = computeContentHash({ mediaType: 'VIDEO', caption: 'c', segments: [{ startSec: 0, endSec: 30, text: 'a' }] });
    const b = computeContentHash({
      mediaType: 'VIDEO',
      caption: 'c',
      segments: [
        { startSec: 0, endSec: 30, text: 'a' },
        { startSec: 30, endSec: 60, text: 'b' },
      ],
    });
    expect(a).not.toBe(b);
  });
});
