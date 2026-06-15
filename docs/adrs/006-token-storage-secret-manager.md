# ADR 006 — Per-creator tokens in Secret Manager (ref only in Firestore)

**Status:** Accepted · **Date:** 2026-06-15

## Context
Per-creator OAuth tokens are dynamic (can't live in `.env`) and are the crown jewels — a token can
DM as the creator. Storing the raw token in a Firestore field means one DB read (misconfig, backup
leak, over-broad service account) compromises every creator. Long-lived IG tokens also **expire
~60 days** and must be refreshed.

## Decision
- `creators/{creatorId}.tokenSecretRef` holds a **Secret Manager resource name**, never the raw token.
- `SecretStorePort` with a `secretmanager` driver (prod) and a `local` driver (dev, reads
  `CREATOR_TOKEN_<creatorId>` from env).
- `tokenExpiresAt` stored; a refresh job rotates the long-lived token before expiry.
- On `401` / IG subcode `190`, set `Creator.status = 'needs_reauth'` and surface it — do **not**
  treat auth errors as rate-limit backoff.

## Consequences
- Tokens never sit in plaintext in the app database.
- Creators whose token lapses go `needs_reauth` (observable) instead of silently failing.
