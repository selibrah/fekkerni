import { describe, it, expect } from 'vitest';
import { withinWindow } from './window';

const ONE_HOUR_MS = 3600_000;

describe('withinWindow', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('returns true when inbound is within the window', () => {
    const inboundTs = now.getTime() - 23 * ONE_HOUR_MS; // 23h ago
    expect(withinWindow(inboundTs, now, 24)).toBe(true);
  });

  it('returns true at exactly the boundary', () => {
    const inboundTs = now.getTime() - 24 * ONE_HOUR_MS; // exactly 24h ago
    expect(withinWindow(inboundTs, now, 24)).toBe(true);
  });

  it('returns false beyond the window', () => {
    const inboundTs = now.getTime() - 25 * ONE_HOUR_MS; // 25h ago
    expect(withinWindow(inboundTs, now, 24)).toBe(false);
  });

  it('returns true when the inbound timestamp is in the future (clock skew)', () => {
    const futureTs = now.getTime() + 5000; // 5s in the future
    expect(withinWindow(futureTs, now, 24)).toBe(true);
  });

  it('returns false for non-finite timestamp', () => {
    expect(withinWindow(NaN, now, 24)).toBe(false);
    expect(withinWindow(Infinity, now, 24)).toBe(false);
  });

  it('returns false for zero or negative timestamp', () => {
    expect(withinWindow(0, now, 24)).toBe(false);
    expect(withinWindow(-100, now, 24)).toBe(false);
  });

  it('works with a custom window (e.g. 1h)', () => {
    const inboundTs = now.getTime() - 30 * 60_000; // 30min ago
    expect(withinWindow(inboundTs, now, 1)).toBe(true);

    const stale = now.getTime() - 2 * ONE_HOUR_MS; // 2h ago
    expect(withinWindow(stale, now, 1)).toBe(false);
  });
});
