import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewCredit, enrollStarter, chargeStarter } from '../lib/credit.js';
import { startServer } from './helpers.mjs';

function memory() {
  const rows = new Map();
  return {
    async get(k) { const v = rows.get(k); return v == null ? null : { v }; },
    async put(k, v) { rows.set(k, v); },
  };
}

test('skip enrolls a $1 cap, warns at 80 cents, and blocks at $1', async () => {
  const st = memory();
  assert.equal(viewCredit(null).enrolled, false);
  const on = await enrollStarter(st, 'Owner@Example.com');
  assert.equal(on.leftUsd, 1);
  assert.equal(on.label, 'Using AaaS starter credit — $1.00 left');
  const again = await enrollStarter(st, 'owner@example.com');
  assert.equal(again.usedUsd, 0);
  const mid = await chargeStarter(st, 'owner@example.com', 0.8);
  assert.equal(mid.ok, true);
  assert.equal(mid.warn, true);
  assert.equal(mid.leftUsd, 0.2);
  const over = await chargeStarter(st, 'owner@example.com', 0.3);
  assert.equal(over.ok, false);
  assert.equal(over.code, 'cap');
  const exact = await chargeStarter(st, 'owner@example.com', 0.2);
  assert.equal(exact.ok, true);
  assert.equal(exact.blocked, true);
  assert.equal((await chargeStarter(st, 'owner@example.com', 0.01)).ok, false);
});

test('skip is not reported as a validated key', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'e2e-skip-' + Date.now() + '@example.com', name: 'S', password: 'Clinic-pass-123!' })).d.token;
    const skipped = await s.api('/api/clinic/ai/skip', {}, tok);
    assert.equal(skipped.status, 200);
    assert.equal(skipped.d.validated, false);
    assert.equal(skipped.d.starter.leftUsd, 1);
    const home = await s.api('/api/clinic', undefined, tok);
    assert.equal(home.d.aiKey.source, 'starter');
    assert.match(home.d.aiKey.label, /\$1\.00 left/);
  } finally { await s.stop(); }
});
