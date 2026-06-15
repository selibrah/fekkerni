import { describe, it, expect } from 'vitest';
import { parseSegments, toSeconds, UnparseableSegmentsError } from './segments';

describe('toSeconds', () => {
  it('handles numbers, SS, MM:SS, H:MM:SS, numeric strings', () => {
    expect(toSeconds(18)).toBe(18);
    expect(toSeconds('18')).toBe(18);
    expect(toSeconds('0:18')).toBe(18);
    expect(toSeconds('1:05')).toBe(65);
    expect(toSeconds('1:02:03')).toBe(3723);
    expect(toSeconds('nope')).toBeNull();
    expect(toSeconds(null)).toBeNull();
  });
});

describe('parseSegments', () => {
  it('parses a clean JSON array of {startSec,endSec,text}', () => {
    const out = parseSegments('[{"startSec":0,"endSec":30,"text":"intro"},{"startSec":30,"endSec":60,"text":"step one"}]');
    expect(out).toEqual([
      { startSec: 0, endSec: 30, text: 'intro' },
      { startSec: 30, endSec: 60, text: 'step one' },
    ]);
  });

  it('tolerates code fences and surrounding prose', () => {
    const out = parseSegments('Here you go:\n```json\n[{"startSec":5,"endSec":35,"text":"hi"}]\n```\nDone.');
    expect(out).toEqual([{ startSec: 5, endSec: 35, text: 'hi' }]);
  });

  it('converts MM:SS timestamps and key aliases', () => {
    const out = parseSegments('[{"start":"0:18","end":"0:48","transcript":"deglaze the pan"}]');
    expect(out).toEqual([{ startSec: 18, endSec: 48, text: 'deglaze the pan' }]);
  });

  it('accepts a {segments:[...]} wrapper', () => {
    const out = parseSegments('{"segments":[{"startSec":1,"endSec":2,"text":"x"}]}');
    expect(out).toEqual([{ startSec: 1, endSec: 2, text: 'x' }]);
  });

  it('drops empty-text and invalid-time segments', () => {
    const out = parseSegments('[{"startSec":0,"endSec":5,"text":"  "},{"startSec":"bad","text":"y"},{"startSec":10,"endSec":40,"text":"keep"}]');
    expect(out).toEqual([{ startSec: 10, endSec: 40, text: 'keep' }]);
  });

  it('clamps endSec to startSec when end is missing or before start', () => {
    const out = parseSegments('[{"startSec":20,"text":"no end"},{"startSec":50,"endSec":10,"text":"reversed"}]');
    expect(out).toEqual([
      { startSec: 20, endSec: 20, text: 'no end' },
      { startSec: 50, endSec: 50, text: 'reversed' },
    ]);
  });

  it('returns [] for a valid empty array (silent video)', () => {
    expect(parseSegments('[]')).toEqual([]);
  });

  it('throws when there is no array at all (caller retries)', () => {
    expect(() => parseSegments('I could not transcribe this video.')).toThrow(UnparseableSegmentsError);
  });
});
