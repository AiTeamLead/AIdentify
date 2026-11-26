// Chief's tools, driven by the mock model ([[mock:tool {...}]]): knowledge, memory, routines, web search and pages,
// email and action approvals, social posts, leads, skills, images, asking the user; the safety switches that turn
// sending off; and the minute tick that runs due routines. Web pages are faked (fetch replaced).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AI_PROVIDER = 'mock'; process.env.AI_MOCK = 'on';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-orch-'));
const { runAgent, tick, decideApproval, approvalBlocked } = await import('../lib/orchestrator.js');

const memStore = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? { v: m.get(k) } : null), put: async (k, v) => { if (v == null) m.delete(k); else m.set(k, v); }, all: async () => [...m].map(([k, v]) => ({ k, v })), listPrefix: async (p) => [...m].filter(([k]) => k.startsWith(p)).map(([k, v]) => ({ k, v })) }; };
const secret = async () => 'orch-secret';
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('duckduckgo')) return new Response('<a class="result__a" href="https://clinic.example/">Smile Clinic</a><a class="result__snippet">Open Sundays</a>', { headers: { 'content-type': 'text/html' } });
  if (u.startsWith('https://93.184.216.34')) return new Response('<html><head><title>Price list</title></head><body><h1>Prices</h1><p>Cleaning 800</p></body></html>', { headers: { 'content-type': 'text/html' } });
  return new Response('{}', { status: 404 });
};
const D = (tool, input) => `[[mock:${tool} ${JSON.stringify(input)}]]`;
const run = (st, email, message, extra = {}) => runAgent({ st, email, userName: 'Phani', data: extra.data || { agents: [] }, agent: extra.agent || null, message, history: [], tz: 'Asia/Kolkata', mode: 'chat', secret, wpSearch: async () => [], wpChunks: async () => [], ...extra });
const text = (r) => JSON.stringify(r);

test('knowledge, memory and routines', async () => {
  const st = memStore(), email = 'o@example.com';
  const r = await run(st, email, 'Save this. ' + D('save_knowledge', { title: 'Parking', text: 'Free parking is behind the clinic on 2nd street.' }) + D('save_knowledge', { title: '', text: 'x' })
    + D('remember', { fact: 'Prefers WhatsApp' }) + D('remember', { fact: 'Prefers WhatsApp' }) + D('remember', {})
    + D('create_routine', { title: 'Morning brief', instruction: 'Summarise new leads', first_run: new Date(Date.now() + 3600e3).toISOString(), repeat_every_days: 1 }) + D('create_routine', { title: 'Bad', first_run: 'soon' })
    + D('list_routines', {}) + D('cancel_routine', { routine_id: 'nope' }) + D('forget', { memory_id: 'nope' }));
  assert.ok(r.answer);
  const ag = { id: 1, name: 'Desk', kind: 'custom', tools: [] };
  const rk = await run(st, email, D('save_knowledge', { title: 'Parking', text: 'Free parking is behind the clinic on 2nd street.' }) + D('save_knowledge', { title: '', text: 'x' }), { agent: ag, data: { agents: [ag] } });
  assert.ok((rk.kb || []).some((k) => k.title === 'Parking'));
  const mem = JSON.parse(st.m.get('as_mem:' + email)); const list = Object.values(mem)[0];
  assert.equal(list.length, 1, 'the same fact is saved once');
  const rt = JSON.parse(st.m.get('as_rt:' + email)); assert.equal(rt.length, 1);
  const r2 = await run(st, email, D('cancel_routine', { routine_id: rt[0].id }) + D('forget', { memory_id: list[0].id }) + D('list_routines', {}));
  assert.ok(r2.steps.some((s) => s.k === 'routine' && /Cancelled/.test(s.t)));
  assert.equal(Object.values(JSON.parse(st.m.get('as_mem:' + email)))[0].length, 0);
});

