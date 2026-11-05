// open-dot style connectors through Composio: any app, exact tools (reads now, writes after approval), triggers.
// A fake Composio API (same /api/v3.1 paths and shapes as @composio/client) stands in for the real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.mjs';
import { isReadTool } from '../lib/composio.js';

const PW = 'Clinic-pass-123!';

function fakeComposio() {
  const log = { exec: [], links: [], triggers: new Map(), deleted: [] };
  const accounts = new Map(); let n = 0;
  const TOOLS = {
    CLICKUP_LIST_BOARDS: { slug: 'CLICKUP_LIST_BOARDS', name: 'List boards', description: 'List the user’s boards', toolkit: { slug: 'clickup' }, input_parameters: { properties: { limit: { type: 'integer' } } } },
    CLICKUP_CREATE_CARD: { slug: 'CLICKUP_CREATE_CARD', name: 'Create card', description: 'Create a card on a list', toolkit: { slug: 'clickup' }, input_parameters: { properties: { name: { type: 'string', description: 'Card title' } }, required: ['name'] } },
    GMAIL_SEND_EMAIL: { slug: 'GMAIL_SEND_EMAIL', name: 'Send email', description: 'Send', toolkit: { slug: 'gmail' }, input_parameters: {} },
  };
  const srv = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c; const b = body ? JSON.parse(body) : {};
    const u = new URL(req.url, 'http://x'); const p = u.pathname.replace(/^\/api\/v3\.1/, '');
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.headers['x-api-key'] !== 'test-composio-key') return send(401, { error: { message: 'bad key' } });
    if (p === '/toolkits') return send(200, { items: [{ slug: 'clickup', name: 'Clickup', meta: { logo: 'https://logos.example/clickup.png', description: 'Boards and cards', categories: [{ name: 'Productivity' }] } }, { slug: 'gmail', name: 'Gmail', meta: {} }].filter((t) => !u.searchParams.get('search') || t.slug.includes(u.searchParams.get('search').toLowerCase().slice(0, 3))) });
    if (p === '/auth_configs' && req.method === 'POST') return send(200, { auth_config: { id: 'ac_' + b.toolkit.slug } });
    if (p === '/connected_accounts/link') { const id = 'ca_' + (++n); accounts.set(id, { user_id: b.user_id, status: 'ACTIVE' }); log.links.push(b); return send(200, { redirect_url: 'https://connect.example/' + id, connected_account_id: id }); }
    let m;
    if ((m = p.match(/^\/connected_accounts\/(ca_\d+)$/))) { if (req.method === 'DELETE') { accounts.delete(m[1]); return send(200, {}); } const a = accounts.get(m[1]); return a ? send(200, { id: m[1], user_id: a.user_id, status: a.status, state: { val: { email: 'owner@clickup.example' } } }) : send(404, {}); }
    if (p === '/tools') { const kit = u.searchParams.get('toolkit_slug'); return send(200, { items: Object.values(TOOLS).filter((t) => t.toolkit.slug === kit) }); }
    if ((m = p.match(/^\/tools\/execute\/([A-Z_]+)$/))) { log.exec.push({ slug: m[1], ...b }); return send(200, { successful: true, data: m[1] === 'CLICKUP_LIST_BOARDS' ? { boards: [{ name: 'Leads' }] } : { id: 'card_1' } }); }
    if ((m = p.match(/^\/tools\/([A-Z_]+)$/))) return TOOLS[m[1]] ? send(200, TOOLS[m[1]]) : send(404, { error: { message: 'no tool' } });
    if (p === '/triggers_types') return send(200, { items: [{ slug: 'CLICKUP_NEW_CARD', name: 'New card', description: 'A card was added', config: { properties: { board_id: { type: 'string' } }, required: ['board_id'] } }] });
    if ((m = p.match(/^\/trigger_instances\/([A-Z_]+)\/upsert$/))) { const id = 'ti_' + (++n); log.triggers.set(id, { slug: m[1], ...b }); return send(200, { trigger_id: id }); }
    if ((m = p.match(/^\/trigger_instances\/manage\/(ti_\d+)$/))) { if (req.method === 'DELETE') log.deleted.push(m[1]); return send(200, {}); }
    send(404, { error: { message: 'not found ' + p } });
  });
  return { srv, log };
}

test('read vs write follows open-dot', () => {
  for (const s of ['GMAIL_FETCH_EMAILS', 'CLICKUP_LIST_BOARDS', 'GITHUB_GET_ISSUE', 'SLACK_SEARCH_MESSAGES']) assert.equal(isReadTool(s), true, s);
  for (const s of ['GMAIL_SEND_EMAIL', 'CLICKUP_CREATE_CARD', 'GITHUB_LIST_AND_DELETE_BRANCHES', 'SLACK_POST_MESSAGE']) assert.equal(isReadTool(s), false, s);
});

