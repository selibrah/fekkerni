import { describe, it, expect } from 'vitest';
import { buildReply, sanitizeAnswer, assembleOutbound } from './reply';
import { utf8ByteLength } from '../lib/bytes';
import type { ReplyPlan } from './types';

const post: ReplyPlan = {
  answer: 'Deglaze with a splash of wine over medium heat.',
  permalink: 'https://instagram.com/p/ABC',
  isVideo: false,
  citedStartSec: null,
};
const video: ReplyPlan = {
  answer: 'Sear first, then add stock.',
  permalink: 'https://instagram.com/reel/XYZ',
  isVideo: true,
  citedStartSec: 22,
};

describe('sanitizeAnswer', () => {
  it('strips any URL from the model answer (injection/hallucination guard)', () => {
    expect(sanitizeAnswer('see http://evil.test/login for more')).toBe('see for more');
    expect(sanitizeAnswer('visit https://phish.example now')).toBe('visit now');
  });
});

describe('buildReply', () => {
  it('formats a post as answer + permalink', () => {
    expect(buildReply(post, 1000)).toBe(
      'Deglaze with a splash of wine over medium heat.\nhttps://instagram.com/p/ABC',
    );
  });

  it('formats a video with the −4s cue (max(0, startSec-4))', () => {
    expect(buildReply(video, 1000)).toBe(
      'Sear first, then add stock.\nWatch from ~18s\nhttps://instagram.com/reel/XYZ',
    );
  });

  it('clamps the cue at 0 for early timestamps', () => {
    expect(buildReply({ ...video, citedStartSec: 2 }, 1000)).toContain('Watch from ~0s');
  });

  it('preserves the permalink and cue, truncating only the answer, under the byte cap', () => {
    const longAnswer = 'x'.repeat(2000);
    const out = buildReply({ ...video, answer: longAnswer }, 80);
    expect(utf8ByteLength(out)).toBeLessThanOrEqual(80);
    expect(out).toContain('Watch from ~18s');
    expect(out).toContain('https://instagram.com/reel/XYZ');
  });

  it('respects the byte cap with multi-byte answers', () => {
    const out = buildReply({ ...post, answer: 'é'.repeat(500) }, 60);
    expect(utf8ByteLength(out)).toBeLessThanOrEqual(60);
    expect(out).toContain('https://instagram.com/p/ABC');
  });
});

describe('assembleOutbound', () => {
  it('prepends the disclosure on first contact and stays within the cap', () => {
    const out = assembleOutbound({ plan: post, fallback: 'fb', disclosure: 'BOT NOTICE', maxBytes: 1000 });
    expect(out.startsWith('BOT NOTICE\n\n')).toBe(true);
    expect(out).toContain('https://instagram.com/p/ABC');
    expect(utf8ByteLength(out)).toBeLessThanOrEqual(1000);
  });

  it('omits the disclosure when null', () => {
    const out = assembleOutbound({ plan: post, fallback: 'fb', disclosure: null, maxBytes: 1000 });
    expect(out.startsWith('Deglaze')).toBe(true);
  });

  it('uses the fallback (no permalink) when plan is null', () => {
    const out = assembleOutbound({ plan: null, fallback: 'I could not find that', disclosure: null, maxBytes: 1000 });
    expect(out).toBe('I could not find that');
  });

  it('keeps the disclosure within the cap even when the body is huge', () => {
    const huge: ReplyPlan = { ...post, answer: 'z'.repeat(5000) };
    const out = assembleOutbound({ plan: huge, fallback: 'fb', disclosure: 'NOTICE', maxBytes: 120 });
    expect(out.startsWith('NOTICE\n\n')).toBe(true);
    expect(utf8ByteLength(out)).toBeLessThanOrEqual(120);
    expect(out).toContain('https://instagram.com/p/ABC');
  });
});
