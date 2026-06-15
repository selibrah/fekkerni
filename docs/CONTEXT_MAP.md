# Context Map

Fekkerni is a single deployable but splits into four bounded contexts plus a shared kernel.

```
                 ┌─────────────────┐
                 │   Onboarding    │  creators, OAuth tokens, webhook subscription, App Review
                 │  (Identity)     │
                 └───────┬─────────┘
                         │ provides token + active-creator gate
          ┌──────────────┼──────────────────────────┐
          ▼              ▼                            ▼
   ┌────────────┐  ┌────────────┐              ┌────────────┐
   │  Indexing  │  │ Retrieval  │◄─shared──────│  Messaging │
   │            │  │            │   kernel     │            │
   └─────┬──────┘  └─────┬──────┘              └─────┬──────┘
         │  writes       │ reads                     │ ingress + egress
         ▼               ▼                           ▼
        ╔═══════════════════════════╗
        ║  Shared kernel:           ║   the `chunks` schema + the embed() contract
        ║  Chunk + embed()@768 L2   ║   (768-d, L2-normalized) — Indexing and Retrieval
        ╚═══════════════════════════╝   MUST use identical dims/normalization/model.
```

## Contexts

- **Onboarding / Identity** — `docs/contexts/onboarding/CONTEXT.md`. Creator subscribe, per-creator
  token storage (Secret Manager) + refresh, `me/subscribed_apps`, the active-creator gate every
  inbound event passes through.
- **Messaging** — `docs/contexts/messaging/CONTEXT.md`. Webhook ingress (verify → dedupe → ack 200),
  STOP/START opt-out, one-time automation disclosure, the 24h window, outbound send.
- **Indexing** — `docs/contexts/indexing/CONTEXT.md`. Media → Chunks. Orchestrator (paginate, enqueue
  per media) + worker (download → transcribe → embed → idempotent write).
- **Retrieval** — `docs/contexts/retrieval/CONTEXT.md`. Query → answer. Embed query → findNearest →
  distance gate → injection-safe draft → output guardrail → reply.

## Relationships

- Onboarding → (Messaging, Indexing): supplies the access token and `Creator.status`. A
  **conformist** relationship: the other contexts accept the token/status as given.
- Messaging → Retrieval: Messaging hands an `InboundMessage` to Retrieval and sends its reply.
- Indexing & Retrieval share the kernel. Any change to dims/model/normalization is a kernel change
  and must update both sides + the vector index — tracked as an ADR.
