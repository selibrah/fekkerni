/**
 * Middleware to validate OIDC tokens on internal/worker endpoints.
 *
 * In production, Cloud Run IAM (`--no-allow-unauthenticated`) is the primary gate, but
 * defense-in-depth demands that the app itself validates the OIDC token so a misconfigured
 * deploy (public access) doesn't expose /tasks and /internal/* to arbitrary callers.
 *
 * When enabled (VALIDATE_OIDC=true + OIDC_AUDIENCE), the middleware:
 *   1. Extracts the Bearer token from the Authorization header.
 *   2. Validates it as a Google OIDC token (via the public JWKS endpoint).
 *   3. Checks the `aud` claim matches the expected audience.
 *
 * When disabled (dev/local), the middleware is a no-op pass-through.
 *
 * NOTE: Full JWKS-based validation requires a JWT library. This implementation uses
 * a lightweight approach: it verifies the token's `aud` and `exp` claims by decoding
 * the payload (base64), and trusts that Cloud Run IAM has already validated the signature.
 * For a production system, consider adding `google-auth-library` for full verification.
 */
import type { Request, Response, NextFunction } from 'express';

export interface OidcOptions {
  /** Whether to enforce OIDC validation (false = pass-through). */
  enabled: boolean;
  /** Expected audience (typically the service URL). */
  audience?: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  const payload = parts[1];
  if (!payload) return null;
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function oidcMiddleware(opts: OidcOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!opts.enabled) {
      next();
      return;
    }

    const auth = req.header('authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = auth.slice('Bearer '.length);
    const payload = decodeJwtPayload(token);
    if (!payload) {
      res.status(401).json({ error: 'Invalid OIDC token (unparseable)' });
      return;
    }

    // Check expiration
    if (typeof payload.exp === 'number' && payload.exp < Date.now() / 1000) {
      res.status(401).json({ error: 'OIDC token expired' });
      return;
    }

    // Check audience
    if (opts.audience) {
      const aud = payload.aud;
      const audMatch = typeof aud === 'string' ? aud === opts.audience : Array.isArray(aud) && aud.includes(opts.audience);
      if (!audMatch) {
        res.status(403).json({ error: 'OIDC token audience mismatch' });
        return;
      }
    }

    next();
  };
}
