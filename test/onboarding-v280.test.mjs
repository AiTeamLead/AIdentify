// v2.8: onboarding rules (shared by the page and the server), the marketing pack, and the front-desk workflow.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, ROOT } from './helpers.mjs';
import '../lib/onboarding-rules.js';
import { PACK_IDS, PACK_PATHS, publicPacks } from '../lib/clinic-packs.js';

const R = globalThis.OBRules;
const PW = 'Tr1ckyHorse#Blue92';

test('ONB-2.1 business name: 2–60 letters only; numbers, emails and symbols refused', () => {
  for (const bad of ['', 'A', '5475676', '12 34', 'siva123@gmail.com', '@@@###', 'x'.repeat(61), 'Smile <b>', '24 Seven Dental', 'Dental 2', "Rao's Clinic (Kukatpally)"])
    assert.equal(R.bizName(bad).ok, false, bad);
  for (const good of ['Smile Dental', 'Seven Dental & Co.', "Rao's Clinic", '  Pixel   Growth  '])
    assert.equal(R.bizName(good).ok, true, good);
  assert.equal(R.bizName('  Pixel   Growth  ').value, 'Pixel Growth', 'trims and collapses spaces');
  assert.match(R.bizName('1').message, /Numbers and symbols are not allowed/);
});

test('ONB-3.1 location: a city from the list, or a real place typed under Other', () => {
  for (const bad of ['siva123@gmail.com', '12345', 'sdfgsdfg', 'xxxx', 'Area 51', '']) assert.equal(R.location(bad).ok, false, bad);
  assert.equal(R.location('hyderabad').value, 'Hyderabad');
  assert.equal(R.location('gachi bowli').value, 'Gachi Bowli', 'a typed place is kept in Title Case');
  assert.equal(R.inList('Kukatpally'), false); assert.equal(R.inList('pune'), true);
  const l = R.list('location', ['Pune', 'pune', 'Mumbai'], { required: true });
  assert.deepEqual(l.value, ['Pune', 'Mumbai'], 'case-insensitive dedupe');
  assert.equal(R.list('location', [], { required: true }).ok, false);
  assert.equal(R.cityShort(['Hyderabad', 'Pune', 'Delhi']), 'Hyderabad +2');
  assert.ok(R.cityLine(R.CITIES.slice(0, 20)).length <= 80);
});

test('v2.10 typed entries must be real words and fit the industry', () => {
  for (const bad of ['asdfgh', 'xxxx yyyy', 'bcdfg', 'qwerty', 'aaaa']) { assert.equal(R.service(bad).ok, false, bad); assert.equal(R.offer(bad).ok, false, bad); assert.equal(R.audience(bad).ok, false, bad); }
  assert.equal(R.service('face cleaning', 'institute').ok, false, 'a salon service in a coaching institute');
  assert.match(R.service('Facial', 'institute').message, /doesn’t fit a coaching institute/);
  assert.equal(R.service('Maths tuition', 'institute').ok, true);
  assert.equal(R.service('Root canal', 'marketing').ok, false);
  assert.equal(R.service('Haircut', 'dental').ok, false);
  assert.equal(R.service('Teeth whitening', 'dental').ok, true);
  assert.equal(R.service('Premium service', 'dental').ok, true, 'neutral wording is allowed');
  assert.equal(R.service('Birthday cakes', 'other').ok, true, '“Other” businesses are not industry-checked');
  assert.equal(R.service('RCT review', 'dental').ok, true, 'short capital abbreviations are fine');
  assert.equal(R.offer('Free haircut', 'institute').ok, false);
  assert.equal(R.offer('Free demo class', 'institute').ok, true);
  assert.equal(R.canAdd('services', [], 'Facial', 'institute').ok, false);
  assert.equal(R.profile({ services: ['Facial'] }, [], 'institute').ok, false);
});

test('ONB-4.1 / 5.1 services and audiences: real text only, limits and duplicates', () => {
  for (const bad of ['12345', '@#$%', 'a', 'x'.repeat(41), 'me@x.com']) assert.equal(R.service(bad).ok, false, bad);
  assert.equal(R.service('Root canal treatment').ok, true);
  for (const bad of ['9999999999', '   ', '!!', 'x'.repeat(61)]) assert.equal(R.audience(bad).ok, false, bad);
  assert.equal(R.audience('Families within 5 km').ok, true, 'numbers inside a real description are fine');
  assert.equal(R.canAdd('services', ['SEO'], 'seo').message, 'Already added.');
  assert.match(R.canAdd('services', Array.from({ length: 20 }, (_, i) => 'Service ' + String.fromCharCode(65 + i)), 'One more').message, /up to 20/);
  assert.match(R.canAdd('audience', Array.from({ length: 10 }, (_, i) => 'Group ' + String.fromCharCode(65 + i)), 'One more').message, /up to 10/);
  assert.equal(R.list('services', 'Check-up, 123').ok, false, 'one bad entry fails the list');
});

