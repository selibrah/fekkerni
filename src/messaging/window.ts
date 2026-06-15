/** The standard messaging window: a bot may only reply within N hours of the follower's message. */
export function withinWindow(inboundTsMs: number, now: Date, windowHours: number): boolean {
  if (!Number.isFinite(inboundTsMs) || inboundTsMs <= 0) return false;
  const elapsedMs = now.getTime() - inboundTsMs;
  if (elapsedMs < 0) return true; // clock skew: treat as just-arrived
  return elapsedMs <= windowHours * 3600_000;
}
