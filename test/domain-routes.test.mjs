// Domain-specific URLs: every industry pack has its own path that serves the clinic app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from './helpers.mjs';
import { PACK_IDS, PACK_PATHS, packForPath, publicPacks } from '../lib/clinic-packs.js';

const PW = 'Clinic-pass-123!';

test('every pack has a unique path; /workspace is the shared sign-in, dental is /Dental', () => {
  assert.equal(PACK_PATHS.dental, '/Dental');
  assert.equal(PACK_PATHS.agency, '/Agency');
  assert.equal(PACK_PATHS.realestate, '/Realestate');
  assert.equal(new Set(Object.values(PACK_PATHS)).size, PACK_IDS.length);
  for (const id of PACK_IDS) assert.equal(packForPath(PACK_PATHS[id]), id);
  assert.equal(packForPath('/workspace'), '');
  assert.equal(packForPath('/workspace.html'), '');
  assert.equal(packForPath('/clinic'), '');
  assert.equal(packForPath('/clinic.html'), '');
  assert.equal(packForPath('/'), '');
  assert.equal(packForPath('/dental'), 'dental');
  assert.equal(packForPath('/realestate'), 'realestate');
  assert.equal(packForPath('/Realestate/'), 'realestate');
  assert.equal(packForPath('/api'), '');
  assert.ok(publicPacks().every((p) => p.path === PACK_PATHS[p.id]));
  assert.equal(publicPacks().find((p) => p.featured).id, 'agency');
});

test('the sign-in at / and /workspace is industry-neutral and features the agency pack', () => {
  const src = fs.readFileSync(new URL('../clinic.html', import.meta.url), 'utf8');
  assert.match(src, /Choose your industry/);
  assert.match(src, /<a class="dom" href="\$\{esc\(p\.path\)\}">/);
  assert.match(src, /function entryPack\(\)/);
  assert.match(src, /For any business/);
  assert.match(src, /Start with \$\{esc\(feat\.title\)\}/);
  assert.match(src, /workspace\(\\\.html\)\?/);
  assert.match(src, /href="\/workspace">All industries/);
  assert.match(src, /function warmApi\(\)/);
  assert.match(src, /\/api\/health/);
  assert.match(src, /is-busy/);
  assert.doesNotMatch(src, /Dental clinic/);
});

test('each pack path serves the app and the account reports its own path', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', CLINIC_DEMO_PLATFORM_KEY: '1', CLINIC_DEMO: '1' });
  try {
    for (const p of [...Object.values(PACK_PATHS), '/realestate', '/workspace', '/workspace.html']) {
      const r = await fetch(s.base + p); assert.equal(r.status, 200, p);
      assert.match(await r.text(), /function homePath\(\)/, p);
    }
    for (const p of ['/clinic', '/clinic.html', '/clinic?from=old']) {
      const r = await fetch(s.base + p, { redirect: 'manual' });
      assert.equal(r.status, 301, p);
      const loc = r.headers.get('location') || '';
      assert.match(loc, /^\/workspace/, loc + ' from ' + p);
      if (p.includes('?')) assert.match(loc, /from=old/);
    }
    const app = await fetch(s.base + '/app');
    assert.equal(app.status, 200);
    const appHtml = await app.text();
    assert.match(appHtml, /Tell Chief of Staff about the business/);
    assert.match(appHtml, /Open Chief/);
    assert.match(appHtml, /\/workspace#chat/);
    assert.doesNotMatch(appHtml, /if\(!botMode\)\{try\{const su=await fetch\('\/api\/setup'\)/);
    const admin = await fetch(s.base + '/admin');
    assert.equal(admin.status, 200);
    assert.match(await admin.text(), /ADMIN_ENTRY/);
    assert.equal((await fetch(s.base + '/Nope')).status, 404);
    // "/" is the owner sign-in; the workplace app is at /app and still answers /?bot=1 (Bot Mode frame)
    assert.match(await (await fetch(s.base + '/')).text(), /function homePath\(\)/);
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
