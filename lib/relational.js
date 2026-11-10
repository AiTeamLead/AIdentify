// Relational tables for one Postgres database. Every product row carries business_id.
// backfillFromKv copies clinic KV rows into these tables. It does not open a connection.
import crypto from 'node:crypto';

export const RELATIONAL_SQL = [
  `create table if not exists aaas_business (
    id uuid primary key,
    name text not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists aaas_user (
    id uuid primary key,
    business_id uuid not null references aaas_business(id),
    email text not null,
    password_hash text not null,
    unique (business_id, email)
  )`,
  `create table if not exists aaas_location (
    id uuid primary key,
    business_id uuid not null references aaas_business(id),
    city text not null,
    place_id text
  )`,
  `create table if not exists aaas_branch (
    id uuid primary key,
    business_id uuid not null references aaas_business(id),
    location_id uuid not null references aaas_location(id),
    name text not null,
    area text,
    phone_e164 text
  )`,
  `create table if not exists aaas_offer (
    id uuid primary key,
    business_id uuid not null references aaas_business(id),
    title text not null,
    type text not null,
    value numeric not null,
    validity_days int not null default 30
  )`,
  `create table if not exists aaas_invoice (
    id uuid primary key,
    business_id uuid not null references aaas_business(id),
    number text not null,
    status text not null,
    total_inr numeric not null default 0
  )`,
  `create table if not exists aaas_post (
    id uuid primary key,
    business_id uuid not null references aaas_business(id),
    status text not null,
    body text not null default ''
  )`,
  `create table if not exists aaas_audit (
    id uuid primary key,
    business_id uuid not null references aaas_business(id),
    actor text not null,
    action text not null,
    payload_hash text not null,
    at timestamptz not null default now()
  )`,
];

export function assertBusiness(businessId) {
  const id = String(businessId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    const e = new Error('business_id is required');
    e.code = 'no_tenant';
    throw e;
  }
  return id;
}

export function tenantInsert(table, businessId, columns) {
  const id = assertBusiness(businessId);
  const names = Object.keys(columns);
  const sql = `insert into ${table} (business_id, ${names.join(', ')}) values ($1, ${names.map((_, i) => '$' + (i + 2)).join(', ')})`;
  return { sql, params: [id, ...names.map((n) => columns[n])] };
}

export async function applyRelational(q) {
  for (const sql of RELATIONAL_SQL) await q(sql);
}

export function deterministicUuid(seed) {
  const h = crypto.createHash('sha256').update(String(seed)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function businessIdFor(email) {
  return deterministicUuid('aaas-business:' + String(email || '').trim().toLowerCase());
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function clinicFromKv(email, raw) {
  let c = {};
  try { c = JSON.parse(raw || '{}') || {}; } catch { c = {}; }
  const profile = c.profile && typeof c.profile === 'object' ? c.profile : {};
  const locations = Array.isArray(profile.locations) ? profile.locations : [];
  return {
    email: String(email || '').trim().toLowerCase(),
    name: String(c.biz || profile.biz || 'Business').slice(0, 200),
    city: String(c.city || profile.city || ''),
    locations,
    offers: Array.isArray(profile.offers) ? profile.offers : [],
    invoices: Array.isArray(c.invoices) ? c.invoices : [],
    posts: Array.isArray(c.posts) ? c.posts : [],
  };
}

export function backfillStatements(clinic) {
  const email = String(clinic.email || '').trim().toLowerCase();
  const bid = businessIdFor(email);
  const upsert = (sql, params) => ({ sql, params });
  const rows = [
    upsert(
      `insert into aaas_business (id, name) values ($1, $2) on conflict (id) do update set name = excluded.name`,
      [bid, clinic.name || 'Business'],
    ),
    upsert(
      `insert into aaas_user (id, business_id, email, password_hash) values ($1, $2, $3, $4) on conflict (id) do update set email = excluded.email`,
      [deterministicUuid('user:' + email), bid, email, 'redacted'],
    ),
  ];
  const locs = clinic.locations && clinic.locations.length
    ? clinic.locations
    : (clinic.city ? [{ city: clinic.city }] : []);
  for (const loc of locs) {
    const city = String(loc.city || clinic.city || 'Unknown').slice(0, 120);
    const lid = deterministicUuid('loc:' + email + ':' + city.toLowerCase());
    rows.push(upsert(
      `insert into aaas_location (id, business_id, city, place_id) values ($1, $2, $3, $4) on conflict (id) do update set city = excluded.city, place_id = excluded.place_id`,
      [lid, bid, city, loc.placeId || loc.place_id || null],
    ));
    for (const br of loc.branches || []) {
      const name = String(br.name || 'Branch').slice(0, 120);
      rows.push(upsert(
        `insert into aaas_branch (id, business_id, location_id, name, area, phone_e164) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set name = excluded.name, area = excluded.area, phone_e164 = excluded.phone_e164`,
        [deterministicUuid('br:' + email + ':' + city.toLowerCase() + ':' + name.toLowerCase()), bid, lid, name, br.area || null, br.phone || br.phone_e164 || null],
      ));
    }
  }
  for (const offer of clinic.offers || []) {
    const title = String(offer.title || offer.name || 'Offer').slice(0, 200);
    rows.push(upsert(
      `insert into aaas_offer (id, business_id, title, type, value, validity_days) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set title = excluded.title, type = excluded.type, value = excluded.value, validity_days = excluded.validity_days`,
      [deterministicUuid('offer:' + email + ':' + title.toLowerCase()), bid, title, String(offer.type || 'note').slice(0, 40), num(offer.value), Math.round(num(offer.validity_days || offer.validityDays) || 30)],
    ));
  }
  for (const inv of clinic.invoices || []) {
    const number = String(inv.number || inv.id || 'INV').slice(0, 40);
    rows.push(upsert(
      `insert into aaas_invoice (id, business_id, number, status, total_inr) values ($1, $2, $3, $4, $5) on conflict (id) do update set status = excluded.status, total_inr = excluded.total_inr`,
      [deterministicUuid('inv:' + email + ':' + number), bid, number, String(inv.status || inv.state || 'draft').slice(0, 40), num(inv.total_inr ?? inv.total)],
    ));
  }
  for (const post of clinic.posts || []) {
    const pid = String(post.id || '');
    rows.push(upsert(
      `insert into aaas_post (id, business_id, status, body) values ($1, $2, $3, $4) on conflict (id) do update set status = excluded.status, body = excluded.body`,
      [deterministicUuid('post:' + email + ':' + pid), bid, String(post.status || 'draft').slice(0, 40), String(post.body || post.text || '').slice(0, 8000)],
    ));
  }
  return rows;
}

export async function backfillFromKv(rows, q) {
  const clinics = (rows || []).filter((row) => row && String(row.k || '').startsWith('as_clinic:') && String(row.k).length > 'as_clinic:'.length);
  let statements = 0;
  for (const row of clinics) {
    const clinic = clinicFromKv(String(row.k).slice('as_clinic:'.length), row.v);
    if (!clinic.email) continue;
    for (const stmt of backfillStatements(clinic)) {
      await q(stmt.sql, stmt.params);
      statements += 1;
    }
  }
  return { businesses: clinics.length, statements };
}