test('connect any app, run its tools, approve writes, and wake agents with triggers', async () => {
  const { srv, log } = fakeComposio();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', COMPOSIO_API_KEY: 'test-composio-key', COMPOSIO_BASE_URL: 'http://127.0.0.1:' + srv.address().port + '/api/v3.1', APP_URL: 'https://aaas.example' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'cx@example.com', name: 'Cx', password: PW })).d.token;
    const H = { 'content-type': 'application/json', authorization: 'Bearer ' + tok };
    // 1. search the catalogue: named apps map to their own connector, others become cx:<slug>
    const cat = await s.api('/api/connectors/composio/toolkits?q=cli', undefined, tok);
    assert.equal(cat.status, 200, JSON.stringify(cat.d));
    assert.deepEqual(cat.d.items.map((x) => x.id), ['cx:clickup']);
    // 2. connect cx:clickup with the browser-bound, single-use sign-in
    const st = await fetch(s.base + '/api/connectors/start', { method: 'POST', headers: H, body: JSON.stringify({ c: 'cx:clickup' }) });
    const sd = await st.json(); assert.equal(st.status, 200, JSON.stringify(sd));
    assert.match(sd.url, /^https:\/\/connect\.example\/ca_/);
    const cookie = (st.headers.get('set-cookie') || '').split(';')[0];
    const state = new URL(log.links[0].callback_url).searchParams.get('state');
    assert.match(await (await fetch(s.base + '/api/connectors/composio?status=success&state=' + encodeURIComponent(state))).text(), /different browser/);
    const st2 = await fetch(s.base + '/api/connectors/start', { method: 'POST', headers: H, body: JSON.stringify({ c: 'cx:clickup' }) });
    const cookie2 = (st2.headers.get('set-cookie') || '').split(';')[0];
    const state2 = new URL(log.links[1].callback_url).searchParams.get('state');
    assert.match(await (await fetch(s.base + '/api/connectors/composio?status=success&state=' + encodeURIComponent(state2), { headers: { cookie: cookie2 } })).text(), /Connected/);
    void cookie;
    const list = await s.api('/api/connectors', undefined, tok);
    assert.equal(list.d.composio, true);
    const tr = list.d.items.find((x) => x.id === 'cx:clickup'); assert.ok(tr); assert.equal(tr.name, 'Clickup'); assert.equal(tr.via, 'composio');
    const chat = (m) => s.api('/api/workplace/chat', { message: m }, tok);
    // 3. the agent searches the app's real tools
    const found = await chat('[[mock:app_search_tools {"need":"boards and cards"}]]');
    assert.equal(found.status, 200, JSON.stringify(found.d));
    assert.match(found.d.answer, /CLICKUP_LIST_BOARDS \(read, runs now\)/);
    assert.match(found.d.answer, /CLICKUP_CREATE_CARD \(changes the app, needs approval\)/);
    // 4. a read runs now; a write waits for approval
    const ran = await chat('[[mock:app_run_tools {"thought":"Add a follow-up card","tools":[{"tool_slug":"CLICKUP_LIST_BOARDS","arguments":{}},{"tool_slug":"CLICKUP_CREATE_CARD","arguments":{"name":"Call Ravi"}}]}]]');
    assert.match(ran.d.answer, /Leads/);
    assert.deepEqual(log.exec.map((e) => e.slug), ['CLICKUP_LIST_BOARDS']);
    assert.equal(log.exec[0].connected_account_id, 'ca_2');
    const ap = (await s.api('/api/agents/approvals', undefined, tok)).d;
    const pending = (ap.approvals || ap.items || ap).find((a) => a.kind === 'composio' && a.status === 'pending');
    assert.ok(pending, JSON.stringify(ap).slice(0, 400));
    // 5. apps that aren't connected are refused
    await chat('[[mock:app_run_tools {"tools":[{"tool_slug":"GMAIL_SEND_EMAIL","arguments":{"to":"x@y.z"}}]}]]');
    assert.ok(!log.exec.some((e) => e.slug === 'GMAIL_SEND_EMAIL'));
    // 6. approving runs exactly the approved tool and arguments
    const ok = await s.api('/api/agents/approval', { id: pending.id, decision: 'approve' }, tok);
    assert.equal(ok.status, 200, JSON.stringify(ok.d));
    const card = log.exec.find((e) => e.slug === 'CLICKUP_CREATE_CARD');
    assert.deepEqual(card.arguments, { name: 'Call Ravi' });
    assert.equal(card.connected_account_id, 'ca_2');
    assert.match(card.user_id, /^as_[0-9a-f]{32}$/);
    // 7. triggers: created with a secret delivery URL; events queue a run; bad tokens do nothing
    const made = await chat('[[mock:app_create_trigger {"app":"clickup","trigger_slug":"CLICKUP_NEW_CARD","config":{"board_id":"b1"},"instruction":"Draft a welcome note for the new card"}]]');
    assert.match(made.d.answer, /Trigger tg[0-9a-f]+ created/);
    const ti = [...log.triggers.values()][0];
    assert.equal(ti.trigger_config.board_id, 'b1');
    const egress = new URL(ti.egress_url);
    assert.equal(egress.origin, 'https://aaas.example');
    const fire = (t) => fetch(s.base + '/api/connectors/composio/event?t=' + encodeURIComponent(t), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: { card: 'New lead: Asha' } }) }).then((r) => r.json());
    assert.equal((await fire(egress.searchParams.get('t'))).queued, true);
    assert.equal((await fire('x'.repeat(32))).ignored, 'unknown');
    const listed = await chat('[[mock:app_list_triggers {}]]');
    assert.match(listed.d.answer, /New card \(Clickup\) on, fired 1/);
    // 8. disconnecting the app removes its triggers at Composio too
    assert.equal((await s.api('/api/connectors/disconnect', { c: 'cx:clickup' }, tok)).status, 200);
    assert.equal(log.deleted.length, 1);
    assert.equal((await fire(egress.searchParams.get('t'))).ignored, 'unknown');
  } finally { await s.stop(); srv.close(); }
});

