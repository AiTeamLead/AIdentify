// v2.13: the lead workflow in every industry, each in its own words (the owner's seven flowcharts + "Other").
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';
import * as F from '../lib/flow.js';

const PW = 'Tr1ckyHorse#Blue92';
const ENV = { RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', SAMPLE_DATA: 'off' };
async function req(s, method, p, body, token) {
  const r = await fetch(s.base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let d = null; try { d = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, d, text };
}
const at = (days, hourIst) => { const d = new Date(Date.now() + days * 864e5); d.setUTCHours(hourIst - 6, 30, 0, 0); return d.toISOString(); };
// one realistic lead per industry: [role, services, audience, catalogue CSV, need, budget, expected top match, words to find]
const CASES = [
  ['marketing', ['SEO'], ['Local businesses'], 'Social media management, Instagram Facebook, 25000\nGoogle Ads management, Google Ads, 30000\nSEO starter, Website SEO, 15000', 'More leads from Instagram', 28000, 'Social media management', { meet: 'discovery call', notify: 'account manager', won: 'Closed Won', send: /proposal/i }],
  ['dental', ['Root canal'], ['Families'], 'Root canal treatment, Dr. Rao, 6000\nBraces, Dr. Iyer, 45000\nTeeth cleaning, Dr. Rao, 1200', 'Root canal for toothache', 7000, 'Root canal treatment', { meet: 'appointment', notify: 'front desk', won: 'Treatment Started', send: /treatment/i }],
  ['aesthetic', ['Laser hair removal'], ['Working women'], 'Acne scar laser (4 sessions), Dr. Mehta, 24000\nHair fall PRP, Dr. Khan, 18000', 'Acne scars before my wedding', 25000, 'Acne scar laser (4 sessions)', { meet: 'consultation', notify: 'clinic coordinator', won: 'Closed Won', send: /options/i }],
  ['coach', ['Career coaching'], ['Working professionals'], 'Leadership coaching 12 weeks, 1:1 online, 45000\nInterview preparation, 4 sessions, 12000', 'Move into a leadership role', 50000, 'Leadership coaching 12 weeks', { meet: 'discovery call', notify: 'coach', won: 'Closed Won', send: /program/i }],
  ['studio', ['Gym membership'], ['Young professionals'], 'Gym membership 3 months, Morning batch, 6000\nYoga monthly, Evening batch, 2500', 'Yoga for back pain', 3000, 'Yoga monthly', { meet: 'trial or visit', notify: 'front desk', won: 'Member Joined', send: /pricing/i }],
  ['home', ['Modular kitchen'], ['Home owners'], 'Modular kitchen modern, Designer Priya, 250000\nFull home interiors 2BHK, Designer Arun, 600000', 'Modular kitchen', 260000, 'Modular kitchen modern', { meet: 'site visit', notify: 'designer', won: 'Advance Paid', send: /portfolio/i }],
  ['institute', ['Maths tuition'], ['Parents of school children'], 'Maths class 10 evening batch, Evening 6-7 pm, 18000\nScience class 10, Morning 7-8 am, 18000\nSpoken English, Weekend, 6000', 'Maths for class 10', 20000, 'Maths class 10 evening batch', { meet: 'counselling or demo', notify: 'counsellor', won: 'Enrolled', send: /brochure/i }],
  ['other', ['Birthday cakes'], ['Families'], 'Birthday cake 1 kg, Cakes, 900\nCupcakes box of 12, Cupcakes, 600', 'Birthday cake for Saturday', 1000, 'Birthday cake 1 kg', { meet: 'order', notify: 'team', won: 'Closed Won', send: /details/i }, 'Bakery'],
];

test('each industry has its own words, questions and stages', () => {
  for (const id of ['marketing', 'dental', 'aesthetic', 'coach', 'studio', 'home', 'institute', 'realestate']) {
    const K = F.cfgOf({ role: id });
    for (const k of ['person', 'item', 'items', 'meet', 'conduct', 'notify', 'send', 'won', 'closeYes', 'handoffHead', 'invoice']) assert.ok(K[k], id + ' ' + k);
    assert.equal(F.stagesFor(K).length, 12); assert.ok(K.channels.length >= 4);
  }
  assert.equal(F.cfgOf({ role: 'other', profile: { businessType: 'Bakery' } }).meet, 'order');
  assert.equal(F.cfgOf({ role: 'other', profile: { businessType: 'Pet clinic' } }).meet, 'appointment');
  const c = { role: 'institute', catalogue: [], leads: [] };
  F.importProperties(c, 'Name, Batch, Price\nMaths class 10 evening batch, Evening, 18000\nSpoken English, Weekend, 6000');
  const K = F.cfgOf(c);
  assert.deepEqual(F.missing(F.cleanReq({ need: 'Maths' }, K), K), ['budget', 'when they want to start']);
  assert.equal(F.matchProperties(c, F.cleanReq({ need: 'Maths for class 10', budget: 20000, timeline: 'immediate' }, K), K).ranked[0].title, 'Maths class 10 evening batch');
  assert.match(F.matchProperties(c, F.cleanReq({ need: 'Maths', budget: 5000, timeline: 'immediate' }, K), K).why, /start at ₹18,000, above the budget/);
  assert.match(F.matchProperties(c, F.cleanReq({ need: 'Guitar lessons', budget: 50000, timeline: 'immediate' }, K), K).why, /Nothing in the catalogue matches/);
});

test('a lead goes from enquiry to won in every industry', { timeout: 240000 }, async () => {
  const s = await startServer(ENV);
  try {
    let n = 0;
    for (const [role, services, audience, csv, need, budget, top, w, businessType] of CASES) {
      n++;
      const tok = (await req(s, 'POST', '/api/auth/signup', { email: role + '@example.com', name: 'Owner', password: PW })).d.token;
      const pr = await req(s, 'POST', '/api/clinic/profile', { biz: 'Bright Star', locations: ['Hyderabad'], services, audience, final: true, role, ...(businessType ? { businessType } : {}) }, tok);
      assert.equal(pr.status, 200, role + ' profile ' + pr.text);
      const st0 = (await req(s, 'POST', '/api/clinic/role', { role }, tok)).d;
      assert.ok(st0.flow, role + ' has the pipeline'); assert.equal(st0.flow.words.meet, w.meet, role); assert.equal(st0.flow.words.won, w.won, role);
      const flow = (b) => req(s, 'POST', '/api/clinic/flow', b, tok);
      const imp = await req(s, 'POST', '/api/clinic/catalogue/import', { csv }, tok);
      assert.equal(imp.status, 200, role + ' import ' + imp.text);
      const phone = '9198765432' + String(10 + n);
      const e = await req(s, 'POST', '/api/clinic/enquiries', { name: 'Ravi Kumar', phone, channel: st0.flow.words.channels[0], message: need }, tok);
      assert.equal(e.status, 200, role + ' enquiry ' + e.text);
      assert.equal((await req(s, 'POST', '/api/clinic/enquiries', { name: 'Ravi', phone, channel: 'Phone' }, tok)).d.existing, true, role + ' no duplicate lead');
      let st = (await req(s, 'GET', '/api/clinic', undefined, tok)).d;
      assert.equal(st.flow.leads.length, 1, role);
      const id = st.flow.leads[0].id;
      let r = await flow({ id, action: 'req', need });
      assert.equal(r.d.stage, 'qualifying', role + ' ' + r.text); assert.equal(r.d.queued, 1);
      r = await flow({ id, action: 'req', need, budget, timeline: 'immediate', waConsent: true });
      assert.equal(r.d.stage, 'matched', role + ' ' + JSON.stringify(r.d.clinic && r.d.clinic.flow.leads[0].noMatchWhy));
      let lead = r.d.clinic.flow.leads[0];
      assert.equal(r.d.clinic.flow.catalogue.find((p) => p.id === lead.matches[0]).title, top, role + ' best match');
      assert.equal(lead.category, 'hot', role); assert.match(lead.next.label, w.send, role);
      r = await flow({ id, action: 'recommend' });
      assert.equal(r.d.stage, 'recommended', role); assert.ok(r.d.clinic.drafts[0].body.includes(top), role); assert.match(r.d.clinic.drafts[0].body, new RegExp('book a ' + w.meet), role);
      assert.equal((await flow({ id, action: 'interest', interested: true })).d.stage, 'interested');
      r = await flow({ id, action: 'visit', at: at(3, 11) });
      assert.equal(r.d.stage, 'visit', role + ' ' + r.text); assert.equal(r.d.queued, 2);
      assert.ok(r.d.clinic.drafts.some((x) => x.kind === 'lead-notify-rep' && x.title.startsWith('Notify ' + w.notify)), role + ' notify');
      assert.ok(r.d.clinic.appointments.some((a) => a.status === 'booked' && a.service.toLowerCase().startsWith(w.meet)), role + ' booking listed');
      assert.equal((await flow({ id, action: 'visit', at: at(3, 11) })).d.slotTaken, false, role + ': a lead can rebook its own slot');
      r = await flow({ id, action: 'visit-result', came: true, ready: true, feedback: 'Happy' });
      assert.equal(r.d.stage, 'negotiation', role + ' ' + r.text);
      r = await flow({ id, action: 'sale', confirmed: true, amount: budget });
      assert.equal(r.d.stage, 'won', role + ' ' + r.text);
      st = r.d.clinic; lead = st.flow.leads[0];
      assert.equal(lead.stageName, w.won, role); assert.equal(st.flow.report.won, 1);
      assert.equal(st.flow.catalogue.find((p) => p.title === top).status, 'available', role + ': a service is not “sold out” after one sale');
      assert.equal(st.pending.length, st.drafts.filter((d) => d.status === 'pending').length);
      const inv = await req(s, 'POST', '/api/clinic/invoices', { patientId: lead.patientId, items: [{ description: top, qty: 1, rate: budget }] }, tok);
      assert.equal(inv.status, 200, role + ' invoice ' + inv.text);
    }
  } finally { await s.stop(); }
});
