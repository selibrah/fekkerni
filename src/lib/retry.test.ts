import { describe, it, expect } from 'vitest';
import { withRetry, isRetryable } from './retry';
import { RateLimitError, TransientError } from './errors';

describe('isRetryable', () => {
  it('returns true for RateLimitError', () => {
    expect(isRetryable(new RateLimitError('rate limited'))).toBe(true);
  });

  it('returns true for TransientError', () => {
    expect(isRetryable(new TransientError('server error'))).toBe(true);
  });

  it('returns false for a generic Error', () => {
    expect(isRetryable(new Error('something bad'))).toBe(false);
  });

  it('returns true for network-like error messages', () => {
    expect(isRetryable(new Error('fetch failed'))).toBe(true);
    expect(isRetryable(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryable(new Error('socket hang up'))).toBe(true);
  });
});

describe('withRetry', () => {
  it('returns immediately on success', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 42;
    });
    expect(result).toBe(42);
    expect(calls).toBe(1);
  });

  it('retries on retryable errors and eventually succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new TransientError('fail');
        return 'ok';
      },
      { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('throws after exhausting retries', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new TransientError('always fails');
        },
        { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 1 },
      ),
    ).rejects.toThrow('always fails');
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('auth failed');
        },
        { maxRetries: 3, initialDelayMs: 1 },
      ),
    ).rejects.toThrow('auth failed');
    expect(calls).toBe(1);
  });

  it('respects RateLimitError retryAfterMs', async () => {
    let calls = 0;
    const start = Date.now();
    const result = await withRetry(
      async () => {
        calls++;
        if (calls === 1) throw new RateLimitError('throttled', 50);
        return 'done';
      },
      { maxRetries: 2, initialDelayMs: 1 },
    );
    expect(result).toBe('done');
    // Should have waited at least ~50ms due to retryAfterMs
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('accepts a custom shouldRetry predicate', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('custom');
        },
        {
          maxRetries: 3,
          initialDelayMs: 1,
          shouldRetry: (_e, attempt) => attempt < 1, // retry only once
        },
      ),
    ).rejects.toThrow('custom');
    expect(calls).toBe(2); // 1 initial + 1 retry
  });
});
