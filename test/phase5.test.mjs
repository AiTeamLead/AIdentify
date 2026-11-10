import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishTarget, transitionPost } from '../lib/publisher.js';
import { createWhatsAppProvider, WA_RISK } from '../lib/whatsapp-provider.js';
import { dueFestivals } from '../lib/festival-drafts.js';
import { decideContact, triageOf } from '../lib/triage.js';
import { quoteTool } from '../lib/tool-result.js';
import { tourState, DASHBOARD_TOUR } from '../lib/tour.js';

function memory() {
  const rows = new Map();
  return { async get(k) { const v = rows.get(k); return v == null ? null : { v }; }, async put(k, v) { rows.set(k, v); } };
}

test('a failed Instagram publish is reported as a failure', async () => {
  const out = await publishTarget({
    async publish() { return { ok: true, provider_id: 'container-1' }; },
    async verify() { return { ok: false }; },
  }, { status: 'approved', body: 'Hello' });
  assert.equal(out.status, 'failed');
  assert.equal(out.verified, false);
  const said = quoteTool({ status: 'failed', verified: false, error: out.error });
  assert.equal(said.claim, 'failed');
  assert.match(said.text, /did not return the live post/);
  assert.equal(transitionPost('draft', 'published').ok, false);
});

test('WhatsApp QR is the default and names the ban risk', async () => {
  const qr = createWhatsAppProvider('qr');
  assert.equal(qr.kind, 'qr');
  assert.equal(qr.risk, WA_RISK);
  const cloud = await createWhatsAppProvider('cloud').send();
  assert.equal(cloud.status, 'failed');
  assert.match(cloud.error, /not configured/);
});

test('festivals inside seven days are the ones to draft', () => {
  const now = Date.parse('2026-11-01T00:00:00Z');
  const due = dueFestivals([{ date: '2026-11-08', name: 'Diwali' }, { date: '2026-12-25', name: 'Christmas' }], now);
  assert.deepEqual(due.map((f) => f.name), ['Diwali']);
});

test('a declined number is never asked again', async () => {
  const st = memory();
  await decideContact(st, 'a@b.c', '+91 98765 43210', 'decline');
  const row = await triageOf(st, 'a@b.c', '919876543210');
  assert.equal(row.decision, 'decline');
  assert.equal(row.askAgain, undefined);
  const again = await decideContact(st, 'a@b.c', '9876543210', 'accept');
  assert.equal(again.decision, 'accept');
});

test('the dashboard tour has five steps and can be skipped', () => {
  assert.equal(DASHBOARD_TOUR.length, 5);
  const first = tourState(null);
  assert.equal(first.current.title, 'Dashboard');
  const skipped = tourState('1', { skip: true });
  assert.equal(skipped.done, true);
});
