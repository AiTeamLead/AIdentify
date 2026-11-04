// Landing site (AIDENTIFY_SITE=landing): v2 is /. v1 stays at /v1. /v2 and /white-label keep working.
// The product server still serves the app at /.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, ROOT } from './helpers.mjs';
import { BUSINESS_TYPES } from '../lib/waitlist.js';
import { applyPriceTokens } from '../lib/pricing.js';

const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

test('landing v2 reuses the waitlist business types, with no default on the main page', () => {
  const js = read('landing-v2.js');
  const listed = Function('return ' + js.match(/const BUSINESS_TYPES = (\[[\s\S]*?\]);/)[1])();
  assert.deepEqual(listed, BUSINESS_TYPES);
  assert.ok(BUSINESS_TYPES.length >= 14, 'canonical list is the server list');
  assert.equal(new Set(BUSINESS_TYPES).size, BUSINESS_TYPES.length);
  assert.ok(BUSINESS_TYPES.includes('Digital marketing agency'));
  assert.ok(BUSINESS_TYPES.includes('Other'));

  const main = read('landing-v2.html');
  const wl = read('white-label.html');
  assert.doesNotMatch(main, /data-preselect/);
  assert.match(wl, /data-preselect="Digital marketing agency"/);
  assert.match(wl, /name="businessType" required/);
  assert.match(js, /sel\.value = pre && BUSINESS_TYPES\.includes\(pre\) \? pre : ''/);
  assert.match(wl, /id="join-form"/);
  assert.match(wl, /name="consent"/);
  assert.match(wl, /name="website"/);
  assert.match(wl, /src="\/landing-v2\.js"/);
  assert.match(main, /src="\/landing-v2\.js"/);
  assert.match(js, /fetch\('\/api\/waitlist'/);
  assert.match(main, /href="\/white-label"/);
  assert.match(main, /Create free account/);
  assert.match(main, /href="\/app#signup"/);
  assert.match(main, /href="\/app"/);
  assert.match(main, /assets\/landing\/chief\.png/);
  assert.doesNotMatch(main, /₹|INR|UPI|upi-qr/);
  assert.doesNotMatch(main, /\{\{SELF_INR\}\}|\{\{HOSTED_INR\}\}|\{\{SETUP_INR\}\}/);
  assert.doesNotMatch(main, /₹14,999/);
  assert.match(wl, /₹14,999/);
  assert.doesNotMatch(main, /\bSMS\b/);
  assert.doesNotMatch(main, /\bsms\b/);
  assert.doesNotMatch(main, /MSG91/);
  assert.doesNotMatch(main, /testimonial|trusted by|★★|customers love/i);
  assert.match(read('waitlist.html'), /Join the waitlist/);
  assert.doesNotMatch(read('waitlist.html'), /landing-v2/);
});

test('landing build serves v2 at / and keeps v1 as waitlist.html', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const rewrite = (src) => vercel.rewrites.find((r) => r.source === src);
  assert.equal(rewrite('/v1').destination, '/waitlist.html');
  assert.equal(rewrite('/v2').destination, '/landing-v2.html');
  assert.equal(rewrite('/white-label').destination, '/white-label.html');
  assert.equal(vercel.rewrites.some((r) => r.source === '/' || r.source === '/index.html'), false);
  const build = (env) => execFileSync(process.execPath, ['scripts/vercel-build.mjs'], { cwd: ROOT, env: { ...process.env, ...env } });
  const pub = (name) => fs.readFileSync(path.join(ROOT, 'public', name), 'utf8');
  try {
    build({ AIDENTIFY_SITE: '' });
    assert.equal(pub('index.html'), read('clinic.html'), 'product build serves the owner sign-in (clinic app) at /');
    assert.equal(pub('app.html'), read('index.html'), 'the workplace app moves to /app');
    build({ AIDENTIFY_SITE: 'landing' });
    assert.equal(pub('index.html'), applyPriceTokens(read('landing-v2.html')));
    assert.notEqual(pub('index.html'), read('waitlist.html'));
    assert.equal(pub('landing-v2.html'), applyPriceTokens(read('landing-v2.html')));
    for (const f of ['white-label.html', 'landing-v2.css', 'landing-v2.js', 'waitlist.html']) {
      assert.equal(pub(f), read(f));
    }
  } finally {
    fs.rmSync(path.join(ROOT, 'public'), { recursive: true, force: true });
  }
});