test('Apps page: whole catalogue with counts, categories, sort, connected tab and one app’s tools', async () => {
  const { srv, log } = fakeComposio();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', COMPOSIO_API_KEY: 'test-composio-key', COMPOSIO_BASE_URL: 'http://127.0.0.1:' + srv.address().port + '/api/v3.1', APP_URL: 'https://aaas.example', GOOGLE_CLIENT_ID: 'own-id', GOOGLE_CLIENT_SECRET: 'own-secret' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'apps@example.com', name: 'Apps', password: PW })).d.token;
    const all = (await s.api('/api/connectors/apps', undefined, tok)).d;
    assert.equal(all.on, true); assert.equal(all.total, 2); assert.equal(all.connected, 0);
    assert.deepEqual(all.categories, [{ name: 'Productivity', count: 1 }]);
    assert.deepEqual(all.popular.map((a) => a.slug), ['gmail']);
    assert.deepEqual((await s.api('/api/connectors/apps?sort=az', undefined, tok)).d.items.map((a) => a.slug), ['clickup', 'gmail']);
    assert.deepEqual((await s.api('/api/connectors/apps?category=Productivity', undefined, tok)).d.items.map((a) => a.id), ['cx:clickup']);
    assert.deepEqual((await s.api('/api/connectors/apps?q=boards', undefined, tok)).d.items.map((a) => a.slug), ['clickup']);
    const info = (await s.api('/api/connectors/apps/info?slug=clickup', undefined, tok)).d;
    assert.equal(info.id, 'cx:clickup'); assert.equal(info.tools, 2); assert.equal(info.triggers, 1); assert.equal(info.auth, 'managed');
    assert.deepEqual(info.toolList.map((t) => [t.slug, t.read]), [['CLICKUP_LIST_BOARDS', true], ['CLICKUP_CREATE_CARD', false]]);
    assert.equal((await s.api('/api/connectors/apps/info?slug=../x', undefined, tok)).status, 400);
    // a named connector (Gmail) signs in through Composio's managed sign-in even with a Google OAuth app set, as in open-dot
    const st = await fetch(s.base + '/api/connectors/start', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ c: 'gmail' }) });
    const sd = await st.json(); assert.equal(st.status, 200, JSON.stringify(sd)); assert.match(sd.url, /^https:\/\/connect\.example\//);
    // finish it and the app shows as connected
    const cookie = (st.headers.get('set-cookie') || '').split(';')[0];
    const state = new URL(log.links.at(-1).callback_url).searchParams.get('state');
    assert.match(await (await fetch(s.base + '/api/connectors/composio?status=success&state=' + encodeURIComponent(state), { headers: { cookie } })).text(), /Connected/);
    const after = (await s.api('/api/connectors/apps?tab=connected', undefined, tok)).d;
    assert.equal(after.connected, 1); assert.deepEqual(after.items.map((a) => [a.slug, a.connected]), [['gmail', true]]);
  } finally { await s.stop(); srv.close(); }
});
