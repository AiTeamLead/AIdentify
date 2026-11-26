// Public customer pages (/p/...): lead form → instant reply → qualify; AfterJob rating (happy/unhappy + private
// comment); OpenPing quote opens; PartPing status; ChangeSlip accept/decline; events applied to the workspace and
// acknowledged; unknown links, bots and rate limits.
import test from 'node:test';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { indexTokens, applyPubToWorkspace, pubEvents, pubAck, publicRoute } from '../lib/public.js';

const memStore = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? { v: m.get(k) } : null), put: async (k, v) => { m.set(k, v); }, all: async () => [...m].map(([k, v]) => ({ k, v })) }; };
const T = (c) => c.repeat(32);
const email = 'shop@example.com';
const ai = async (prompt) => ({ text: /Return ONLY JSON/.test(prompt) ? '{"intent":"New crowns","urgency":"High","score":"Hot","next":"Call today"}' : 'Hi Asha, thanks for your message! We will call you soon.' });
const noAi = async () => { throw new Error('no key'); };

function workspace() {
  return { user: { name: 'Owner' }, agents: [
    { id: 1, kind: 'formfirst', biz: 'Bright Dental', forms: [{ token: T('a'), title: 'Book a visit', fields: ['Name', 'Email', 'Phone', 'How can we help?', 'Budget'] }], recs: [{ token: T('b'), name: 'Ravi Kumar', email: 'ravi@example.com', status: 'sent', q1: 'What do you need?', q2: 'When?' }] },
    { id: 2, kind: 'afterjob', biz: 'CoolAir', recs: [{ token: T('c'), name: 'Meena', status: 'sent', google: 'https://g.page/r/x', thr: 4 }, { token: T('d'), name: 'Kiran', status: 'sent' }] },
    { id: 3, kind: 'openping', recs: [{ token: T('e'), name: 'Arun', title: 'Kitchen', status: 'sent', file: { kind: 'html' }, html: '<p>Quote</p>', from: 'Sam' }] },
    { id: 4, kind: 'partping', recs: [{ token: T('f'), name: 'Lata', part: 'Compressor', job: 'J-1', milestone: 'shipped', eta: '2026-12-01', ev: [{ k: 'note', at: 1, note: 'Left warehouse' }] }, { token: T('9'), name: 'Old', part: 'Fan', milestone: 'cancelled' }] },
    { id: 5, kind: 'changeslip', biz: 'BuildCo', slips: [{ token: T('1'), name: 'Vijay Rao', summary: 'Extra socket', cents: 150000, cur: 'INR', status: 'pending', typed: true }, { token: T('2'), name: 'Anu', summary: 'Paint', cents: 5000, cur: 'BAD', status: 'pending' }] },
    null,
  ] };
}
async function setup() {
  const st = memStore(), data = workspace(), raw = JSON.stringify(data);
  st.m.set('as_data:' + email, raw);
  await indexTokens(st, email, raw);
  await indexTokens(st, email, raw); // a second time adds nothing
  await indexTokens(st, email, 'not json');
  return st;
}
const go = (st, method, path, body, opt = {}) => publicRoute({ method, pathname: path, body, headers: opt.headers || { 'user-agent': 'Mozilla/5.0' }, ip: opt.ip || '1.2.3.' + crypto.randomInt(250), query: new URLSearchParams(opt.q || ''), st, ai: opt.ai || ai });
const html = (r) => r.__html;
const ws = (st) => JSON.parse(st.m.get('as_data:' + email));

test('unknown, malformed and wrong-kind links show "not active"', async () => {
  const st = await setup();
  for (const p of ['/p/x/abc', '/p/f/' + T('0'), '/p/f/short', '/p/q/' + T('c'), '/p/r/' + T('b'), '/p/v/' + T('b'), '/p/t/' + T('b'), '/p/c/' + T('b'), '/p/f/' + T('b')]) assert.match(html(await go(st, 'GET', p)), /isn’t active/, p);
});

test('lead form: page, validation, instant reply, CRM lead, then the qualify page', async () => {
  const st = await setup();
  const form = html(await go(st, 'GET', '/p/f/' + T('a'), null, { q: 'utm_source=google&utm_campaign=diwali' }));
  assert.match(form, /Book a visit/); assert.match(form, /type="email"/);
  assert.match(html(await go(st, 'POST', '/p/f/' + T('a'), { f0: 'Asha' })), /valid email/);
  const thanks = html(await go(st, 'POST', '/p/f/' + T('a'), 'f0=Asha+Rao&f1=asha%40example.com&f2=9876543210&f3=Need+crowns&f4=50k'));
  assert.match(thanks, /Thanks, Asha!/); assert.match(thanks, /thanks for your message/);
  const qt = thanks.match(/action="\/p\/q\/([a-f0-9]+)"/)[1];
  const w = ws(st); assert.equal(w.agents[0].recs[0].name, 'Asha Rao'); assert.ok(w.agents.some((x) => x && x.kind === 'crm'), 'CRM lead created');
  // qualify page for the new lead (pending token) → answers → AI summary
  assert.match(html(await go(st, 'GET', '/p/q/' + qt)), /two quick questions/);
  assert.match(html(await go(st, 'POST', '/p/q/' + qt, { q1a: 'Crowns' })), /answer both/);
  assert.match(html(await go(st, 'POST', '/p/q/' + qt, JSON.stringify({ q1a: 'Two crowns', q2a: 'This week' }))), /Thank you, Asha/);
  assert.match(html(await go(st, 'GET', '/p/q/' + qt)), /has your answers/);
  const rec = ws(st).agents[0].recs.find((r) => r.token === qt);
  assert.equal(rec.status, 'qualified'); assert.equal(rec.sum.score, 'Hot');
  // no AI: built-in reply and rule-based score
  const t2 = html(await go(st, 'POST', '/p/f/' + T('a'), { f0: 'Bala', f1: 'bala@example.com', f3: 'Cleaning' }, { ai: noAi }));
  const q2 = t2.match(/action="\/p\/q\/([a-f0-9]+)"/)[1];
  assert.match(t2, /thanks for reaching out to Bright Dental/);
  await go(st, 'POST', '/p/q/' + q2, { q1a: 'Cleaning', q2a: 'next month' }, { ai: noAi });
  assert.equal(ws(st).agents[0].recs.find((r) => r.token === q2).sum.score, 'Warm');
  const evs = await pubEvents(st, email); assert.ok(evs.length >= 4);
  assert.equal((await pubAck(st, email, evs.map((e) => e.id))).left, 0);
  assert.equal((await pubAck(st, email, ['none'])).left, 0);
});

