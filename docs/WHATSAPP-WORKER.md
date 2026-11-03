# WhatsApp QR worker

Vercel (and any serverless host) cannot keep a WhatsApp socket open. The site on Vercel still serves the app, the CRM and approvals. The QR session runs in a separate process that stays up.

## Run it

On the same machine as the data store:

```bash
WHATSAPP_QR=on SESSION_SECRET=... node worker.js
```

Or with Docker, from the repo root:

```bash
docker compose up worker
```

The worker uses the same `DATABASE_URL` or `data/kv.json` as the web app. Sessions are encrypted in the account’s channel credentials. Logs do not include the session.

## What it does

- Shows a QR in Settings until the owner scans it with the business phone.
- Reconnects if the link drops. If WhatsApp logs the number out, the screen asks for a new scan.
- Inbound customer messages are stored on that account’s CRM and become drafts. They are not auto-replied.
- An outbound message is sent only after the owner approves that one draft, with a short random pause and a per-number hourly cap.
- Groups, status broadcasts and multi-recipient blasts are refused.

## Official API

Set `CLINIC_WA_PROVIDER` to `meta` or `gupshup` when you want the paid Cloud API instead. That path does not need this worker. QR mode stays available for accounts that have not upgraded.

## Warning

This link is unofficial. WhatsApp can restrict the number. Do not use a number you cannot afford to lose.
