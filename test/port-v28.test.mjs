import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from './helpers.mjs';
import { externalCrmSlug, CRM_BLOCK, importCsv } from '../lib/crm.js';
import { routeClinicQr, waqrOutboundAllowed } from '../lib/clinic-waqr.js';
import { monthlyEstimate } from '../lib/cost.js';
import { FEATURED_PACK } from '../lib/clinic-packs.js';
import { backoffMs } from '../lib/social-log.js';

const PW = 'Clinic-pass-123!';

test('featured pack is digital marketing and the cost meter is an estimate', () => {
  assert.equal(FEATURED_PACK, 'marketing');
  assert.ok(monthlyEstimate().inr > 0);
  assert.match(monthlyEstimate().note, /Estimate only/);
  assert.equal(externalCrmSlug('salesforce'), true);
  assert.equal(externalCrmSlug('gmail'), false);
  assert.match(CRM_BLOCK, /AIdentify/);
  assert.equal(backoffMs(429, 1), 800);
  assert.equal(backoffMs(200, 3), 0);
  assert.equal(routeClinicQr({ from: '919800022288', owner: '919800011199' }), 'agent');
  assert.equal(waqrOutboundAllowed({ to: '919800011199', approved: false }).reason, 'needs_approval');
  assert.match(fs.readFileSync(new URL('../privacy.html', import.meta.url), 'utf8'), /AIdentify/);
  assert.match(fs.readFileSync(new URL('../privacy.html', import.meta.url), 'utf8'), /Review by a lawyer/);
  assert.match(fs.readFileSync(new URL('../terms.html', import.meta.url), 'utf8'), /Razorpay/);
  assert.doesNotMatch(fs.readFileSync(new URL('../terms.html', import.meta.url), 'utf8'), /6302381884-w772@ibl/);
  assert.match(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'), /\/api\/cron\/festivals/);
  assert.match(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'), /"version": "2.9.1"/);
  assert.match(fs.readFileSync(new URL('../config/chief-prompt.txt', import.meta.url), 'utf8'), /Chief/);
});

test('native CRM, deletion request, skills and invoice fields stay inside the account', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', CLINIC_DEMO_PLATFORM_KEY: '1' });
  try {
    const a = (await s.api('/api/auth/signup', { email: 'crm-a@example.com', name: 'Agency A', password: PW })).d.token;
    const b = (await s.api('/api/auth/signup', { email: 'crm-b@example.com', name: 'Agency B', password: PW })).d.token;
    await s.api('/api/clinic/profile', { biz: 'North Agency', city: 'Hyderabad', services: 'SEO', audience: 'Founders' }, a);
    await s.api('/api/clinic/role', { role: 'marketing' }, a);
    const contact = await s.api('/api/crm/contacts', { name: 'Asha Rao', phone: '919800011122', email: 'asha@client.example', tags: 'retainer' }, a);
    assert.equal(contact.status, 200, JSON.stringify(contact.d));
    const id = contact.d.item.id;
    assert.equal((await s.api('/api/crm/contacts/' + id, undefined, b)).status, 404);
    const deal = await s.api('/api/crm/deals', { title: 'Retainer', value: 25000, contactId: id }, a);
    assert.equal((await s.api('/api/crm/deals/' + deal.d.item.id, { stage: 'proposal' }, a)).d.item.stage, 'proposal');
    const dash = await s.api('/api/crm', undefined, a);
    assert.equal(dash.d.externalCrm, false);
    assert.equal(dash.d.dashboard.pipelineValue, 25000);
    assert.equal((await s.api('/api/crm', undefined, b)).d.dashboard.contacts, 0);
    const task = await s.api('/api/crm/agent/remind', { contactId: id, title: 'Call Asha' }, a);
    assert.equal(task.d.sent, false);
    const note = await s.api('/api/crm/activities', { contactId: id, kind: 'whatsapp', body: 'Asked about the audit' }, a);
    assert.equal(note.d.item.kind, 'whatsapp');
    const csv = await fetch(s.base + '/api/crm/export', { headers: { authorization: 'Bearer ' + a } });
    assert.match(await csv.text(), /Asha Rao/);
    const imp = await s.api('/api/crm/import', { csv: 'type,name,email,phone\ncontact,Meera Shah,meera@client.example,919800011133\n' }, b);
    assert.equal(imp.d.contacts, 1);
    const blocked = await s.api('/api/connectors/start', { c: 'salesforce' }, a);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.d.error, 'native_crm');
    const del = await s.api('/api/legal/deletion', { note: 'Please delete the CRM' }, a);
    assert.equal(del.status, 200);
    assert.equal(del.d.grievance.name, 'Phanindra Malladi');
    assert.equal((await fetch(s.base + '/privacy')).status, 200);
    const skill = await s.api('/api/agents/skills', { name: 'Audit follow-up', description: 'After an audit call', body: 'Draft a follow-up. Do not send it.', aid: 'front' }, a);
    assert.equal(skill.status, 200, JSON.stringify(skill.d));
    assert.equal(skill.d.skills[0].name, 'Audit follow-up');
    const edited = await s.api('/api/agents/skills', { id: skill.d.skill.id, name: 'Audit follow-up', description: 'Reuse', body: 'Draft a shorter follow-up.', aid: 'recall' }, a);
    assert.equal(edited.d.skill.aid, 'recall');
    const clinic = await s.api('/api/clinic', undefined, a);
    const patient = clinic.d.patients[0];
    const inv = await s.api('/api/clinic/invoices', { patientId: patient.id, items: [{ desc: 'Audit', qty: 1, rate: 1500 }], gstin: '36AAAAA0000A1Z5', cgst: 9, sgst: 9 }, a);
    assert.equal(inv.status, 200, JSON.stringify(inv.d));
    assert.match(inv.d.invoice.number, /^INV-\d{4}-\d{4}$/);
    assert.equal(inv.d.invoice.gstin, '36AAAAA0000A1Z5');
    assert.equal(inv.d.invoice.cgst, 9);
    const page = await s.api('/api/clinic/integrations', { id: 'facebook', op: 'page', pageId: '123', pageName: 'North Page' }, a);
    assert.equal(page.d.integrations.facebook.pageId, '123');
    const packs = (await s.api('/api/clinic/meta')).d.packs;
    assert.ok(packs.find((p) => p.id === 'marketing').suggest.services.includes('SEO'));
    const wa = await s.api('/api/clinic/waqr', undefined, a);
    assert.equal(wa.status, 200);
    assert.match(wa.d.warning, /Unofficial WhatsApp/);
  } finally { await s.stop(); }
});

test('CSV helper counts rows', async () => {
  const mem = {
    data: {},
    async get(k) { return this.data[k] || null; },
    async put(k, v, at) { this.data[k] = { k, v, at }; },
    async listPrefix(p) { return Object.values(this.data).filter((r) => r.k && r.k.startsWith(p) && r.v); },
  };
  const out = await importCsv(mem, 'a@example.com', 'type,name\ncompany,North Co\ncontact,Asha Rao\ndeal,Retainer\n');
  assert.deepEqual(out, { contacts: 1, companies: 1, deals: 1 });
});
