# MASTER PROMPT — AIdentify (AaaS) Fix & Build Program, for Claude Code

> Run `claude` in the repo root and paste everything below the line. `CLAUDE.md` in the root is loaded
> automatically and holds the repo map and standing rules. This prompt replaces the GrokBot version: the stack
> assumptions are corrected to what the code really is, finished work is marked, and each phase has a check you can run.

---

## 0. Role

You are the lead full-stack engineer and UI/UX designer for **AIdentify (AaaS)**: an AI team for small businesses
(digital marketing agencies, dental and skin clinics, salons and gyms, coaches, real estate, coaching institutes,
interior design). The team is Front Desk, Follow-up, Reviews & Referrals, Social Media, Billing & Invoicing, plus the
chat assistant **Chief** and a full-screen **Bot Mode**.

v2.8 already fixed onboarding, navigation, the sidebar and the Chief flicker (see `docs/FIX-REPORT.md`).
Your job is the remaining phases in §4. Do not redo finished work; extend it.

## 1. How to work (Claude Code)

1. **Start in plan mode.** Read `CLAUDE.md`, `docs/FIX-REPORT.md` and the files a phase touches. Output a plan
   with the files you will change and the test you will add for each issue ID. Wait for "go".
2. **Stack facts, not assumptions.** Vanilla Node 20 ESM, no React, no ORM, no bundler. Pages are single HTML files
   (`clinic.html`, `index.html`). Storage is key-value rows (`lib/db.js`). Do not introduce a framework, Zod,
   BullMQ or a migration tool unless the phase says so and you have stated the trade-off first.
3. **One issue per commit**, message `fix(<ID>): …` or `feat(<ID>): …`, on a branch named `phase-N`. Tag
   `pre-phase-N` before you start.
4. **Verify, then report.** After each change run the narrowest test, then `npm test` before the phase report.
   For UI work also drive the page in headless Chrome (Playwright is installed; see `test/e2e/`).
5. **Zero hallucinated success.** A task is DONE only with: the diff, a test that failed before and passes now, and
   the real output. Anything needing live credentials, a public domain or a phone is **UNVERIFIED** with the exact
   steps a human must run. Never write "this should work".
6. **Every external call is verified.** After any provider call that returns an id (post, message, payment), read the
   final object back before reporting success, and surface the provider's own error text on failure.
7. **Secrets.** Never print `.env`, `data/kv.json`, tokens or keys. No credentials or personal accounts in code,
   seed data or samples.
8. **Phase report:** a table `Issue ID | Status (DONE / UNVERIFIED / BLOCKED) | Commit | Proof`, then stop and wait
   for "continue".

## 2. Platform constraints (design around them)

- **Facebook:** only **Pages** can be posted to. Personal profiles cannot, by any tool. Say so in the UI.
- **Instagram:** browser automation of the Create button is always blocked. Publishing is the Graph API content
  flow only: create container → poll `status_code` until `FINISHED` → `media_publish` → read back `permalink`.
  Needs an Instagram Business/Creator account linked to a Facebook Page, and a **public https JPEG URL**
  (no localhost, no private bucket). "API returned an id but nothing on the feed" means the container id was
  reported as the post, or publish ran before `FINISHED`.
- **Google OAuth:** a raw IP redirect (`http://54.81.208.96:3000`) is rejected. Live sign-in needs a real domain
  with HTTPS and the callback registered in Google Cloud Console and in Composio. `deploy/https/` has the setup script.
- **WhatsApp QR mode** (Baileys, `lib/waqr.js`) is unofficial and numbers can be restricted. Keep it behind the
  provider interface so the official Cloud API (`lib/clinic-whatsapp.js`) can replace it; show the risk line at
  connect time; rate-limit sends.

## 3. Already done in v2.8 (do not rebuild; tests guard these)

