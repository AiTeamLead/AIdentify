// v2.9 Phase 1: WhatsApp by QR is the main channel. Customer messages land in the Front Desk inbox
// (unknown numbers: Accept / Decline), replies go out only after approval, from the owner's own number,
// with opt-out and a send cap. The paid API is only the fallback. Bot Mode hides CRM, Owner Insights and Skills.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, ROOT } from './helpers.mjs';
import { triageInbound, acceptCard, declineCard, declineHash, inboxView } from '../lib/wa-triage.js';
import { waqrQuota, markMockLinked, sendToCustomer, WAQR_LIMITS } from '../lib/waqr.js';

const PW = 'Tr1ckyHorse#Blue92';
const MOCK = { RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', CHANNELS_MOCK: 'on', WHATSAPP_QR: 'on' };
async function req(s, method, p, body, token) {
  const r = await fetch(s.base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let d = null; try { d = await r.json(); } catch { /* not json */ }
  return { status: r.status, d };
}

test('triage rules: known goes to the thread, unknown to one card, decline keeps only a hash', () => {
  const c = { patients: [{ id: 1, name: 'Ravi', phone: '919848012345' }], enquiries: [] };
  assert.equal(triageInbound(c, { from: '919848012345', text: 'Hi, can I come at 5?' }).route, 'known');
  assert.equal(c.waThreads['919848012345'].length, 1);
  const a = triageInbound(c, { from: '919000011111', name: 'Kiran', text: 'Price for SEO?' });
  assert.equal(a.route, 'triage');
  triageInbound(c, { from: '919000011111', text: 'Hello?' });
  assert.equal(c.waTriage.length, 1, 'one card per number');
  assert.equal(c.waTriage[0].count, 2);
  assert.equal(c.waTriage[0].preview, 'Hello?');
  const b = triageInbound(c, { from: '919000022222', text: 'personal message' });
  assert.equal(declineCard(c, b.card.id), true);
  assert.equal(JSON.stringify(c).includes('919000022222'), false, 'a declined number is not stored');
  assert.equal(JSON.stringify(c).includes('personal message'), false, 'a declined chat is not stored');
  assert.ok(c.waDeclined.includes(declineHash('919000022222')));
  assert.equal(triageInbound(c, { from: '+91 90000 22222', text: 'again' }).route, 'declined');
  const enq = acceptCard(c, a.card.id);
  assert.equal(enq.phone, '919000011111'); assert.equal(enq.channel, 'WhatsApp'); assert.equal(enq.name, 'Kiran');
  assert.equal(triageInbound(c, { from: '919000011111', text: 'thanks' }).route, 'known', 'accepted lead is now known');
  assert.equal(triageInbound(c, { from: '919848012345', text: 'STOP' }).route, 'known');
  assert.equal(c.patients[0].waOpt, 'out', 'STOP opts the person out');
  assert.equal(inboxView(c).triage.length, 0);
  assert.equal(triageInbound(c, { from: '123', text: 'x' }).route, 'ignored');
});

test('send cap: 20 an hour, then refused with the reason', async () => {
  markMockLinked('cap@example.com', '919800011199');
  for (let i = 0; i < WAQR_LIMITS.perHour; i++) await sendToCustomer('cap@example.com', '9198480' + String(10000 + i), 'hello ' + i);
  assert.match(waqrQuota('cap@example.com'), /20 messages an hour/);
  await assert.rejects(sendToCustomer('cap@example.com', '919848099999', 'one more'), /send limit/);
  markMockLinked('grp@example.com', '919800011199');
  await assert.rejects(sendToCustomer('grp@example.com', '120363@g.us', 'x'), /Groups and broadcasts/);
});

test('end to end: customer message -> card -> accept -> reply drafted -> approved -> sent from own number', { timeout: 120000 }, async () => {
  const s = await startServer(MOCK);
  try {
    const A = (await req(s, 'POST', '/api/auth/signup', { email: 'wa-owner@example.com', name: 'Owner', password: PW })).d.token;
    assert.equal((await req(s, 'POST', '/api/clinic/profile', { biz: 'Pixel Growth', locations: ['Hyderabad'], services: ['SEO'], audience: ['Local business owners'], final: true }, A)).status, 200);
    const made = await req(s, 'POST', '/api/clinic/role', { role: 'marketing' }, A);
    assert.equal(made.status, 200, JSON.stringify(made.d));
    assert.equal(made.d.waqrLinked, false);
    assert.equal((await req(s, 'POST', '/api/channels/whatsapp-qr/mock', { action: 'link', owner: '919800011199' }, A)).status, 200);
    const inb = await req(s, 'POST', '/api/channels/whatsapp-qr/mock', { action: 'inbound', from: '919000011111', name: 'Kiran', body: 'What does SEO cost?', id: 'm1' }, A);
    assert.equal(inb.d.filed, 'triage');
    let st = (await req(s, 'GET', '/api/clinic', undefined, A)).d;
    assert.equal(st.waqrLinked, true);
    assert.equal(st.waInbox.triage.length, 1);
    const card = st.waInbox.triage[0];
    assert.equal(card.name, 'Kiran'); assert.equal(card.preview, 'What does SEO cost?');
    // decline a second number; it never comes back
    await req(s, 'POST', '/api/channels/whatsapp-qr/mock', { action: 'inbound', from: '919000022222', body: 'hi it is your cousin', id: 'm2' }, A);
    st = (await req(s, 'GET', '/api/clinic', undefined, A)).d;
    const cousin = st.waInbox.triage.find((t) => t.phone === '919000022222');
    const dec = await req(s, 'POST', '/api/clinic/wa/triage', { id: cousin.id, decision: 'decline' }, A);
    assert.equal(dec.status, 200, JSON.stringify(dec.d));
    assert.equal(dec.d.waInbox.triage.some((t) => t.phone === '919000022222'), false);
    const again = await req(s, 'POST', '/api/channels/whatsapp-qr/mock', { action: 'inbound', from: '919000022222', body: 'hello??', id: 'm3' }, A);
    assert.equal(again.d.filed, 'declined');
    // accept Kiran -> becomes an enquiry
    const acc = await req(s, 'POST', '/api/clinic/wa/triage', { id: card.id, decision: 'accept' }, A);
    assert.equal(acc.status, 200, JSON.stringify(acc.d));
    const enq = acc.d.enquiries.find((e) => e.phone === '919000011111');
    assert.ok(enq); assert.equal(enq.channel, 'WhatsApp'); assert.equal(enq.status, 'new');
    assert.equal((await req(s, 'POST', '/api/clinic/wa/triage', { id: card.id, decision: 'accept' }, A)).status, 400, 'a card is decided once');
    // reply -> approval -> sent from own number
    const rep = await req(s, 'POST', '/api/clinic/wa/reply', { phone: '919000011111', text: 'Hi Kiran, our SEO retainer is ₹25,000 a month. Free audit first?' }, A);
    assert.equal(rep.status, 200, JSON.stringify(rep.d));
    assert.equal((await req(s, 'POST', '/api/clinic/wa/reply', { phone: '919777777777', text: 'cold message' }, A)).status, 400, 'no replies to unknown numbers');
    const ok = await req(s, 'POST', '/api/clinic/decide', { id: rep.d.draft.approvalId, decision: 'approve' }, A);
    assert.equal(ok.status, 200, JSON.stringify(ok.d));
    assert.equal(ok.d.approval.result, 'Sent on WhatsApp from your own number.');
    st = (await req(s, 'GET', '/api/clinic', undefined, A)).d;
    const d = st.drafts.find((x) => x.id === rep.d.draft.id);
    assert.equal(d.waProvider, 'qr'); assert.equal(d.waStatus, 'sent'); assert.match(d.waMessageId, /^qr\.mock/);
    const th = st.waInbox.threads.find((t) => t.phone === '919000011111');
    assert.equal(th.lastDir, 'out');
    // Bot Mode: CRM and Owner Insights are hidden, the data is still there for Chief
    const kv = (await req(s, 'GET', '/api/kv', undefined, A)).d;
    const row = (kv.items || []).find((x) => x.k === 'as_data:wa-owner@example.com');
    const agents = JSON.parse(row.v).agents;
    assert.equal(agents.find((a) => a.kind === 'crm').hidden, true);
    assert.equal(agents.find((a) => a.clinicKey === 'insights').hidden, true);
    assert.deepEqual(agents.filter((a) => !a.hidden).map((a) => a.clinicKey).sort(), ['billing', 'front', 'recall', 'reviews', 'social']);
  } finally { await s.stop(); }
});

test('workplace and owner app: QR is the first WhatsApp option; Skills, CRM and Plugins are gone from Bot Mode', () => {
  const idx = fs.readFileSync(ROOT + '/index.html', 'utf8');
  assert.match(idx, /Connect your WhatsApp <small>· free, scan a QR code<\/small>/);
  assert.match(idx, /Bulk marketing \(official API, paid\)/);
  assert.doesNotMatch(idx, />Skills<\/h3>/);
  assert.doesNotMatch(idx, /<span>Plugins<\/span><\/button>/);
  assert.match(idx, /agents\.filter\(a=>!a\.hidden\)/);
  const app = fs.readFileSync(ROOT + '/clinic.html', 'utf8');
  assert.match(app, /Connect with QR \(free\)/);
  assert.match(app, /Accept \(add as lead\)/);
  assert.match(app, /Decline \(never ask again\)/);
});
