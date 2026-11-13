// v2.10: fixes for the team's second test round (issues2.pdf).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, ROOT } from './helpers.mjs';
import { sameAppTwice } from '../lib/connectors.js';
import { otherWords } from '../lib/clinic-packs.js';

const PW = 'Tr1ckyHorse#Blue92';
const ENV = { RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', SAMPLE_DATA: 'off' };
async function req(s, method, p, body, token) {
  const r = await fetch(s.base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let d = null; try { d = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, d, text };
}
async function account(s, email, role, extra = {}) {
  const tok = (await req(s, 'POST', '/api/auth/signup', { email, name: 'Owner', password: PW })).d.token;
  const p = await req(s, 'POST', '/api/clinic/profile', { biz: 'Bright Minds', locations: ['Hyderabad'], services: extra.services || ['Maths tuition'], audience: ['Parents of school children'], final: true, role, ...(extra.businessType ? { businessType: extra.businessType } : {}) }, tok);
  assert.equal(p.status, 200, JSON.stringify(p.d));
  const c = await req(s, 'POST', '/api/clinic/role', { role }, tok);
  assert.equal(c.status, 200, JSON.stringify(c.d));
  return { tok, state: c.d };
}
const future = (days) => new Date(Date.now() + days * 864e5).toISOString();

test('one app is listed once; “Other” businesses get their own words', () => {
  const all = { slack: {}, 'cx:slack': { name: 'Slack' }, 'cx:slackbot': { name: 'Slack' }, 'cx:instagram': { name: 'Instagram' }, gmail: {} };
  assert.deepEqual(Object.keys(all).filter((id) => !sameAppTwice(id, all)), ['slack', 'cx:instagram', 'gmail']);
  const two = { 'cx:slack': { name: 'Slack' }, 'cx:slackbot': { name: 'Slack' } };
  assert.deepEqual(Object.keys(two).filter((id) => !sameAppTwice(id, two)), ['cx:slack']);
  assert.equal(otherWords('Bakery').visit, 'order'); assert.equal(otherWords('Bakery').bookAction, 'New order');
  assert.equal(otherWords('Pet clinic').visit, 'appointment');
  assert.equal(otherWords('Travel agency').visit, 'booking');
});

test('a new business starts empty, in its own words, and refuses past dates and wrong-industry services', { timeout: 120000 }, async () => {
  const s = await startServer(ENV);
  try {
    const { tok, state } = await account(s, 'inst@example.com', 'institute');
    for (const k of ['patients', 'appointments', 'enquiries', 'invoices', 'drafts', 'posts']) assert.equal(state[k].length, 0, k + ' should start empty (no dummy data)');
    assert.equal(state.sample, false);
    assert.equal(state.labels.bookAction, 'Book class');
    const enq = await req(s, 'POST', '/api/clinic/enquiries', { name: 'Siva', phone: '919876543218', channel: 'Phone', message: 'Maths for class 9' }, tok);
    assert.equal(enq.status, 200);
    const past = await req(s, 'POST', '/api/clinic/appointments', { enquiryId: enq.d.enquiry.id, at: '2024-01-05T10:00:00.000Z', service: 'Maths tuition', fee: 1500 }, tok);
    assert.equal(past.status, 400); assert.match(past.d.message, /already passed/);
    const wrong = await req(s, 'POST', '/api/clinic/appointments', { enquiryId: enq.d.enquiry.id, at: future(1), service: 'face cleaning', fee: 1500 }, tok);
    assert.equal(wrong.status, 400); assert.match(wrong.d.message, /doesn’t fit a coaching institute/);
    assert.equal((await req(s, 'GET', '/api/clinic', undefined, tok)).d.enquiries[0].status, 'new', 'a refused booking changes nothing');
    const ok = await req(s, 'POST', '/api/clinic/appointments', { enquiryId: enq.d.enquiry.id, at: future(1), service: 'Maths tuition', fee: 1500 }, tok);
    assert.equal(ok.status, 200, JSON.stringify(ok.d));
    // “Other” + Bakery
    const b = await account(s, 'bakery@example.com', 'other', { businessType: 'Bakery', services: ['Birthday cakes'] });
    assert.equal(b.state.roleTitle, 'Bakery'); assert.equal(b.state.labels.visit, 'order'); assert.equal(b.state.labels.bookAction, 'New order');
    assert.match(b.state.agents.find((a) => a.key === 'front').label, /orders/);
    assert.doesNotMatch(JSON.stringify([b.state.labels, b.state.agents.find((a) => a.key === 'front')]), /appointment/i);
  } finally { await s.stop(); }
});

test('festival and post drafts cover only the ticked networks; skills are saved and used', { timeout: 120000 }, async () => {
  const s = await startServer({ ...ENV, AI_PROVIDER: '', AI_MOCK: '' });
  try {
    const { tok } = await account(s, 'soc@example.com', 'institute');
    const month = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
    let cal = (await req(s, 'POST', '/api/clinic/festivals', { month }, tok)).d;
    let fest = (cal.events || [])[0];
    if (!fest) { const d = new Date(); d.setMonth(d.getMonth() + 1); cal = (await req(s, 'POST', '/api/clinic/festivals', { month: d.toISOString().slice(0, 7) }, tok)).d; fest = cal.events[0]; }
    assert.ok(fest, 'a festival to draft');
    assert.equal((await req(s, 'POST', '/api/clinic/social/festival', { date: fest.date, name: fest.name, platforms: [] }, tok)).status, 400);
    const r = await req(s, 'POST', '/api/clinic/social/festival', { date: fest.date, name: fest.name, platforms: ['Instagram', 'LinkedIn'] }, tok);
    assert.equal(r.status, 200, JSON.stringify(r.d));
    assert.deepEqual(r.d.post.platforms, ['Instagram', 'LinkedIn']);
    assert.match(r.d.post.text, /## Instagram\n/); assert.match(r.d.post.text, /## LinkedIn\n/);
    assert.doesNotMatch(r.d.post.text, /## (Facebook|X|WhatsApp)/);
    const one = await req(s, 'POST', '/api/clinic/social/draft', { topic: 'New batch starts Monday', platforms: ['X'] }, tok);
    assert.equal(one.status, 200); assert.deepEqual(one.d.post.platforms, ['X']);
    assert.equal((await req(s, 'POST', '/api/clinic/social/draft', { topic: 'New batch', platforms: ['Orkut'] }, tok)).status, 400);
    // skills
    assert.equal((await req(s, 'POST', '/api/clinic/skills', { name: 'xx', text: 'short' }, tok)).status, 400);
    assert.equal((await req(s, 'POST', '/api/clinic/skills', { name: 'asdfgh', text: 'qwerty zxcvb asdfgh hjkl' }, tok)).status, 400);
    const sk = await req(s, 'POST', '/api/clinic/skills', { name: 'Parents', text: 'Always mention the next batch start date to parents.' }, tok);
    assert.equal(sk.status, 200, JSON.stringify(sk.d)); assert.equal(sk.d.skills.length, 1);
    assert.equal((await req(s, 'POST', '/api/clinic/skills', { name: 'parents', text: 'Always mention the next batch start date again.' }, tok)).status, 400, 'duplicate name');
    const del = await req(s, 'POST', '/api/clinic/skills/delete', { id: sk.d.skills[0].id }, tok);
    assert.equal(del.d.skills.length, 0);
  } finally { await s.stop(); }
});

test('usage counts every AI call (Chief included); record questions skip the AI', { timeout: 120000 }, async () => {
  const s = await startServer(ENV);
  try {
    const { tok } = await account(s, 'use@example.com', 'institute');
    const before = (await req(s, 'GET', '/api/clinic/usage', undefined, tok)).d;
    assert.equal(before.usage.calls, 0); assert.equal(before.provider.available, false);
    const t0 = Date.now();
    const fast = await req(s, 'POST', '/api/workplace/chat', { message: 'Which invoices are unpaid?', history: [] }, tok);
    assert.equal(fast.status, 200, JSON.stringify(fast.d)); assert.equal(fast.d.mode, 'records'); assert.match(fast.d.answer, /No unpaid invoices/);
    assert.ok(Date.now() - t0 < 1500, 'the fast path answers quickly');
    assert.equal((await req(s, 'GET', '/api/clinic/usage', undefined, tok)).d.usage.calls, 0, 'no AI call was made for it');
    const slow = await req(s, 'POST', '/api/workplace/chat', { message: 'Suggest three ideas to get more students next month', history: [] }, tok);
    assert.equal(slow.status, 200, JSON.stringify(slow.d)); assert.notEqual(slow.d.mode, 'records');
    const after = (await req(s, 'GET', '/api/clinic/usage', undefined, tok)).d.usage;
    assert.ok(after.calls >= 1, 'Chief’s call is counted'); assert.ok(after.tokensIn > 0 && after.tokensOut > 0, JSON.stringify(after).slice(0, 200));
    assert.ok(after.runs.length >= 1); assert.equal(after.runs[0].name, 'Chief'); assert.ok(after.costUsd > 0);
  } finally { await s.stop(); }
});

test('sign-in keeps working; export, delete data and delete account all answer', { timeout: 120000 }, async () => {
  const s = await startServer(ENV);
  try {
    const { tok } = await account(s, 'Keep.Me@Example.com', 'dental', { services: ['Check-up'] });
    assert.equal((await req(s, 'POST', '/api/auth/logout', {}, tok)).status, 200);
    assert.equal((await req(s, 'GET', '/api/clinic', undefined, tok)).status, 401, 'the old session is closed');
    assert.equal((await req(s, 'POST', '/api/auth/signup', { email: 'keep.me@example.com', name: 'Owner', password: PW })).status, 409, 'already registered');
    for (const email of ['keep.me@example.com', 'KEEP.ME@EXAMPLE.COM', '  Keep.Me@Example.com ']) assert.equal((await req(s, 'POST', '/api/auth/login', { email, password: PW })).status, 200, 'the registered email signs in: ' + email);
    const t2 = (await req(s, 'POST', '/api/auth/login', { email: 'keep.me@example.com', password: PW })).d.token;
    const st = (await req(s, 'GET', '/api/clinic', undefined, t2)).d;
    assert.equal(st.role, 'dental'); assert.equal(st.biz, 'Bright Minds', 'the business is still there after signing in again');
    const ex = await req(s, 'GET', '/api/clinic/export', undefined, t2);
    assert.equal(ex.status, 200); assert.equal(ex.d.account, 'keep.me@example.com'); assert.equal(ex.d.clinic.biz, 'Bright Minds');
    assert.equal((await req(s, 'POST', '/api/clinic/data/delete', { confirm: 'nope' }, t2)).status, 400);
    assert.equal((await req(s, 'POST', '/api/clinic/data/delete', { confirm: 'delete my data' }, t2)).status, 200);
    const empty = (await req(s, 'GET', '/api/clinic', undefined, t2)).d;
    assert.equal(empty.needsRole, true, 'records are gone, the sign-in stays');
    assert.equal((await req(s, 'POST', '/api/auth/delete', { password: 'wrong-password-1' }, t2)).status, 400);
    assert.equal((await req(s, 'POST', '/api/auth/delete', { password: PW }, t2)).status, 200);
    assert.equal((await req(s, 'POST', '/api/auth/login', { email: 'keep.me@example.com', password: PW })).status, 401);
    assert.equal((await req(s, 'POST', '/api/auth/signup', { email: 'keep.me@example.com', name: 'Owner', password: PW })).status, 200, 'a deleted email can register again');
  } finally { await s.stop(); }
});

test('pages: sign-in is remembered, dashboard and settings follow the team’s list', () => {
  const app = fs.readFileSync(ROOT + '/clinic.html', 'utf8');
  assert.match(app, /localStorage\.setItem\('aaas_clinic_token'/); assert.doesNotMatch(app, /sessionStorage\.setItem\('aaas_clinic_token'/);
  assert.doesNotMatch(app, /<h2>Needs approval<\/h2>/); assert.doesNotMatch(app, /Reminders & quiet hours/); assert.doesNotMatch(app, /Plan & usage/);
  assert.match(app, /\['crm', 'CRM'\]/); assert.match(app, /\['skills', 'Skills'\]/); assert.match(app, /\['guide', 'Guide'\]/);
  assert.match(app, /data-net-all/); assert.match(app, /data-loc-other/);
  const idx = fs.readFileSync(ROOT + '/index.html', 'utf8');
  assert.match(idx, /Here is your WhatsApp QR code/);
});