| Area | Done |
|---|---|
| Auth | Password show/hide; forgot/reset flow; sign-up no longer signs in (owner signs in with the new email and password); stale login error no longer leaks onto later screens; session expiry says "your progress is saved". |
| Onboarding | 7 accurate steps; tile click selects, OK advances, "Please select a business category to continue."; Digital Marketing Agency first; shared rules in `lib/onboarding-rules.js` enforced on page and server (name 2–60 with letters, locations only from the city list, services/audiences real text with limits and dedupe); multi-location picker with select/unselect and "Hyderabad +2"; industry service, audience and offer suggestions (nothing pre-selected); key tested before advancing, clear success/failure, Skip is never shown as validated; AWS region only for Bedrock; brief shows validated data only. |
| Navigation | Each step and screen is a history entry; Back/Forward/Refresh stay in the app and keep answers; draft saved to the account on every OK. |
| Layout | Sidebar is Dashboard · Front Desk · Social Media · Billing & Invoicing · Approvals · Settings for every industry. Front Desk has two primary buttons and tabs (Enquiries · Appointments · Follow-ups · Reviews & Referrals). Settings has six tabs incl. Integrations (Connect / Reconnect / Disconnect), Plan & usage, Privacy & data (export, delete data, delete account). First-visit tour. |
| Workflow | Enquiry → book (creates the person, marks enquiry booked) → completed → invoice (offer discount before GST, GSTIN on PDF) → paid → review / referral → follow-up. |
| Chief / Bot Mode | Frame is created once (no reload on re-render, no blink, no second sign-in); quiet loader until the session is confirmed; "Latest" jump button; edit-message already existed. Chief must read a post back before saying "published" and must lead with the real error on failure. |

## 4. Remaining work — execute in this order, one phase per response

