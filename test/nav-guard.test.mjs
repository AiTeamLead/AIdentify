import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from './helpers.mjs';

const PW = 'Clinic-pass-123!';

test('a finished account is not sent back through onboarding', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on' });
  try {
    const email = 'e2e-guard-' + Date.now() + '@example.com';
    const tok = (await s.api('/api/auth/signup', { email, name: 'G', password: PW })).d.token;
    await s.api('/api/clinic/profile', { biz: 'Harbour Dental', city: 'Pune', services: 'Cleaning', audience: 'Families nearby', offer: 'Check-up' }, tok);
    const role = await s.api('/api/clinic/role', { role: 'dental' }, tok);
    assert.equal(role.status, 200);
    assert.equal(role.d.role, 'dental');
    const draft = await s.api('/api/clinic/onboarding/draft', { step: 0, biz: 'Overwrite' }, tok);
    assert.equal(draft.status, 200);
    const home = await s.api('/api/clinic', undefined, tok);
    assert.equal(home.d.needsRole, undefined);
    assert.equal(home.d.role, 'dental');
    assert.equal(home.d.biz, 'Harbour Dental');
    const src = fs.readFileSync(new URL('../clinic.html', import.meta.url), 'utf8');
    assert.match(src, /history\.replaceState\(null, '', state\.rolePath \|\| '\/clinic'\)/);
    assert.match(src, /captureReturn\(\)/);
  } finally { await s.stop(); }
});
