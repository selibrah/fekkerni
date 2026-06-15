/** UTF-8 byte-length helpers. Meta caps message text at a BYTE count, not chars. */

const encoder = new TextEncoder();

export function utf8ByteLength(s: string): number {
  return encoder.encode(s).length;
}

/**
 * Truncate a string so its UTF-8 byte length is <= maxBytes, never splitting a
 * multi-byte code point. Appends nothing; pure truncation.
 */
export function truncateToBytes(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (utf8ByteLength(s) <= maxBytes) return s;
  // Walk by code point, accumulating byte cost.
  let bytes = 0;
  let out = '';
  for (const ch of s) {
    const cost = utf8ByteLength(ch);
    if (bytes + cost > maxBytes) break;
    bytes += cost;
    out += ch;
  }
  return out;
}
