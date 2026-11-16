import { describe, it, expect } from 'vitest';
import { FakeUsage } from './usage';

describe('FakeUsage', () => {
  it('initializes to zero counters and handles increments correctly', async () => {
    const usage = new FakeUsage();
    const today = await usage.getToday('creator-1');
    expect(today).toEqual({
      videosTranscribed: 0,
      embeddingsGenerated: 0,
      llmCallsMade: 0,
    });

    await usage.increment('creator-1', { videosTranscribed: 1 });
    await usage.increment('creator-1', { embeddingsGenerated: 5, llmCallsMade: 2 });

    const updated = await usage.getToday('creator-1');
    expect(updated).toEqual({
      videosTranscribed: 1,
      embeddingsGenerated: 5,
      llmCallsMade: 2,
    });

    // Another creator should be independent
    const other = await usage.getToday('creator-2');
    expect(other).toEqual({
      videosTranscribed: 0,
      embeddingsGenerated: 0,
      llmCallsMade: 0,
    });
  });
});
