// Postgres storage (Neon or any Postgres). One key-value table, the same shape as data/kv.json.
//
//   Driver:  Neon URLs (*.neon.tech) use @neondatabase/serverless over HTTPS (works on Vercel and behind firewalls);
//            every other URL uses node-postgres ("pg") with a connection pool. DB_DRIVER=neon|pg forces one.
//   Schema:  DATABASE_SCHEMA=<name> keeps the tables in their own Postgres schema (tests, several apps in one database).
//   Tables:  agentsphere_kv (k, v, at, ver, updated_at): the data. The old name is kept so existing databases keep working.
//            agentsphere_locks: short leases, so only one server instance changes one workspace at a time.
//            agentsphere_migrations: which schema steps have run.
//   Writes:  put() is an upsert. update() is compare-and-swap on "ver" and retries, so two servers saving the same key
//            at the same moment cannot silently drop one of the changes. lock() gives a cross-instance lease.
//   Retries: transient network and Postgres errors (connection reset, admin shutdown, serialization) are retried.
import crypto from 'node:crypto';

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = /ECONNRESET|ETIMEDOUT|EPIPE|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|Connection terminated|timeout|terminating connection|too many connections/i;
const TRANSIENT_CODES = new Set(['57P01', '57P02', '57P03', '08000', '08003', '08006', '08001', '08004', '40001', '40P01', '53300']);
export const isTransient = (e) => !!e && (TRANSIENT_CODES.has(e.code) || TRANSIENT.test(String(e.message || e)));

export function driverFor(url) {
  const forced = env('DB_DRIVER').toLowerCase();
  if (forced === 'neon' || forced === 'pg') return forced;
  try { return /\.neon\.tech$/i.test(new URL(url).hostname) ? 'neon' : 'pg'; } catch { return 'pg'; }
}

// → { q(text, params) => rows, close(), driver }
export async function connect(url, { driver = driverFor(url), retries = 3 } = {}) {
  let raw, close = async () => {};
  if (driver === 'neon') {
    const mod = await import('@neondatabase/serverless');
    const sql = mod.neon(url);
    raw = async (text, params) => sql.query(text, params);
  } else {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: Number(env('DB_POOL_MAX', '10')) || 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });
    pool.on('error', (e) => console.error('Postgres pool:', e.message)); // an idle client dropped; the pool replaces it
    raw = async (text, params) => (await pool.query(text, params)).rows;
    close = () => pool.end();
  }
  const q = async (text, params = []) => {
    for (let i = 0; ; i++) {
      try { return await raw(text, params); }
      catch (e) { if (i >= retries || !isTransient(e)) throw e; await sleep(150 * 3 ** i + crypto.randomInt(100)); }
    }
  };
  return { q, close, driver };
}

const ident = (s) => { if (!/^[a-z_][a-z0-9_]{0,50}$/.test(s)) throw new Error('DATABASE_SCHEMA must be lower-case letters, digits and _'); return '"' + s + '"'; };

