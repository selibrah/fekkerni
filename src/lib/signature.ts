import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validate Meta's X-Hub-Signature-256 header.
 *
 * The signature is HMAC-SHA256 over the RAW, unparsed request body bytes, keyed by the
 * app secret, formatted as "sha256=<hexdigest>". We MUST hash the exact bytes received —
 * never a re-serialized parsed object — and compare in constant time.
 */
export function computeSignature(rawBody: Buffer | string, appSecret: string): string {
  const hmac = createHmac('sha256', appSecret);
  hmac.update(rawBody);
  return 'sha256=' + hmac.digest('hex');
}

export function verifySignature(
  rawBody: Buffer | string,
  header: string | undefined | null,
  appSecret: string,
): boolean {
  if (!header || typeof header !== 'string') return false;
  const expected = computeSignature(rawBody, appSecret);
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return timingSafeEqual(a, b);
}
