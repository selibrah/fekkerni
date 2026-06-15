import { describe, it, expect } from 'vitest';
import { l2norm, l2normalize } from './normalize';

describe('l2normalize', () => {
  it('produces a unit vector (||v|| ≈ 1)', () => {
    const { vector, norm } = l2normalize([3, 4]);
    expect(l2norm(vector)).toBeCloseTo(1, 10);
    expect(norm).toBeCloseTo(5, 10); // original norm preserved for assertions
    expect(vector[0]).toBeCloseTo(0.6, 10);
    expect(vector[1]).toBeCloseTo(0.8, 10);
  });

  it('keeps an already-unit vector unit', () => {
    const { vector } = l2normalize([0, 1, 0]);
    expect(l2norm(vector)).toBeCloseTo(1, 12);
  });

  it('throws on a zero vector', () => {
    expect(() => l2normalize([0, 0, 0])).toThrow();
  });

  it('throws on a non-finite vector', () => {
    expect(() => l2normalize([Number.NaN, 1])).toThrow();
  });
});
