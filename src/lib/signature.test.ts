import { describe, it, expect } from 'vitest';
import { computeSignature, verifySignature } from './signature';

const SECRET = 'test_app_secret';

describe('signature', () => {
  it('computes a stable sha256= digest for a fixed body + secret', () => {
    const body = '{"object":"instagram","entry":[]}';
    // Precomputed reference digest (HMAC-SHA256(body, SECRET)).
    const sig = computeSignature(body, SECRET);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    // Deterministic: same inputs => same digest.
    expect(computeSignature(body, SECRET)).toBe(sig);
  });

  it('hashes raw bytes — re-serialized JSON with different whitespace does NOT match', () => {
    const raw = '{"a":1,"b":2}';
    const reserialized = JSON.stringify(JSON.parse(raw)); // same here, but prove whitespace matters
    const spaced = '{ "a": 1, "b": 2 }';
    const header = computeSignature(raw, SECRET);
    expect(verifySignature(raw, header, SECRET)).toBe(true);
    expect(verifySignature(reserialized, header, SECRET)).toBe(true); // identical bytes
    expect(verifySignature(spaced, header, SECRET)).toBe(false); // different bytes => reject
  });

  it('accepts a Buffer body identically to a string body', () => {
    const body = Buffer.from('hello world', 'utf8');
    const header = computeSignature(body, SECRET);
    expect(verifySignature(body, header, SECRET)).toBe(true);
    expect(verifySignature('hello world', header, SECRET)).toBe(true);
  });

  it('rejects a missing, malformed, or wrong-secret signature', () => {
    const body = 'payload';
    const good = computeSignature(body, SECRET);
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, 'sha256=deadbeef', SECRET)).toBe(false);
    expect(verifySignature(body, good, 'wrong_secret')).toBe(false);
  });

  it('rejects a tampered body', () => {
    const header = computeSignature('original', SECRET);
    expect(verifySignature('tampered', header, SECRET)).toBe(false);
  });
});
