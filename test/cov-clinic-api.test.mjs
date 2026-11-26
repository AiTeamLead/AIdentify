// Owner app API, beyond the main clinic test: invoices (create, edit, paid/unpaid, remind, pay page, print/PDF),
// messages and WhatsApp replies, festival and social drafts, weekly summary, insights, agents, rules, skills, setup,
// visit page, checklist, export, chat, and the refusals (bad input, samples, wrong ids). Mock AI, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

const MOCK = { RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', CLINIC_DEMO_PLATFORM_KEY: '1' };

test('owner app: invoices, drafts, settings and refusals', async () => {
  const s = await startServer(MOCK);
  try {
    const token = (await s.api('/api/clinic/demo', {})).d.token;
    const api = (p, b) => s.api(p, b, token);
    const ok = async (p, b, code = 200) => { const r = await api(p, b); assert.equal(r.status, code, p + ' ' + JSON.stringify(r.d)); return r.d; };
    const soft = []; const no = async (p, b, code = 400) => { const r = await api(p, b); if (r.status !== code) soft.push(p + ' ' + JSON.stringify(b).slice(0, 80) + ' → ' + r.status + ' ' + JSON.stringify(r.d).slice(0, 120)); return r.d; };
    const d = await ok('/api/clinic/role', { role: 'dental' });
    const pid = d.patients[0].id, pid2 = d.patients[1].id;

    // ----- invoices -----
    await no('/api/clinic/invoices', { patientId: 999999, items: [{ desc: 'Cleaning', qty: 1, rate: 800 }] });
    await no('/api/clinic/invoices', { patientId: pid, items: [{ desc: 'Cleaning', qty: 1, rate: 800 }], gst: 500 });
    await no('/api/clinic/invoices', { patientId: pid, items: [{ desc: 'Cleaning', qty: 1, rate: 800 }], due: 'not a date' });
    await no('/api/clinic/invoices', { patientId: pid, items: [{ desc: 'Cleaning', qty: 1, rate: 800 }], discount: -5 });
    await no('/api/clinic/invoices', { patientId: pid, items: [{ desc: 'Cleaning', qty: 1, rate: 800 }], discount: 5000 });
    const inv = (await ok('/api/clinic/invoices', { patientId: pid, items: [{ desc: 'Cleaning', qty: 2, rate: 800 }], gst: 18, offer: '10% off', upi: 'smile@upi', due: '2026-12-31' })).invoice;
    assert.match(inv.number, /^INV-\d+/); assert.ok(inv.total > 0);
    const inv2 = (await ok('/api/clinic/invoices', { patientId: pid2, items: [{ desc: 'Filling', qty: 1, rate: 1500 }], discount: 100, payLink: 'https://rzp.io/l/x' })).invoice;
    const edited = (await ok('/api/clinic/invoices/edit', { id: inv.id, items: [{ desc: 'Cleaning', qty: 1, rate: 900 }] })).invoice;
    assert.equal(edited.number, inv.number);
    await no('/api/clinic/invoices/edit', { id: 999999, items: [] });
    await ok('/api/clinic/invoices/update', { id: inv.id, status: 'paid' });
    await no('/api/clinic/invoices/edit', { id: inv.id, items: [{ desc: 'x', qty: 1, rate: 1 }] });
    await ok('/api/clinic/invoices/update', { id: inv.id, status: 'unpaid' });
    await no('/api/clinic/invoices/update', { id: inv.id, status: 'maybe' });
    await no('/api/clinic/invoices/update', { id: 999999, status: 'paid' });
    const rem = await ok('/api/clinic/invoices/remind', { id: inv2.id });
    assert.equal(rem.draft.kind, 'payment'); assert.match(rem.draft.body, new RegExp(inv2.number));
    await no('/api/clinic/invoices/remind', { id: 999999 });
    const pay = await ok('/api/clinic/invoices/' + inv.id + '/pay');
    assert.match(pay.upi, /^upi:\/\/pay/); assert.match(pay.qr, /^data:image\/png/);
    assert.equal((await api('/api/clinic/invoices/999999/pay')).status, 404);
    const html = await fetch(s.base + '/api/clinic/invoices/' + inv.id + '/print', { headers: { authorization: 'Bearer ' + token } });
    assert.equal(html.status, 200); assert.match(await html.text(), new RegExp(inv.number));
    const pdf = await fetch(s.base + '/api/clinic/invoices/' + inv.id + '/pdf', { headers: { authorization: 'Bearer ' + token } });
    assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /pdf/);
    await ok('/api/clinic/payments/simulate', { id: inv2.id });
    await ok('/api/clinic/payments/simulate', { id: inv2.id });
    await no('/api/clinic/payments/simulate', { id: 999999 });

    // ----- messages, WhatsApp, drafts -----
    await no('/api/clinic/message/draft', { text: 'hi', patientId: pid });
    await no('/api/clinic/message/draft', { text: 'Your visit is due next week.', patientId: 999999 });
    const msg = await ok('/api/clinic/message/draft', { text: 'Your check-up is due next week. Reply to book.', patientId: pid });
    assert.equal(msg.draft.kind, 'message');
    await ok('/api/clinic/drafts/edit', { id: msg.draft.id, body: 'Edited: your check-up is due next week.' });
    await no('/api/clinic/drafts/edit', { id: 999999, body: 'x' });
    await no('/api/clinic/wa/reply', { text: 'x', phone: '919000000001' });
    await no('/api/clinic/wa/reply', { text: 'Hello there', phone: '910000000000' });
    await no('/api/clinic/wa/triage', { decision: 'maybe' });
    await no('/api/clinic/wa/triage', { decision: 'accept', id: 'nope' });
    await ok('/api/clinic/whatsapp/opt', { patientId: pid, status: 'out' });
    await no('/api/clinic/whatsapp/opt', { patientId: pid, status: 'sideways' });
    await no('/api/clinic/whatsapp/opt', { patientId: 999999, status: 'in' });
    await ok('/api/clinic/referrals/draft', { patientId: pid2 });

    // ----- social: festival calendar, festival posts, topic posts, publish refusals -----
    const fests = await ok('/api/clinic/festivals', { month: '2026-11' });
    assert.ok(Array.isArray(fests.events));
    await no('/api/clinic/festivals', { month: 'soon' });
    await no('/api/clinic/social/festival', { date: 'tomorrow' });
    await no('/api/clinic/social/festival', { date: '2026-11-03', name: 'Not a festival' }, 404);
    if (fests.events.length) {
      const f = fests.events[0];
      const fp = await ok('/api/clinic/social/festival', { date: f.date, name: f.name, platforms: ['LinkedIn', 'X'] });
      assert.ok(fp.post.platforms.length === 2);
      assert.equal((await ok('/api/clinic/social/festival', { date: f.date, name: f.name })).existing, true);
      await no('/api/clinic/social/festival', { date: f.date, name: f.name + 'x' }, 404);
    }
    const sp = await ok('/api/clinic/social/draft', { topic: 'Free check-up camp on Sunday', platforms: ['Instagram'], when: '2026-12-01T10:00:00+05:30' });
    assert.deepEqual(sp.post.platforms, ['Instagram']);
    await no('/api/clinic/social/draft', { topic: 'x', platforms: ['Myspace'] });
    await no('/api/clinic/posts/publish', { id: 999999 }, 404);
    await no('/api/clinic/posts/publish', { id: sp.post.id });

    // ----- weekly summary, insights, rules, agents, decide -----
    const w1 = await ok('/api/clinic/summary/weekly', {});
    assert.equal((await ok('/api/clinic/summary/weekly', {})).draft.id, w1.draft.id, 'one pending summary at a time');
    assert.ok((await ok('/api/clinic/insights/refresh', {})).summary.text);
    assert.equal((await ok('/api/clinic/rules', { cap: 3, everyDays: 10, from: '09:00', to: '19:30', ask: 'false' })).rules.ask, false);
    await no('/api/clinic/agent', { key: 'nobody' });
    assert.equal((await ok('/api/clinic/agent', { key: 'social', paused: true })).paused, true);
    await ok('/api/clinic/agent', { key: 'social', paused: false });
    await no('/api/clinic/decide', { id: 'x', decision: 'perhaps' });
    await no('/api/clinic/decide', { id: 'missing', decision: 'approve' }, 404);
    const dec = await ok('/api/clinic/decide', { id: w1.draft.approvalId, decision: 'reject' });
    assert.equal(dec.approval.status, 'declined');

    // ----- skills, visit page, setup, checklist -----
    await no('/api/clinic/skills', { name: 'ab', text: 'Always mention free parking behind the clinic.' });
    await no('/api/clinic/skills', { name: 'Parking info', text: '' });
    await no('/api/clinic/skills', { name: 'Parking info', text: 'short' });
    await no('/api/clinic/skills', { name: 'Parking info', text: 'zzzzzzzzzzzzzzz' });
    const sk = await ok('/api/clinic/skills', { name: 'Parking info', text: 'Always mention free parking behind the clinic.' });
    await no('/api/clinic/skills', { name: 'parking info', text: 'Always mention free parking behind the clinic.' });
    await ok('/api/clinic/skills/delete', { id: (sk.skills || []).at(-1)?.id || 1 });
    assert.ok(await ok('/api/clinic/visit'));
    await no('/api/clinic/visit', { answers: { x: 'y' } });
    await no('/api/clinic/visit', { accept: true, answers: {} });
    await ok('/api/clinic/visit', { accept: true, who: 'Phani', notes: 'Met the owner', answers: Object.fromEntries((await ok('/api/clinic/visit')).questions.map((q) => [q.id, 'Answer for ' + q.id])) });
    await no('/api/clinic/setup/call', { name: 'Phani' });
    await no('/api/clinic/setup/call', { name: 'Phani', phone: '9876543210' });
    assert.equal((await ok('/api/clinic/setup/call', { name: 'Phani', phone: '9876543210', when: 'Tomorrow 11 am', note: 'Call me' })).sent, false);
    await no('/api/clinic/checklist', { id: 'import' });
    await ok('/api/clinic/checklist', { id: 'form' });
    const fin = await ok('/api/clinic/setup/finish', { demoKey: true, phone: '9876543210', tone: 'Warm and short', paste: 'Asha Rao, 9876500001\nRavi K, 9876500002', ack: true });
    assert.ok(Array.isArray(fin.drafts));
    await no('/api/clinic/connectors/sync', { provider: 'practo' });
    assert.ok((await api('/api/clinic/connectors/sync', { provider: 'eka' })).status < 500);

    // ----- usage, export, chat, delete -----
    const u = await ok('/api/clinic/usage');
    assert.ok(u.plans && u.pricing);
    const ex = await fetch(s.base + '/api/clinic/export', { headers: { authorization: 'Bearer ' + token } });
    assert.equal(ex.status, 200); assert.doesNotMatch(await ex.text(), /"formToken":"[a-f0-9]{16,}"/);
    await no('/api/clinic/chat', { message: '' });
    for (const q of ['How many patients came in the last 2 months?', 'Who has not visited for a while?', 'What is overdue on invoices?', 'Any no-shows this week?', 'Revenue this month']) {
      const r = await api('/api/clinic/chat', { message: q });
      assert.equal(r.status, 200, q); assert.ok(r.d.answer);
    }
    await no('/api/clinic/data/delete', { confirm: 'yes' });
    await ok('/api/clinic/data/delete', { confirm: 'delete my data' });
    assert.deepEqual(soft, []);
  } finally { await s.stop(); }
});
