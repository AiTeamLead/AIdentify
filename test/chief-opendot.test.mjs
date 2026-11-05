// Chief works like open-dot: owner rules (allow / ask / never), "Always allow" on a card, question options,
// skills, and Connect cards. A fake Composio API stands in for the real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.mjs';
import { _forTests } from '../lib/rules.js';

const PW = 'Clinic-pass-123!';

function fakeComposio() {
  const exec = []; let n = 0; const accounts = new Map(); const links = [];
  const TOOLS = {
    CLICKUP_GET_TASKS: { slug: 'CLICKUP_GET_TASKS', toolkit: { slug: 'clickup' }, description: 'Get tasks', input_parameters: {} },
    CLICKUP_CREATE_TASK: { slug: 'CLICKUP_CREATE_TASK', toolkit: { slug: 'clickup' }, description: 'Create a task', input_parameters: { properties: { name: { type: 'string' } }, required: ['name'] } },
    CLICKUP_DELETE_TASK: { slug: 'CLICKUP_DELETE_TASK', toolkit: { slug: 'clickup' }, description: 'Delete a task', input_parameters: {} },
  };
  const srv = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c; const b = body ? JSON.parse(body) : {};
    const u = new URL(req.url, 'http://x'); const p = u.pathname.replace(/^\/api\/v3\.1/, '');
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    let m;
    if (p === '/auth_configs') return send(200, { auth_config: { id: 'ac_1' } });
    if (p === '/connected_accounts/link') { const id = 'ca_' + (++n); accounts.set(id, b.user_id); links.push(b); return send(200, { redirect_url: 'https://connect.example/' + id, connected_account_id: id }); }
    if ((m = p.match(/^\/connected_accounts\/(ca_\d+)$/))) return send(200, { id: m[1], user_id: accounts.get(m[1]), status: 'ACTIVE', state: { val: {} } });
    if (p === '/tools') return send(200, { items: Object.values(TOOLS) });
    if ((m = p.match(/^\/tools\/execute\/([A-Z_]+)$/))) { exec.push({ slug: m[1], args: b.arguments }); return send(200, { successful: true, data: { ok: m[1] } }); }
    if ((m = p.match(/^\/tools\/([A-Z_]+)$/))) return TOOLS[m[1]] ? send(200, TOOLS[m[1]]) : send(404, {});
    send(404, {});
  });
  return { srv, exec, links };
}

test('rule matching: words of the rule must appear in the action', () => {
  const ok = _forTests.overlapApplies;
  assert.equal(ok('send an email to a customer', 'send an email to asha@example.com (subject: Visit)'), false); // "customer" not in action
  assert.equal(ok('send an email', 'send an email to asha@example.com (subject: Visit)'), true);
  assert.equal(ok('create a task in ClickUp', 'add a follow-up (CLICKUP_CREATE_TASK) create task clickup'), true);
  assert.equal(ok('delete anything', 'add a follow-up (CLICKUP_CREATE_TASK)'), false);
});

