# App Review readiness

`instagram_business_manage_messages` is an **Advanced Access** permission — the app cannot message
real (non-admin) followers until App Review approves it. These are the **documented** gates (a STOP
keyword is good practice but is NOT itself a review gate):

- [ ] **App Review submission** for `instagram_business_basic` + `instagram_business_manage_messages`.
- [ ] **Business Verification** completed for the app's business.
- [ ] **Privacy Policy URL** set in app settings.
- [ ] **App icon** 1024×1024.
- [ ] **App Category** set.
- [ ] **Screencast** showing the end-to-end experience: log in, a follower sends a DM, the bot replies,
      messages clearly originate from your app. Narrate/caption it.
- [ ] **Reviewer test instructions + credentials**: provide step-by-step test steps and a
      **non-super-admin** dashboard login. Never share the Instagram account password.
- [ ] **Data handling**: answer the data-use questions; plan for the annual **Data Use Checkup**.
- [ ] Connected account is **Business/Creator** (not Personal).
- [ ] App subscribed to the **`messages`** webhook field (`me/subscribed_apps`).

## Built-in compliance the app already satisfies
- One-time **automation disclosure** on first reply in a conversation (policy/legal — CA, Germany).
- **STOP/START** opt-out (best practice; honored before any retrieval/send).
- Replies only inside the **24h window**, measured from the follower's message; never uses
  `HUMAN_AGENT` to bypass it for an automated reply.
- Outbound text capped at **1000 bytes**; the only URL emitted is the matched post's permalink
  (prompt-injection / phishing guardrail).
- Human-escalation hint in the disclosure and fallback copy (`src/messaging/copy.ts` — customize).

## During development (before Advanced Access)
You can exercise the app with app **roles** (admins/testers) and the connected test account in dev
mode. Use the offline `npm run search`/`npm run eval` to validate retrieval with zero Meta dependency.
