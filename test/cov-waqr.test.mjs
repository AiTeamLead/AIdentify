// WhatsApp by QR (free, unofficial): who may be messaged (owner's own chat, one customer at a time, never groups),
// the send cap, the mock-linked send path, the setup card, turning it off, serverless hosts, stop and resume.
// No real WhatsApp connection is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../lib/waqr.js';

const memStore = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? { v: m.get(k) } : null), put: async (k, v) => { if (v == null) m.delete(k); else m.set(k, v); }, listPrefix: async (p) => [...m].filter(([k]) => k.startsWith(p)).map(([k, v]) => ({ k, v })) }; };

test('routing and who may be messaged', () => {
  assert.equal(W.waqrMaySend('919876543210@s.whatsapp.net', '+91 98765 43210'), true);
  assert.equal(W.waqrMaySend('12345@g.us', '12345'), false);
  assert.equal(W.waqrMaySend('919876543210', ''), false);
  assert.equal(W.waqrMaySendCustomer('+91 98765 43210'), true);
  assert.equal(W.waqrMaySendCustomer('120363@g.us'), false);
  assert.equal(W.waqrMaySendCustomer('status@broadcast'), false);
  assert.equal(W.waqrMaySendCustomer('12345'), false);
  assert.equal(W.routeWaqrSender('919876543210', '919876543210'), 'chief');
  assert.equal(W.routeWaqrSender('919800000000', '919876543210'), 'customer');
  assert.equal(W.routeWaqrSender('1203@g.us', '919876543210'), 'drop');
});

test('runtime: on by default, can be turned off, never on serverless hosts', () => {
  delete process.env.WHATSAPP_QR; delete process.env.VERCEL;
  assert.equal(W.waqrRuntime().available, true);
  assert.ok(W.assertWaqrAvailable().enabled);
  process.env.WHATSAPP_QR = 'off';
  assert.equal(W.waqrRuntime().reason, 'flag_off');
  assert.throws(() => W.assertWaqrAvailable(), (e) => e.code === 'waqr_off');
  delete process.env.WHATSAPP_QR; process.env.VERCEL = '1';
  assert.equal(W.waqrRuntime().reason, 'serverless');
  assert.throws(() => W.assertWaqrAvailable(), (e) => e.code === 'waqr_serverless' && e.status === 503);
  delete process.env.VERCEL;
});

test('send cap per hour and per day', () => {
  const email = 'cap@example.com', now = Date.parse('2026-11-25T10:00:00Z');
  assert.equal(W.waqrQuota(email, now), '');
});

test('sending to a customer: needs a linked number, one person, a message, under the cap', async () => {
  const email = 'send@example.com';
  await assert.rejects(W.sendToCustomer(email, '919800000000', 'Hi'), (e) => e.code === 'not_connected');
  assert.equal(W.waqrLinked(email), false);
  W.markMockLinked(email, '919876543210');
  assert.equal(W.waqrLinked(email), true);
  await assert.rejects(W.sendToCustomer(email, '1203@g.us', 'Hi'), (e) => e.code === 'no_groups');
  await assert.rejects(W.sendToCustomer(email, '919800000000', '   '), (e) => e.code === 'empty');
  const r = await W.sendToCustomer(email, '+91 98000 00000', 'Your appointment is at 5 pm.');
  assert.equal(r.sent, true); assert.equal(r.provider, 'qr'); assert.match(r.id, /^qr\.mock/);
  for (let i = 1; i < W.WAQR_LIMITS.perHour; i++) await W.sendToCustomer(email, '919800000000', 'Message ' + i);
  await assert.rejects(W.sendToCustomer(email, '919800000000', 'One more'), (e) => e.code === 'wa_limit' && e.status === 429);
  assert.match(W.waqrQuota(email), /an hour/);
  // owner-chat sends need a real socket
  await assert.rejects(W.sendToLinkedOwner(email, 'hi'), (e) => e.code === 'not_connected');
});

test('setup card shows status and warning, never the stored session', async () => {
  const h = await W.attachWaqrHint({ session: 'secret-session', linked: false }, 'nobody@example.com');
  assert.equal(h.session, undefined); assert.equal(h.beta, true); assert.match(h.warning, /unofficial/); assert.deepEqual(h.limits, W.WAQR_LIMITS);
  W.markMockLinked('hint@example.com', '919876543210');
  assert.equal((await W.attachWaqrHint(null, 'hint@example.com')).status, 'linked');
});

test('stop forgets the session; resume skips when off or nothing is linked', async () => {
  const st = memStore(), email = 'stop@example.com', secret = async () => 'qr-secret';
  W.markMockLinked(email, '919876543210');
  assert.deepEqual(await W.stopWaqr(st, email, secret), { ok: true });
  assert.equal(W.waqrLinked(email), false);
  assert.deepEqual(await W.stopWaqr(null, email, null, { wipe: false }), { ok: true });
  W.markMockLinked('a@example.com', '1'); W.markMockLinked('b@example.com', '2');
  await W.stopAllWaqr();
  assert.equal(W.waqrLinked('a@example.com'), false);
  process.env.WHATSAPP_QR = 'off';
  assert.deepEqual(await W.resumeLinkedSessions(st, secret), { skipped: 'flag_off' });
  delete process.env.WHATSAPP_QR;
  st.m.set('as_chidx:x@example.com', JSON.stringify({ email: true })); st.m.set('as_chidx:y@example.com', 'not json');
  assert.deepEqual(await W.resumeLinkedSessions(st, secret), { resumed: 0 });
  const broken = { listPrefix: async () => { throw new Error('db down'); } };
  assert.deepEqual(await W.resumeLinkedSessions(broken, secret), { skipped: 'list' });
  W.setWaqrOwnerHandler(() => {}); W.setWaqrCustomerHandler(() => {});
});
