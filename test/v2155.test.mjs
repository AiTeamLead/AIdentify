// v2.15.5: PostgreSQL holds who signed up and signed in. Readable views (aaas_users, aaas_businesses, aaas_enquiries,
// aaas_leads, aaas_posts) and the aaas_logins table, checked against a real (in-memory) PostgreSQL engine; sign-ups and
// sign-ins are recorded; `npm run users` lists and exports them; db:setup helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sqlStore } from '../lib/db.js';
import { startServer, ROOT } from './helpers.mjs';
import { usersFromKv, toCsv } from '../scripts/users-report.mjs';
import { writeEnvUrl, mask } from '../scripts/db-setup.mjs';

let PGlite = null; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { /* skipped below */ }
const PW = 'Tr1ckyHorse#Blue92';
const ms = (iso) => Date.parse(iso);

test('PostgreSQL: tables + readable views show every user, business, enquiry, lead, post and sign-in — never passwords', { skip: !PGlite && 'install devDependencies (@electric-sql/pglite)' }, async () => {
  const db = new PGlite();
  const st = sqlStore(async (text, params = []) => (await db.query(text, params)).rows);
  await st.init();
  await st.put('as_users', JSON.stringify({
    'owner@x.com': { name: 'Ravi Kumar', role: 'customer', hash: 'scrypt$SECRET', joined: ms('2026-11-15T10:00:00+05:30'), last: ms('2026-11-20T09:30:00+05:30'), sv: 1 },
    'g@x.com': { name: 'Asha', role: 'customer', hash: '', google: '123', joined: ms('2026-11-16T12:00:00+05:30'), last: ms('2026-11-16T12:00:00+05:30') },
    'old@x.com': { name: 'Old', role: 'customer', hash: 'h', joined: ms('2026-10-01T09:00:00+05:30'), suspended: true },
    'admin@x.com': { name: 'Admin', role: 'admin', hash: 'h', joined: ms('2026-09-01T09:00:00+05:30') },
  }), Date.now());
  await st.put('as_clinic:owner@x.com', JSON.stringify({ biz: 'Bright Smile', role: 'dental', city: 'Hyderabad', phone: '919876543210',
    enquiries: [{ name: 'Kiran', phone: '919811111111', channel: 'Instagram', message: 'Braces price?', status: 'new', at: '2026-11-18T10:00:00Z', source: 'Comments' }],
    leads: [{ name: 'Kiran', phone: '919811111111', channel: 'Instagram', stage: 'new', message: 'Braces price?', at: '2026-11-18T10:00:00Z' }],
    posts: [{ text: 'Diwali offer', status: 'scheduled', platforms: ['LinkedIn', 'X'], at: '2026-11-19T09:00:00Z', publish: { status: 'published' } }],
    patients: [{ name: 'A' }, { name: 'B' }] }), Date.now());
  await st.put('as_clinic:broken@x.com', 'not json', Date.now()); // a bad row never breaks the views
  await st.logEvent('owner@x.com', 'signup', 'password'); await st.logEvent('owner@x.com', 'login', 'password'); await st.logEvent('g@x.com', 'signup', 'google');

  const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'aaas_users'`)).rows.map((r) => r.column_name);
  assert.ok(!cols.some((c) => /hash|password|token|secret/i.test(c)), 'no password column: ' + cols.join(','));
  const users = (await db.query(`select * from aaas_users order by signed_up_at desc`)).rows;
  assert.equal(users.length, 4);
  assert.ok(!JSON.stringify(users).includes('SECRET'), 'password hash never shown');
  const ravi = users.find((u) => u.email === 'owner@x.com');
  assert.equal(ravi.name, 'Ravi Kumar'); assert.equal(ravi.business, 'Bright Smile'); assert.equal(ravi.industry, 'dental'); assert.equal(ravi.city, 'Hyderabad'); assert.equal(ravi.sign_in_method, 'password');
  assert.equal((await db.query(`select to_char(signed_up_at, 'YYYY-MM-DD HH24:MI') t from aaas_users where email = 'owner@x.com'`)).rows[0].t, '2026-11-15 10:00', 'India time');
  assert.equal(users.find((u) => u.email === 'g@x.com').sign_in_method, 'google');
  assert.equal(users.find((u) => u.email === 'old@x.com').suspended, true);
  // the promotion question: who signed up since 15 Nov
  const promo = (await db.query(`select email from aaas_users where account_type = 'customer' and signed_up_at >= '2026-11-15' order by signed_up_at`)).rows.map((r) => r.email);
  assert.deepEqual(promo, ['owner@x.com', 'g@x.com']);
  const biz = (await db.query(`select * from aaas_businesses`)).rows;
  assert.equal(biz.length, 1); assert.equal(biz[0].enquiries, 1); assert.equal(biz[0].leads, 1); assert.equal(biz[0].posts, 1); assert.equal(biz[0].customers, 2);
  assert.equal((await db.query(`select * from aaas_enquiries`)).rows[0].message, 'Braces price?');
  assert.equal((await db.query(`select * from aaas_leads`)).rows[0].stage, 'new');
  const post = (await db.query(`select * from aaas_posts`)).rows[0]; assert.equal(post.networks, 'LinkedIn, X'); assert.equal(post.published, 'published');
  const logins = (await db.query(`select email, event, method from aaas_logins order by id`)).rows;
  assert.deepEqual(logins.map((l) => l.event + ':' + l.method), ['signup:password', 'login:password', 'signup:google']);
  // running the setup again changes nothing and keeps the data
  const st2 = sqlStore(async (text, params = []) => (await db.query(text, params)).rows); await st2.init();
  assert.equal((await db.query(`select count(*)::int n from aaas_logins`)).rows[0].n, 3);
  await db.close();
});

test('every sign-up and sign-in is recorded (data/logins.jsonl without a database)', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on' });
  try {
    assert.equal((await s.api('/api/auth/signup', { email: 'new1@example.com', name: 'New One', password: PW })).status, 200);
    assert.equal((await s.api('/api/auth/login', { email: 'new1@example.com', password: PW })).status, 200);
    assert.notEqual((await s.api('/api/auth/login', { email: 'new1@example.com', password: 'wrong-password-1' })).status, 200);
    const lines = fs.readFileSync(path.join(s.dir, 'data', 'logins.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.email + ':' + l.event), ['new1@example.com:signup', 'new1@example.com:login'], 'failed sign-ins are not recorded as sign-ins');
    assert.ok(lines.every((l) => !l.password && !l.hash && l.at));
  } finally { await s.stop(); }
});

test('npm run users: list since a date and save a CSV (no passwords)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-users-')), data = path.join(dir, 'data'); fs.mkdirSync(data);
  const kv = { as_users: { k: 'as_users', v: JSON.stringify({ 'a@x.com': { name: 'A', hash: 'SECRETHASH', joined: ms('2026-11-16T10:00:00+05:30'), last: ms('2026-11-17T10:00:00+05:30') }, 'b@x.com': { name: 'B, Jr', hash: 'h', joined: ms('2026-11-01T10:00:00+05:30') } }) }, 'as_clinic:a@x.com': { k: 'as_clinic:a@x.com', v: JSON.stringify({ biz: 'A Dental', role: 'dental', city: 'Pune', phone: '919000000000' }) } };
  fs.writeFileSync(path.join(data, 'kv.json'), JSON.stringify(kv)); fs.writeFileSync(path.join(dir, '.env'), '');
  const rows = usersFromKv(kv); assert.equal(rows.length, 2); assert.equal(rows.find((r) => r.email === 'a@x.com').business, 'A Dental');
  assert.equal(toCsv([{ name: 'B, Jr' }], ['name']), 'name\n"B, Jr"\n');
  const csv = path.join(dir, 'out.csv');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'users-report.mjs'), '--since', '2026-11-15', '--csv', csv], { env: { PATH: process.env.PATH, AIDENTIFY_DATA_DIR: data, AIDENTIFY_ENV_FILE: path.join(dir, '.env'), DATABASE_URL: '' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /1 user signed up since 2026-11-15/);
  const out = fs.readFileSync(csv, 'utf8'); assert.match(out, /^email,name,signed_up_at/); assert.match(out, /a@x\.com,A,2026-11-16 10:00/); assert.ok(!/b@x\.com/.test(out)); assert.ok(!/SECRETHASH/.test(out));
});

test('db:setup writes DATABASE_URL into .env once and never prints the password', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-env-')), f = path.join(dir, '.env');
  fs.writeFileSync(f, 'SESSION_SECRET=abc\nDATABASE_URL=\nAPP_URL=http://localhost:3000\n');
  writeEnvUrl(f, 'postgres://aaas:s3cret@localhost:5432/aaas');
  const txt = fs.readFileSync(f, 'utf8');
  assert.match(txt, /^DATABASE_URL=postgres:\/\/aaas:s3cret@localhost:5432\/aaas$/m); assert.match(txt, /^SESSION_SECRET=abc$/m); assert.match(txt, /^APP_URL=/m);
  assert.equal(txt.match(/DATABASE_URL=/g).length, 1);
  assert.equal(mask('postgres://aaas:s3cret@localhost:5432/aaas'), 'postgres://aaas:****@localhost:5432/aaas');
  const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /image: postgres:16/); assert.match(compose, /DATABASE_URL: postgres:\/\/aaas:/); assert.match(compose, /127\.0\.0\.1:5432:5432/);
});
