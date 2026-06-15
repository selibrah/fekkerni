# Runbook — provision & go live

Everything here needs **your** GCP + Meta credentials; it cannot be automated for you. Replace
`PROJECT`, `REGION` (e.g. `us-central1`), and IDs as needed.

## 0. Prerequisites
- `gcloud` + `firebase` CLIs, authenticated. A GCP project with billing enabled.
- A Meta developer account and an Instagram **Business/Creator** account to connect.

## 1. Enable APIs
```bash
gcloud services enable \
  firestore.googleapis.com run.googleapis.com cloudtasks.googleapis.com \
  cloudscheduler.googleapis.com secretmanager.googleapis.com \
  aiplatform.googleapis.com --project PROJECT     # aiplatform only if using Vertex
```

## 2. Firestore
```bash
gcloud firestore databases create --location=REGION --project PROJECT   # if no DB yet

# Composite vector index (pre-filtered KNN). Dimension MUST equal EMBED_DIMS (768).
gcloud firestore indexes composite create \
  --collection-group=chunks --query-scope=COLLECTION \
  --field-config field-path=creatorId,order=ASCENDING \
  --field-config field-path=embedding,vector-config='{"dimension":"768","flat":"{}"}' \
  --project PROJECT

# TTL on webhook dedupe docs (auto-expire seen mids). Add a numeric/timestamp `at` field TTL:
gcloud firestore fields ttls update at \
  --collection-group=seen_mids --enable-ttl --project PROJECT
```
The vector index build is eventually-consistent — wait a few minutes.

## 3. Secrets
```bash
printf '%s' "$META_APP_SECRET" | gcloud secrets create fekkerni-meta-app-secret --data-file=- --project PROJECT
printf '%s' "$VERIFY_TOKEN"    | gcloud secrets create fekkerni-verify-token    --data-file=- --project PROJECT
```
Per-creator tokens are created automatically by the app (`SECRETS_DRIVER=secretmanager`) as
`fekkerni-creator-<creatorId>`; Firestore stores only the resource name (ADR 006).

## 4. Cloud Tasks
```bash
gcloud tasks queues create fekkerni-jobs --location=REGION --project PROJECT
```

## 5. Deploy to Cloud Run
```bash
gcloud run deploy fekkerni --source . --region REGION --project PROJECT --no-allow-unauthenticated \
  --set-env-vars QUEUE_DRIVER=cloudtasks,SECRETS_DRIVER=secretmanager,GOOGLE_CLOUD_PROJECT=PROJECT,IG_GRAPH_VERSION=v25.0,FLASH_MODEL=gemini-3.5-flash,EMBED_MODEL=gemini-embedding-001,EMBED_DIMS=768,COSINE_DISTANCE_MAX=0.4 \
  --set-secrets META_APP_SECRET=fekkerni-meta-app-secret:latest,VERIFY_TOKEN=fekkerni-verify-token:latest,GEMINI_API_KEY=fekkerni-gemini-key:latest
```
Then set `WORKER_BASE_URL` to the deployed URL and `WORKER_OIDC_SERVICE_ACCOUNT` to the run service
account, and grant that SA `roles/cloudtasks.enqueuer` + `roles/run.invoker` so Cloud Tasks can call
`/tasks`. Redeploy with those two env vars. Grant the run SA `roles/datastore.user`,
`roles/secretmanager.secretAccessor`, `roles/aiplatform.user` (if Vertex).

## 6. Schedulers (Cloud Scheduler → authenticated endpoints)
```bash
RUN_URL=$(gcloud run services describe fekkerni --region REGION --project PROJECT --format='value(status.url)')
gcloud scheduler jobs create http fekkerni-poll --schedule="0 * * * *" --uri="$RUN_URL/internal/poll-all" \
  --http-method=POST --oidc-service-account-email=SCHED_SA --location REGION --project PROJECT
gcloud scheduler jobs create http fekkerni-refresh --schedule="0 3 * * *" --uri="$RUN_URL/internal/refresh-tokens" \
  --http-method=POST --oidc-service-account-email=SCHED_SA --location REGION --project PROJECT
```
`/internal/*` is protected by Cloud Run IAM (`--no-allow-unauthenticated`); grant `SCHED_SA`
`roles/run.invoker`.

## 7. Meta app + webhook
1. Create an app → add **Instagram** → use **Instagram API with Instagram Login** (NOT the Facebook
   Login/Messenger path).
2. Webhooks → callback URL `https://<RUN_URL>/webhook`, verify token = your `VERIFY_TOKEN`, subscribe
   the **`messages`** field.
3. Permissions: `instagram_business_basic`, `instagram_business_manage_messages`.
4. App settings: Privacy Policy URL, 1024×1024 icon, App Category (see `docs/APP_REVIEW.md`).

## 8. Onboard a creator
1. Run the Instagram Business Login OAuth flow → obtain a long-lived token.
2. Store it (the app does this when you call its onboarding path, or seed manually): create
   `creators/{creatorId}` with `status:'active'`, `tokenSecretRef`, `tokenExpiresAt`.
3. Subscribe the app to the account's messages: `POST {base}/{version}/me/subscribed_apps?subscribed_fields=messages`
   (the IG adapter's `subscribeMessages` does this).
4. Backfill: `gcloud run jobs ...` or locally `npm run backfill -- --creator <creatorId>`.

## 9. Smoke test (end to end)
- [ ] `GET /webhook` handshake returns the challenge (Meta "Verify and Save" succeeds).
- [ ] A forged/unsigned `POST /webhook` returns 403; a correctly signed one returns 200 fast.
- [ ] `npm run backfill -- --creator <id>` indexes media; `npm run search -- --creator <id> "…"`
      returns sensible top-3 chunks and a reply.
- [ ] DM the creator account a question you know is answered in a post → bot replies with answer +
      permalink (and a "Watch from ~Xs" cue for a reel) within seconds.
- [ ] First reply includes the automation disclosure; a second message in the same thread does not.
- [ ] DM `STOP` → one confirmation, then no further auto-replies. `START` → re-enabled.
- [ ] Tune `COSINE_DISTANCE_MAX` with `npm run eval -- --creator <id> eval/cases.json`.