test('offers become invoice discounts; phones are normalised', () => {
  assert.deepEqual(R.offerOf('10% off first visit'), { label: '10% off first visit', type: 'percent', value: 10 });
  assert.deepEqual(R.offerOf('Refer a friend: ₹500 off'), { label: 'Refer a friend: ₹500 off', type: 'flat', value: 500 });
  assert.equal(R.offerOf('Free consultation').type, 'other');
  assert.equal(R.phone('98480 12345').value, '+919848012345');
  assert.equal(R.phone('+14155550123').value, '+14155550123');
  for (const bad of ['abc', '12345', '1234567890']) assert.equal(R.phone(bad).ok, false, bad);
  const br = R.branches('City, Name, Area, Phone\nHyderabad, Banjara Hills, Road 12, 9848012345\nNowhere, X, Y, 1');
  assert.equal(br.value.length, 1); assert.equal(br.ok, false); assert.match(br.message, /Line 3/);
});

test('ONB-1.2 Digital marketing agency is the first pack and every suggestion passes the rules', () => {
  assert.equal(PACK_IDS[0], 'marketing');
  assert.equal(PACK_PATHS.marketing, '/Marketing');
  for (const p of publicPacks()) {
    assert.ok(p.suggest.services.length >= 5, p.id + ' services');
    assert.ok(p.suggest.audience.length >= 5, p.id + ' audiences');
    assert.ok(p.suggest.offers.length >= 4, p.id + ' offers');
    for (const x of p.suggest.services) assert.equal(R.service(x).ok, true, p.id + ' service ' + x);
    for (const x of p.suggest.audience) assert.equal(R.audience(x).ok, true, p.id + ' audience ' + x);
    for (const x of p.suggest.offers) assert.equal(R.offer(x).ok, true, p.id + ' offer ' + x);
  }
});

