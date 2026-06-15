# Context: Onboarding / Identity

**Owns:** the `Creator` aggregate, per-creator access tokens, and the consent/active gate.

## Invariants
- A token is stored only as a Secret Manager ref (`tokenSecretRef`); never raw in Firestore (ADR 006).
- Every inbound event is gated: `creators/{recipientId}` must exist and be `status='active'` before
  any query/send. Unknown/uninstalled ⇒ ack 200 and drop.
- `me/subscribed_apps?subscribed_fields=messages` must be called once at subscribe (receiving DMs
  needs it separately from holding the permission).
- The connected account must be Business/Creator.

## Contracts
- Provides `getCreatorToken(ref)` and `Creator.status` to Messaging and Indexing (conformist).
- `refreshLongLivedToken` rotates before `tokenExpiresAt` (~60 days). `401`/`190` ⇒ `needs_reauth`.