test('web search, reading a page, email and action approvals, skills, leads, pictures, questions', async () => {
  const st = memStore(), email = 'w@example.com';
  const r = await run(st, email, 'Do it. ' + D('web_search', { query: 'smile clinic' }) + D('read_webpage', { url: 'https://93.184.216.34/prices' }) + D('read_webpage', { url: 'http://127.0.0.1/x' })
    + D('send_email', { to: 'not-an-email', subject: 'Hi', body: 'x' }) + D('send_email', { to: 'ravi@example.com', subject: 'Hi [Name]', body: 'x' })
    + D('send_email', { to: 'ravi@example.com', subject: 'Your visit', body: 'See you on Monday at 5 pm.' })
    + D('propose_action', { app: 'draft', summary: 'Call Ravi', request: 'Call Ravi about the crown' }) + D('propose_action', { app: 'hubspot', summary: 'Add contact', request: 'Add Ravi' })
    + D('save_skill', { name: 'Parking info', description: 'Where to park', instructions: 'Always say parking is free behind the clinic.' }) + D('use_skill', { name: 'nope' })
    + D('save_lead', { name: 'Kiran', source: 'Instagram', url: 'https://instagram.com/p/abc', note: 'Asked price' }) + D('save_lead', {})
    + D('create_image', { prompt: 'A clean dental clinic reception', size: 'square' }) + D('ask_user', { question: 'Which day?', options: ['Mon', 'Tue'] })
    + D('read_connected_app', { request: 'emails' }) + D('search_my_data', { query: 'Ravi' }));
  const t = text(r);
  assert.match(t, /Smile Clinic|Searched the web/);
  assert.ok((r.approvals || []).length >= 2, 'email and action wait for approval');
  assert.ok(r.question && r.question.q === 'Which day?');
  const r2 = await run(st, email, D('use_skill', { name: 'Parking info' }));
  assert.ok(r2.answer);
  // approve the email: no mail account → it fails cleanly; reject the action
  const appr = JSON.parse(st.m.get('as_appr:' + email));
  for (const a of appr.filter((x) => x.status === 'pending')) {
    const out = await decideApproval({ st, email, id: a.id, approve: a.kind !== 'email', secret });
    assert.ok(out.approval);
  }
  assert.ok((await decideApproval({ st, email, id: 'missing', approve: true, secret })).error);
});

test('safety switches block sending, posting and app actions', async () => {
  const st = memStore(), email = 's@example.com';
  for (const k of ['EMAIL', 'ACTION', 'SOCIAL', 'BROWSER']) process.env['APPROVAL_' + k] = 'block';
  assert.equal(approvalBlocked('EMAIL'), true);
  const r = await run(st, email, D('send_email', { to: 'a@b.in', subject: 'x', body: 'y' }) + D('propose_action', { app: 'draft', summary: 's', request: 'r' }) + D('publish_social_post', { text: 'Offer', platforms: ['LinkedIn'] }));
  assert.equal((r.approvals || []).length, 0);
  for (const k of ['EMAIL', 'ACTION', 'SOCIAL', 'BROWSER']) delete process.env['APPROVAL_' + k];
});

test('the minute tick runs due routines, queues board routines and retires one-offs', async () => {
  const st = memStore(), email = 't@example.com', now = Date.now();
  st.m.set('as_data:' + email, JSON.stringify({ agents: [{ id: 1, name: 'Desk', kind: 'custom' }] }));
  st.m.set('as_rt:' + email, JSON.stringify([
    { id: 'r1', on: true, aid: 'assistant', title: 'Brief', prompt: 'Summarise today', next: now - 1000, every: 1, hour: 8, minute: 0, tz: 'Asia/Kolkata', slack: true },
    { id: 'r2', on: true, aid: 1, title: 'Desk check', prompt: 'Check enquiries', next: now - 1000, every: 0 },
    { id: 'r3', on: true, aid: 99, title: 'Gone agent', prompt: 'x', next: now - 1000 },
    { id: 'r4', on: true, aid: 1, title: 'Board job', prompt: 'Research', next: now - 1000, every: 2, board: 'g1' },
    { id: 'r5', on: true, paused: true, aid: 1, title: 'Paused', prompt: 'x', next: now - 1000 },
    { id: 'r6', on: true, aid: 1, title: 'Later', prompt: 'x', next: now + 864e5 },
  ]));
  const r = await tick({ st, secret, wpSearch: async () => [], wpChunks: async () => [], now, getName: async () => 'Phani', getProfile: async () => '' });
  assert.equal(r.ran, 3);
  const after = Object.fromEntries(JSON.parse(st.m.get('as_rt:' + email)).map((x) => [x.id, x]));
  assert.equal(after.r2.on, false, 'one-off is retired'); assert.equal(after.r3.on, false, 'routine of a deleted agent stops');
  assert.ok(after.r1.next > now); assert.equal(after.r5.last, undefined); assert.equal(after.r6.last, undefined);
  assert.ok(JSON.parse(st.m.get('as_board:' + email)).some((t) => /Board job/.test(t.title)));
  assert.equal(JSON.parse(st.m.get('as_inbox:' + email)).length, 3);
  delete process.env.AI_PROVIDER;
  assert.equal((await tick({ st, secret, now })).skipped, 'no AI key');
  process.env.AI_PROVIDER = 'mock';
});
