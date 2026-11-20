// v2.15: fixes from the 18 Nov test round (issues.pdf).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, ROOT } from './helpers.mjs';
import '../lib/onboarding-rules.js';
import { addApproval, saveApproval, withApprovals } from '../lib/appr-store.js';
import { brandCard } from '../lib/media.js';
import { parseReport, clinicAfterDecision } from '../lib/clinic.js';
import { NO_SHARED_APP } from '../lib/composio.js';

const PW = 'Tr1ckyHorse#Blue92';
const ENV = { RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', SAMPLE_DATA: 'off' };
const R = globalThis.OBRules;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(s, method, p, body, token) {
  const r = await fetch(s.base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, d: await r.json().catch(() => null) };
}
async function owner(s, email) {
  const tok = (await req(s, 'POST', '/api/auth/signup', { email, name: 'Owner', password: PW })).d.token;
  const p = await req(s, 'POST', '/api/clinic/profile', { biz: 'Bright Smile', locations: ['Hyderabad'], services: ['Root canal treatment'], audience: ['Families'], final: true, role: 'dental' }, tok);
  assert.equal(p.status, 200, JSON.stringify(p.d));
  await req(s, 'POST', '/api/clinic/role', { role: 'dental' }, tok);
  return tok;
}
// a store whose reads and writes take a little time, so racing writers really interleave
function slowStore() {
  const m = new Map();
  return { m, get: async (k) => { await sleep(Math.random() * 6); return m.has(k) ? { v: m.get(k) } : null; }, put: async (k, v) => { await sleep(Math.random() * 6); m.set(k, v); } };
}

test('#1 approvals are never lost when several are queued and decided at the same time', async () => {
  const st = slowStore(), email = 'q@example.com';
  await Promise.all(Array.from({ length: 12 }, (_, i) => addApproval(st, email, { id: 'a' + i, status: 'pending', summary: 'Post ' + i })));
  // decide half while six more arrive
  await Promise.all([
    ...Array.from({ length: 6 }, (_, i) => saveApproval(st, email, { id: 'a' + i, status: 'done', summary: 'Post ' + i, result: 'ok' })),
    ...Array.from({ length: 6 }, (_, i) => addApproval(st, email, { id: 'b' + i, status: 'pending', summary: 'More ' + i })),
  ]);
  const all = JSON.parse(st.m.get('as_appr:' + email));
  assert.equal(all.length, 18, 'every approval is still on file');
  assert.equal(new Set(all.map((a) => a.id)).size, 18, 'no duplicates');
  for (let i = 0; i < 6; i++) assert.equal(all.find((a) => a.id === 'a' + i).status, 'done');
  for (let i = 6; i < 12; i++) assert.equal(all.find((a) => a.id === 'a' + i).status, 'pending');
  const n = await withApprovals(st, email, (list) => list.filter((a) => a.status === 'pending').length);
  assert.equal(n, 12);
});

test('#1 #4 Chief keeps the picture in its history and never treats a gone approval as an error', () => {
  const wp = fs.readFileSync(ROOT + '/index.html', 'utf8');
  assert.match(wp, /function wpHistWithImages\(/);
  assert.match(wp, /history:wpHistWithImages\(c,hist\)/);
  assert.match(wp, /no longer exists/);
  const orch = fs.readFileSync(ROOT + '/lib/orchestrator.js', 'utf8');
  assert.match(orch, /Image attached by the user: /);
  assert.match(orch, /never ask which image/i);
});

test('#2 when every image model fails, a designed picture is made so a post is never text-only', async () => {
  const png = await brandCard('Diwali offer "20% off whitening" for families', { size: 'square', brand: { name: 'Bright Smile' } });
  assert.ok(Buffer.isBuffer(png) && png.length > 2000);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const sharp = (await import('sharp')).default;
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 1080); assert.equal(meta.height, 1080);
});

test('#5 Chief does not open a browser for a network that is connected through Composio', () => {
  const orch = fs.readFileSync(ROOT + '/lib/orchestrator.js', 'utf8');
  assert.match(orch, /linkedin\.com/); assert.match(orch, /connected/i);
  assert.match(orch, /not the browser|instead of the browser|never the browser|not a browser/i);
});

test('approved posts publish in the background and report each network', async () => {
  const r = parseReport('Instagram: published https://www.instagram.com/p/abc\nLinkedIn: failed - the token expired, reconnect LinkedIn\nFacebook: published https://facebook.com/123_456', ['Instagram', 'LinkedIn', 'Facebook']);
  assert.equal(r.status, 'partial');
  assert.deepEqual(r.per.map((x) => x.ok), [true, false, true]);
  assert.equal(r.links.length, 2);
  assert.equal(parseReport('X: published https://x.com/a/status/1', ['X']).status, 'published');
  assert.equal(parseReport('Nothing worked.', ['LinkedIn']).status, 'failed');

  // a post approved for today is published straight away; the approval says so
  const m = new Map(), st = { get: async (k) => (m.has(k) ? { v: m.get(k) } : null), put: async (k, v) => { m.set(k, v); } };
  const email = 'pub@example.com', lock = async (_e, fn) => fn();
  m.set('as_clinic:' + email, JSON.stringify({ role: 'marketing', biz: 'Bright', city: 'Hyderabad', posts: [], drafts: [], patients: [], appointments: [], enquiries: [], invoices: [] }));
  m.set('as_appr:' + email, JSON.stringify([{ id: 'p1', status: 'done', kind: 'draft' }]));
  const today = new Date().toISOString().slice(0, 10);
  const note = await clinicAfterDecision(st, email, { id: 'p1', status: 'done', kind: 'draft', app: 'draft', summary: 'Social media post for ' + today + ' (LinkedIn)', request: 'Hello Hyderabad\nImage attached by the user: https://example.com/a.jpg' }, lock);
  assert.match(note, /Publishing now on LinkedIn/);
  const c = JSON.parse(m.get('as_clinic:' + email));
  assert.equal(c.posts.length, 1);
  assert.ok(c.posts[0].publish && ['publishing', 'failed', 'partial', 'published'].includes(c.posts[0].publish.status));
});

test('#6 mobile numbers are exactly 10 digits everywhere', async () => {
  assert.equal(R.phone('98765 11111').value, '+919876511111');
  for (const bad of ['98765111112', '987651111', '+1 415 555 0123', '1234567890', '98765abcde']) assert.equal(R.phone(bad).ok, false, bad);
  const s = await startServer(ENV);
  try {
    const tok = await owner(s, 'ph@example.com');
    let r = await req(s, 'POST', '/api/clinic/enquiries', { name: 'Kiran Rao', phone: '98765111112', channel: 'Instagram', message: 'Braces cost?' }, tok);
    assert.equal(r.status, 400); assert.match(r.d.message, /exactly 10 digits/);
    r = await req(s, 'POST', '/api/clinic/enquiries', { name: 'Kiran Rao', phone: '+91 98765 11111', channel: 'Instagram', message: 'Braces cost?' }, tok);
    assert.equal(r.status, 200, JSON.stringify(r.d));
    r = await req(s, 'POST', '/api/clinic/import', { csv: 'name,phone\nAsha,987654321099\nRavi,9876543210' }, tok);
    assert.equal(r.status, 200, JSON.stringify(r.d)); assert.equal(r.d.patients, 1); assert.equal(r.d.errors.length, 1);
    assert.match(r.d.errors[0].message || r.d.errors[0].error || JSON.stringify(r.d.errors[0]), /10 digits/);
    // publishing needs an approved post on file
    r = await req(s, 'POST', '/api/clinic/posts/publish', { id: 999 }, tok);
    assert.equal(r.status, 404);
  } finally { await s.stop(); }
  const app = fs.readFileSync(ROOT + '/clinic.html', 'utf8');
  assert.match(app, /data-digits10/);
  assert.match(app, /const wp = R\.phone\(f\.phone\); if \(!wp\.ok\) throw new Error\(wp\.message\);/);
});

test('#3 #7 Integrations explain the Facebook label and how to connect X', () => {
  const app = fs.readFileSync(ROOT + '/clinic.html', 'utf8');
  assert.match(app, /Published by Composio” line only to Page admins/);
  assert.match(app, /developer\.x\.com/); assert.match(app, /X_CLIENT_ID and X_CLIENT_SECRET/);
  assert.ok(NO_SHARED_APP.has('twitter'));
});

test('#7 X for free: not connected -> "Post on X (free)" instead of X\'s error, and the publisher skips the API', async () => {
  assert.equal(parseReport('X (Twitter): manual - post it free with the Post on X button', ['X']).status, 'manual');
  const r = parseReport('LinkedIn: published https://www.linkedin.com/feed/update/1\nX (Twitter): manual - post it free with the Post on X button', ['LinkedIn', 'X']);
  assert.equal(r.status, 'partial'); assert.equal(r.per[1].manual, true); assert.equal(r.per[0].ok, true);
  const s = await startServer(ENV);
  try {
    const tok = await owner(s, 'x@example.com');
    const c = await req(s, 'POST', '/api/connectors/start', { c: 'cx:twitter' }, tok);
    assert.equal(c.status, 409, JSON.stringify(c.d));
    assert.match(c.d.message, /Post on X \(free\)/); assert.match(c.d.message, /developer\.x\.com/); assert.doesNotMatch(c.d.message, /free X app/);
    await req(s, 'POST', '/api/ai/key', { provider: 'openrouter', key: 'sk-or-mock-key-000000000000', model: '' }, tok);
    const d = await req(s, 'POST', '/api/clinic/social/draft', { topic: 'Diwali offer', platforms: ['X'] }, tok);
    assert.equal(d.status, 200, JSON.stringify(d.d));
    const a = await req(s, 'POST', '/api/agents/approval', { id: d.d.post.approvalId, decision: 'approve' }, tok);
    assert.equal(a.status, 200, JSON.stringify(a.d));
    let post = (await req(s, 'GET', '/api/clinic', undefined, tok)).d.posts.find((p) => p.id === d.d.post.id);
    const pub = await req(s, 'POST', '/api/clinic/posts/publish', { id: post.id }, tok);
    assert.ok([200, 409].includes(pub.status), JSON.stringify(pub.d));
    for (let i = 0; i < 40; i++) { post = (await req(s, 'GET', '/api/clinic', undefined, tok)).d.posts.find((p) => p.id === d.d.post.id); if (post.publish && post.publish.status !== 'publishing') break; await sleep(150); }
    assert.equal(post.publish.status, 'manual', JSON.stringify(post.publish));
    assert.equal(post.status, 'scheduled', 'not marked published until the owner posts it');
  } finally { await s.stop(); }
  const app = fs.readFileSync(ROOT + '/clinic.html', 'utf8');
  assert.match(app, /https:\/\/x\.com\/intent\/post\?text=/); assert.match(app, /Post on X \(free\)/); assert.doesNotMatch(app, /free X app/);
});
