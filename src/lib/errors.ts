/** Typed errors so callers can distinguish auth failures from rate limits from the rest. */

/** Auth/token failure (HTTP 401 / IG error subcode 190). Caller should mark needs_reauth, NOT backoff-retry. */
export class AuthError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Rate limit (HTTP 429). Caller should backoff and retry, honoring retryAfterMs if present. */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/** A transient upstream failure that is safe to retry with backoff. */
export class TransientError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TransientError';
  }
}

export function isAuthError(e: unknown): e is AuthError {
  return e instanceof AuthError;
}
export function isRateLimitError(e: unknown): e is RateLimitError {
  return e instanceof RateLimitError;
}
