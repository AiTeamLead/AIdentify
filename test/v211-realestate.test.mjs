// v2.11: the real-estate lead workflow (the owner's flowchart plus five agreed changes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';
import * as RE from '../lib/flow-realestate.js';

const PW = 'Tr1ckyHorse#Blue92';
const ENV = { RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', SAMPLE_DATA: 'off' };
async function req(s, method, p, body, token) {
  const r = await fetch(s.base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let d = null; try { d = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, d, text };
}
async function account(s, email, role = 'realestate') {
  const tok = (await req(s, 'POST', '/api/auth/signup', { email, name: 'Owner', password: PW })).d.token;
  const svc = role === 'realestate' ? ['Apartment sales'] : ['Maths tuition'];
  const p = await req(s, 'POST', '/api/clinic/profile', { biz: 'Skyline Homes', locations: ['Hyderabad'], services: svc, audience: role === 'realestate' ? ['Home buyers'] : ['Parents of school children'], final: true, role }, tok);
  assert.equal(p.status, 200, JSON.stringify(p.d));
  const c = await req(s, 'POST', '/api/clinic/role', { role }, tok);
  assert.equal(c.status, 200, JSON.stringify(c.d));
  return { tok, state: c.d };
}
const at = (days, hourIst) => { const d = new Date(Date.now() + days * 864e5); d.setUTCHours(hourIst - 6, 30, 0, 0); return d.toISOString(); }; // hourIst:00 IST
const CSV = 'Title, Location, BHK, Price, Size, Status\nSunrise Towers 3BHK, Gachibowli, 3, 12500000, 1850, available\nLake View 3BHK, Kondapur, 3, 11800000, 1700, available\nPalm Grove 2BHK, Gachibowli, 2, 8200000, 1240, available\nOld Block 3BHK, Gachibowli, 3, 9000000, 1500, sold';

test('matching, ranking and scoring follow the rules', () => {
  const c = { catalogue: [], leads: [], enquiries: [], appointments: [], patients: [] };
  const r = RE.importProperties(c, CSV + '\nBad row, , x, 0');
  assert.equal(r.added.length, 4); assert.equal(r.errors.length, 1);
  const req1 = RE.cleanReq({ budget: '1,20,00,000', locations: 'Gachibowli, Kondapur', bhk: '3', timeline: 'immediate' });
  assert.equal(req1.budget, 12000000); assert.deepEqual(RE.missing(req1), []);
  const m = RE.matchProperties(c, req1);
  assert.deepEqual(m.ranked.map((p) => p.title), ['Lake View 3BHK', 'Sunrise Towers 3BHK'], 'inside budget first, then up to 10% over; sold is never offered');
  const none = RE.matchProperties(c, RE.cleanReq({ budget: 5000000, locations: 'Gachibowli', bhk: 3, timeline: '1-3' }));
  assert.equal(none.ranked.length, 0); assert.match(none.why, /nearest starts at/);
  assert.deepEqual(RE.missing(RE.cleanReq({ budget: 9000000 })), ['preferred location', 'BHK', 'when they want to buy']);
  const hot = RE.scoreLead({ req: req1, waConsent: true, channel: 'Referral' }, m.ranked);
  assert.equal(hot.category, 'hot'); assert.ok(hot.score >= 70);
  const cold = RE.scoreLead({ req: RE.cleanReq({ budget: 5000000 }), channel: 'Website' }, []);
  assert.equal(cold.category, 'cold');
});

test('a lead goes from enquiry to Closed Won, every message waiting for approval', { timeout: 120000 }, async () => {
  const s = await startServer(ENV);
  try {
    const { tok, state } = await account(s, 're@example.com');
    assert.ok(state.flow, 'real estate gets the lead workflow'); assert.equal(state.flow.leads.length, 0);
    const flow = (b) => req(s, 'POST', '/api/clinic/flow', b, tok);
    assert.equal((await req(s, 'POST', '/api/clinic/catalogue/import', { csv: CSV }, tok)).d.added, 4);
    assert.equal((await req(s, 'POST', '/api/clinic/catalogue', { title: 'Sunrise Towers 3BHK', location: 'Gachibowli', bhk: 3, price: 1 }, tok)).status, 400, 'no duplicate property');

    // capture, and the same number again updates the lead instead of adding a second one
    const e1 = await req(s, 'POST', '/api/clinic/enquiries', { name: 'Ravi Kumar', phone: '919876543210', channel: 'Website', message: '3BHK in Gachibowli' }, tok);
    assert.equal(e1.status, 200);
    const e2 = await req(s, 'POST', '/api/clinic/enquiries', { name: 'Ravi', phone: '9876543210', channel: 'WhatsApp', message: 'Any update?' }, tok);
    assert.equal(e2.d.existing, true);
    let st = (await req(s, 'GET', '/api/clinic', undefined, tok)).d;
    assert.equal(st.flow.leads.length, 1); assert.equal(st.enquiries.length, 1);
    const id = st.flow.leads[0].id; assert.equal(st.flow.leads[0].stage, 'new'); assert.equal(st.flow.leads[0].next.action, 'req');

    // incomplete requirements -> ask for what is missing
    let r = await flow({ id, action: 'req', budget: 12000000, locations: 'Gachibowli, Kondapur' });
    assert.equal(r.status, 200, r.text); assert.equal(r.d.stage, 'qualifying'); assert.deepEqual(r.d.missing, ['BHK', 'when they want to buy']); assert.equal(r.d.queued, 1);
    assert.match(r.d.clinic.drafts[0].body, /BHK and when they want to buy/);
    assert.equal(r.d.clinic.drafts[0].to, '', 'no WhatsApp consent, so no WhatsApp number on the draft');

    // complete -> matched, ranked, scored hot
    r = await flow({ id, action: 'req', budget: 12000000, locations: 'Gachibowli, Kondapur', bhk: '3', timeline: 'immediate', waConsent: true });
    assert.equal(r.d.stage, 'matched');
    let lead = r.d.clinic.flow.leads[0];
    assert.equal(lead.matches.length, 2); assert.equal(lead.category, 'hot'); assert.equal(lead.next.action, 'recommend');

    // shortlist goes to WhatsApp because consent was given, and waits for approval
    r = await flow({ id, action: 'recommend' });
    assert.equal(r.d.stage, 'recommended'); assert.equal(r.d.queued, 1);
    const d = r.d.clinic.drafts[0];
    assert.equal(d.status, 'pending'); assert.equal(d.to, '919876543210'); assert.match(d.body, /Lake View 3BHK[\s\S]*Sunrise Towers 3BHK/);
    assert.ok(r.d.clinic.pending.some((x) => x.id === d.id));

    r = await flow({ id, action: 'interest', interested: true, feedback: 'Likes Lake View' });
    assert.equal(r.d.stage, 'interested');

    // slot taken -> alternatives; free slot -> booked, customer confirmation + sales-rep note
    const lakeView = r.d.clinic.flow.catalogue.find((p) => p.title === 'Lake View 3BHK').id;
    const slot = at(3, 11);
    const other = await req(s, 'POST', '/api/clinic/enquiries', { name: 'Meena', phone: '919812345678', channel: 'Phone' }, tok);
    const oid = (await req(s, 'GET', '/api/clinic', undefined, tok)).d.flow.leads.find((l) => l.enquiryId === other.d.enquiry.id).id;
    await flow({ id: oid, action: 'req', budget: 9000000, locations: 'Gachibowli', bhk: '2', timeline: '1-3' });
    assert.equal((await flow({ id: oid, action: 'visit', at: slot })).d.stage, 'visit');
    r = await flow({ id, action: 'visit', at: slot, propertyId: lakeView });
    assert.equal(r.d.slotTaken, true); assert.ok(r.d.alternatives.length >= 1); assert.equal(r.d.stage, 'interested');
    assert.equal((await flow({ id, action: 'visit', at: '2024-01-01T10:00:00.000Z', propertyId: lakeView })).status, 400, 'past dates refused');
    r = await flow({ id, action: 'visit', at: r.d.alternatives[0], propertyId: lakeView });
    assert.equal(r.d.stage, 'visit'); assert.equal(r.d.queued, 2);
    assert.ok(r.d.clinic.drafts.some((x) => x.kind === 'lead-notify-rep' && x.internal && !x.to));
    assert.ok(r.d.clinic.appointments.some((a) => a.status === 'booked' && /Site visit: Lake View/.test(a.service)));
    assert.equal((await flow({ id, action: 'remind' })).d.queued, 1);

    // visit done, ready -> human handoff -> sale confirmed -> Closed Won, property sold
    r = await flow({ id, action: 'visit-result', came: true, ready: true, feedback: 'Loved it' });
    assert.equal(r.d.stage, 'negotiation'); assert.ok(r.d.clinic.drafts.some((x) => x.kind === 'lead-handoff'));
    assert.equal((await flow({ id, action: 'sale', confirmed: false })).d.stage, 'visited');
    assert.equal((await flow({ id, action: 'sale', confirmed: true, amount: 1 })).status, 400, 'a sale needs the handoff first');
    await flow({ id, action: 'follow', answered: true });
    r = await flow({ id, action: 'visit', at: at(5, 15), propertyId: lakeView });
    assert.equal(r.d.stage, 'visit', r.text);
    await flow({ id, action: 'visit-result', came: true, ready: true });
    r = await flow({ id, action: 'sale', confirmed: true, amount: 11500000 });
    assert.equal(r.d.stage, 'won');
    st = r.d.clinic; lead = st.flow.leads.find((l) => l.id === id);
    assert.equal(lead.saleAmount, 11500000); assert.equal(lead.next.action, 'invoice');
    assert.equal(st.flow.catalogue.find((p) => p.id === lakeView).status, 'sold');
    assert.equal(st.flow.report.won, 1); assert.equal(st.flow.report.wonValue, 11500000);
    assert.ok(st.drafts.some((x) => x.kind === 'lead-won' && /review/.test(x.body)));
    // change 4: the buyer is a customer on file, ready for the booking-amount invoice
    const inv = await req(s, 'POST', '/api/clinic/invoices', { patientId: lead.patientId, items: [{ description: 'Booking amount', qty: 1, rate: 500000 }] }, tok);
    assert.equal(inv.status, 200, inv.text);
    // Chief answers from the pipeline without an AI call
    const chat = await req(s, 'POST', '/api/workplace/chat', { message: 'pipeline' }, tok);
    if (chat.status === 200 && chat.d && chat.d.answer) assert.match(chat.d.answer, /Closed Won/);
  } finally { await s.stop(); }
});

test('no match, no-show, three unanswered follow-ups, lost and opt-out', { timeout: 120000 }, async () => {
  const s = await startServer(ENV);
  try {
    const { tok } = await account(s, 're2@example.com');
    const flow = (b) => req(s, 'POST', '/api/clinic/flow', b, tok);
    await req(s, 'POST', '/api/clinic/catalogue/import', { csv: CSV }, tok);
    const mk = async (name, phone) => { const e = await req(s, 'POST', '/api/clinic/enquiries', { name, phone, channel: 'Instagram' }, tok); return (await req(s, 'GET', '/api/clinic', undefined, tok)).d.flow.leads.find((l) => l.enquiryId === e.d.enquiry.id).id; };

    // no match -> explain and ask to adjust; adjusting finds a match
    const a = await mk('Asha', '919811111111');
    let r = await flow({ id: a, action: 'req', budget: 5000000, locations: 'Gachibowli', bhk: '3', timeline: '3-6' });
    assert.equal(r.d.stage, 'nomatch'); assert.equal(r.d.queued, 1); assert.match(r.d.clinic.drafts[0].body, /widen the search/);
    assert.equal((await flow({ id: a, action: 'recommend' })).status, 400);
    r = await flow({ id: a, action: 'req', budget: 9000000, locations: 'Gachibowli', bhk: '2', timeline: '3-6' });
    assert.equal(r.d.stage, 'matched');

    // change 2: three unanswered follow-ups -> long-term nurturing; an answer reopens
    await flow({ id: a, action: 'recommend' });
    assert.equal((await flow({ id: a, action: 'follow', answered: false })).d.stage, 'recommended');
    await flow({ id: a, action: 'follow', answered: false });
    r = await flow({ id: a, action: 'follow', answered: false });
    assert.equal(r.d.stage, 'nurture'); assert.equal(r.d.clinic.flow.leads.find((l) => l.id === a).category, 'cold');
    assert.equal((await flow({ id: a, action: 'follow', answered: true })).d.stage, 'recommended');

    // change 3: did not come -> new slot offered, the booking is marked missed
    await flow({ id: a, action: 'interest', interested: true });
    await flow({ id: a, action: 'visit', at: at(2, 12) });
    r = await flow({ id: a, action: 'visit-result', came: false });
    assert.equal(r.d.stage, 'interested'); assert.ok(r.d.clinic.drafts.some((x) => x.kind === 'lead-reschedule'));
    assert.ok(r.d.clinic.appointments.some((x) => x.status === 'noshow'));

    // change 5: opt-out -> nothing more is drafted
    await flow({ id: a, action: 'optout', optOut: true });
    r = await flow({ id: a, action: 'follow', answered: false });
    assert.equal(r.d.queued, 0);
    assert.equal((await flow({ id: a, action: 'recommend' })).status, 400);

    // lost with a reason; a new enquiry from the same number reopens the lead
    r = await flow({ id: a, action: 'lost', reason: 'Bought elsewhere' });
    assert.equal(r.d.stage, 'lost'); assert.deepEqual(r.d.clinic.flow.report.lostReasons, { 'Bought elsewhere': 1 });
    await req(s, 'POST', '/api/clinic/enquiries', { name: 'Asha', phone: '919811111111', channel: 'Phone', message: 'Looking again' }, tok);
    const st = (await req(s, 'GET', '/api/clinic', undefined, tok)).d;
    assert.equal(st.flow.leads.length, 1); assert.notEqual(st.flow.leads[0].stage, 'lost');
  } finally { await s.stop(); }
});

