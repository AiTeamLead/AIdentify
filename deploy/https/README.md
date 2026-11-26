# HTTPS for AaaS on AWS (needed for Composio, image posts and secure sign-in)

Composio's sign-in only returns to an `https://` address (or `localhost`). On a plain `http://<ip>:3000` server it fails with
**"Invalid redirect URI"**. Instagram, Facebook, X and LinkedIn also download post images from `APP_URL`, so it must be public `https://`.

This folder puts AaaS behind **Caddy**, which gets and renews a free Let's Encrypt certificate by itself.
No domain yet? It uses `<your-ip-with-dashes>.sslip.io` (for `54.81.208.96` that is `https://54-81-208-96.sslip.io`),
a free name that points to your IP, so a real certificate works straight away. Switch to your own domain any time.

## 1. EC2 security group

Inbound: **80** and **443** from `0.0.0.0/0` (Let's Encrypt and visitors). 22 from your IP. You can close 3000.

## 2a. AaaS runs directly on the server (`npm start`, pm2, systemd)

```bash
cd /path/to/AaaS
git pull
npm install
sudo bash deploy/https/setup-https.sh                 # no domain → https://<ip>.sslip.io
# or: sudo bash deploy/https/setup-https.sh app.yourdomain.com   (DNS A record → this server's IP first)
pm2 restart all        # or: sudo systemctl restart aaas   — so AaaS reads the new APP_URL
```

The script installs Caddy, writes `/etc/caddy/Caddyfile`, and sets `APP_URL=https://…` in `.env`.

## 2b. AaaS runs in Docker

```bash
git pull
# in .env: remove or update APP_URL (the compose file sets it from DOMAIN)
DOMAIN=54-81-208-96.sslip.io docker compose -f deploy/https/docker-compose.https.yml up -d --build
```

(Stop the old container on port 3000 first if one is running.)

## 3. Check

- Open `https://<domain>`: the padlock shows, AaaS loads. The first visit can take ~30 s while the certificate is issued.
- Log line at start-up: no `WARNING: APP_URL is … (plain http)`.
- Apps → **Sign in to Composio** opens Composio's sign-in, then comes back to AaaS signed in.
- Users sign in again on the new address (sign-ins are per address).

## Notes

- Keep `.env` out of git. On the server set at least `SESSION_SECRET`, `APP_URL`, your AI key (`OPENROUTER_API_KEY` or `AWS_BEARER_TOKEN_BEDROCK` + `BEDROCK_REGION`).
- Leave `COMPOSIO_API_KEY` unset for "each user signs in to their own Composio account" (as in open-dot). Set it only to run
  everyone's apps under one Composio project (also needed for app triggers).
- Agents' own browser on the server needs Google Chrome or Playwright's Chromium: `npx playwright install --with-deps chromium`.
- Using an AWS load balancer instead: put an ACM certificate on an ALB listener 443 → target port 3000, and set `APP_URL` to the ALB's https name. Caddy is then not needed.
