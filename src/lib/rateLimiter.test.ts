import { describe, it, expect } from 'vitest';
import { RateLimiter } from './rateLimiter';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('RateLimiter', () => {
  it('allows up to maxConcurrent calls simultaneously', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 2 });
    let concurrent = 0;
    let maxSeen = 0;
    const task = () =>
      limiter.run('reply', async () => {
        concurrent++;
        maxSeen = Math.max(maxSeen, concurrent);
        await sleep(20);
        concurrent--;
      });
    await Promise.all([task(), task(), task()]);
    expect(maxSeen).toBe(2);
  });

  it('prioritises reply lane over index lane', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    const order: string[] = [];

    // Start a long-running task to fill the single slot
    const blocker = limiter.run('index', async () => {
      await sleep(30);
      order.push('blocker');
    });
    // Allow the blocker to start
    await sleep(5);

    // Queue an index task, then a reply task — reply should run first
    const indexTask = limiter.run('index', async () => {
      order.push('index');
    });
    const replyTask = limiter.run('reply', async () => {
      order.push('reply');
    });

    await Promise.all([blocker, indexTask, replyTask]);
    // After the blocker completes, the reply should run before the index
    expect(order).toEqual(['blocker', 'reply', 'index']);
  });

  it('works with maxConcurrent=1 as a simple mutex', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    const results: number[] = [];
    const task = (n: number) =>
      limiter.run('reply', async () => {
        results.push(n);
        await sleep(5);
      });
    await Promise.all([task(1), task(2), task(3)]);
    expect(results).toEqual([1, 2, 3]);
  });
});
