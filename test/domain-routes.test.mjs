// Domain-specific URLs: every industry pack has its own path that serves the clinic app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from './helpers.mjs';
import { PACK_IDS, PACK_PATHS, packForPath, publicPacks } from '../lib/clinic-packs.js';

const PW = 'Clinic-pass-123!';

test('every pack has a unique path; dental stays /clinic, real estate is /Realestate', () => {
  assert.equal(PACK_PATHS.dental, '/clinic');
  assert.equal(PACK_PATHS.realestate, '/Realestate');
  assert.equal(new Set(Object.values(PACK_PATHS)).size, PACK_IDS.length);
  for (const id of PACK_IDS) assert.equal(packForPath(PACK_PATHS[id]), id);
  assert.equal(packForPath('/realestate'), 'realestate');
  assert.equal(packForPath('/Realestate/'), 'realestate');
  assert.equal(packForPath('/api'), '');
  assert.ok(publicPacks().every((p) => p.path === PACK_PATHS[p.id]));
});

test('the sign-in at / lists every industry link; each industry path has its own sign-in', () => {
  const src = fs.readFileSync(new URL('../clinic.html', import.meta.url), 'utf8');
  assert.match(src, /Choose your industry/);
  assert.match(src, /<a class="dom" href="\$\{esc\(p\.path\)\}">/);
  assert.match(src, /function entryPack\(\)/);
});

test('each pack path serves the app and the account reports its own path', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', CLINIC_DEMO_PLATFORM_KEY: '1', CLINIC_DEMO: '1' });
  try {
    for (const p of [...Object.values(PACK_PATHS), '/realestate', '/clinic.html']) {
      const r = await fetch(s.base + p); assert.equal(r.status, 200, p);
      assert.match(await r.text(), /function homePath\(\)/, p);
    }
    assert.equal((await fetch(s.base + '/Nope')).status, 404);
    // "/" is the public home page whose Sign in opens /clinic; the workplace app is at /app and still answers /?bot=1 (Bot Mode frame)
    const homePage = await (await fetch(s.base + '/')).text();
    assert.match(homePage, /Less admin\. More time for your customers\./); assert.match(homePage, /href="\/Aesthetic">Sign in/); assert.match(homePage, /href="\/Aesthetic#signup">Get Started Free/);
    for (const a of ['/home.css', '/home.js', '/assets/landing/chief.png', '/assets/landing/dashboard.png', '/assets/landing/crm.png', '/assets/landing/approvals.png', '/assets/landing/onboarding-user-step-1.webp', '/assets/landing/onboarding-user-step-2.webp', '/assets/landing/onboarding-user-step-3.webp', '/assets/landing/onboarding-user-step-4.webp', '/assets/landing/onboarding-user-step-5.webp', '/assets/landing/onboarding-user-step-6.webp', '/assets/landing/onboarding-user-step-7.webp', '/assets/landing/onboarding-user-ready.webp', '/assets/landing/onboarding-ready-cropped.webp']) assert.equal((await fetch(s.base + a)).status, 200, a);
    for (const p of ['/app', '/?bot=1', '/app?bot=1&mini=1']) assert.match(await (await fetch(s.base + p)).text(), /const botMode=/, p);
    const tok = (await s.api('/api/auth/signup', { email: 'route@example.com', name: 'R', password: PW })).d.token;
    await s.api('/api/clinic/profile', { biz: 'Homes', city: 'Pune', services: 'Flats', prices: '₹50L', audience: 'Buyers', offer: 'Site visit' }, tok);
    const role = await s.api('/api/clinic/role', { role: 'realestate' }, tok);
    assert.equal(role.d.rolePath, '/Realestate');
    const home = await s.api('/api/clinic', undefined, tok);
    assert.equal(home.d.rolePath, '/Realestate');
    assert.ok(home.d.packs === undefined || home.d.packs.every((p) => p.path));
  } finally { await s.stop(); }
});