### Done in v2.9 Phase 1 (do not redo)
WhatsApp by QR is the primary channel (free, owner's own number); customer messages go to Front Desk › Enquiries with
Accept / Decline; approved 1:1 sends with a 20/hour, 100/day cap; the paid API is "Bulk marketing" only; Bot Mode no
longer shows CRM, Owner Insights, Skills or Plugins; Instagram stops with a clear reason when JPEG conversion is missing.
Tests: `test/whatsapp-qr-v290.test.mjs`.

### Phase 2 — Starter credit and key security (ONB-6.3, ONB-6.4)
- **ONB-6.3** Skip → run on the platform key with a hard **$1.00 cap per account**, metered server-side per request
  (tokens × model price; the usage ledger is `lib/usage.js` + `clinicUsage` in `lib/clinic.js`). 80 % → banner;
  100 % → block AI calls with HTTP 402 `starter_credit_used` and show an **Upgrade** modal (add own key, or pick a
  plan). Settings › AI shows "Using starter credit — $0.37 left". Today a skipped key means agents stay off
  (`clinicAiBlock` in `lib/aikeys.js`); change that gate, and update `test/clinic-byok.test.mjs` deliberately.
- **ONB-6.4** Confirm keys are sealed at rest, never returned after save, never logged. Add a test that greps
  server logs and API responses for a saved key.

### Phase 3 — Onboarding enrichments (ONB-2.2, ONB-3.2 branches, ONB-5.2)
- **ONB-2.2** Google Business pre-fill: debounce 400 ms, ≥3 chars, server-side call to Places API (New) Text
  Search (key in env, never in the browser); dropdown of name + address; on select fetch details and fill
  address, phone, website, rating, `place_id`. Unknown fields stay empty. "My business isn't listed" option.
  Without `GOOGLE_PLACES_KEY` the feature hides itself. UNVERIFIED without a key: say so.
- **ONB-3.2** Branches UI inside onboarding (the data model `profile.locations[]` + `profile.branches[]` and the
  CSV paste in Settings already exist): per-location branch rows and bulk paste for 100+.
- **ONB-5.2** With a working key, one structured-JSON LLM call predicts 5–8 audiences for industry + services and
  merges them into the suggestion chips (still nothing pre-selected unless the owner taps). Fall back to the pack
  list on any error.

### Phase 4 — Data layer (DATA-1, DATA-2, DATA-3, CHF-2)
- **DATA-1** Propose, then implement, the move from one KV row per account to relational tables on Postgres
  (users, sessions, businesses, locations, branches, services, offers, contacts, appointments, invoices,
  invoice_items, payments, posts, post_targets, integrations, chat_threads, chat_messages, memory_facts,
  usage_ledger, audit_log) with `business_id` tenancy. Output the ERD (Mermaid), migration SQL, and a
  backfill script from the KV rows. Keep the KV file store working for local runs. This is a large change:
  plan it, get approval, land it behind `DATABASE_URL`.
- **DATA-2** Delete account must also revoke every integration token at the provider (call
  `/api/connectors/disconnect` logic for each connection), purge Chief memory, and email a completion notice.
  Today it deletes local data and the sign-in. Add export as a zip (JSON + CSV).
- **DATA-3** Audit log row for every external send: who approved, when, payload hash, provider response.
- **CHF-2** Chief memory: persist threads and messages server-side per user and business, rolling summary after N
  turns, long-term facts with retrieval (pgvector when on Postgres), business context injected through tool calls.

### Phase 5 — Integrations (INT-2 … INT-8, CHF-3 test)
- **INT-2** Internal publisher: `posts` with per-platform variants and a status machine
  (`draft → approved → scheduled → publishing → published | failed`), a queue with retries and backoff,
  idempotency keys, one adapter per platform. Decide and document: keep Composio as the transport for all four
  networks (current, one consistent path) or add direct Graph/LinkedIn/X adapters. After publish, fetch the post and
  store the permalink. Failed posts show the provider error and a Retry button.
- **INT-3** LinkedIn intermittent failures: log every request/response status, handle token refresh and 429
  backoff, find and state the root cause. UNVERIFIED without a live account.
- **INT-4** Facebook: Page picker after OAuth; refuse profile-only connections with the explanation.
- **INT-6** Festival calendar: 7 days before each festival auto-draft industry posts into Approvals with one-click
  **Approve & Schedule** (the calendar and one-click drafting exist in `lib/festivals.js`; add the scheduler and
  the scheduled/published/failed states).
- **INT-8b** WhatsApp auto-reply rules (business hours, FAQ, booking link) on top of the v2.9 inbox; every auto-reply logged.
- **CHF-3** Automated test: a mocked failed Instagram publish must produce a reply that starts with the failure.

### Phase 6 — Performance (PERF-1)
Measure first (Lighthouse + Chrome performance trace on `/clinic` signed in). Known suspects: `index.html` is
630 KB and is loaded inside the Chief panel; polling timers in the workplace (`wpInboxStart`, `ffStart`);
unpaginated tables (now capped at 25 in the owner app). Report before/after LCP and TTI. Target LCP < 2.5 s.

### Phase 6b — Landing page (LND-1)
Rebuild `home.html` as the conversion page: hero (outcome headline, CTA "Build my AI team — free") → industry
tiles (Digital Marketing first) → 3-step how it works → agent cards with concrete outcomes → "You approve
everything" → proof block (real, or clearly marked examples) → pricing in ₹ → FAQ → final CTA. Mobile-first, no
heavy libraries, WCAG AA, SEO + OG tags. Reuse the copy already in `home.html` and `landing-v2.html`.

### Phase 7 — Deployment and regression
- **AUTH-3** Google sign-in on the live server: domain + HTTPS (`deploy/https/setup-https.sh`), register the
  callback, hide the Google button when its env vars are missing.
- End-to-end run for **Dental clinic** and **Digital Marketing Agency**: sign up → sign in → onboard → enquiry →
  book → complete → invoice with offer → paid → review request → festival post approved → verified published.
  Final tracker table with every issue ID.

## 5. Definition of done (per issue)

Reproduced → root cause in one line → fixed → test added → `npm test` green → committed with the issue ID →
checked in the running app at 360 px and 1440 px with no console errors, and loading/empty/error states present.
No new hardcoded secrets, no `TODO` in shipped paths, no fake success messages.

**Start with Phase 2 in plan mode now.** Every phase begins with a step-by-step plan; wait for approval before writing code.
