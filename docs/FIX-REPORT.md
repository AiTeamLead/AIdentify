# Fix report — v2.10 (13 Nov 2026), with v2.9 Phase 1 and v2.8 below

## v2.13 — lead workflow for the other industries (your seven flowcharts + Other)

| Industry | Status | How it was checked |
|---|---|---|
| Digital marketing agency | DONE | automated test + browser, enquiry to Closed Won |
| Dental clinic | DONE | automated test + browser, enquiry to Treatment Started |
| Skin, hair and aesthetic clinic | DONE | automated test + browser |
| Coach or consultant | DONE | automated test + browser |
| Salon, gym or studio | DONE | automated test + browser, to Member Joined |
| Interior design and home services | DONE | automated test + browser, to Advance Paid |
| Coaching institute | DONE | automated test + browser, to Enrolled |
| Other business | DONE | automated test + browser as a bakery; words come from the business type |
| Real estate | unchanged | its own tests and browser run still pass |

Changes made to your flowcharts (same five as real estate, applied everywhere): score decides follow-up timing; 3 unanswered follow-ups move to monthly nurturing and a lead can close as Lost with a reason; day-before reminder and a did-not-come branch; won continues into invoice, review and referral; "customer said stop" ends all messages. One addition: a quick Book button on the Pipeline row for a customer who only wants a slot.

Simplifications to know about:
- Aesthetic clinic: "capture photos" and "send results with consent" are not built; no photos are stored or sent.
- Dental and aesthetic: doctor or specialist availability is checked as a free calendar slot, not per doctor.
- Institute: seat counts per batch are not tracked; mark a full batch as Paused in the Catalogue.
- Matching uses the words in the catalogue names, so name items the way customers ask for them.
- Reminders and follow-ups are drafted when you press the button; nothing runs on a timer.

## v2.12 — Nagendra's test round (Document45)

| # | Issue | Valid? | Status | How it was checked |
|---|---|---|---|---|
| 1 | Tour Back button text not visible | Yes | FIXED | browser |
| 2 | "Knowledge base ready" popup over Chief's chat box | Yes | FIXED | browser |
| 3 | Chief Approve / Deny / Always allow do nothing | Yes | FIXED | reproduced in a browser, then automated test + browser |
| 4 | Gmail Connect from Settings does not complete | Yes | FIXED in code, NOT tested against live Composio / Google | code + browser (button and flow start only) |
| 5 | Skills validation | Partly | Works as designed for the text in the screenshot (random letters are refused on purpose); messages made clearer | automated test + browser |
| 6 | Book strategy call: no Save button, date not kept | Yes | FIXED | browser |
| 7 | Marketing Guide as a full handbook | Enhancement | DONE | browser |

Cause of #3: the server accepted the decision, but it also updated the account's shared data; the Chief panel then saw "newer data on the server", reloaded its older copy of the chat, and the card showed "Waiting for you" again.

Not verified here: a real Gmail / Composio sign-in from Settings (needs your Composio and Google accounts), and Chief drafting posts with a real AI key (the approval buttons were tested on real pending approvals, with the AI replaced by a stand-in).

## v2.11 — real-estate workflow (approved for real estate only)

| What | Status | How it was checked |
|---|---|---|
| Your flowchart, enquiry to Closed Won, on the Pipeline screen | DONE | automated test + browser run (23 steps) |
| Same number enquires again: lead updated, no duplicate | DONE | automated test |
| Missing details asked for; no-match explained with what to adjust | DONE | automated test + browser |
| Matching, ranking, score, Hot / Warm / Cold | DONE | automated test + browser |
| WhatsApp only with consent; otherwise call or email draft | DONE | automated test |
| Site visit: calendar check, alternative slots, sales-rep note, reminder | DONE | automated test + browser |
| Human handoff, sale, Closed Won, property marked Sold | DONE | automated test + browser |
| Change 1: score decides follow-up timing | DONE | automated test |
| Change 2: 3 unanswered -> monthly nurturing; Lost with reason | DONE | automated test |
| Change 3: day-before reminder; did-not-come branch | DONE | automated test |
| Change 4: Closed Won -> booking-amount invoice, review, referral | DONE | automated test + browser |
| Change 5: customer said stop -> nothing more drafted | DONE | automated test |
| Catalogue in Settings (add, paste a list, status) | DONE | browser |
| Dashboard funnel, Guide, Chief answers | DONE | browser; Chief answer by automated test |
| "Classs booked today" typo | DONE | code |
| Other eight industries | NOT STARTED | waiting for your approval; a test confirms they are unchanged |

