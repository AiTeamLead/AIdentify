# AIdentify (AaaS) — repo rules for Claude Code

Claude Code loads this file automatically. The full task brief is `docs/CLAUDE_MASTER_PROMPT.md`.
Current status of every issue is `docs/FIX-REPORT.md`.

## What this repo is (confirmed from the code, do not assume otherwise)

- **Runtime:** Node 20+, ES modules, **no framework and no build step**. `npm start` runs `server.js`.
- **Server:** `server.js` (static pages + routing) → `lib/backend.js` `handle()` → feature modules in `lib/`.
- **Owner app (SMB product):** `clinic.html`, one file, vanilla JS, served at `/clinic`, `/Marketing`, `/Realestate`, … (one URL per industry pack).
- **Workplace / Chief / Bot Mode:** `index.html` (served at `/app`). The owner app frames it for Bot Mode and the Chief panel.
- **Industry config:** `lib/clinic-packs.js`. One pack per industry. Layout code never branches on industry; only labels, suggestions and sample rows come from the pack.
- **Field rules:** `lib/onboarding-rules.js`. Loaded by the page as `/onboarding-rules.js` and imported by the server. **One source of truth.** Never duplicate a rule in a page.
- **Storage:** key-value rows (`lib/db.js`): a local `data/kv.json`, or Postgres/Neon when `DATABASE_URL` is set. One row per account per concern (`as_clinic:<email>`, `as_conn:<email>`, …).
- **Integrations:** `lib/connectors.js` + Composio (`lib/composio*.js`). Social posting is done by Chief through the connected toolkit; rules are in `lib/orchestrator.js` (`NET`, `socialPlaybook`).
- **Tests:** `npm test` (Node's test runner, `test/*.test.mjs`). Each test starts an isolated server with a temp data dir (`test/helpers.mjs`). Never point a test at the real `.env` or `data/`.

## Rules

0. **Plan first, always.** Before changing any code, post a numbered step-by-step plan (files, tests, what stays
   UNVERIFIED) and wait for the team's explicit approval. Do not start on your own plan. Fix known bugs before more testing.
1. **Read before you write.** Open the function you are changing and its callers. Pages are long single files: search, do not guess.
2. **Branch + commits.** Work on a branch, one issue ID per commit (`fix(ONB-2.1): reject numeric-only business names`). Merge to `main` only when `npm test` passes.
3. **No claimed success without proof.** Done = diff + a test that fails before and passes after + the actual output. If it cannot be run here (needs live Meta/Google/LinkedIn credentials, a real domain, a phone), mark it **UNVERIFIED** and say exactly what a human must run.
4. **Secrets.** Nothing hardcoded. `.env` and `data/` are never committed and never printed. Keys are stored sealed (`lib/aikeys.js`) and shown masked.
5. **Validation lives in `lib/onboarding-rules.js`.** The server re-checks everything the page sends (`/api/clinic/profile`).
6. **Same layout for every industry.** New wording goes into the pack, not into an `if (role === …)`.
7. **Nothing leaves the business without approval.** Any new outbound action goes through the approval queue and writes an audit entry.
8. **`node_modules` is per machine.** `sharp` (JPEG for Instagram) ships one binary per OS. Run `npm install` on the machine that runs the app; never copy `node_modules` between Windows and Linux.
9. **WhatsApp:** QR (free, `lib/waqr.js`) is the primary channel; the paid API (`lib/clinic-whatsapp.js`) is for bulk marketing only. Customer sends happen only after approval, 1:1, under the cap in `WAQR_LIMITS`.

10. **Deploys must keep `data/`** (or use `DATABASE_URL`). Never ship a `data/` folder in a release zip: it replaces live accounts.
11. **Sample data is off for real accounts.** Tests turn it on with `SAMPLE_DATA=on` (set in `test/helpers.mjs`).

## Commands

```bash
npm install          # once
npm start            # http://localhost:3000  (owner app: /clinic or /Marketing)
npm test             # full suite, ~4 minutes
node --test test/onboarding-v280.test.mjs   # the v2.8 rules + workflow tests
```
