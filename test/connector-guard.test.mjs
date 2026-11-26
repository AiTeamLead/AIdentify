// Connector sign-in guardrails: every OAuth state is single-use and bound (HttpOnly cookie) to the browser that started it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { ROOT, startServer } from './helpers.mjs';

const PW = 'Clinic-pass-123!';

test('Chief + menu and the sidebar open the Apps page', () => {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(src, /data-act="wpCnMenu"/);
  assert.match(src, /act==='wpCnMenu'\)\{wpRmClose\(\);wpAppsOpen\(\)\}/);
  assert.match(src, /data-act="wpApps"/);
  assert.match(src, /function wpAppsOpen\(\)\{if\(miniMode\)\{try\{parent\.postMessage\(\{type:'aaas-mini',full:true\}/);
  assert.match(fs.readFileSync(path.join(ROOT, 'clinic.html'), 'utf8'), /e\.data\.type === 'aaas-mini'/);
});

test('OAuth callback needs the starting browser cookie and works once', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', GOOGLE_CLIENT_ID: 'test-id', GOOGLE_CLIENT_SECRET: 'test-secret', CONNECTORS_OAUTH: 'own' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'conn@example.com', name: 'C', password: PW })).d.token;
    const start = async () => {
      const r = await fetch(s.base + '/api/connectors/start', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ c: 'gcal' }) });
      const d = await r.json(); assert.equal(r.status, 200, JSON.stringify(d));
      const ck = r.headers.get('set-cookie') || '';
      assert.match(ck, /^as_cn_gcal=[^;]+; HttpOnly; SameSite=Lax; Path=\/api\/connectors; Max-Age=600/);
      assert.ok(!('__cookie' in d));
      return { state: new URL(d.url).searchParams.get('state'), cookie: ck.split(';')[0] };
    };
    const cb = async (state, cookie, extra = '') => (await fetch(s.base + '/api/connectors/callback?state=' + encodeURIComponent(state) + extra, { headers: cookie ? { cookie } : {} })).text();

    // another browser (no cookie) cannot finish someone else's sign-in
    const a = await start();
    assert.match(await cb(a.state, ''), /different browser/);
    // and the state is burned after that attempt
    assert.match(await cb(a.state, a.cookie, '&error=access_denied'), /already used/);

    // a wrong cookie value is refused
    const b = await start();
    assert.match(await cb(b.state, 'as_cn_gcal=forged'), /different browser/);

    // the right browser passes the guard (the provider said "cancelled" here, so nothing is stored)
    const c = await start();
    assert.match(await cb(c.state, c.cookie, '&error=access_denied'), /You cancelled the sign-in/);
    assert.match(await cb(c.state, c.cookie, '&error=access_denied'), /already used/);

    // tampered state is rejected outright
    assert.match(await cb(c.state.slice(0, -4) + 'AAAA', c.cookie), /invalid/);
    assert.equal((await s.api('/api/connectors', undefined, tok)).d.items.length, 0);
  } finally { await s.stop(); }
});

// The page is open at 127.0.0.1 but APP_URL says localhost (same computer, same port): the sign-in goes through a
// one-time hop on the APP_URL name so the browser-binding cookie lands where the callback can read it.
test('loopback name mismatch: one-time hop sets the binding cookie on the APP_URL name', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', GOOGLE_CLIENT_ID: 'test-id', GOOGLE_CLIENT_SECRET: 'test-secret', CONNECTORS_OAUTH: 'own', APP_URL: 'http://localhost:1' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'hop@example.com', name: 'H', password: PW })).d.token;
    const port = new URL(s.base).port;
    const startAs = (host) => new Promise((resolve, reject) => {
      const body = JSON.stringify({ c: 'gcal' });
      const r = http.request({ host: '127.0.0.1', port, path: '/api/connectors/start', method: 'POST', headers: { host, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: 'Bearer ' + tok } }, (res) => {
        let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, cookie: res.headers['set-cookie'], d: JSON.parse(d) }));
      });
      r.on('error', reject); r.end(body);
    });
    // same name as APP_URL: no hop, cookie set directly
    const direct = await startAs('localhost:1');
    assert.match(direct.d.url, /^https:\/\/accounts\.google\.com\//);
    assert.ok(direct.cookie);
    // other loopback name: hop link on the APP_URL name, no cookie yet
    const hop = await startAs('127.0.0.1:1');
    assert.equal(hop.status, 200, JSON.stringify(hop.d));
    assert.match(hop.d.url, /^http:\/\/localhost:1\/api\/connectors\/go\?t=[\w-]{20,}$/);
    assert.equal(hop.cookie, undefined);
    const go = await fetch(s.base + new URL(hop.d.url).pathname + new URL(hop.d.url).search, { redirect: 'manual' });
    assert.equal(go.status, 302);
    const to = new URL(go.headers.get('location'));
    assert.equal(to.origin, 'https://accounts.google.com');
    assert.equal(to.searchParams.get('redirect_uri'), 'http://localhost:1/api/connectors/callback');
    const cookie = (go.headers.get('set-cookie') || '').split(';')[0];
    assert.match(cookie, /^as_cn_gcal=/);
    // the callback in that browser passes the guard (cancelled here, so nothing is stored)
    const cb = await (await fetch(s.base + '/api/connectors/callback?error=access_denied&state=' + encodeURIComponent(to.searchParams.get('state')), { headers: { cookie } })).text();
    assert.match(cb, /You cancelled the sign-in/);
    // a hop works once
    assert.match(await (await fetch(s.base + new URL(hop.d.url).pathname + new URL(hop.d.url).search, { redirect: 'manual' })).text(), /already used or has expired/);
    // different, non-loopback names never hop
    const far = await startAs('evil.example:1');
    assert.match(far.d.url, /^https:\/\/accounts\.google\.com\//);
  } finally { await s.stop(); }
});
