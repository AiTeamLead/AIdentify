import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELATIONAL_SQL, tenantInsert, assertBusiness, applyRelational } from '../lib/relational.js';

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
