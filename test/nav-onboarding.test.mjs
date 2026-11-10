import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

const PW = 'Clinic-pass-123!';

test('onboarding steps are routes and a draft survives a refresh', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on' });
  try {
    const page = await fetch(s.base + '/onboarding/step/3');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /function obShow/);
    assert.equal((await fetch(s.base + '/onboarding/step/9')).status, 404);
    const email = 'e2e-nav-' + Date.now() + '@example.com';
    const tok = (await s.api('/api/auth/signup', { email, name: 'N', password: PW })).d.token;
    const saved = await s.api('/api/clinic/onboarding/draft', { step: 2, role: 'dental', biz: 'Harbour Dental', city: 'Pune', services: 'Cleaning', audience: 'Families nearby' }, tok);
    assert.equal(saved.status, 200);
    assert.equal(saved.d.step, 2);
    const home = await s.api('/api/clinic', undefined, tok);
    assert.equal(home.d.needsRole, true);
    assert.equal(home.d.onboardingStep, 2);
    assert.equal(home.d.biz, 'Harbour Dental');
    assert.equal(home.d.city, 'Pune');
    assert.equal(home.d.draftRole, 'dental');
    assert.equal(home.d.profile.services, 'Cleaning');
  } finally { await s.stop(); }
});

test('browser back stays on the step route and a dead session says progress is saved', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../clinic.html', import.meta.url), 'utf8');
  assert.match(src, /history\.pushState\(\{ ob: ob\.step \}/);
  assert.match(src, /popstate/);
  assert.match(src, /Your session expired\. Sign in to continue — your progress is saved\./);
  assert.match(src, /aaas_return/);
  assert.match(src, /state\.role && \/\^\\\/onboarding\\\/step\\\//);
});
