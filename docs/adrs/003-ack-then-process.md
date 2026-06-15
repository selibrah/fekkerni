# ADR 003 — Ack-then-process webhook architecture

**Status:** Accepted · **Date:** 2026-06-15

## Context
Meta retries any non-200 / slow webhook delivery for up to 36h. The reply path does embed →
findNearest → Gemini draft → send (multiple seconds). Doing that synchronously inside the webhook
request causes timeouts → redelivery → **duplicate replies and duplicate paid Gemini calls**.

## Decision
The webhook handler does only: verify signature → **dedupe** (persist `mid` durably) →
**active-creator gate** → return **200 immediately** → `enqueue` a `process_message` job. A separate
worker runs retrieval + send. Indexing follows the same shape (one `index_media` job per media).

- Dedupe is written **before** the async work and is durable across instances/cold starts.
- The send is idempotent per `mid` so task-level retries never double-send.
- `QueuePort` has a `local` (in-process) driver for dev/smoke and a `cloudtasks` driver for prod.

## Consequences
- Webhook latency is bounded and decoupled from LLM latency.
- Requires a queue (Cloud Tasks) and an authenticated worker endpoint in production.
