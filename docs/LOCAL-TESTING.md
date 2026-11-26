# Test everything on your own computer first, then on the real domain

Everything below works on `http://localhost:3000`. When it works there, the same steps work on
`https://phanindramalladi.online` once `APP_URL` is set correctly (step 6).

## 1. Start it on your computer

```bash
cd AaaS_final/AaaS
npm install                      # once; installs the Linux/Mac/Windows parts for THIS computer
cp .env.example .env             # once
```

In `.env` set at least:

```
APP_URL=http://localhost:3000
SESSION_SECRET=any-long-random-text-of-40-characters-or-more
```

Then `npm start` and open http://localhost:3000. Sign up, pick an industry, finish the setup.

## 2. AI key and usage (#5)

Settings › AI & API key › paste your OpenRouter key (starts with `sk-or-`).
Ask Chief anything, then Settings › Usage › Refresh:

- **Spent on this key (OpenRouter)**, **This month / today**, **Credit left**: OpenRouter's own numbers for the key.
- **By agent** and **Every call**: tokens and cost of each call. "exact, from OpenRouter" means the cost came back from OpenRouter with the answer.

## 3. WhatsApp — real messages, free (#10)

Settings › Integrations › WhatsApp › **Connect with QR (free)** → on your phone: WhatsApp › Settings › Linked devices › Link a device → scan.

Test: Front Desk › Follow-ups › **Draft message** for someone whose phone is *your other number* →
Approvals › Approve. The draft first says "Approving sends this on **WhatsApp** to …", and after approving: "✓ Sent".

## 4. Gmail — real emails (#6, #10)

Two ways, both work on localhost:

**A. App password (simplest, no Composio):** Google account › Security › turn on 2-Step Verification →
https://myaccount.google.com/apppasswords → create one called "AIdentify" →
Settings › Integrations › **Gmail without Composio: use an app password** → Gmail address + the 16 letters → Connect Gmail.

**B. Composio sign-in:** Settings › Integrations › Gmail › Connect. On localhost Composio accepts `http://localhost:3000/...` as the return address.

Test: import or add a customer with an email (Settings › Privacy & data › Import a CSV), Follow-ups › Draft message → Approve.
Without WhatsApp linked, the draft says "Approving sends this by **email** to …" and the email arrives from your Gmail.

## 5. Social posts with the picture (v2.15 checklist)

Connect first: Settings › Integrations › Facebook Page / Instagram / LinkedIn / X › Connect (Composio).

**X through the app's browser (v2.15.4) — no X app, no API cost.** Settings › Integrations › X › **Sign in to X in
the app's browser**: a live view of the app's browser opens on x.com; click and type to sign in (codes X emails you
included), then **Done, I'm signed in** → "Signed in to X as @handle". Approved X posts then go out there: text typed,
picture attached, Post, link captured, post opened to check the picture (deleted at once if missing). Max 10 a day,
90 s apart. ⚠ X's rules forbid automating its website — the account can be locked; your X app (below) is the safe way
and is used first when connected. On the server this works the same (the browser runs headless on the server).

**X (Twitter) — your own X app, connected directly (v2.15.1, no Composio).** X blocks Composio's shared app, and
Composio adds a second place for the setup to go wrong, so the app now signs in to X itself.
1. developer.x.com → your Project › App → **User authentication settings** → Edit:
   - App permissions: **Read and write** · Type of App: **Web App, Automated App or Bot** · OAuth 2.0 on
   - Callback URI / Redirect URL — add **both**, exactly:
     `http://localhost:3000/api/connectors/callback` and `https://phanindramalladi.online/api/connectors/callback`
     (Settings › Integrations › X shows the exact one for the address you opened the app on.)
   - Website URL: `https://phanindramalladi.online` → Save.
2. Keys and tokens → **OAuth 2.0 Client ID and Client Secret** (not the API Key / Bearer token) → server `.env`:
   `X_CLIENT_ID=...` and `X_CLIENT_SECRET=...` → restart the server.
3. Open the app on the same address you registered (`http://localhost:3000` locally) → Settings › Integrations › X ›
   Connect → authorize on X → "Connected as @yourhandle".
4. Billing on developer.x.com: add credit. Connecting is free; each post (~$0.015) and each read is charged by X.
   Without credit, posts fail with "X needs API credit".
Still "Something went wrong" on X? It is always one of: callback not added exactly (copy it from Integrations),
permissions not Read and write, Client ID/Secret from a different app, or OAuth 2.0 not switched on.
Free alternative that needs none of this: **Post on X (free)** on Social Media.

**LinkedIn with the picture through Composio (v2.15.3) — no LinkedIn app needed.** Keep LinkedIn connected in
Settings › Integrations (Composio) and `COMPOSIO_API_KEY` in `.env`. On approve, the app: uploads the picture (Composio's
upload tool with the real file; if LinkedIn didn't receive it, LinkedIn's own upload slot), waits until LinkedIn says
AVAILABLE, creates the post with the picture through your Composio connection (Composio's post tool, which dropped
pictures, is not used), reads it back and deletes it if the picture is missing. If the picture can't get to LinkedIn
this way, the post is held with the exact reason — then use your own LinkedIn app below.

