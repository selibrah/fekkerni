/**
 * Exponential backoff + jitter retry utility. Used to wrap all Gemini, embedding,
 * and IG Graph calls so transient failures (5xx, rate limits, network blips) are
 * automatically retried with capped exponential backoff and full jitter.
 *
 * The spec mandates: "exponential backoff + jitter + max-retry + dead-letter for
 * download, Files API upload, transcription, embedding, and send."
 */
import { isRateLimitError, type RateLimitError } from './errors';

export interface RetryOptions {
  /** Maximum number of retries (default 3, i.e. up to 4 total attempts). */
  maxRetries?: number;
  /** Initial backoff in ms before the first retry (default 500). */
  initialDelayMs?: number;
  /** Maximum backoff in ms (default 30_000). */
  maxDelayMs?: number;
  /** Multiplier applied to the delay after each retry (default 2). */
  multiplier?: number;
  /** Predicate: should this error be retried? Default: retries RateLimitError and 5xx-class errors. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Optional label for log messages. */
  label?: string;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_MULTIPLIER = 2;

/**
 * Default retry predicate: retry on RateLimitError, transient errors,
 * and generic Errors whose message suggests a transient condition.
 */
export function isRetryable(error: unknown): boolean {
  if (isRateLimitError(error)) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Transient network / server errors
    if (msg.includes('econnreset') || msg.includes('socket hang up')) return true;
    if (msg.includes('fetch failed') || msg.includes('network')) return true;
    if (/5\d{2}/.test(msg)) return true;
    if (error.name === 'TransientError') return true;
  }
  return false;
}

/** Full jitter: uniform random in [0, delay]. */
function jitter(delayMs: number): number {
  return Math.floor(Math.random() * delayMs);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Execute `fn` with exponential backoff + jitter. If the error is a RateLimitError
 * with a `retryAfterMs`, that value takes precedence over the computed delay.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelay = opts.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelay = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const multiplier = opts.multiplier ?? DEFAULT_MULTIPLIER;
  const shouldRetry = opts.shouldRetry ?? ((e) => isRetryable(e));

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt >= maxRetries || !shouldRetry(e, attempt)) {
        throw e;
      }
      // Compute delay: use Retry-After from rate limit errors if available,
      // otherwise exponential backoff with full jitter.
      let delay: number;
      if (isRateLimitError(e) && (e as RateLimitError).retryAfterMs) {
        delay = (e as RateLimitError).retryAfterMs! + jitter(1000);
      } else {
        const baseDelay = Math.min(maxDelay, initialDelay * Math.pow(multiplier, attempt));
        delay = jitter(baseDelay);
      }
      await sleep(delay);
    }
  }
  throw lastError;
}
