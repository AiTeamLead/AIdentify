import test from 'node:test';
import assert from 'node:assert/strict';
import { needsOwnerApproval } from '../lib/browser.js';
import { razorpaySignature, verifyRazorpaySignature, readRazorpayWebhook } from '../lib/billing.js';

test('browser: pay/buy/submit clicks and password typing wait for approval', () => {
  for (const t of ['Pay now', 'Buy', 'Place order', 'Confirm payment', 'Submit', 'Delete account', 'Sign in']) assert.equal(needsOwnerApproval('click', { text: t }), true, t);
  for (const t of ['Pricing', 'Next page', 'Read more']) assert.equal(needsOwnerApproval('click', { text: t }), false, t);
  assert.equal(needsOwnerApproval('type', { into: 'Password' }), true);
  assert.equal(needsOwnerApproval('type', { into: 'Search' }), false);
  assert.equal(needsOwnerApproval('open', { url: 'https://example.com' }), false);
});

test('billing harness: Razorpay-style HMAC webhook signature', async () => {
  const secret = 'whsec_test', raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', amount: 49900 } } } });
  const sig = razorpaySignature(raw, secret);
  assert.equal(verifyRazorpaySignature(raw, sig, secret), true);
  assert.equal(verifyRazorpaySignature(raw + ' ', sig, secret), false, 'body changed');
  assert.equal(verifyRazorpaySignature(raw, sig, 'other'), false, 'wrong secret');
  assert.equal(verifyRazorpaySignature(raw, 'zz', secret), false);
  assert.equal(verifyRazorpaySignature(raw, sig, ''), false);
  const seen = new Set();
  const r1 = await readRazorpayWebhook({ rawBody: raw, headers: { 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'ev1' }, secret, seen: async (id) => { const s = seen.has(id); seen.add(id); return s; } });
  assert.equal(r1.duplicate, false); assert.equal(r1.event.event, 'payment.captured');
  const r2 = await readRazorpayWebhook({ rawBody: raw, headers: { 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'ev1' }, secret, seen: async (id) => seen.has(id) });
  assert.equal(r2.duplicate, true);
  await assert.rejects(readRazorpayWebhook({ rawBody: raw, headers: { 'x-razorpay-signature': '0'.repeat(64) }, secret }), /bad signature/);
});

test('billing: the clinic Razorpay webhook route rejects a bad signature', async () => {
  const { startServer } = await import('./helpers.mjs');
  const s = await startServer({ RAZORPAY_WEBHOOK_SECRET: 'whsec_unit_route' });
  try {
    const raw = JSON.stringify({ entity: 'event', event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', amount: 100 } } } });
    const bad = await fetch(s.base + '/api/clinic/payments/razorpay', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'ab'.repeat(32), 'x-razorpay-event-id': 'evt_units_bad' },
      body: raw,
    });
    assert.equal(bad.status, 400);
  } finally { await s.stop(); }
});