**Optional — your own LinkedIn app (v2.15.2), used first when its keys are set.** Composio's LinkedIn post tool drops pictures while
reporting success, so picture posts now go straight to LinkedIn:
1. linkedin.com/developers → **Create app** (link it to your company Page; any logo) → **Products**: request
   **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect** (both instant, free).
2. **Auth** → Authorized redirect URLs → add both: `http://localhost:3000/api/connectors/callback` and
   `https://phanindramalladi.online/api/connectors/callback` (Integrations › LinkedIn shows the exact one).
3. Copy **Client ID** and **Primary Client Secret** into `.env` as `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`,
   restart, open `http://localhost:3000` → Settings › Integrations › LinkedIn › **Connect** (Reconnect if it was on Composio).
The app uploads the picture to LinkedIn, waits until LinkedIn says it is ready, posts with it attached, then reads the
post back; if LinkedIn dropped the picture the post is deleted at once and Social Media says so (Try again).
Posts go to your personal profile. Company Page: apply for LinkedIn's Community Management API; once approved set
`LINKEDIN_ORG_ID=<page id>` and reconnect. Without your own LinkedIn app, LinkedIn picture posts are held, not posted.

**Facebook "Published by Composio"**: Facebook shows that small line only to Page admins (you), never to followers.
No tool can remove it. To show your own name there, create a Meta app, add it in Composio › Auth Configs › Facebook
the same way, and reconnect the Page.

Test, in this order (tick each):
- [ ] Chief: "make 3 posts for Diwali" → 3 approval cards → approve all three quickly. All show *Approved*; none says "no longer exists".
- [ ] Chief: attach a picture → "post this on LinkedIn" → Chief does **not** ask "which image"; the approval shows the picture.
- [ ] Approve a post for today → it says "Publishing now …". Social Media › Approved posts shows *Publishing…*, then
      **✓ Published** with a link per network, or *Not published* with the exact error and **Try again**.
- [ ] LinkedIn / Facebook / Instagram / X posts carry the picture (never text-only). If every image model fails, a designed
      card with the headline and your business name is used.
- [ ] Chief never opens a browser sign-in for a network that is connected in Integrations.
- [ ] A post for X with X not connected shows **Post on X (free)**; it opens X with the text ready.
- [ ] X connected: an approved post appears on X **with the picture**; LinkedIn post shows the picture too.
- [ ] Chief: "post this on LinkedIn" with a picture → ONE approval → approve → "Publishing now" → link on Social Media
      with the same picture; asking again does not create a second approval or a new picture.
- [ ] X via the app's browser: sign in once, approve an X post → "published … (through the app's browser)" with link.
- [ ] Engagement (Social Media › Engagement): comment on your X / Facebook / Instagram post → within 15 min (or press
      **Check comments now**) a drafted reply appears; edit → **Send** → the reply shows under the comment.
- [ ] A comment asking "price?" / "how to book" / with a phone number → it is in **Enquiries** (source: Comments) and
      in the lead follow-up; no number after a day → a follow-up reply is drafted once.
- [ ] Settings › X keywords → business posts on X appear as "Comment on a post" (never automatic, 10 a day max).
- [ ] Paste a LinkedIn post link in "Comment on another business post" → drafted → Send.
- [ ] A post approved for a later date shows "Publishes on …" and goes out by itself at that time (server must be running).

On localhost the picture is copied to a free public image host for the networks to download (`IMAGE_HOST`, default
litterbox, 72 hours). On the real domain the networks download it straight from `APP_URL`.

## 5b. Mobile numbers

Every mobile field (enquiry, booking, public booking form, CSV import, WhatsApp setup, Chief onboarding) takes exactly
10 digits starting 6–9. Pasted `+91 98765 43210` / `098765 43210` become `9876543210`; anything else is refused with
"Mobile number must be exactly 10 digits, numbers only."

## 6. Move to the real domain (#4, #6)

On the server's `.env`, the address must be written exactly like this — no `http:` in front, no slash at the end:

```
APP_URL=https://phanindramalladi.online
```

The screenshots showed `http:https://phanindramalladi.online`. That broken address is why Composio said
"Invalid redirect URI" and why posts went out without their picture. v2.14 corrects that typo by itself and prints a
`NOTE: APP_URL in .env was …` line at start-up — but fix the line in `.env` anyway, then restart (`pm2 restart all`).

Then repeat steps 3–5 on the domain. WhatsApp and the Gmail app password need nothing else. Composio sign-in returns
to `https://phanindramalladi.online/api/connectors/account/callback`.

## Payments (#11)

Settings › Business profile › UPI ID (e.g. `yourname@okhdfcbank`). Billing › any invoice › **UPI QR & link**:
the QR has the amount and invoice number filled in — scan it with any UPI app to test (pay ₹1 to yourself).
"Open in UPI app" only works on a phone; on a computer show the QR or press "Send on WhatsApp".