Not automatic yet, by design: the reminder and follow-ups are drafted when you press the button (the Pipeline shows "Reminder due" / "Follow-up due"); nothing runs on a timer. Messages reaching a real WhatsApp number were not tested here (no phone linked in this environment).

## v2.10 — the team's second test round (issues2.pdf)

**Status words:** DONE = changed, with an automated test and a headless-Chrome check. UNVERIFIED = built, but it
needs a live account, a phone or your server to confirm. NOT AN APP BUG = cause is outside the app.

| # | Issue from issues2.pdf | Status | What changed |
|---|---|---|---|
| D1 | Business name accepts numbers | DONE | Letters only (plus spaces and & . ' -). "24 Seven Classes" is refused. |
| D2 | Location: accept typed places that make sense, add "Other" | DONE | City list stays. A place not in the list gets an "Other: add …" row; it must be real words, letters only. "sdfgsdfg" is refused. |
| D3 | Offers accept meaningless typed text | DONE | Nonsense check (keyboard runs, repeated letters, no vowels) and wrong-industry check. |
| D4 | Customers accept meaningless typed text | DONE | Same nonsense check. |
| D5 | Services accept anything ("face cleaning" in a coaching institute) | DONE | Each industry has its word list; an entry made only of another industry's words is refused with the reason. In Book and Invoice forms the service is a pick-list of the business's own services. The server applies the same check. |
| D5b | AI check of typed entries | NOT DONE | I planned an AI relevance check when a key is connected. The word-list check covers the reported cases without AI cost, so I left the AI check out. Say if you still want it. |
| D6 | Booking accepts past dates | DONE | Refused in the form (minimum = now) and on the server. |
| L1 | Credentials not saving; "already registered" but sign-in says the email does not exist | DONE / UNVERIFIED | Could not reproduce in the code: sign-up then sign-in works in every letter-case (test). Two real causes fixed: (1) the delivery zip carried a `data/` folder, so each redeploy replaced live accounts with old ones; the zip no longer has it and the server prints where accounts are stored at every start. (2) the sign-in was kept only for the open tab; it is now remembered. Confirm on your server after the next deploy. |
| S1 | Social scheduling / channel selection | NOT AN APP BUG + DONE | The screenshot shows facebook.com blocked by your office network (Microsoft Security). Separately, post drafts now have a network checklist. |
| S2 | "Other" business (Bakery) shows Appointments | DONE | Wording follows the typed business type: bakery/shop → Orders, clinic → Appointments, others → Bookings. |
| S3 | Festival click should offer Instagram, LinkedIn, Facebook, X and Select all | DONE | Checklist window; only ticked networks are drafted. |
| S4 | AI usage and cost from the OpenRouter key shows nothing | DONE / UNVERIFIED | Every AI call is counted (Chief was not listed before), totals come from the month's counters, the tab loads fresh numbers with Refresh. For an OpenRouter key the tab also shows the spend OpenRouter reports; that call could not be tested here (no internet access to OpenRouter). |
| S5 | A connected app is shown several times (Slack) | DONE | One row per app. |
| S6 | Add CRM and Skills to the left sidebar | DONE | CRM: every contact with history and search. Skills: up to 12 saved instructions that every draft and Chief follow. |
| S7 | Remove "Needs approval" from the dashboard | DONE | Approvals stays in the sidebar. |
| S8 | Privacy & data shows "failed to fetch" | DONE / UNVERIFIED | Export, delete data and delete account all pass on a test server, so the server was not reachable when the team clicked (for example mid-restart). The page now says so in a sentence, forms show their own errors, and Export downloads a dated file. If it happens again, send the server log line from that minute. |
| S9 | Move "Your records" from Integrations to Privacy & data | DONE | |
| S10 | Remove "Reminders & quiet hours"; remove plans from "Plan & usage" | DONE | Settings tabs: Business profile · AI & API key · Integrations · Usage · Privacy & data. Reminders keep the built-in defaults (9:00–20:00, 2 per person per 7 days). |
| S11 | Remove dummy data | DONE | A new account starts empty. |
| S12 | Workflow guidance for each business | DONE | In the app: **Guide** in the sidebar, in the business's own words. Document: `docs/WORKFLOWS.md` with a section for each of the 9 industries. |
| C1 | Chief takes too long | PARTIAL | Plain questions about records (unpaid invoices, today's schedule, open enquiries, who needs follow-up, revenue this month, how many customers) are answered from the records with no AI call: under 1.5 s in the test, typically milliseconds. Everything else still depends on your AI model's speed; I could not measure that here (no live model). A faster model in Settings › AI & API key is the biggest lever. |
| C2 | LinkedIn: picture should be embedded | UNVERIFIED | Chief's LinkedIn rule now requires uploading the picture first and attaching it, never pasting the link. Needs one live post to confirm. |
| C3 | Facebook not sending | UNVERIFIED | Chief's Facebook rule now lists the Page, posts with the Page id, and names the missing permission if Meta refuses. Needs a live Page on a network that allows facebook.com. |
| C4 | WhatsApp QR from Chief | DONE / UNVERIFIED | Typing "connect my WhatsApp" answers at once and opens the QR window. A real scan needs a phone. |

**Tests:** `npm test` → see the end of the hand-over message. Browser runs: 43 steps for this round, 13 steps for WhatsApp.

**Changes to earlier behaviour you should know:** real accounts no longer get sample rows; Bot Mode still hides the
CRM agent (the CRM is now a screen in the owner app); the v2.8 rule "names may contain digits" is replaced by letters only.

---

# v2.9 Phase 1 and v2.8 (12 Nov 2026)

## v2.9 Phase 1 (approved plan, steps 1–6)

| Step | Item | Status | Proof |
|---|---|---|---|
| 1 | Bot Mode: Skills, CRM (and Owner Insights, Plugins) removed from the owner's view | DONE | `test/whatsapp-qr-v290.test.mjs` (agents list = 5 team agents), browser run |
| 2 | WhatsApp QR is the main connect option in Chief and Settings › Integrations | DONE | browser run: QR card first, connect → connected → disconnect |
| 3 | Official API only as "Bulk marketing (official API, paid)" | DONE | browser run; delivery uses QR first, API second, wa.me link last |
| 4 | One WhatsApp layer, send cap, risk line, auto-reconnect | DONE / UNVERIFIED | cap and group refusal tested; auto-reconnect needs a real phone |
| 5 | Lead triage: Accept / Decline, declined numbers kept only as a hash | DONE | unit + end-to-end test (decline never returns, accept → enquiry, reply → approval → sent) |
| 6 | Instagram: stop with the real reason when JPEG conversion is unavailable | DONE | full suite green incl. `media-public.test.mjs` once `sharp` matches the OS |
| — | **Real QR scan with a phone** | UNVERIFIED | Run `npm start` on a server that stays running, open Settings › Integrations › Connect with QR, scan from WhatsApp › Linked devices, send yourself a message, then send one from another phone. |

`npm test`: 173 tests, 171 pass, 2 skipped, 0 fail.

---


Sources: `Fixing issues using Grokbot.docx`, `Issues1.pdf`, `GrokBot_Master_Prompt_AIdentify.md`.
Stack confirmed from the code: Node 20 ESM, no framework, single-file pages (`clinic.html` owner app, `index.html`
workplace / Chief / Bot Mode), key-value storage. The Grok prompt assumed React, Zod, an ORM and BullMQ; none exist.

**Status words:** DONE = changed and proven by an automated test and a headless-Chrome run in this pass.
ALREADY = was already correct in the uploaded zip; checked, not changed. PARTIAL = part shipped, rest listed.
OPEN = not started; it is a phase in `docs/CLAUDE_MASTER_PROMPT.md`. UNVERIFIED = needs live credentials.

Proof: `test/onboarding-v280.test.mjs` (7 tests) and a 69-step browser run (sign-up → sign-in → 7 steps →
dashboard → enquiry → booking → invoice → paid → settings → Bot Mode). Full suite: see the end of this file.

## Issues1.pdf (newest list)

| # | Issue | Status | What changed / root cause |
|---|---|---|---|
| 1 | Create account signs in automatically | DONE | Sign-up now closes the session the server opens and returns to **Sign in** with the email kept and "Account created. Sign in…". |
| 2 | Business name accepts numbers | DONE | 2–60 chars, must include a letter, letters/numbers/spaces/`& . , ' - ( )`, never an email. Counter `n/60`, hard max length. **Decision:** digits are allowed next to letters ("24 Seven Dental"); numbers-only is refused. |
| 3 | Multiple locations, "+2" display | DONE | Searchable picker + popular chips, up to 25 cities, preview shows "Hyderabad +2". |
| 4 | Location accepts numbers / symbols | DONE | Only a city from the supported list (120+ Indian cities) is accepted. Typed text that is not picked blocks OK. |
| 5 | Services accept numbers / symbols | DONE | Each entry 2–40 chars with real letters, no symbols; max 20; case-insensitive dedupe ("Already added."). |
| 6 | Audiences accept numbers / symbols | DONE | Same rule, 2–60 chars, max 10. "Families within 5 km" is valid; "99999" is not. |
| • | Selected cities cannot be unselected | DONE | Chips and list rows are toggles; × and Backspace also remove. |
| • | Random words in services | PARTIAL | Symbols, numbers and one-letter entries are refused. A made-up word made of letters cannot be detected without a dictionary; suggestions are offered first to reduce it. |
| • | Customers come pre-filled | DONE | Nothing is pre-selected. Industry recommendations are shown as chips to tap. |
| • | AWS region shows for every provider | DONE | Root cause: the field was marked `hidden`, but the form's `label { display:flex }` rule overrode it. Fixed globally (`[hidden] { display:none !important }`). |
| • | Unneeded dashboard components (Skills, CRM) | PARTIAL | Owner app sidebar is now exactly six items. "Skills" and "CRM" are inside the workplace app shown in Bot Mode (`index.html`); that app was not restructured in this pass. |
| • | Marketing agency sees clinic data | DONE | New **Digital marketing agency** pack (first tile, `/Marketing`): clients, strategy calls, retainers, its own services, audiences, offers and sample rows. Sample drafts now use the owner's business name. Eka.care (clinic software) only shows for clinics. |
| • | Chief scroll button | DONE | The chat had no jump control. Added a "↓ Latest" button that appears when scrolled up. |
| • | Settings "Integrations" button redirects | DONE | Integrations is a real tab: status + Connect / Reconnect / Disconnect per account. |
| • | Usage appears twice | DONE | One place: Settings › Plan & usage. |
| • | Same sidebar, domain-specific content | DONE | See `docs/WORKFLOWS.md`. |
| • | Step-by-step workflow + user guide per domain | DONE | `docs/WORKFLOWS.md`. |
| • | Add email / social / WhatsApp integrations | PARTIAL | Listed with connect/disconnect in Settings › Integrations (uses the existing connector backend). WhatsApp QR still opens from Chief › Apps. Live connections UNVERIFIED here (need provider credentials and HTTPS). |

## Fixing issues using Grokbot.docx

| ID | Issue | Status | Notes |
|---|---|---|---|
| AUTH-1 | Password show/hide | ALREADY | Present on sign-in and create account. |
| AUTH-2 | Forgot password | ALREADY | Request → single-use 30-minute link → reset; covered by `test/signin-page.test.mjs`. Needs SMTP env to send real mail. |
| AUTH-3 | Google sign-in "not set up on this server" | OPEN | Needs a domain + HTTPS and the callback registered (Google refuses raw IPs). Phase 7. |
| AUTH-4 | "Email or password is incorrect" on the brief screen | DONE | Root cause: one shared error/toast variable was never cleared after a failed sign-in. Errors now expire and are cleared on every step. |
| AUTH-5 | Bot Mode asks to sign in again | DONE | Root cause: the Bot Mode iframe was rebuilt on every re-render, reloading the workplace and re-running sign-in; the workplace also showed its sign-in form until auth finished. Frame is now created once; a quiet loader shows until the session is confirmed. |
| AUTH-6 | Chief / Bot Mode blinking, three redirect screens | DONE | Same root cause as AUTH-5. |
| AUTH-7 / NAV-1 | Back goes to login; refresh loses progress | DONE | Root cause: the app never created history entries, so Back left the page. Each step (`?step=3`) and each screen is now a history entry; answers are saved to the account on every OK and to the tab; refresh resumes. |
| AUTH-8 / DATA-2 | Delete account | PARTIAL | Settings › Privacy & data: Export → Delete my data → Delete my account (existed, now in one place). Revoking provider tokens on account delete is OPEN (Phase 3). |
| ONB-1.1 | Tile click auto-advances; OK inconsistent | DONE | Click selects; OK or Enter advances; message when nothing is selected. |
| ONB-1.2 | Digital Marketing tile | DONE | First tile. |
| ONB-2.1 / 3.1 / 4.1 / 5.1 | Field validation | DONE | One rules file, `lib/onboarding-rules.js`, loaded by the page and enforced again by the server (`/api/clinic/profile` returns 400 with per-field errors). |
| ONB-2.2 | Google Business pre-fill | OPEN | Needs a Google Places key. Phase 2. |
| ONB-3.2 | Multiple locations / branches | PARTIAL | Multi-location done. Branches: stored (`profile.branches`) with bulk paste in Settings › Business profile; no per-branch UI inside onboarding yet. |
| ONB-4.2 / 4.3 | Suggested services and offers | DONE | Per-industry lists; offers stored structured (`percent` / `flat` / `other`) and applied as invoice discounts. |
| ONB-5.2 | Audience prediction | PARTIAL | Recommendations come from the industry config (instant, no AI cost). LLM prediction is Phase 2. **Decision:** the audience step stays; it is one tap with recommendations and feeds every draft. |
| ONB-6.1 | API key OK unclear | DONE | OK tests the key with the provider: "Validating…", "✅ API key validated successfully." or "❌ reason". Never advances on failure. |
| ONB-6.2 | Provider/model mismatch, region | DONE / ALREADY | Region fixed (above). Models load per provider and reset on change (already present). |
| ONB-6.3 | Skip → $1 starter credit + upgrade modal | OPEN | Today Skip means agents stay off until a key is added, and the UI says so. Phase 1. |
| ONB-6.4 | Key security | ALREADY | Keys are sealed at rest and shown masked. An explicit leak test is in Phase 1. |
| ONB-7 | Brief shows email in name/city | DONE | Brief is built only from validated answers; each Edit jumps to its step. |
| NAV-2 | Direct navigation to protected routes | ALREADY | Signed-out visits get the sign-in page; incomplete onboarding resumes. |
| NAV-3 | Product tour | DONE | Five steps, Next / Back / Skip, remembered per account. |
| DSH-1 | Dashboard as the owner's single view | DONE | Six KPI tiles, approvals, today's schedule, weekly summary, ₹ recovered, workflow strip, setup checklist. Sample rows are tagged SAMPLE. |
| DSH-2 | Front Desk: two buttons, modals, merged tabs | DONE | Removed: Owner Insights, Connections, Pricing, Usage & cost, Privacy, Clinic visit kit and standalone Follow-up / Reviews from the sidebar; inline add-forms; per-page "Save rules" boxes (now Settings › Reminders); the redundant "15-minute setup" button on the dashboard. |
| DSH-3 | End-to-end workflow | PARTIAL | Enquiry → booked → completed → invoice → paid → review/referral → follow-up works in the UI and API. A formal event log per transition is OPEN (Phase 3, DATA-3). |
| DSH-4 | Billing audit | PARTIAL | Added offer/coupon discount (before GST), GSTIN on invoices, overdue totals, modal form with checks. Numbering stays `INV-1001…` (existing tests depend on it); CGST/SGST/IGST split and a year in the number are OPEN. |
| DSH-5 | Industry config drives labels | ALREADY / DONE | `lib/clinic-packs.js`; suggestions and offers added to every pack. |
| DSH-6 | Integrations with Disconnect | DONE | Settings › Integrations. |
| CHF-1 / CHF-2 | Chief persona and memory | OPEN | Phase 3. |
| CHF-3 | No hallucinated actions | PARTIAL | Chief's rules now require reading a post back before saying "published" and leading with the provider's real error. The automated failed-publish test is Phase 4. |
| CHF-4 | Edit message in chat | ALREADY | Present in the workplace Chief. |
| CHF-5 | Chief flicker | DONE | See AUTH-5. |
| INT-1 | Hardcoded Buffer account (Shreyas) | ALREADY | Not in this zip: no Buffer code, config, seed row or env key. Searched code, `.env`, `.env.example` and `data/kv.json`. **But** the uploaded zip shipped `data/browsers/` (signed-in Chrome profiles) and `data/kv.json` (test accounts with live Gmail/Instagram connections). The delivered zip leaves out the browser profiles. Rotate any credential that was ever in a shared zip. |
| IG-IMG | Instagram image posts fail | PARTIAL | Likely root cause found: `sharp` (PNG → JPEG) cannot load when `node_modules` is copied from Windows to the Linux server, so a PNG was sent and Instagram refused it. Startup now warns loudly. Run `npm install` on the server. UNVERIFIED live. |
| INT-2 … INT-8 | Internal publisher, LinkedIn, Facebook Pages, festival scheduler, WhatsApp provider + triage | OPEN | Phase 4. Posting rules were tightened (Instagram: API only, never the browser Create button; Facebook: Pages only). UNVERIFIED without live accounts. |
| INT-9 | Gmail and all connectors: Disconnect | DONE | See DSH-6. |
| DATA-1 / DATA-3 | Relational schema, audit log | OPEN | Phase 3. |
| PERF-1 | Slow browser | PARTIAL | Removed the biggest cause found: Bot Mode reloading a 630 KB app on every re-render. Tables capped at 25 rows. No Lighthouse numbers were taken; Phase 5. |
| LND-1 | Landing page | OPEN | Phase 6. |

## Files changed

- **New:** `lib/onboarding-rules.js`, `test/onboarding-v280.test.mjs`, `CLAUDE.md`, `docs/CLAUDE_MASTER_PROMPT.md`, `docs/WORKFLOWS.md`, this file.
- **Changed:** `clinic.html` (onboarding, layout, settings, Bot Mode frame), `index.html` (boot loader, Latest button), `lib/clinic.js` (validated profile, book-from-enquiry, invoice discount, GSTIN, resumable onboarding), `lib/clinic-packs.js` (marketing pack, suggestions), `lib/orchestrator.js` (publish-proof rules), `server.js` and `scripts/vercel-build.mjs` (serve the rules file), four test files updated for the intended behaviour changes.

## Test results

`npm test`: 169 tests, 166 pass, 2 skipped, 1 fail. Before this pass: 162 tests, 159 pass, 2 skipped, 1 fail.

The one failing test is the same before and after: `media-public.test.mjs` "local image links become public
links…" (expects a `.jpg`, gets a `.png`). Cause: the uploaded `node_modules` was installed on Windows, so the JPEG
converter (`sharp`) has only its Windows binary and cannot load on Linux. **This is also a likely cause of the
"Instagram image posts fail" report on the server:** Instagram accepts JPEG only, and with `sharp` missing the app
silently sent the PNG. The app now prints a clear warning at startup. Fix on the server: delete `node_modules`
and run `npm install` there. Never copy `node_modules` between computers. UNVERIFIED on the live server.
