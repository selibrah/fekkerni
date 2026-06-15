# Context: Messaging

**Owns:** webhook ingress, opt-out/disclosure, the 24h window, and outbound send.

## Invariants
- Handling order is fixed: **HMAC → dedupe(mid) → active-creator → STOP/START → opt-out → retrieval**.
  STOP short-circuits before any retrieval/send except its single confirmation.
- Ack-then-process (ADR 003): verify → dedupe → 200, then enqueue. No heavy work in the request.
- Only text messages are processed; echoes (`is_echo`) and non-text events are dropped.
- Send only inside the 24h window, measured from the follower's inbound timestamp, and only if not
  opted out. Never use `HUMAN_AGENT` to bypass the window for an automated reply.
- Outbound text ≤ `MAX_REPLY_BYTES` (1000) UTF-8 bytes; the only URL is the resolved permalink.
- First reply in a conversation is prefixed with a one-time automation disclosure.

## Contracts
- Consumes `getCreatorToken` + active-creator from Onboarding.
- Hands an `InboundMessage` to Retrieval; sends Retrieval's reply.
