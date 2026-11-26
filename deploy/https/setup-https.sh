#!/usr/bin/env bash
# One command to put AaaS (already running on port 3000 on this server, e.g. with `npm start` or pm2) behind HTTPS.
#   sudo bash deploy/https/setup-https.sh                     # no domain: uses <public-ip>.sslip.io
#   sudo bash deploy/https/setup-https.sh app.example.com     # your domain (its DNS A record must point here)
# Needs Ubuntu/Debian or Amazon Linux, and ports 80 + 443 open in the EC2 security group.
set -euo pipefail
cd "$(dirname "$0")/../.."
APP_DIR="$(pwd)"
DOMAIN="${1:-${DOMAIN:-}}"
if [ -z "$DOMAIN" ]; then
  TOKEN=$(curl -s -m 3 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' || true)
  IP=$(curl -s -m 3 ${TOKEN:+-H "X-aws-ec2-metadata-token: $TOKEN"} http://169.254.169.254/latest/meta-data/public-ipv4 || true)
  [ -z "$IP" ] && IP=$(curl -s -m 5 https://checkip.amazonaws.com | tr -d '[:space:]')
  [ -z "$IP" ] && { echo "Couldn't find this server's public IP. Run: sudo bash $0 your.domain.com"; exit 1; }
  DOMAIN="$(echo "$IP" | tr '.' '-').sslip.io"
fi
echo "==> HTTPS address: https://$DOMAIN"

if ! command -v caddy >/dev/null 2>&1; then
  echo "==> Installing Caddy"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
  else
    (dnf install -y 'dnf-command(copr)' && dnf copr enable -y @caddy/caddy && dnf install -y caddy) || {
      curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')" -o /usr/bin/caddy && chmod +x /usr/bin/caddy
      id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --create-home caddy
      cat > /etc/systemd/system/caddy.service <<UNIT
[Unit]
Description=Caddy
After=network-online.target
[Service]
User=caddy
ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
      systemctl daemon-reload; }
  fi
fi

mkdir -p /etc/caddy
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000 {
		header_up X-Forwarded-Proto https
		header_up X-Forwarded-Host {host}
		flush_interval -1
	}
}
CADDY
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy

# APP_URL in .env → the HTTPS address (Composio sign-in, image links and secure cookies all use it)
ENVF="$APP_DIR/.env"; touch "$ENVF"
if grep -q '^APP_URL=' "$ENVF"; then sed -i "s#^APP_URL=.*#APP_URL=https://$DOMAIN#" "$ENVF"; else printf '\nAPP_URL=https://%s\n' "$DOMAIN" >> "$ENVF"; fi
echo "==> APP_URL=https://$DOMAIN written to $ENVF"
echo
echo "Done. Now restart AaaS so it reads the new APP_URL (pm2 restart all / systemctl restart aaas / docker compose up -d),"
echo "then open https://$DOMAIN . The first visit can take ~30 s while the certificate is issued."
echo "EC2 security group: allow 80 and 443 from anywhere; you can close 3000."
