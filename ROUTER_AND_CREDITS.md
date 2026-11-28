# Auto mode (model router) and AI credits

Hosted AIdentify accounts get AI included. They pay for it with **credits**. **Auto mode** picks the cheapest model
that can do each job, and an admin manages everyone from **/app → AI credits**.

Code: `lib/router.js` (Auto mode), `lib/credits.js` (ledger and billing), `lib/orkeys.js` (per-user OpenRouter keys),
`lib/credits-api.js` (routes). UI: `clinic.html` → Settings › AI credits (customer), `index.html` → AI credits (admin).
Tests: `test/router-credits.test.mjs`.

## When it is on

| Setting | Effect |
|---|---|
| `AI_CREDITS=on` | Credits and Auto mode for every customer without their own key (BYOK). |
| `AI_CREDITS=off` | Old behaviour: customers bring their own key. |
| unset | On when running on Vercel (the hosted product), off on a self-hosted server. |

Customers who saved their own key (BYOK) and staff accounts are never billed in credits.

## Routing table (defaults, admin-editable)

Prices are OpenRouter list prices in US$ per 1M tokens (input / output), read from
https://openrouter.ai/api/v1/models on 29 Nov 2026 (IST). The first model is tried first. The others are fallbacks
when a call errors or is rate limited.

| Task class | When | Models in order (in / out per 1M) |
|---|---|---|
| `simple` | short chat, website-widget and front-desk replies, one-line helpers | Gemini 2.5 Flash-Lite ($0.10 / $0.40) → DeepSeek V4 Flash ($0.09 / $0.18) → Gemini 3.1 Flash-Lite ($0.25 / $1.50) |
| `vision` | the request carries an image | Gemini 2.5 Flash-Lite ($0.10 / $0.40) → Gemini 3.1 Flash-Lite ($0.25 / $1.50) → Claude Haiku 5.5 ($0.10 / $0.50) |
| `build` | website builds and edits, JSON drafting, tool-using agent work, moderate reasoning | Claude Haiku 5.5 ($0.10 / $0.50) → Claude Haiku 4.5 ($1 / $5) → Gemini 3.1 Flash-Lite ($0.25 / $1.50) |
| `hard` | long or explicitly hard reasoning (strategy, analysis, forecasts), the "strong" tier, planner agents | Claude Sonnet 5.5 ($2 / $10) → Claude Sonnet 4.6 ($3 / $15) → Claude Haiku 5.5 ($0.10 / $0.50) |

Why Gemini 2.5 Flash-Lite and not 3.1 Flash-Lite for chat: on today's list 3.1 Flash-Lite costs 2.5× more on input
and 3.75× more on output, and Haiku 5.5 is also cheaper than 3.1 Flash-Lite. 3.1 stays in the table as a fallback.

How a request is classified (`classify()` in `lib/router.js`, in this order):
1. It has an image → `vision`.
2. `meta.task` is set (`simple` / `vision` / `build` / `hard`, or `chat`, `website`, `reason`…) → that class.
3. The tier is "strong", or the agent is a planner / strategy / research agent → `hard`.
4. Hard-reasoning words ("analyse", "strategy", "forecast", "step by step", "unit economics"…) in a request longer
   than ~240 characters, or a context over ~24,000 characters → `hard`. A short "analyse this" stays cheap.
5. Front-desk / widget / rules agents → `simple`, unless the text asks for a website.
6. Website words, website / workflow / social agents, or any call with tools → `build`.
7. Everything else → `simple`.

**Model picker.** A customer can switch from Auto to a fixed model (Settings › AI credits). That model goes first, and
the Auto route stays behind it as the fallback chain. A fixed model that cannot read images is skipped for image
requests. Pricier models simply burn more credits, because credits come from the real cost of each call.

**Editing the table.** Admin → AI credits → Routing table. One OpenRouter model id per line. Saved in the
`as_sys_credits_cfg` row and used from the next call. Every change is audit-logged.

## Credit formula

```
credits = cost_usd × usd_inr × markup ÷ inr_per_credit     (rounded up to 0.01, minimum min_charge when cost > 0)
```

- `cost_usd` is OpenRouter's real charge for the call. The app sends `usage: { include: true }`, so each response
  carries `usage.cost`. If a provider does not report cost, it is estimated from the model's list price.
- Defaults: `inr_per_credit` ₹1, `markup` 3×, `usd_inr` 93, `min_charge` 0.01, **50 free credits at sign-up**,
  low-balance flag at 10 credits.
- With these defaults, **1 credit costs us at most ₹0.33 of AI**, so the gross margin on AI is 67% before payment fees
  and GST.

What a typical message costs (2,000 tokens in, 500 out):

| Model | Credits |
|---|---|
| Gemini 2.5 Flash-Lite | ~0.12 |
| Claude Haiku 5.5 | ~0.13 |
| Gemini 3.1 Flash-Lite | ~0.35 |
| Claude Sonnet 5.5 | ~2.52 |

So 50 free credits cover roughly 400 simple chats or about 20 Sonnet answers.

