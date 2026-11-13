// v2.12: fixes from Nagendra's test round (Document45.docx).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, ROOT } from './helpers.mjs';
import { clinicAfterDecision } from '../lib/clinic.js';

const PW = 'Tr1ckyHorse#Blue92';
const ENV = { RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', SAMPLE_DATA: 'off' };
async function req(s, method, p, body, token) {
  const r = await fetch(s.base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let d = null; try { d = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, d, text };
}
async function account(s, email) {
  const tok = (await req(s, 'POST', '/api/auth/signup', { email, name: 'Owner', password: PW })).d.token;
  assert.equal((await req(s, 'POST', '/api/clinic/profile', { biz: 'Indian', locations: ['Hyderabad'], services: ['SEO'], audience: ['Small business owners'], final: true, role: 'marketing' }, tok)).status, 200);
  assert.equal((await req(s, 'POST', '/api/clinic/role', { role: 'marketing' }, tok)).status, 200);
  return tok;
}

test('Approve / Deny / Always allow in Chief decide the same draft in the owner app', { timeout: 120000 }, async () => {
  const s = await startServer(ENV);
  try {
    const tok = await account(s, 'mk@example.com');
    assert.equal((await req(s, 'POST', '/api/ai/key', { provider: 'openrouter', key: 'sk-or-mock-key-000000000000', model: '' }, tok)).status, 200);
    const mk0 = async (topic) => (await req(s, 'POST', '/api/clinic/social/draft', { topic, platforms: ['Instagram', 'LinkedIn'] }, tok)); const mk = async (topic) => { const r0 = await mk0(topic); assert.equal(r0.status, 200, r0.text); return r0.d.post; };
    const a = await mk('Diwali offer for local shops'), b = await mk('New SEO package'), c = await mk('Client success story');
    assert.ok(a.approvalId && b.approvalId && c.approvalId);
    // Approve from Chief: the post is scheduled and leaves the Approvals list
    let r = await req(s, 'POST', '/api/agents/approval', { id: a.approvalId, decision: 'approve' }, tok);
    assert.equal(r.status, 200, r.text); assert.equal(r.d.approval.status, 'done');
    let st = (await req(s, 'GET', '/api/clinic', undefined, tok)).d;
    assert.equal(st.posts.find((p) => p.id === a.id).status, 'scheduled');
    assert.ok(!st.pending.some((d) => d.approvalId === a.approvalId), 'no longer waiting');
    // Deny from Chief: rejected, never published
    r = await req(s, 'POST', '/api/agents/approval', { id: b.approvalId, decision: 'decline' }, tok);
    assert.equal(r.d.approval.status, 'declined');
    st = (await req(s, 'GET', '/api/clinic', undefined, tok)).d;
    assert.equal(st.posts.find((p) => p.id === b.id).status, 'rejected');
    assert.ok(!st.pending.some((d) => d.approvalId === b.approvalId));
    // Always allow: approved, and the rule is saved
    r = await req(s, 'POST', '/api/agents/approval', { id: c.approvalId, decision: 'approve', always: true }, tok);
    assert.equal(r.d.approval.status, 'done'); assert.ok(r.d.rule && r.d.rule.decision === 'allow', JSON.stringify(r.d.rule));
    st = (await req(s, 'GET', '/api/clinic', undefined, tok)).d;
    assert.equal(st.posts.find((p) => p.id === c.id).status, 'scheduled');
    assert.equal(st.pending.length, 0, 'nothing is left pending');
    // the same request cannot be decided twice, and an unknown one says so
    assert.equal((await req(s, 'POST', '/api/agents/approval', { id: a.approvalId, decision: 'decline' }, tok)).d.approval.status, 'done');
    assert.equal((await req(s, 'POST', '/api/agents/approval', { id: 'nope', decision: 'approve' }, tok)).status, 404);
  } finally { await s.stop(); }
});

test('a social post Chief drafted on its own goes on the calendar when approved', async () => {
  const m = new Map(), st = { get: async (k) => (m.has(k) ? { v: m.get(k) } : null), put: async (k, v) => { m.set(k, v); } };
  const email = 'x@example.com', lock = async (_e, fn) => fn();
  m.set('as_clinic:' + email, JSON.stringify({ role: 'marketing', biz: 'Indian', city: 'Hyderabad', posts: [], drafts: [], patients: [], appointments: [], enquiries: [], invoices: [] }));
  m.set('as_appr:' + email, JSON.stringify([{ id: 'a1', status: 'done', kind: 'draft' }]));
  const note = await clinicAfterDecision(st, email, { id: 'a1', status: 'done', kind: 'draft', app: 'draft', summary: 'Social media post for 2099-11-17 (Instagram, LinkedIn)', request: 'Line one\nLine two #diwali' }, lock);
  assert.match(note, /Social Media calendar for 17 Nov/);
  const c = JSON.parse(m.get('as_clinic:' + email));
  assert.equal(c.posts.length, 1); assert.equal(c.posts[0].status, 'scheduled'); assert.deepEqual(c.posts[0].platforms, ['Instagram', 'LinkedIn']);
  assert.equal(c.posts[0].text, 'Line one\nLine two #diwali'); assert.match(c.posts[0].at, /^2099-11-17/);
  assert.match(JSON.parse(m.get('as_appr:' + email))[0].result, /calendar/);
  // a denied one, or a draft that is not a post, adds nothing
  await clinicAfterDecision(st, email, { id: 'a2', status: 'declined', kind: 'draft', summary: 'Social media post for 2099-11-19 (X)' }, lock);
  await clinicAfterDecision(st, email, { id: 'a3', status: 'done', kind: 'draft', summary: 'Email to a client about the invoice' }, lock);
  assert.equal(JSON.parse(m.get('as_clinic:' + email)).posts.length, 1);
});

test('skills: clear messages, real sentences saved and kept', { timeout: 120000 }, async () => {
  const s = await startServer(ENV);
  try {
    const tok = await account(s, 'sk@example.com');
    const bad = await req(s, 'POST', '/api/clinic/skills', { name: 'dusyfudsyf', text: '7634853685368skdhfkshfkjshfskfhskjf' }, tok);
    assert.equal(bad.status, 400); assert.match(bad.d.message, /does not read as real words/);
    assert.match((await req(s, 'POST', '/api/clinic/skills', { name: 'Sign off', text: 'Be nice' }, tok)).d.message, /too short/);
    assert.match((await req(s, 'POST', '/api/clinic/skills', { name: 'Sign off', text: '' }, tok)).d.message, /empty/);
    const ok = await req(s, 'POST', '/api/clinic/skills', { name: 'Sign off', text: 'Always sign off messages as Team Indian.' }, tok);
    assert.equal(ok.status, 200, ok.text); assert.equal(ok.d.skills.length, 1);
    assert.equal((await req(s, 'GET', '/api/clinic', undefined, tok)).d.skills[0].name, 'Sign off', 'still there after a reload');
  } finally { await s.stop(); }
});

test('screens: Back is readable, booking has date + time + Save booking, Settings confirms connections, marketing Guide', () => {
  const app = fs.readFileSync(ROOT + '/clinic.html', 'utf8'), wp = fs.readFileSync(ROOT + '/index.html', 'utf8');
  assert.match(app, /\.tour \.btn-ghost \{ background:transparent; color:#fff;/);
  assert.match(app, /Save booking<\/button>/); assert.doesNotMatch(app, /type="datetime-local"/);
  assert.match(app, /\/api\/connectors\/account\/check\?slug=/); assert.match(app, /\/api\/connectors\/account\/signin/);
  for (const t of ['Lead generation', 'Lead qualification', 'Client onboarding', 'Strategy planning', 'Content creation', 'Client approval', 'Campaign management', 'Performance monitoring', 'Reporting', 'Billing & payments', 'Customer retention', 'How the AI team works']) assert.ok(app.includes(`['${t}'`), t);
  assert.match(wp, /if\(!botMode&&tab==='My Workplace'&&wpSet===a\.id\)say\('Knowledge base ready for '/);
  assert.match(wp, /This request is no longer open/);
});