// Half an emoji (a lone UTF-16 surrogate, e.g. text cut in the middle of 🎉) is fine for the app, but PostgreSQL
// refuses it as JSON, and one such record broke every report view ("invalid input syntax for type json").
// Saved text is cleaned first: a lone surrogate, raw or as a \uD83C escape, becomes U+FFFD (�). Whole emojis stay.
const LONE_HIGH = /\\u[dD][89abAB][0-9a-fA-F]{2}(?!\\u[dD][c-fC-F][0-9a-fA-F]{2})/g;
const LONE_LOW = /(?<!\\u[dD][89abAB][0-9a-fA-F]{2})\\u[dD][c-fC-F][0-9a-fA-F]{2}/g;
export function wellFormed(v) {
  if (typeof v !== 'string') return v;
  let s = typeof v.toWellFormed === 'function' ? v.toWellFormed() : v;
  if (s.includes('\\u')) s = s.replace(LONE_HIGH, '\\ufffd').replace(LONE_LOW, '\\ufffd');
  return s;
}
export function sqlStore(q, { schema = env('DATABASE_SCHEMA'), driver = 'pg', close = async () => {} } = {}) {
  const S = schema ? ident(schema) + '.' : '';
  const T = S + 'agentsphere_kv', L = S + 'agentsphere_locks', M = S + 'agentsphere_migrations';
  // Every step is idempotent, so two instances starting at once are safe.
  const MIGRATIONS = [
    [1, `create table if not exists ${T} (k text primary key, v text, at bigint not null default 0, updated_at timestamptz not null default now())`],
    [2, `alter table ${T} add column if not exists ver bigint not null default 0`],
    [3, `create index if not exists agentsphere_kv_k_prefix on ${T} (k text_pattern_ops)`],
    [4, `create table if not exists ${L} (name text primary key, holder text not null, expires timestamptz not null)`],
    // v2.15.5: every sign-up and sign-in, one row each (written by the app)
    [5, `create table if not exists ${S}aaas_logins (id bigserial primary key, email text not null, event text not null, method text not null default 'password', at timestamptz not null default now())`],
    [6, `create index if not exists aaas_logins_at on ${S}aaas_logins (at desc)`],
    // v2.15.8: JSON read that never fails (half emojis repaired, anything else unreadable → null) for the views,
    // and a one-time repair of records saved before the app cleaned them
    [7, String.raw`create or replace function ${S}aaas_jsonb(t text) returns jsonb language plpgsql immutable as $f$
      begin
        return t::jsonb;
      exception when others then
        begin
          return regexp_replace(regexp_replace(t, '\\u[dD][89abAB][0-9a-fA-F]{2}(?!\\u[dD][c-fC-F][0-9a-fA-F]{2})', '\\ufffd', 'g'),
            '(?<!\\u[dD][89abAB][0-9a-fA-F]{2})\\u[dD][c-fC-F][0-9a-fA-F]{2}', '\\ufffd', 'g')::jsonb;
        exception when others then
          return null;
        end;
      end $f$`],
    [8, String.raw`update ${T} set v = regexp_replace(regexp_replace(v, '\\u[dD][89abAB][0-9a-fA-F]{2}(?!\\u[dD][c-fC-F][0-9a-fA-F]{2})', '\\ufffd', 'g'),
      '(?<!\\u[dD][89abAB][0-9a-fA-F]{2})\\u[dD][c-fC-F][0-9a-fA-F]{2}', '\\ufffd', 'g') where v ~ '\\u[dD][89a-fA-F][0-9a-fA-F]{2}'`],
  ];
  // Readable views over the app's data (no passwords, tokens or keys). Re-created on every start, so they always match
  // this version of the app. Times are shown in India time.
  const IST = (ms) => `(to_timestamp((${ms})::double precision / 1000) at time zone 'Asia/Kolkata')`;
  const CLINIC = `(select owner, c from (select substr(k, 11) as owner, ${S}aaas_jsonb(v) as c from ${T} where k like 'as_clinic:%' and v like '{%') z where c is not null)`;
  const VIEWS = [
    `create or replace view ${S}aaas_users as
      select u.key as email, u.value->>'name' as name, coalesce(u.value->>'role', 'customer') as account_type,
        ${IST("nullif(u.value->>'joined', '')")} as signed_up_at, ${IST("nullif(u.value->>'last', '')")} as last_seen_at,
        case when u.value->>'google' is not null then 'google' when coalesce(u.value->>'hash', '') = '' then 'email link' else 'password' end as sign_in_method,
        coalesce(u.value->>'suspended', '') not in ('', 'false', '0', 'null') as suspended,
        cl.c->>'biz' as business, cl.c->>'role' as industry, cl.c->>'city' as city, cl.c->>'phone' as business_phone
      from ${T} kv cross join lateral jsonb_each(coalesce(${S}aaas_jsonb(kv.v), '{}'::jsonb)) u
      left join ${CLINIC} cl on cl.owner = u.key
      where kv.k = 'as_users'`,
    `create or replace view ${S}aaas_businesses as
      select owner as email, c->>'biz' as business, c->>'role' as industry, c->>'city' as city, c->>'phone' as phone,
        coalesce(c->>'demo', '') not in ('', 'false', '0', 'null') as sample_data,
        jsonb_array_length(coalesce(c->'enquiries', '[]'::jsonb)) as enquiries, jsonb_array_length(coalesce(c->'leads', '[]'::jsonb)) as leads,
        jsonb_array_length(coalesce(c->'posts', '[]'::jsonb)) as posts, jsonb_array_length(coalesce(c->'patients', '[]'::jsonb)) as customers
      from ${CLINIC} x`,
    `create or replace view ${S}aaas_enquiries as
      select x.owner as business_email, x.c->>'biz' as business, e->>'name' as name, e->>'phone' as phone, e->>'email' as email,
        e->>'channel' as channel, e->>'message' as message, e->>'status' as status, e->>'source' as source, (e->>'at') as at
      from ${CLINIC} x cross join lateral jsonb_array_elements(case when jsonb_typeof(x.c->'enquiries') = 'array' then x.c->'enquiries' else '[]'::jsonb end) e`,
    `create or replace view ${S}aaas_leads as
      select x.owner as business_email, x.c->>'biz' as business, l->>'name' as name, l->>'phone' as phone, l->>'email' as email,
        l->>'channel' as channel, coalesce(l->>'stage', l->>'status') as stage, l->>'message' as message, (l->>'at') as at
      from ${CLINIC} x cross join lateral jsonb_array_elements(case when jsonb_typeof(x.c->'leads') = 'array' then x.c->'leads' else '[]'::jsonb end) l`,
    `create or replace view ${S}aaas_posts as
      select x.owner as business_email, x.c->>'biz' as business, p->>'text' as text, p->>'status' as status,
        (select string_agg(n, ', ') from jsonb_array_elements_text(case when jsonb_typeof(p->'platforms') = 'array' then p->'platforms' else '[]'::jsonb end) n) as networks,
        p->'publish'->>'status' as published, (p->>'at') as at
      from ${CLINIC} x cross join lateral jsonb_array_elements(case when jsonb_typeof(x.c->'posts') = 'array' then x.c->'posts' else '[]'::jsonb end) p`,
  ];
  let ready = null;
  const init = () => (ready ||= (async () => {
    if (schema) await q(`create schema if not exists ${ident(schema)}`);
    await q(`create table if not exists ${M} (version int primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await q(`select version from ${M}`)).map((r) => Number(r.version)));
    for (const [v, text] of MIGRATIONS) {
      if (done.has(v)) continue;
      await q(text);
      await q(`insert into ${M} (version) values ($1) on conflict do nothing`, [v]);
    }
    for (const text of VIEWS) { try { await q(text); } catch (e) { console.error('Postgres view:', e.message); } } // views never stop the app
  })().catch((e) => { ready = null; throw e; }));
  const row = (r) => ({ k: r.k, v: r.v, at: Number(r.at) || 0 });
  const st = {
    kind: driver === 'neon' ? 'neon' : 'postgres',
    driver,
    schema: schema || 'public',
    init,
    close,
    async all() { await init(); return (await q(`select k, v, at from ${T}`)).map(row); },
    // one row per sign-up / sign-in (aaas_logins)
    async logEvent(email, event, method) { await init(); await q(`insert into ${S}aaas_logins (email, event, method) values ($1, $2, $3)`, [String(email).slice(0, 200), String(event).slice(0, 20), String(method || 'password').slice(0, 20)]); },
    async get(k) { await init(); const r = await q(`select k, v, at, ver from ${T} where k = $1`, [k]); return r[0] ? { ...row(r[0]), ver: Number(r[0].ver) || 0 } : null; },
    async put(k, v, at) {
      await init();
      await q(`insert into ${T} (k, v, at) values ($1, $2, $3)
               on conflict (k) do update set v = excluded.v, at = excluded.at, ver = ${T}.ver + 1, updated_at = now()`, [k, wellFormed(v), Number(at) || Date.now()]);
    },
    async del(k) { await init(); await q(`delete from ${T} where k = $1`, [k]); },
    // several keys in one round trip (missing keys are left out)
    async getMany(keys) { await init(); if (!keys.length) return []; return (await q(`select k, v, at from ${T} where k = any($1::text[])`, [keys])).map(row); },
    // remove rows outright (no null placeholder rows left behind)
    async delMany(keys) { await init(); if (!keys.length) return 0; return (await q(`delete from ${T} where k = any($1::text[]) returning k`, [keys])).length; },
    async listPrefix(prefix) {
      await init();
      const like = String(prefix).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      return (await q(`select k, v, at from ${T} where k like $1 escape '\\'`, [like])).map(row);
    },
    // Read-modify-write without lost updates: fn(currentText|null) → new text (or undefined to leave it).
    async update(k, fn, { tries = 40 } = {}) {
      await init();
      for (let i = 0; i < tries; i++) {
        const cur = await st.get(k);
        const next = await fn(cur ? cur.v : null);
        if (next === undefined) return cur ? cur.v : null;
        const at = Date.now();
        const r = cur
          ? await q(`update ${T} set v = $2, at = $3, ver = ver + 1, updated_at = now() where k = $1 and ver = $4 returning k`, [k, wellFormed(next), at, cur.ver])
          : await q(`insert into ${T} (k, v, at) values ($1, $2, $3) on conflict (k) do nothing returning k`, [k, wellFormed(next), at]);
        if (r.length) return next;
        await sleep(crypto.randomInt(Math.min(1000, 20 * 2 ** Math.min(i, 6)))); // someone else wrote first: read again and re-apply
      }
      throw new Error('Too many concurrent changes to ' + k + '; try again.');
    },
    // Cross-instance lease. Returns release(). Waits up to waitMs; a crashed holder's lease expires after ttlMs.
    async lock(name, { ttlMs = 30000, waitMs = 20000 } = {}) {
      await init();
      const holder = crypto.randomBytes(8).toString('hex'), end = Date.now() + waitMs;
      for (let i = 0; ; i++) {
        const r = await q(`insert into ${L} (name, holder, expires) values ($1, $2, now() + ($3::text || ' milliseconds')::interval)
                           on conflict (name) do update set holder = excluded.holder, expires = excluded.expires where ${L}.expires < now()
                           returning holder`, [name, holder, String(ttlMs)]);
        if (r[0] && r[0].holder === holder) return async () => { await q(`delete from ${L} where name = $1 and holder = $2`, [name, holder]).catch(() => {}); };
        if (Date.now() > end) throw new Error('Busy: another server is changing ' + name + '. Try again.');
        await sleep(Math.min(500, 20 * (i + 1)));
      }
    },
    async dropSchema() { if (!schema || schema === 'public') throw new Error('refusing to drop'); await q(`drop schema if exists ${ident(schema)} cascade`); ready = null; },
  };
  return st;
}
