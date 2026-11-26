#!/usr/bin/env node
// Set up PostgreSQL for this app in one step (v2.15.5):  npm run db:setup  [-- --url postgres://user:pass@host:5432/db]
//   1. finds the database: --url, else DATABASE_URL (environment or .env), else the local default
//      postgres://aaas:aaas@localhost:5432/aaas (what docker compose and scripts/setup-postgres.sh create)
//   2. connects and creates the app's tables and the readable views (aaas_users, aaas_logins, aaas_businesses,
//      aaas_enquiries, aaas_leads, aaas_posts)
//   3. copies what is already in data/kv.json into the database (first time only; checked row by row)
//   4. writes DATABASE_URL into .env if it was empty, so `npm start` uses PostgreSQL from now on
//   5. prints how many users / sign-ins / businesses are in it
// The connection string's password is never printed.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connect, sqlStore } from '../lib/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = process.env.AIDENTIFY_ENV_FILE || path.join(ROOT, '.env');
const DEFAULT_URL = 'postgres://aaas:aaas@localhost:5432/aaas';
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : ''; };
export const mask = (u) => String(u).replace(/(\/\/[^:/@]+:)[^@]*@/, '$1****@');

function envFileValue(key) {
  if (!fs.existsSync(ENV_FILE)) return '';
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const equals = line.indexOf('=');
    if (equals < 0) continue;
    const name = line.slice(0, equals).trim();
    if (name !== key || !/^[A-Z0-9_]+$/.test(name)) continue;
    let value = line.slice(equals + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) value = value.slice(1, -1);
    return value;
  }
  return '';
}
// DATABASE_URL=… in .env: replaces an empty/old line or adds one (the rest of .env is untouched)
export function writeEnvUrl(file, url) {
  const txt = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const line = 'DATABASE_URL=' + url;
  const databaseLine = /^[ \t]*DATABASE_URL[ \t]*=[^\r\n]*$/m;
  const out = databaseLine.test(txt) ? txt.replace(databaseLine, line) : txt + (txt.endsWith('\n') || !txt ? '' : '\n') + line + '\n';
  fs.writeFileSync(file, out);
}

// the real reason (Node's "connection refused" can come with an empty message)
export function connectError(e) {
  const m = (e && (e.message || e.code)) || '';
  if (m.trim()) return m;
  const inner = e && Array.isArray(e.errors) ? e.errors.map((x) => x && (x.message || x.code)).filter(Boolean) : [];
  return inner.length ? [...new Set(inner)].join('; ') : 'no answer from the database server (is PostgreSQL running on that host and port?)';
}
export function connectHint(why) {
  if (/password authentication failed|role .* does not exist/i.test(why)) return 'PostgreSQL is running, but this login is wrong. Create the login and database (docs/POSTGRES.md §1), or fix the user/password in --url, then run npm run db:setup again.';
  if (/database .* does not exist/i.test(why)) return 'PostgreSQL is running, but that database does not exist yet: create it (docs/POSTGRES.md §1), then run npm run db:setup again.';
  return 'Start PostgreSQL first:\n  - with Docker:   docker compose up -d db\n  - on Ubuntu/EC2: sudo bash scripts/setup-postgres.sh\n  - on Windows:    install PostgreSQL 16 (docs/POSTGRES.md), check: Get-Service postgresql*\nthen run npm run db:setup again (or pass --url for another database).';
}
async function main() {
  const fromArg = opt('url'), fromEnv = (process.env.DATABASE_URL || '').trim() || envFileValue('DATABASE_URL');
  const url = fromArg || fromEnv || DEFAULT_URL;
  if (!process.env.DATABASE_SCHEMA && envFileValue('DATABASE_SCHEMA')) process.env.DATABASE_SCHEMA = envFileValue('DATABASE_SCHEMA');
  console.log('PostgreSQL: ' + mask(url) + (fromArg ? ' (from --url)' : fromEnv ? ' (from DATABASE_URL)' : ' (local default)'));
  let c;
  try { c = await connect(url, { retries: 1 }); await c.q('select 1'); }
  catch (e) {
    const why = connectError(e);
    console.error('\nCould not connect: ' + why);
    console.error(connectHint(why));
    process.exit(2);
  }
  const st = sqlStore(c.q, { driver: c.driver, close: c.close });
  await st.init();
  console.log('✓ Tables and views ready (aaas_users, aaas_logins, aaas_businesses, aaas_enquiries, aaas_leads, aaas_posts).');
  // first time: bring over what the app saved in data/kv.json
  const dataDir = process.env.AIDENTIFY_DATA_DIR ? path.resolve(process.env.AIDENTIFY_DATA_DIR) : path.join(ROOT, 'data');
  const kv = path.join(dataDir, 'kv.json'), hasUsers = !!(await st.get('as_users'));
  if (fs.existsSync(kv) && !hasUsers && !args.includes('--no-copy')) {
    console.log('Copying data/kv.json into PostgreSQL…');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'db-migrate.mjs'), 'from-file', '--file', kv], { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
    if (r.status !== 0) { console.error('Copy failed; nothing in data/kv.json was changed. Fix the message above and run again.'); await st.close(); process.exit(3); }
  } else if (hasUsers) console.log('✓ The database already has the app’s data (no copy needed).');
  if (!fromEnv && !args.includes('--no-env')) { writeEnvUrl(ENV_FILE, url); console.log('✓ DATABASE_URL written to .env — npm start now uses PostgreSQL.'); }
  const n = async (sql) => { try { return Number((await c.q(sql))[0].n) || 0; } catch { return 0; } };
  const S = process.env.DATABASE_SCHEMA ? '"' + process.env.DATABASE_SCHEMA + '".' : '';
  console.log(`\nIn the database now: ${await n(`select count(*) n from ${S}aaas_users`)} users, ${await n(`select count(*) n from ${S}aaas_logins`)} sign-ins recorded, ${await n(`select count(*) n from ${S}aaas_businesses`)} businesses.`);
  console.log('See them: npm run users -- --since 2026-11-01   ·   SQL guide: docs/POSTGRES.md');
  await st.close();
}
if (import.meta.url === 'file://' + process.argv[1] || process.argv[1]?.endsWith('db-setup.mjs')) main().catch((e) => { console.error(e.message); process.exit(1); });
