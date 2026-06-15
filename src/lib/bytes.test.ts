import { describe, it, expect } from 'vitest';
import { utf8ByteLength, truncateToBytes } from './bytes';

describe('bytes', () => {
  it('counts UTF-8 bytes, not chars', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2); // 2 bytes
    expect(utf8ByteLength('🎉')).toBe(4); // 4 bytes
  });

  it('returns the string unchanged when under the cap', () => {
    expect(truncateToBytes('hello', 1000)).toBe('hello');
  });

  it('truncates to the byte cap without splitting a multi-byte code point', () => {
    // "ééé" is 6 bytes. Cap at 5 must yield "éé" (4 bytes), not a broken "éé\x??".
    const out = truncateToBytes('ééé', 5);
    expect(out).toBe('éé');
    expect(utf8ByteLength(out)).toBeLessThanOrEqual(5);
  });

  it('never exceeds the cap even with emoji at the boundary', () => {
    const s = 'ab🎉cd'; // a,b = 2 bytes; 🎉 = 4; total 8
    const out = truncateToBytes(s, 5); // can fit "ab" (2) but not 🎉 (would be 6)
    expect(out).toBe('ab');
    expect(utf8ByteLength(out)).toBeLessThanOrEqual(5);
  });

  it('returns empty for a non-positive cap', () => {
    expect(truncateToBytes('x', 0)).toBe('');
  });
});
