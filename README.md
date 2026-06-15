# Fekkerni

Turn an Instagram creator's own content into a **DM-searchable knowledge base**. A follower DMs
the creator a question; Fekkerni finds the most relevant post or video moment from that creator's
archive and replies in the DM with a short answer + the post link (and, for video, a
"watch from ~0:18" cue).

> Status: **MVP codebase** — all logic implemented and unit-tested against mocked
> Gemini/Graph/Firestore. The live-deploy steps (GCP/Meta provisioning, OAuth, App Review) require
> your credentials; see [Going live](#going-live).

## Architecture

Ports & adapters (hexagonal). Pure domain logic and application services depend only on the
interfaces in [`src/lib/ports.ts`](src/lib/ports.ts); real SDK adapters live in `src/lib/adapters/`.

Bounded contexts (see [`docs/CONTEXT_MAP.md`](docs/CONTEXT_MAP.md)):

| Context | Code | Responsibility |
|---|---|---|
| Onboarding | `src/lib/adapters/ig-graph`, `secrets` | creator subscribe, token storage/refresh, webhook subscription |
| Messaging | `src/webhook`, `src/messaging` | webhook ingress, ack-then-process, opt-out/disclosure, 24h window, send |
| Indexing | `src/indexing` | media → chunks: fetch, transcribe, embed, idempotent write, poll |
| Retrieval | `src/retrieval` | query → answer: embed, findNearest, distance gate, draft, guardrails |

Async model: the webhook **fast-acks** (verify → dedupe → 200) and enqueues a job; a separate
worker does embed → findNearest → draft → send. Same for indexing (one job per media).

## Quick start (local, mocked)

```bash
cp .env.example .env      # fill in at least META_APP_SECRET, VERIFY_TOKEN, and Gemini auth
npm install
npm test                  # all unit tests (mocked Gemini/Graph/Firestore)
npm run typecheck
npm run lint
npm run build
```

## Offline retrieval CLI (no Instagram needed)

```bash
npm run search -- "how do I deglaze a pan?"   # prints top-3 chunks + the reply the bot would send
npm run eval  -- eval/cases.example.json       # hit-rate@1 / @3 over {question, expectedMediaId}
```

(These run against Firestore — use the [Firestore emulator](#firestore-emulator) for a no-cost local DB.)

## Indexing

```bash
npm run backfill -- --creator <creatorId>      # enqueues per-media indexing jobs (cost-capped)
npm run poll     -- --creator <creatorId>      # incremental poll (new media since high-water mark)
```

## Firestore vector index (required — not auto-created)

Pre-filtered KNN (`where('creatorId','==',x).findNearest(embedding)`) needs a **composite** vector
index. Create it once per database (dimension MUST equal `EMBED_DIMS`):

```bash
gcloud firestore indexes composite create \
  --collection-group=chunks \
  --query-scope=COLLECTION \
  --field-config field-path=creatorId,order=ASCENDING \
  --field-config field-path=embedding,vector-config='{"dimension":"768","flat":"{}"}' \
  --database='(default)'
```

The build is eventually-consistent — allow a few minutes before queries succeed.

## Environment variables

See [`.env.example`](.env.example) — every var is documented inline. Highlights:
`FLASH_MODEL=gemini-3.5-flash` (NOT 2.5 — deprecated), `EMBED_MODEL=gemini-embedding-001` @
`EMBED_DIMS=768` (manual L2-normalize, handled in code), `COSINE_DISTANCE_MAX=0.4` (distance, 0..2,
smaller=closer), `IG_GRAPH_VERSION=v25.0`, `QUEUE_DRIVER`, `SECRETS_DRIVER`.

## Going live

The runbook (GCP/Firebase project, Secret Manager, Cloud Tasks/Scheduler, Meta app, App Review,
OAuth, deploy, smoke test) lives in [`docs/RUNBOOK.md`](docs/RUNBOOK.md) and the App Review readiness
checklist in [`docs/APP_REVIEW.md`](docs/APP_REVIEW.md).

## Firestore emulator

```bash
# requires the Firebase CLI
firebase emulators:start --only firestore
export FIRESTORE_EMULATOR_HOST=localhost:8080
```

## Decisions

Architecture Decision Records in [`docs/adrs/`](docs/adrs/).
