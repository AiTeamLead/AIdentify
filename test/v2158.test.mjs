// v2.15.8: a record with half an emoji (text cut in the middle of 🎉) no longer breaks `npm run users` and the report
// views ("invalid input syntax for type json"). Saves are cleaned, the views read every record safely, and records
// saved before the fix are repaired once on start. Checked on an in-memory PostgreSQL engine (PGlite) and, when
// DATABASE_URL_TEST is set, on a real PostgreSQL server too. Also: the coverage setup Jenkins and SonarQube need.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sqlStore, wellFormed, connect } from '../lib/db.js';
import { ROOT } from './helpers.mjs';

let PGlite = null; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { /* skipped below */ }
const cut = 'Diwali offer 🎉'.slice(0, 14); // ends in half an emoji
const broken = JSON.stringify({ biz: 'Bright Smile', city: 'Hyderabad', posts: [{ text: cut, status: 'draft', platforms: ['X'] }], leads: [{ name: 'Kiran', stage: 'new' }] });

test('saved text is cleaned: half emojis become �, whole emojis and plain text stay', () => {
  assert.match(broken, /\\ud83c"/);
  const w = wellFormed(broken);
  assert.doesNotThrow(() => JSON.parse(w));
  assert.equal(JSON.parse(w).posts[0].text, 'Diwali offer \ufffd');
  assert.equal(wellFormed(JSON.stringify({ t: 'ok 🎉' })), JSON.stringify({ t: 'ok 🎉' }));
  assert.equal(wellFormed(JSON.stringify({ t: '\udc00 low first' })), '{"t":"\\ufffd low first"}');
  assert.equal(wellFormed('plain'), 'plain'); assert.equal(wellFormed(null), null);
  assert.equal(wellFormed('raw \ud83c half'), 'raw \ufffd half', 'a raw lone surrogate too');
});

async function check(q, label, schema = '') {
  const S = schema ? '"' + schema + '".' : '';
  const st = sqlStore(q, { schema });
  // a record saved by an older version, straight into the table (not cleaned)
  await st.init();
  await q(`insert into ${S}agentsphere_kv (k, v, at) values ('as_clinic:old@x.com', $1, 1) on conflict (k) do update set v = excluded.v`, [broken]);
  await st.put('as_users', JSON.stringify({ 'old@x.com': { name: 'Old ' + cut, hash: 'h', joined: Date.now() }, 'new@x.com': { name: 'New', hash: 'h', joined: Date.now() } }), Date.now());
  await st.put('as_clinic:new@x.com', broken, Date.now()); // cleaned on save
  await st.put('as_clinic:junk@x.com', '{not json at all', Date.now());
  const users = await q(`select email, name, business from ${S}aaas_users order by email`);
  assert.equal(users.length, 2, label);
  assert.equal(users.find((u) => u.email === 'old@x.com').business, 'Bright Smile', label + ': old broken record readable through the view');
  const posts = await q(`select business_email, text from ${S}aaas_posts order by business_email`);
  assert.ok(posts.length >= 2, label);
  assert.ok(posts.every((p) => /^Diwali offer/.test(p.text)), label);
  assert.equal((await q(`select count(*)::int as n from ${S}aaas_leads`)).at(0).n, 2, label);
  const stored = (await q(`select v from ${S}agentsphere_kv where k = 'as_clinic:new@x.com'`))[0].v;
  assert.doesNotThrow(() => JSON.parse(stored)); assert.match(stored, /\\ufffd/, label + ': cleaned before saving');
  // the one-time repair (migration 8) fixes rows saved before the update: run it again by hand on the old row
  const migrated = (await q(`select version from ${S}agentsphere_migrations order by version`)).map((r) => Number(r.version));
  assert.deepEqual(migrated, [1, 2, 3, 4, 5, 6, 7, 8], label);
  const st2 = sqlStore(q, { schema }); // a restart re-runs only the views; the old row is still readable
  await st2.init();
  assert.equal((await q(`select count(*)::int as n from ${S}aaas_businesses`))[0].n, 2, label + ': unreadable junk is skipped, not fatal');
}

test('views never fail on half emojis or bad JSON (PGlite)', { skip: !PGlite && 'install devDependencies (@electric-sql/pglite)' }, async () => {
  const db = new PGlite();
  await check(async (text, params = []) => (await db.query(text, params)).rows, 'pglite');
  // rows saved before the update are repaired on the next start
  const db2 = new PGlite();
  const q2 = async (text, params = []) => (await db2.query(text, params)).rows;
  await q2('create table agentsphere_kv (k text primary key, v text, at bigint not null default 0, updated_at timestamptz not null default now())');
  await q2(`insert into agentsphere_kv (k, v) values ('as_clinic:a@x.com', $1)`, [broken]);
  await sqlStore(q2).init();
  const v = (await q2(`select v from agentsphere_kv where k = 'as_clinic:a@x.com'`))[0].v;
  assert.doesNotThrow(() => JSON.parse(v)); assert.match(v, /Diwali offer \\ufffd/);
});

const PGURL = process.env.DATABASE_URL_TEST || '';
test('views never fail on half emojis or bad JSON (real PostgreSQL)', { skip: !PGURL && 'set DATABASE_URL_TEST to run against a real server' }, async () => {
  const c = await connect(PGURL), schema = 'aidentify_t2158_' + crypto.randomBytes(4).toString('hex'); // its own schema: nothing else is touched
  try { await check(c.q, 'postgres', schema); }
  finally { await c.q(`drop schema if exists "${schema}" cascade`).catch(() => {}); await c.close(); }
});

test('coverage setup for Jenkins and SonarQube', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['test:coverage'], /^c8 node --test/);
  assert.ok(pkg.devDependencies.c8);
  const c8 = JSON.parse(fs.readFileSync(path.join(ROOT, '.c8rc.json'), 'utf8'));
  assert.equal(c8['report-dir'], 'coverage'); assert.ok(c8.reporter.includes('lcov')); assert.equal(c8.all, true);
  const sonar = fs.readFileSync(path.join(ROOT, 'sonar-project.properties'), 'utf8');
  assert.match(sonar, /^sonar\.javascript\.lcov\.reportPaths=coverage\/lcov\.info$/m);
  assert.match(sonar, /^sonar\.tests=test$/m);
  assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^coverage\/$/m);
});
