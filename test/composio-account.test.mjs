// Connectors with no COMPOSIO_API_KEY (as in open-dot): the owner signs in to their own Composio account over OAuth
// (discovery, dynamic client registration, PKCE), apps are connected in that account through Composio's links, and
// agents use Composio's MCP tools: reads run, writes wait for approval. A fake Composio (OAuth + MCP) stands in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer } from './helpers.mjs';
import { parseDirectory, parseAppPage } from '../lib/composio-catalog.js';

const PW = 'Clinic-pass-123!';

function fakeComposio() {
  const log = { calls: [], registered: [], tokens: 0 };
  const connected = new Set(['gmail']);
  const codes = new Map();
  let base = '';
  const tools = () => [
    { name: 'COMPOSIO_SEARCH_TOOLS', description: 'Search tools. You have connected the apps: ' + [...connected].join(', ') + '.', inputSchema: { type: 'object', properties: { queries: { type: 'array', items: { type: 'object', properties: { use_case: { type: 'string' } } } } } } },
    { name: 'COMPOSIO_MANAGE_CONNECTIONS', description: 'Manage connections', inputSchema: { type: 'object', properties: { toolkits: { type: 'array' } } } },
    { name: 'COMPOSIO_MULTI_EXECUTE_TOOL', description: 'Run tools', inputSchema: { type: 'object', properties: { tools: { type: 'array', items: { type: 'object', properties: { tool_slug: { type: 'string' }, arguments: { type: 'object' } } } }, thought: { type: 'string' } }, required: ['tools'] } },
    { name: 'COMPOSIO_REMOTE_BASH_TOOL', description: 'shell', inputSchema: { type: 'object', properties: {} } },
  ];
  const srv = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const u = new URL(req.url, base);
    const json = (code, j, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(j)); };
    if (u.pathname.startsWith('/.well-known/oauth-protected-resource')) return json(200, { resource: base + '/mcp', authorization_servers: [base] });
    if (u.pathname.startsWith('/.well-known/oauth-authorization-server') || u.pathname.startsWith('/.well-known/openid-configuration')) return json(200, {
      issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token', registration_endpoint: base + '/register',
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
    if (u.pathname === '/register' && req.method === 'POST') { const b = JSON.parse(body); log.registered.push(b); return json(201, { ...b, client_id: 'client-' + log.registered.length }); }
    if (u.pathname === '/authorize') { // a real server shows a sign-in page; the test reads this URL instead
      const code = 'code-' + crypto.randomBytes(4).toString('hex');
      codes.set(code, u.searchParams.get('code_challenge'));
      res.writeHead(302, { location: u.searchParams.get('redirect_uri') + '?code=' + code + '&state=' + encodeURIComponent(u.searchParams.get('state') || '') }); return res.end();
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      const p = new URLSearchParams(body);
      if (p.get('grant_type') === 'authorization_code') {
        const ch = codes.get(p.get('code')); codes.delete(p.get('code'));
        if (!ch || crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') !== ch) return json(400, { error: 'invalid_grant' });
      }
      log.tokens++;
      return json(200, { access_token: 'tok-' + log.tokens, token_type: 'Bearer', expires_in: 3600, refresh_token: 'ref' });
    }
    if (u.pathname === '/mcp') {
      if (!/^Bearer tok-/.test(req.headers.authorization || '')) return json(401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
      if (req.method === 'GET') { res.writeHead(405); return res.end(); }
      if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
      const m = JSON.parse(body);
      if (m.id === undefined) { res.writeHead(202); return res.end(); }
      const ok = (result) => json(200, { jsonrpc: '2.0', id: m.id, result }, { 'mcp-session-id': 's1' });
      if (m.method === 'initialize') return ok({ protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-composio', version: '1' } });
      if (m.method === 'tools/list') return ok({ tools: tools() });
      if (m.method === 'tools/call') {
        const { name, arguments: a } = m.params; log.calls.push({ name, a });
        const text = (t) => ok({ content: [{ type: 'text', text: t }] });
        if (name === 'COMPOSIO_MANAGE_CONNECTIONS') {
          const t = a.toolkits[0];
          if (t.action === 'list') return text(JSON.stringify({ results: { [t.name]: { status: connected.has(t.name) ? 'ACTIVE' : 'NONE' } } }));
          if (t.action === 'add') return text(JSON.stringify({ results: { [t.name]: { redirect_url: 'https://connect.example/link/' + t.name } } }));
          if (t.action === 'remove') { connected.delete(t.name); return text('{"ok":true}'); }
        }
        if (name === 'COMPOSIO_MULTI_EXECUTE_TOOL') return text(JSON.stringify({ data: a.tools.map((x) => ({ slug: x.tool_slug, ok: true, files: x.tool_slug.includes('LIST') ? ['Q3 report.pdf'] : undefined })) }));
        return text('{}');
      }
      return json(200, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no method' } });
    }
    json(404, {});
  });
  return { srv, log, connected, setBase: (b) => { base = b; } };
}

test('directory and app pages from composio.dev parse into the catalogue', () => {
  const rec = (slug, name, cats) => ({ id: 1, documentId: 'd' + slug, name, slug, short_description: name + ' does things. More text.', categories: cats.map((c) => ({ name: c })), logo_url: 'https://logos.composio.dev/api/' + slug });
  const payload = JSON.stringify([rec('gmail', 'Gmail', ['Collaboration & Communication']), rec('hubspot', 'Hubspot', ['CRM'])]) + JSON.stringify({ slug: 'hubspot', name: 'x', description: 'y', logo: '', rank: 0 }) + JSON.stringify({ slug: 'gmail', name: 'x', description: 'y', logo: '', rank: 1 });
  const html = '<script>self.__next_f.push([1,' + JSON.stringify(payload) + '])</script>';
  const apps = parseDirectory(html);
  assert.deepEqual(apps.map((a) => [a.slug, a.name, a.categories[0], a.rank]), [['hubspot', 'HubSpot', 'Sales & CRM', 0], ['gmail', 'Gmail', 'Communication', 1]]);
  assert.equal(apps[1].description, 'Gmail does things.');
  const md = '# Gmail\n\n- Tools: 61\n- Triggers: 2\n\n## Description\nEmail by Google.\n\n## Suggested Prompts\n- Find unread emails from my boss\n- Draft a reply\n\n## Authentication\n- **OAuth2** "is_composio_managed": true\n\n## Supported Tools\n| Slug | Name | Description |\n|---|---|---|\n| `GMAIL_SEND_EMAIL` | Send email | Sends an email |\n| `GMAIL_FETCH_EMAILS` | Fetch emails | Lists emails |\n';
  const d = parseAppPage('gmail', md);
  assert.equal(d.tools, 61); assert.equal(d.triggers, 2); assert.equal(d.auth, 'managed'); assert.equal(d.description, 'Email by Google.');
  assert.deepEqual(d.prompts, ['Find unread emails from my boss', 'Draft a reply']);
  assert.deepEqual(d.toolList.map((t) => t.slug), ['GMAIL_SEND_EMAIL', 'GMAIL_FETCH_EMAILS']);
});

test('no key: sign in to Composio, connect apps, agents read now and write after approval', async () => {
  const f = fakeComposio();
  await new Promise((r) => f.srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + f.srv.address().port; f.setBase(base);
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', COMPOSIO_API_KEY: '', COMPOSIO_MCP_URL: base + '/mcp', COMPOSIO_SITE: base, COMPOSIO_CATALOG_COUNTS: 'off' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'cfy@example.com', name: 'Cfy', password: PW })).d.token;
    const H = { 'content-type': 'application/json', authorization: 'Bearer ' + tok };
    assert.deepEqual((await s.api('/api/connectors/account', undefined, tok)).d, { on: true, signedIn: false, connected: [] });
    // connecting before signing in asks for the Composio sign-in
    const early = await s.api('/api/connectors/start', { c: 'slack' }, tok);
    assert.equal(early.status, 409); assert.equal(early.d.error, 'composio_signin');
    // 1. sign in: Composio's authorize URL (registered client, PKCE), bound to this browser
    const si = await fetch(s.base + '/api/connectors/account/signin', { method: 'POST', headers: H, body: '{}' });
    const sd = await si.json(); assert.equal(si.status, 200, JSON.stringify(sd));
    const au = new URL(sd.url);
    assert.equal(au.origin + au.pathname, base + '/authorize');
    assert.equal(au.searchParams.get('code_challenge_method'), 'S256');
    assert.match(au.searchParams.get('redirect_uri'), /^http:\/\/[^/]+\/api\/connectors\/account\/callback$/);
    assert.deepEqual(f.log.registered[0].redirect_uris, [au.searchParams.get('redirect_uri')]);
    const cookie = (si.headers.get('set-cookie') || '').split(';')[0];
    assert.match(cookie, /^as_cn_cfy=/);
    // Composio sends the browser back with a code; another browser (no cookie) is refused
    const back = (await fetch(sd.url, { redirect: 'manual' })).headers.get('location');
    const stolen = await fetch(back);
    assert.match(await stolen.text(), /different browser/);
    const si2 = await fetch(s.base + '/api/connectors/account/signin', { method: 'POST', headers: H, body: '{}' });
    const sd2 = await si2.json(), cookie2 = (si2.headers.get('set-cookie') || '').split(';')[0];
    const back2 = (await fetch(sd2.url, { redirect: 'manual' })).headers.get('location');
    const fin = await fetch(back2, { headers: { cookie: cookie2 } });
    assert.match(await fin.text(), /Connected/);
    // 2. signed in: apps already connected in the Composio account show up
    const acct = (await s.api('/api/connectors/account', undefined, tok)).d;
    assert.equal(acct.signedIn, true); assert.deepEqual(acct.connected, ['gmail']);
    let list = (await s.api('/api/connectors', undefined, tok)).d;
    assert.equal(list.account, true);
    assert.equal(list.items.find((x) => x.id === 'gmail').via, 'composio-account');
    // 3. connect Slack: Composio's link, then the check notices it once it's active
    const st = (await s.api('/api/connectors/start', { c: 'slack' }, tok)).d;
    assert.equal(st.url, 'https://connect.example/link/slack'); assert.equal(st.poll, 'slack');
    assert.equal((await s.api('/api/connectors/account/check?slug=slack', undefined, tok)).d.connected, false);
    f.connected.add('slack');
    assert.deepEqual((await s.api('/api/connectors/account/check?slug=slack', undefined, tok)).d, { connected: true, id: 'slack' });
    assert.equal((await s.api('/api/connectors/start', { c: 'cx:clickup' }, tok)).d.url, 'https://connect.example/link/clickup');
    list = (await s.api('/api/connectors', undefined, tok)).d;
    assert.ok(list.items.some((x) => x.id === 'slack' && x.via === 'composio-account'));
    // 4. agents get Composio's tools: a read runs now…
    const chat = (m) => s.api('/api/workplace/chat', { message: m }, tok);
    const read = await chat('[[mock:COMPOSIO_MULTI_EXECUTE_TOOL {"tools":[{"tool_slug":"GOOGLEDRIVE_LIST_FILES","arguments":{}}]}]]');
    assert.equal(read.status, 200, JSON.stringify(read.d));
    assert.match(read.d.answer, /Q3 report\.pdf/);
    assert.equal(f.log.calls.filter((c) => c.name === 'COMPOSIO_MULTI_EXECUTE_TOOL').length, 1);
    // hidden shell tools are never offered
    await chat('[[mock:COMPOSIO_REMOTE_BASH_TOOL {}]]');
    assert.ok(!f.log.calls.some((c) => c.name === 'COMPOSIO_REMOTE_BASH_TOOL'));
    // …a send waits for approval and runs exactly as approved
    await chat('[[mock:COMPOSIO_MULTI_EXECUTE_TOOL {"thought":"Email Ravi the quote","tools":[{"tool_slug":"GMAIL_SEND_EMAIL","arguments":{"to":"ravi@x.com"}}]}]]');
    assert.equal(f.log.calls.filter((c) => c.name === 'COMPOSIO_MULTI_EXECUTE_TOOL').length, 1);
    const ap = (await s.api('/api/agents/approvals', undefined, tok)).d;
    const pending = (ap.approvals || ap.items || ap).find((a) => a.kind === 'cfy' && a.status === 'pending');
    assert.ok(pending, JSON.stringify(ap).slice(0, 300));
    const ok = await s.api('/api/agents/approval', { id: pending.id, decision: 'approve' }, tok);
    assert.equal(ok.status, 200, JSON.stringify(ok.d));
    const sent = f.log.calls.filter((c) => c.name === 'COMPOSIO_MULTI_EXECUTE_TOOL').at(-1);
    assert.deepEqual(sent.a.tools, [{ tool_slug: 'GMAIL_SEND_EMAIL', arguments: { to: 'ravi@x.com' } }]);
    // 5. disconnect removes it from the Composio account; sign out forgets the tokens and the account's apps
    await s.api('/api/connectors/disconnect', { c: 'slack' }, tok);
    assert.ok(!f.connected.has('slack'));
    await s.api('/api/connectors/account/signout', {}, tok);
    assert.equal((await s.api('/api/connectors/account', undefined, tok)).d.signedIn, false);
    assert.ok(!(await s.api('/api/connectors', undefined, tok)).d.items.some((x) => x.via === 'composio-account'));
  } finally { await s.stop(); f.srv.close(); }
});
