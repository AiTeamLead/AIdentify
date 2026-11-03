import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers.mjs';
import { externalCrmSlug, CRM_BLOCK, importCsv } from '../lib/crm.js';
import { upiPublic, DEFAULT_UPI_ID, DEFAULT_UPI_NAME } from '../lib/upi.js';
import { routeClinicQr, waqrOutboundAllowed, humanDelayMs } from '../lib/clinic-waqr.js';
import { monthlyEstimate } from '../lib/cost.js';
import { FEATURED_PACK, PACKS } from '../lib/clinic-packs.js';

const PW = 'Clinic-pass-123!';
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

test('featured pack is the digital marketing agency and dental remains a pack', () => {
  assert.equal(FEATURED_PACK, 'agency');
  assert.equal(PACKS.agency.title, 'Digital marketing agency');
  assert.equal(PACKS.agency.front, 'Lead Capture');
  assert.equal(PACKS.dental.title, 'Dental clinic');
  assert.equal(PACKS.agency.visitKit, false);
  const html = fs.readFileSync(path.join(root, 'landing-v2.html'), 'utf8');
  assert.match(html, /Digital marketing agencies/);
  assert.doesNotMatch(html, /skin-clinic/);
  assert.match(fs.readFileSync(path.join(root, 'privacy.html'), 'utf8'), /Review by a lawyer/);
  assert.match(fs.readFileSync(path.join(root, 'privacy.html'), 'utf8'), /Phanindra Malladi/);
});

test('UPI defaults to the owner PhonePe id and can be overridden', () => {
  const pub = upiPublic({});
  assert.equal(pub.upiId, DEFAULT_UPI_ID);
  assert.equal(pub.payee, DEFAULT_UPI_NAME);
  assert.equal(pub.razorpay, false);
  assert.match(pub.whatsapp, /916302381884/);
  assert.equal(upiPublic({ UPI_ID: 'other@upi' }).upiId, 'other@upi');
  assert.ok(fs.existsSync(path.join(root, 'assets', 'upi-qr.png')));
});

test('WhatsApp QR clinic mode blocks broadcasts and unapproved sends', () => {
  assert.equal(routeClinicQr({ from: '919800011199', owner: '919800011199' }), 'chief');
  assert.equal(routeClinicQr({ from: '919800022288', owner: '919800011199' }), 'agent');
  assert.equal(routeClinicQr({ from: '919800011199@g.us', owner: '919800011199' }), 'drop');
  assert.equal(waqrOutboundAllowed({ to: '9198', approved: false }).reason, 'needs_approval');
  assert.equal(waqrOutboundAllowed({ to: '919800011199', approved: true, count: 3 }).reason, 'bulk');
  assert.equal(waqrOutboundAllowed({ to: 'status@broadcast', approved: true }).reason, 'broadcast');
  assert.equal(waqrOutboundAllowed({ to: '919800011199', approved: true }).ok, true);
  const d = humanDelayMs(() => 0);
  assert.ok(d >= 800 && d <= 4500);
});

test('external CRMs are named and blocked', () => {
  assert.equal(externalCrmSlug('salesforce'), true);
  assert.equal(externalCrmSlug('cx:hubspot'), true);
  assert.equal(externalCrmSlug('gmail'), false);
  assert.match(CRM_BLOCK, /stay in AaaS/);
  assert.ok(monthlyEstimate().inr > 0);
});

test('native CRM is tenant isolated, imports CSV, and does not send', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on' });
  try {
    const a = (await s.api('/api/auth/signup', { email: 'crm-a@example.com', name: 'Agency A', password: PW })).d.token;
    const b = (await s.api('/api/auth/signup', { email: 'crm-b@example.com', name: 'Agency B', password: PW })).d.token;
    const plans = await s.api('/api/billing/plans');
    assert.equal(plans.d.razorpay, false);
    assert.equal(plans.d.upi.upiId, DEFAULT_UPI_ID);
    const contact = await s.api('/api/crm/contacts', { name: 'Asha Rao', phone: '919800011122', email: 'asha@client.example', tags: 'retainer' }, a);
    assert.equal(contact.status, 200, JSON.stringify(contact.d));
    const id = contact.d.item.id;
    const stolen = await s.api('/api/crm/contacts/' + id, undefined, b);
    assert.equal(stolen.status, 404);
    const deal = await s.api('/api/crm/deals', { title: 'Retainer', value: 25000, contactId: id }, a);
    assert.equal(deal.d.item.stage, 'new');
    const moved = await s.api('/api/crm/deals/' + deal.d.item.id, { stage: 'proposal' }, a);
    assert.equal(moved.d.item.stage, 'proposal');
    const dash = await s.api('/api/crm', undefined, a);
    assert.equal(dash.d.externalCrm, false);
    assert.equal(dash.d.dashboard.pipelineValue, 25000);
    const other = await s.api('/api/crm', undefined, b);
    assert.equal(other.d.dashboard.contacts, 0);
    const task = await s.api('/api/crm/agent/remind', { contactId: id, title: 'Call Asha' }, a);
    assert.equal(task.d.sent, false);
    const csv = await fetch(s.base + '/api/crm/export', { headers: { authorization: 'Bearer ' + a } });
    const text = await csv.text();
    assert.match(text, /Asha Rao/);
    assert.doesNotMatch(text, /crm-b@example.com/);
    const imp = await s.api('/api/crm/import', { csv: 'type,name,email,phone\ncontact,Meera Shah,meera@client.example,919800011133\n' }, b);
    assert.equal(imp.d.contacts, 1);
    assert.equal((await s.api('/api/crm', undefined, a)).d.dashboard.contacts, 1);
    const sf = await s.api('/api/connectors/start', { c: 'salesforce' }, a);
    assert.equal(sf.status, 409);
    assert.equal(sf.d.error, 'native_crm');
    const del = await s.api('/api/legal/deletion', { note: 'Please delete the CRM' }, a);
    assert.equal(del.status, 200);
    assert.equal(del.d.grievance.name, 'Phanindra Malladi');
    const page = await fetch(s.base + '/privacy');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Review by a lawyer/);
  } finally { await s.stop(); }
});

test('CSV helper counts rows', async () => {
  const mem = {
    kind: 'file',
    data: {},
    async get(k) { return this.data[k] || null; },
    async put(k, v, at) { this.data[k] = { k, v, at }; },
    async listPrefix(p) { return Object.values(this.data).filter((r) => r.k && r.k.startsWith(p) && r.v); },
  };
  const out = await importCsv(mem, 'a@example.com', 'type,name\ncompany,North Co\ncontact,Asha Rao\ndeal,Retainer\n');
  assert.deepEqual(out, { contacts: 1, companies: 1, deals: 1 });
});
