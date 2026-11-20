#!/usr/bin/env bash
# PostgreSQL on the server (Ubuntu / Debian, e.g. AWS EC2), for this app. Run once from the project folder:
#   sudo bash scripts/setup-postgres.sh
# Installs PostgreSQL (if missing), creates the login "aaas" with a random password and the database "aaas"
# (only reachable from this server), writes DATABASE_URL into .env, then runs `npm run db:setup` which creates the
# tables and copies data/kv.json in. Safe to run again: it keeps the existing database and password.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v psql >/dev/null 2>&1; then
  echo "Installing PostgreSQL…"; apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql
fi
systemctl enable --now postgresql >/dev/null 2>&1 || service postgresql start
if grep -qE '^DATABASE_URL=postgres(ql)?://aaas:[^@]+@localhost' .env 2>/dev/null; then
  echo "DATABASE_URL already points to the local aaas database — keeping it."
else
  PW=$(openssl rand -hex 18)
  if sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='aaas'" | grep -q 1; then
    sudo -u postgres psql -qc "alter role aaas with login password '$PW'"
  else
    sudo -u postgres psql -qc "create role aaas with login password '$PW'"
  fi
  sudo -u postgres psql -tAc "select 1 from pg_database where datname='aaas'" | grep -q 1 || sudo -u postgres createdb -O aaas aaas
  URL="postgres://aaas:$PW@localhost:5432/aaas"
  if grep -qE '^\s*DATABASE_URL\s*=' .env 2>/dev/null; then sed -i -E "s#^\s*DATABASE_URL\s*=.*#DATABASE_URL=$URL#" .env; else echo "DATABASE_URL=$URL" >> .env; fi
  echo "✓ Database aaas and login aaas created; DATABASE_URL written to .env (password not shown)."
fi
OWNER=$(stat -c %U .); sudo -u "$OWNER" npm run db:setup --silent
echo "Restart the app (pm2 restart / systemctl restart / npm start) so it uses PostgreSQL."