test('server serves /v2 and /white-label and leaves / on the app', async (t) => {
  const s = await startServer();
  t.after(s.stop);
  const v2 = await fetch(s.base + '/v2');
  assert.equal(v2.status, 200);
  assert.match(v2.headers.get('content-type'), /text\/html/);
  const html = await v2.text();
  assert.match(html, /A small business gets a team of AI agents/);
  assert.match(html, /Create free account/);
  assert.match(html, /href="\/app#signup"/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/deletion"/);
  assert.match(html, /916302381884/);
  assert.doesNotMatch(html, /₹|upi-qr|\{\{SELF_INR\}\}/);
  const alias = await fetch(s.base + '/data-deletion', { redirect: 'manual' });
  assert.equal(alias.status, 301);
  assert.equal(alias.headers.get('location'), '/deletion');
  assert.match(html, /White Label/);
  assert.doesNotMatch(html, /\bSMS\b/);
  assert.doesNotMatch(html, /\bsms\b/);
  const wl = await fetch(s.base + '/white-label');
  assert.equal(wl.status, 200);
  assert.match(await wl.text(), /Resell AaaS under your brand/);
  const css = await fetch(s.base + '/landing-v2.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const js = await fetch(s.base + '/landing-v2.js');
  assert.equal(js.status, 200);
  const home = await fetch(s.base + '/');
  const homeHtml = await home.text();
  assert.equal(home.status, 200);
  assert.doesNotMatch(homeHtml, /A small business gets a team of AI agents/);
  const v1 = await fetch(s.base + '/v1');
  assert.equal(v1.status, 200);
  assert.match(await v1.text(), /Never miss a lead again/);
  const wait = await fetch(s.base + '/waitlist');
  assert.match(await wait.text(), /Join the waitlist/);
  const opts = await s.api('/api/waitlist/options');
  assert.deepEqual(opts.d.businessTypes, BUSINESS_TYPES);
  const joined = await s.api('/api/waitlist', {
    name: 'Asha Rao', email: 'asha@clinic.example', businessType: 'Clinic: skin / aesthetic / hair',
    city: 'Pune', whatsapp: '9876543211', consent: true, source: 'landing-v2',
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.d.ok, true);
  const missing = await s.api('/api/waitlist', {
    name: 'Asha Rao', email: 'asha@clinic.example', businessType: '',
    city: 'Pune', whatsapp: '9876543211', consent: true,
  });
  assert.equal(missing.status, 400);
  assert.ok(missing.d.fields.businessType);
});

test('landing site serves v2 at / and v1 at /v1', async (t) => {
  const s = await startServer({ AIDENTIFY_SITE: 'landing' });
  t.after(s.stop);
  const home = await fetch(s.base + '/');
  assert.equal(home.status, 200);
  const homeHtml = await home.text();
  assert.match(homeHtml, /A small business gets a team of AI agents/);
  assert.match(homeHtml, /Create free account/);
  assert.match(homeHtml, /href="\/app#signup"/);
  assert.match(homeHtml, /href="\/white-label"/);
  const v2 = await fetch(s.base + '/v2');
  assert.match(await v2.text(), /A small business gets a team of AI agents/);
  const v1 = await fetch(s.base + '/v1');
  const v1Html = await v1.text();
  assert.match(v1Html, /Never miss a lead again/);
  assert.doesNotMatch(v1Html, /landing-v2/);
  const wl = await fetch(s.base + '/white-label');
  assert.match(await wl.text(), /Resell AaaS under your brand/);
});