test('Chief: rules decide allow / ask / never; Always allow adds a rule; options, skills and connect cards', async () => {
  const { srv, exec, links } = fakeComposio();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', COMPOSIO_API_KEY: 'k', COMPOSIO_BASE_URL: 'http://127.0.0.1:' + srv.address().port + '/api/v3.1' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'chief@example.com', name: 'Chief Owner', password: PW })).d.token;
    const H = { 'content-type': 'application/json', authorization: 'Bearer ' + tok };
    // connect ClickUp through the browser-bound sign-in
    const st = await fetch(s.base + '/api/connectors/start', { method: 'POST', headers: H, body: JSON.stringify({ c: 'cx:clickup' }) });
    const cookie = (st.headers.get('set-cookie') || '').split(';')[0];
    const state = new URL(links[0].callback_url).searchParams.get('state');
    assert.match(await (await fetch(s.base + '/api/connectors/composio?status=success&state=' + encodeURIComponent(state), { headers: { cookie } })).text(), /Connected/);
    const chat = (m) => s.api('/api/workplace/chat', { message: m }, tok);
    const run = (thought, slug, args = {}) => chat(`[[mock:app_run_tools {"thought":"${thought}","tools":[{"tool_slug":"${slug}","arguments":${JSON.stringify(args)}}]}]]`);

    // rules API
    assert.equal((await s.api('/api/agents/rules', { action: 'x', decision: 'ask' }, tok)).status, 400);
    assert.equal((await s.api('/api/agents/rules', { action: 'delete a task', decision: 'maybe' }, tok)).status, 400);
    const never = await s.api('/api/agents/rules', { action: 'delete a task in ClickUp', decision: 'never' }, tok);
    assert.equal(never.status, 200, JSON.stringify(never.d));

    // 1. never → refused, nothing runs
    const blocked = await run('Delete the old task', 'CLICKUP_DELETE_TASK');
    assert.match(blocked.d.answer, /Not allowed: the owner's rule says never delete a task in ClickUp/);
    assert.ok(!exec.some((e) => e.slug === 'CLICKUP_DELETE_TASK'));

    // 2. no rule → asks first; the card carries the action used for "Always allow"
    const asked = await run('Create a follow-up task', 'CLICKUP_CREATE_TASK', { name: 'Call Ravi' });
    const card = asked.d.approvals.find((a) => a.status === 'pending');
    assert.ok(card, JSON.stringify(asked.d).slice(0, 300));
    assert.match(card.ruleAction, /create a follow-up task \(CLICKUP_CREATE_TASK\)/);
    assert.ok(!exec.some((e) => e.slug === 'CLICKUP_CREATE_TASK'));

    // 3. Always allow → runs now and adds an allow rule
    const ok = await s.api('/api/agents/approval', { id: card.id, decision: 'approve', always: true }, tok);
    assert.equal(ok.status, 200, JSON.stringify(ok.d));
    assert.equal(ok.d.approval.status, 'done');
    assert.equal(ok.d.rule.decision, 'allow');
    assert.equal(exec.filter((e) => e.slug === 'CLICKUP_CREATE_TASK').length, 1);
    const rules = (await s.api('/api/agents/rules', undefined, tok)).d.rules;
    assert.deepEqual(rules.map((r) => r.decision).sort(), ['allow', 'never']);

    // 4. the same kind of action now runs without asking
    const auto = await run('Create a follow-up task', 'CLICKUP_CREATE_TASK', { name: 'Call Asha' });
    assert.match(auto.d.answer, /Done, allowed by the owner's rule/);
    const autoCard = auto.d.approvals[0];
    assert.equal(autoCard.status, 'done'); assert.equal(autoCard.auto, true);
    assert.deepEqual(exec.filter((e) => e.slug === 'CLICKUP_CREATE_TASK').map((e) => e.args.name), ['Call Ravi', 'Call Asha']);

    // 5. never beats allow when both apply; rules show in Chief's instructions
    await s.api('/api/agents/rules', { action: 'create a task in ClickUp', decision: 'never' }, tok);
    const both = await run('Create a follow-up task', 'CLICKUP_CREATE_TASK', { name: 'Call Imran' });
    assert.match(both.d.answer, /never create a task in ClickUp/);
    assert.ok(!exec.some((e) => e.args && e.args.name === 'Call Imran'));

    // 6. question with answer options
    const q = await chat('[[mock:ask_user {"question":"Which day?","options":["Monday","Tuesday"]}]]');
    assert.deepEqual(q.d.question.opts, ['Monday', 'Tuesday']);

    // 7. skills: save, list, load
    const sk = await chat('[[mock:save_skill {"name":"Follow-up note","description":"Short warm follow-up","instructions":"1. Greet by name\\n2. One line\\n3. Sign as the owner"}]]');
    assert.match(sk.d.answer, /Skill "Follow-up note" saved/);
    const skills = (await s.api('/api/agents/skills', undefined, tok)).d.skills;
    assert.equal(skills[0].name, 'Follow-up note');
    const used = await chat('[[mock:use_skill {"name":"follow-up note"}]]');
    assert.match(used.d.answer, /Greet by name/);

    // 8. connect card for an app that is not connected; already-connected apps continue
    const cx = await chat('[[mock:app_connect {"app":"hubspot","reason":"To add the lead to your CRM"}]]');
    assert.deepEqual(cx.d.connect, { id: 'hubspot', slug: 'hubspot', name: 'Hubspot', why: 'To add the lead to your CRM' });
    const already = await chat('[[mock:app_connect {"app":"clickup"}]]');
    assert.equal(already.d.connect, null);
    assert.match(already.d.answer, /already connected/);

    // 9. remove rules
    for (const r of (await s.api('/api/agents/rules', undefined, tok)).d.rules) await s.api('/api/agents/rules/delete', { id: r.id }, tok);
    assert.equal((await s.api('/api/agents/rules', undefined, tok)).d.rules.length, 0);
  } finally { await s.stop(); srv.close(); }
});
