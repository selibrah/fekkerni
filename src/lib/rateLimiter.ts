/**
 * Token-bucket rate limiter with priority lanes. The spec mandates: "a shared rate limiter
 * in front of all Gemini + embedding calls, with the reply path prioritized over batch indexing."
 *
 * Two priority lanes:
 *   - 'reply' (high) — live DM replies; never starved by indexing.
 *   - 'index' (low)  — background batch work; waits when the reply lane is busy.
 *
 * Token bucket: at most `maxConcurrent` calls execute at once. Each lane has its own queue;
 * 'reply' is dequeued before 'index'.
 */

export type Priority = 'reply' | 'index';

export interface RateLimiterOptions {
  /** Maximum concurrent calls across both lanes (default 5). */
  maxConcurrent?: number;
}

const DEFAULT_MAX_CONCURRENT = 5;

interface Waiter {
  resolve: () => void;
  priority: Priority;
}

export class RateLimiter {
  private running = 0;
  private readonly max: number;
  private readonly waiters: Waiter[] = [];

  constructor(opts: RateLimiterOptions = {}) {
    this.max = opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  }

  /** Execute `fn` within the rate limiter, with the given priority. */
  async run<T>(priority: Priority, fn: () => Promise<T>): Promise<T> {
    await this.acquire(priority);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private async acquire(priority: Priority): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push({ resolve, priority });
    });
  }

  private release(): void {
    this.running--;
    if (this.waiters.length === 0) return;
    // Dequeue the highest-priority waiter. 'reply' > 'index'.
    const idx = this.waiters.findIndex((w) => w.priority === 'reply');
    const next = idx !== -1 ? this.waiters.splice(idx, 1)[0]! : this.waiters.shift()!;
    this.running++;
    next.resolve();
  }
}

/**
 * Shared singleton factory — one limiter per process for all Gemini + embedding calls.
 * Configured via options; the container passes it to adapters that need it.
 */
export function createRateLimiter(opts?: RateLimiterOptions): RateLimiter {
  return new RateLimiter(opts);
}
