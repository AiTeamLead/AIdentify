// Relational tables for one Postgres database. Every product row carries business_id.
// The KV table remains until a backfill is run. This module does not open a connection.

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