**Recharge packs (suggested, editable in config):** ₹199 = 200 credits, ₹499 = 550 credits, ₹999 = 1,200 credits
(₹0.99 / ₹0.91 / ₹0.83 per credit). All prices are before GST. Even at the cheapest pack, AI costs us ₹0.33 per credit.

**Hard stop.** Before every model call the balance, the pause flag and the monthly cap are checked. At 0 credits the
call is refused with HTTP 402 `no_credits` and the message *"You're out of AI credits. Recharge in Settings › AI
credits…"*. The balance never goes negative. If a single call costs more than what is left, it takes the rest and the
difference is logged as `absorbed`.

**Atomic deduction.** Each account changes one step at a time inside a server (promise chain), and with
compare-and-swap on the row version across servers (`st.update` in `lib/db.js`). Tests run 200 parallel charges on one
server and 120 across two "servers" sharing one Postgres. Exactly the balance is taken, with no lost update.

## Storage (key-value rows, same as the rest of the app)

- `as_credits:<email>`: balance, granted, recharged, used, this month's credits / calls / AI cost, per-model use, cap,
  paused, model pick, last active, and the sealed sub-key.
- `as_cledger:<email>:<id>`: one row per event (`grant`, `usage`, `recharge`, `adjust`), with credits, balance after,
  model, task class, tokens, cost in US$, note, and who did it.
- `as_corder:<id>`: recharge orders. **Test mode only**: no money moves, and live Razorpay keys (`rzp_live_…`) are refused.
- `as_sys_credits_cfg`: the routing table, markup, credit unit and packs.
- `as_sys_credits_audit`: the last 500 admin actions.

## Admin dashboard (/app → AI credits, admin only)

It shows totals for today and this month in ₹ and $ (AI cost to us), OpenRouter key use against its limit, credits
used, low-balance and paused counts, and the key mode. For each customer it shows plan, balance (Low / Empty flags),
credits and calls this month, AI cost in ₹ and $, top models, last active, and AI on or paused.

Actions: **Grant / deduct**, **Monthly cap**, **Pause / Resume AI**, **Ledger**, edit the **routing table** and
**credit price**. Every action is written to the audit log.

API: `GET /api/admin/credits`, `GET /api/admin/credits/ledger?email=`, `POST /api/admin/credits/adjust`,
`POST /api/admin/credits/user`, `POST /api/admin/credits/config`. Customer: `GET /api/credits`,
`POST /api/credits/model`, `POST /api/credits/recharge`, `POST /api/credits/recharge/confirm`.

## Environment variables

| Variable | What it is |
|---|---|
| `OPENROUTER_API_KEY` | The platform key that runs models for everyone without a sub-key. |
| `OPENROUTER_PROVISIONING_KEY` | An OpenRouter **Provisioning / Management** key. It can create per-user keys but cannot run models. |
| `AI_CREDITS` | `on` / `off` (see above). |
| `AI_CREDIT_MARKUP` | Markup × on AI cost (default 3). The admin screen overrides it. |
| `AI_CREDIT_INR` | Rupees per credit (default 1). |
| `AI_USD_INR` | Exchange rate (default 93). |
| `AI_FREE_CREDITS` | Credits at sign-up (default 50). |
| `AI_CREDIT_MIN` | Minimum charge per call (default 0.01). |
| `AI_CREDIT_LOW` | Low-balance flag (default 10). |
| `ROUTER_LIVE_PRICES=off` | Use the built-in price table instead of the live OpenRouter list. |

Settings saved on the admin screen beat the env defaults. Keys are never shown, logged or sent to a page.

## Per-user OpenRouter keys (sub-keys): how to switch them on

1. On openrouter.ai, open **Settings → Provisioning (Management) API Keys** and create a key. Give it an expiry and
   rotate it before it expires.
2. Set it as `OPENROUTER_PROVISIONING_KEY` on the server (Vercel env needs Phani's OK). Keep `OPENROUTER_API_KEY` as
   the platform key for anyone without a sub-key.
3. That's all. Within 10 minutes the app checks the key: `GET /api/v1/key` with `is_provisioning_key` /
   `is_management_key` true, or a working `GET /api/v1/keys`. Sub-keys then switch on by themselves, and the admin
   screen shows **Per-user keys ON**.

What happens with sub-keys on:
- **First AI use after sign-up:** a key named `aidentify:<hash of email>` is created, with limit = balance at cost
  plus 5% and 1¢ headroom. It is stored AES-256-GCM sealed (key derived from `SESSION_SECRET`). Only the last 4
  characters are ever shown.
- **Recharge or grant:** the limit is raised to the key's usage so far plus the new balance at cost.
- **Pause, or balance at 0:** the key is disabled. **Resume:** it is re-enabled.
- **Account deleted:** the key is deleted.
- If OpenRouter can't be reached, the user falls back to the platform key, and the ledger still enforces the cap.

**Fallback.** If `OPENROUTER_PROVISIONING_KEY` is unset, or is really a normal API key (`is_provisioning_key: false`),
everyone runs on one platform key and the credit ledger is the cap. If `OPENROUTER_API_KEY` is empty and the
"provisioning" value is a normal key, that normal key is used as the platform key.
