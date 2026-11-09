// Landing site (AIDENTIFY_SITE=landing): v2 is /. v1 stays at /v1. /v2 and /white-label keep working.
// The product server still serves the app at /.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, ROOT } from './helpers.mjs';
import { BUSINESS_TYPES } from '../lib/waitlist.js';
import { applyPriceTokens, SELF_HOSTED_INR, HOSTED_INR, SETUP_INR } from '../lib/pricing.js';

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
  const productHome = read('home.html');
  assert.match(productHome, /aria-label="AIdentify home"[^>]*>[\s\S]*?AIdentify<\/a>/);
  assert.match(productHome, /Less admin\. More time for your customers\./);
  assert.match(productHome, /You started a business to serve people—not chase admin\./);
  assert.match(productHome, /Your day-to-day, under one roof\./);
  assert.match(productHome, /Get Started Free/);
  assert.equal([...productHome.matchAll(/role="tab" id="tab-/g)].length, 7, 'show all industries as tabs');
  assert.match(productHome, /role="tablist" aria-label="Industries"/);
  const homeCss = read('home.css');
  assert.match(homeCss, /\.tabs\s*\{\s*display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(4,/);
  assert.match(homeCss, /@media \(max-width: 900px\)[\s\S]*?\.tabs\s*\{\s*grid-template-columns:\s*repeat\(3,/);
  assert.match(homeCss, /@media \(max-width: 560px\)[\s\S]*?\.tabs\s*\{\s*grid-template-columns:\s*repeat\(2,/);
  const onboarding = productHome.match(/<div class="setup-gallery"[^>]*>([\s\S]*?)<\/div>\s*<\/section>/)?.[1] || '';
  assert.doesNotMatch(productHome, /assets\/landing\/onboarding\.png/);
  assert.equal([...onboarding.matchAll(/class="setup-shot"/g)].length, 1, 'show one large screenshot at a time');
  assert.equal([...onboarding.matchAll(/data-setup-step/g)].length, 9, 'provide selectors for seven steps, setup progress, and team ready');
  const homeJs = read('home.js');
  for (const image of ['onboarding-user-step-1.webp', 'onboarding-user-step-2.webp', 'onboarding-user-step-3.webp', 'onboarding-user-step-4.webp', 'onboarding-user-step-5.webp', 'onboarding-user-step-6.webp', 'onboarding-user-step-7.webp', 'onboarding-user-ready.webp', 'onboarding-ready-cropped.webp']) {
    assert.match(onboarding, new RegExp(`data-src="/assets/landing/${image}"`));
    assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'landing', image)), image);
  }
  assert.match(onboarding, /data-setup-prev/);
  assert.match(onboarding, /data-setup-next/);
  assert.match(homeJs, /showStep\(current - 1\)/);
  assert.match(homeJs, /showStep\(current \+ 1\)/);
  assert.match(main, /name="businessType" required/);
  assert.match(main, /<option value="" selected>Choose one<\/option>/);
  assert.doesNotMatch(main, /data-preselect/);
  assert.match(wl, /data-preselect="Digital marketing agency"/);
  assert.match(js, /sel\.value = pre && BUSINESS_TYPES\.includes\(pre\) \? pre : ''/);
  for (const page of [main, wl]) {
    assert.match(page, /id="join-form"/);
    assert.match(page, /name="consent"/);
    assert.match(page, /name="website"/);
    assert.match(page, /src="\/landing-v2\.js"/);
  }
  assert.match(js, /fetch\('\/api\/waitlist'/);
  assert.match(main, /class="tab" href="\/white-label"/);
  assert.doesNotMatch(main, /₹14,999/);
  assert.match(wl, /₹14,999/);
  assert.match(main, /\{\{SELF_INR\}\}/);
  assert.match(main, /\{\{HOSTED_INR\}\}/);
  assert.match(main, /\{\{SETUP_INR\}\}/);
  const priced = applyPriceTokens(main);
  assert.match(priced, new RegExp(SELF_HOSTED_INR.toLocaleString('en-IN')));
  assert.match(priced, new RegExp(HOSTED_INR.toLocaleString('en-IN')));
  assert.match(priced, new RegExp(SETUP_INR.toLocaleString('en-IN')));
  assert.doesNotMatch(priced, /₹5,999|₹8,000|₹15,000/);
  assert.doesNotMatch(main, /\bSMS\b/);
  assert.doesNotMatch(main, /\bsms\b/);
  assert.doesNotMatch(main, /MSG91/);
  assert.match(main, /Product preview/);
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
    assert.equal(pub('index.html'), read('home.html'), 'product build serves the home page at /; Sign in opens /clinic');
    for (const f of ['home.css', 'home.js', 'assets/landing/chief.png']) assert.ok(fs.existsSync(path.join(ROOT, 'public', f)), f);
    for (const f of ['onboarding-user-step-1.webp', 'onboarding-user-step-2.webp', 'onboarding-user-step-3.webp', 'onboarding-user-step-4.webp', 'onboarding-user-step-5.webp', 'onboarding-user-step-6.webp', 'onboarding-user-step-7.webp', 'onboarding-user-ready.webp']) {
      assert.ok(fs.existsSync(path.join(ROOT, 'public', 'assets', 'landing', f)), f);
    }
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
  assert.match(html, /Hire an AI team/);
  assert.match(html, /₹4,999/);
  assert.match(html, /₹9,999/);
  assert.doesNotMatch(html, /\{\{SELF_INR\}\}/);
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
  assert.doesNotMatch(homeHtml, /Hire an AI team/);
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
  assert.match(homeHtml, /Hire an AI team/);
  assert.match(homeHtml, /href="\/white-label"/);
  const v2 = await fetch(s.base + '/v2');
  assert.match(await v2.text(), /Hire an AI team/);
  const v1 = await fetch(s.base + '/v1');
  const v1Html = await v1.text();
  assert.match(v1Html, /Never miss a lead again/);
  assert.doesNotMatch(v1Html, /landing-v2/);
  const wl = await fetch(s.base + '/white-label');
  assert.match(await wl.text(), /Resell AaaS under your brand/);
});
