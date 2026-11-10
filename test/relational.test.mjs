import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELATIONAL_SQL, tenantInsert, assertBusiness, applyRelational, backfillStatements, clinicFromKv, businessIdFor } from '../lib/relational.js';

test('every relational table is keyed by business_id', () => {
  assert.ok(RELATIONAL_SQL.length >= 8);
  for (const sql of RELATIONAL_SQL) {
    if (sql.includes('aaas_business (')) continue;
    assert.match(sql, /business_id uuid not null/);
  }
});

test('a write without a business id is refused', () => {
  assert.throws(() => tenantInsert('aaas_invoice', '', { number: 'INV-1' }), /business_id is required/);
  const row = tenantInsert('aaas_invoice', '11111111-1111-1111-1111-111111111111', { number: 'INV-1', status: 'draft', total_inr: 10 });
  assert.match(row.sql, /insert into aaas_invoice \(business_id, number, status, total_inr\)/);
  assert.equal(row.params[0], '11111111-1111-1111-1111-111111111111');
  assert.equal(assertBusiness(row.params[0]), row.params[0]);
});

test('applyRelational runs each statement once', async () => {
  const seen = [];
  await applyRelational(async (sql) => { seen.push(sql); });
  assert.equal(seen.length, RELATIONAL_SQL.length);
});

test('KV clinic rows become idempotent upserts and do not copy a password', () => {
  const raw = JSON.stringify({
    biz: 'North Agency', city: 'Hyderabad',
    profile: { locations: [{ city: 'Hyderabad', branches: [{ name: 'Banjara', area: 'Road 12', phone: '+919800000000' }] }], offers: [{ title: 'Audit', type: 'service', value: 0 }] },
    invoices: [{ number: 'INV-1', state: 'unpaid', total: 1500 }],
    posts: [{ id: 'p1', status: 'draft', text: 'Hello Diwali' }],
  });
  const once = backfillStatements(clinicFromKv('Owner@Example.com', raw));
  const twice = backfillStatements(clinicFromKv('owner@example.com', raw));
  assert.equal(once[0].params[0], businessIdFor('owner@example.com'));
  assert.equal(once[0].params[0], twice[0].params[0]);
  assert.ok(once.every((row) => /on conflict \(id\) do update/.test(row.sql)));
  assert.equal(JSON.stringify(once).includes('+919800000000'), true);
  assert.equal(once.some((row) => row.params.includes('redacted')), true);
  assert.equal(once.some((row) => String(row.params[0]).length === 36), true);
});