test('AfterJob rating: happy → review link; unhappy → private comment once', async () => {
  const st = await setup();
  assert.match(html(await go(st, 'GET', '/p/r/' + T('c'))), /How did we do, Meena/);
  assert.match(html(await go(st, 'POST', '/p/r/' + T('c'), { score: '5' })), /g\.page/);
  assert.match(html(await go(st, 'GET', '/p/r/' + T('c'))), /Thank you!/);
  assert.match(html(await go(st, 'POST', '/p/r/' + T('d'), { score: '2' })), /Sorry we missed the mark/);
  assert.match(html(await go(st, 'POST', '/p/r/' + T('d'), { op: 'comment', comment: 'Late by 2 hours' })), /stays private/);
  await go(st, 'POST', '/p/r/' + T('d'), { op: 'comment', comment: 'again' });
  const k = ws(st).agents[1].recs.find((r) => r.token === T('d'));
  assert.equal(k.status, 'unhappy'); assert.equal(k.comment, 'Late by 2 hours');
  assert.match(html(await go(st, 'GET', '/p/r/' + T('d'))), /Thank you for telling us/);
});

test('OpenPing quote: a real open is recorded once and drafts a follow-up; bots are ignored', async () => {
  const st = await setup();
  assert.match(html(await go(st, 'GET', '/p/v/' + T('e'), null, { headers: { 'user-agent': 'WhatsApp/2.0' } })), /Kitchen/);
  assert.equal(ws(st).agents[2].recs[0].status, 'sent', 'link preview bot does not count');
  assert.match(html(await go(st, 'GET', '/p/v/' + T('e'))), /srcdoc/);
  await go(st, 'GET', '/p/v/' + T('e'));
  const r = ws(st).agents[2].recs[0];
  assert.equal(r.status, 'followup_queued'); assert.equal(r.opens, 1); assert.match(r.fu.subject, /Kitchen quote, Arun/);
});

test('PartPing status page and ChangeSlip accept/decline', async () => {
  const st = await setup();
  const p = html(await go(st, 'GET', '/p/t/' + T('f')));
  assert.match(p, /Compressor/); assert.match(p, /1 December 2026/); assert.match(p, /Left warehouse/);
  assert.match(html(await go(st, 'GET', '/p/t/' + T('9'))), /Cancelled/);
  assert.match(html(await go(st, 'GET', '/p/c/' + T('1'))), /Type your full name/);
  assert.match(html(await go(st, 'POST', '/p/c/' + T('1'), { op: 'accept', typed: 'someone' })), /exactly as shown/);
  assert.match(html(await go(st, 'POST', '/p/c/' + T('1'), { op: 'accept', typed: 'vijay rao' })), /Accepted/);
  assert.match(html(await go(st, 'GET', '/p/c/' + T('1'))), /Accepted/);
  assert.equal(ws(st).agents[4].slips[0].status, 'accepted');
  assert.match(html(await go(st, 'GET', '/p/c/' + T('2'))), /50\.00/);
  assert.match(html(await go(st, 'POST', '/p/c/' + T('2'), { op: 'decline' })), /declined/i);
});

test('too many posts from one address are slowed down', async () => {
  const st = await setup();
  let last;
  for (let i = 0; i < 32; i++) last = await go(st, 'POST', '/p/r/' + T('c'), { score: 'x' }, { ip: '9.9.9.9' });
  assert.match(html(last), /Too many tries/);
});

test('applyPubToWorkspace ignores bad input and duplicates', () => {
  assert.equal(applyPubToWorkspace(null, {}), false);
  const d = workspace();
  assert.equal(applyPubToWorkspace(d, { aid: 99, kind: 'open', token: 'x' }), false);
  assert.equal(applyPubToWorkspace(d, { aid: 2, kind: 'open', token: 'missing' }), false);
  const ev = { id: 'e1', aid: 2, kind: 'rate', token: T('c'), score: 4, at: 5 };
  assert.equal(applyPubToWorkspace(d, ev), true);
  assert.equal(applyPubToWorkspace(d, { ...ev }), false, 'same event id twice');
  assert.equal(applyPubToWorkspace(d, { id: 'e2', aid: 3, kind: 'open', token: T('e'), at: 6 }), true);
  assert.equal(applyPubToWorkspace(d, { id: 'e3', aid: 3, kind: 'open', token: T('e'), at: 7 }), true);
  assert.equal(d.agents[2].recs[0].ev.at(-1).k, 'open');
  assert.equal(applyPubToWorkspace(d, { id: 'e4', aid: 1, kind: 'lead', token: T('7'), data: { name: 'Z', email: 'z@z.in' }, over_lead_limit: true }), true);
});