test('the page loads the same rules file and no longer auto-advances or hides nothing', () => {
  const html = fs.readFileSync(ROOT + '/clinic.html', 'utf8');
  assert.match(html, /<script src="\/onboarding-rules\.js"><\/script>/);
  assert.match(html, /\[hidden\] \{ display:none !important; \}/, 'AWS region stays hidden for non-Bedrock providers');
  assert.doesNotMatch(html, /Typeform-style: a pick moves on/, 'a tile click only selects');
  assert.doesNotMatch(html, /item\('(connections|pricing|usage|privacy)'/, 'old sidebar items are gone');
  assert.doesNotMatch(html, /<iframe class="bot-frame"/, 'Bot Mode frame is not rebuilt on every render');
  const idx = fs.readFileSync(ROOT + '/index.html', 'utf8');
  assert.match(idx, /bot-boot/); assert.match(idx, /id="wpJump"/);
});

test('server re-validates the profile, books from an enquiry and applies an offer to an invoice', async () => {
  const s = await startServer({ AI_MOCK: '1' });
  try {
    const js = await fetch(s.base + '/onboarding-rules.js'); assert.equal(js.status, 200); assert.match(await js.text(), /OBRules/);
    assert.equal((await fetch(s.base + '/Marketing')).status, 200);
    const meta = await fetch(s.base + '/api/clinic/meta').then((r) => r.json());
    assert.equal(meta.packs[0].id, 'marketing');
    const up = await s.api('/api/auth/signup', { email: 'agency@example.com', name: 'Agency Owner', password: PW });
    assert.equal(up.status, 200, JSON.stringify(up.d)); const tok = up.d.token;
    for (const [body, field] of [[{ biz: '24 Seven Dental' }, 'biz'], [{ services: 'asdfgh' }, 'services'], [{ services: 'Haircut', role: 'marketing' }, 'services'], [{ locations: ['sdfgsdfg'] }, 'locations'], [{ biz: '5475676' }, 'biz'], [{ biz: 'siva123@gmail.com' }, 'biz'], [{ city: 'siva123@gmail.com' }, 'locations'], [{ locations: ['12345'] }, 'locations'], [{ services: '12345' }, 'services'], [{ audience: '99999' }, 'audience'], [{ phone: 'abc' }, 'phone'], [{ contactEmail: 'nope' }, 'contactEmail']]) {
      const r = await s.api('/api/clinic/profile', body, tok);
      assert.equal(r.status, 400, JSON.stringify(body)); assert.ok(r.d.fields && r.d.fields[field], 'field error for ' + field + ': ' + JSON.stringify(r.d));
    }
    assert.equal((await s.api('/api/clinic/profile', { biz: 'Pixel Growth', final: true }, tok)).status, 400, 'final save needs every answer');
    const step = await s.api('/api/clinic/profile', { biz: 'Pixel Growth' }, tok); assert.equal(step.status, 200);
    const resume = await s.api('/api/clinic', undefined, tok);
    assert.equal(resume.d.biz, 'Pixel Growth', 'a refresh gets the saved step back'); assert.equal(resume.d.needsRole, true);
    const fin = await s.api('/api/clinic/profile', { biz: 'Pixel Growth', locations: ['Hyderabad', 'Pune', 'Mumbai'], services: ['SEO', 'Google Ads'], audience: ['Local business owners'], offers: ['10% off the first 3 months', 'Free marketing audit'], final: true }, tok);
    assert.equal(fin.status, 200, JSON.stringify(fin.d));
    assert.deepEqual(fin.d.profile.locations, ['Hyderabad', 'Pune', 'Mumbai']);
    assert.deepEqual(fin.d.profile.offers[0], { label: '10% off the first 3 months', type: 'percent', value: 10 });
    const c = await s.api('/api/clinic/role', { role: 'marketing' }, tok);
    assert.equal(c.status, 200, JSON.stringify(c.d));
    assert.equal(c.d.roleTitle, 'Digital marketing agency'); assert.equal(c.d.rolePath, '/Marketing');
    assert.equal(c.d.labels.who, 'clients'); assert.equal(c.d.labels.visit, 'strategy call');
    assert.equal(c.d.city, 'Hyderabad, Pune, Mumbai');
    assert.doesNotMatch(JSON.stringify([c.d.labels, c.d.agents.map((a) => [a.name, a.label, a.d]), c.d.drafts.map((d) => [d.title, d.body]), c.d.posts.map((p) => p.text), c.d.enquiries.map((e) => e.message)]), /patient|dentist|tooth|clinic/i, 'no clinic wording for an agency');
    assert.doesNotMatch(JSON.stringify(c.d.drafts), /\(sample\)/, 'drafts use the owner’s business name');
    // enquiry -> appointment -> invoice with the offer
    const enq = await s.api('/api/clinic/enquiries', { name: 'Ravi Kumar', phone: '919848012345', channel: 'Website', message: 'Need SEO' }, tok);
    assert.equal(enq.status, 200);
    const ap = await s.api('/api/clinic/appointments', { enquiryId: enq.d.enquiry.id, at: new Date(Date.now() + 864e5).toISOString(), service: 'SEO', fee: 25000 }, tok);
    assert.equal(ap.status, 200, JSON.stringify(ap.d));
    let cur = (await s.api('/api/clinic', undefined, tok)).d;
    assert.equal(cur.enquiries.find((e) => e.id === enq.d.enquiry.id).status, 'booked');
    const person = cur.patients.find((p) => p.id === ap.d.appointment.patientId); assert.equal(person.name, 'Ravi Kumar'); assert.equal(person.demo, false);
    const inv = await s.api('/api/clinic/invoices', { patientId: person.id, appointmentId: ap.d.appointment.id, items: [{ desc: 'SEO retainer', qty: 1, rate: 25000 }], offer: '10% off the first 3 months', gst: '18' }, tok);
    assert.equal(inv.status, 200, JSON.stringify(inv.d));
    assert.equal(inv.d.invoice.discount, 2500); assert.equal(inv.d.invoice.total, 26550, '25000 - 10% = 22500, + 18% GST');
    const tooMuch = await s.api('/api/clinic/invoices', { patientId: person.id, items: [{ desc: 'Audit', qty: 1, rate: 100 }], discount: 500 }, tok);
    assert.notEqual(tooMuch.status, 200, 'a discount above the amount is refused');
    const plain = await s.api('/api/clinic/invoices', { patientId: person.id, items: [{ desc: 'Audit', qty: 2, rate: 1000 }] }, tok);
    assert.equal(plain.d.invoice.total, 2000, 'invoices without an offer are unchanged');
    // nothing is connected by default
    const conns = await s.api('/api/connectors', undefined, tok); assert.equal(conns.status, 200); assert.deepEqual(conns.d.items, []);
  } finally { await s.stop(); }
});
