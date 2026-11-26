#!/usr/bin/env node
// Who signed up / signed in (v2.15.5):
//   npm run users -- --since 2026-11-10            users who signed up on or after that date (India time)
//   npm run users -- --since 2026-11-10 --csv signups.csv    also save them as a CSV (opens in Excel)
//   npm run users -- --logins --since 2026-11-10   every sign-up and sign-in since then (PostgreSQL only)
// Reads PostgreSQL when DATABASE_URL is set (environment or .env), else data/kv.json. Never shows passwords.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, sqlStore } from '../lib/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : ''; };
function loadEnv() {
  const f = process.env.AIDENTIFY_ENV_FILE || path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const equals = line.indexOf('=');
    if (equals < 0) continue;
    const key = line.slice(0, equals).trim();
    if (!/^[A-Z0-9_]+$/.test(key) || (process.env[key] ?? '') !== '') continue;
    let value = line.slice(equals + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
const ist = (ms) => (ms ? new Date(Number(ms) + 5.5 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) : '');
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function toCsv(rows, cols) { return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'; }
function sinceMs(s) {
  if (!s) return 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) { console.error('Use --since YYYY-MM-DD'); process.exit(2); }
  return Date.parse(s + 'T00:00:00+05:30');
}
const COLS = ['email', 'name', 'signed_up_at', 'last_seen_at', 'sign_in_method', 'business', 'industry', 'city', 'business_phone', 'suspended'];

// the same fields as the aaas_users view, from data/kv.json
export function usersFromKv(kvObj) {
  const get = (k) => { const r = kvObj[k]; try { return r ? (typeof r.v === 'string' ? JSON.parse(r.v) : r.v) : null; } catch { return null; } };
  const users = get('as_users') || {};
  return Object.entries(users).map(([email, u]) => {
    const c = get('as_clinic:' + email) || {};
    return { email, name: u.name || '', joined: Number(u.joined) || 0, signed_up_at: ist(u.joined), last_seen_at: ist(u.last), sign_in_method: u.google ? 'google' : !u.hash ? 'email link' : 'password', business: c.biz || '', industry: c.role || '', city: c.city || '', business_phone: c.phone || '', suspended: !!u.suspended, account_type: u.role || 'customer' };
  });
}

// bring the tables and views up to this version first (same as the app does on start; safe to repeat), so the report
// works even before the server was restarted after an update
async function upToDate(c) {
  try { await sqlStore(c.q, { driver: c.driver }).init(); } catch (e) { console.error('Note: could not update the views (' + e.message + '); reading them as they are.'); }
}

async function main() {
  loadEnv();
  const since = sinceMs(opt('since')), url = (process.env.DATABASE_URL || '').trim(), S = process.env.DATABASE_SCHEMA ? '"' + process.env.DATABASE_SCHEMA + '".' : '';
  let rows, from;
  if (args.includes('--logins')) {
    if (!url) { console.error('Sign-in history is kept in PostgreSQL (aaas_logins). Set it up first: npm run db:setup'); process.exit(2); }
    const c = await connect(url);
    await upToDate(c);
    rows = (await c.q(`select email, event, method, to_char(at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as at_ist from ${S}aaas_logins where at >= to_timestamp($1::double precision / 1000) order by at desc`, [since])).map((r) => ({ ...r }));
    await c.close();
    console.log(`${rows.length} sign-ups/sign-ins${since ? ' since ' + opt('since') : ''}:`);
    console.table(rows.slice(0, 200));
    if (opt('csv')) { fs.writeFileSync(opt('csv'), toCsv(rows, ['email', 'event', 'method', 'at_ist'])); console.log('Saved ' + opt('csv')); }
    return;
  }
  if (url) {
    const c = await connect(url);
    await upToDate(c);
    rows = (await c.q(`select email, name, to_char(signed_up_at, 'YYYY-MM-DD HH24:MI') as signed_up_at, to_char(last_seen_at, 'YYYY-MM-DD HH24:MI') as last_seen_at, sign_in_method, business, industry, city, business_phone, suspended, account_type
      from ${S}aaas_users where signed_up_at >= (to_timestamp($1::double precision / 1000) at time zone 'Asia/Kolkata') order by signed_up_at desc nulls last`, [since]));
    await c.close(); from = 'PostgreSQL';
  } else {
    const dataDir = process.env.AIDENTIFY_DATA_DIR ? path.resolve(process.env.AIDENTIFY_DATA_DIR) : path.join(ROOT, 'data'), kv = path.join(dataDir, 'kv.json');
    if (!fs.existsSync(kv)) { console.error('No data yet (no DATABASE_URL and no data/kv.json).'); process.exit(2); }
    rows = usersFromKv(JSON.parse(fs.readFileSync(kv, 'utf8')) || {}).filter((u) => u.joined >= since).sort((a, b) => b.joined - a.joined);
    from = 'data/kv.json (no DATABASE_URL — run npm run db:setup to move to PostgreSQL)';
  }
  rows = rows.filter((r) => (r.account_type || 'customer') === 'customer' || args.includes('--all'));
  console.log(`${rows.length} user${rows.length === 1 ? '' : 's'} signed up${since ? ' since ' + opt('since') : ''} — from ${from}:`);
  console.table(rows.slice(0, 200).map((r) => Object.fromEntries(COLS.slice(0, 8).map((k) => [k, r[k]]))));
  if (rows.length > 200) console.log(`(first 200 shown; use --csv to get all ${rows.length})`);
  if (opt('csv')) { fs.writeFileSync(opt('csv'), toCsv(rows, COLS)); console.log('Saved ' + opt('csv') + ' (open it in Excel)'); }
}
if (process.argv[1]?.endsWith('users-report.mjs')) main().catch((e) => { console.error(e.message); process.exit(1); });
