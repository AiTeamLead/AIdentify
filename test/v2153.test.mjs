// v2.15.3: LinkedIn text + picture through your Composio LinkedIn connection. The app uses LinkedIn's own steps over
// Composio's proxy (Composio's post tool, which drops pictures, is never used): picture uploaded and checked AVAILABLE,
// post created with the picture, read back; a post without its picture is deleted; if the picture can't get there,
// the post is held — never text-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.mjs';

const PW = 'Tr1ckyHorse#Blue92';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOOL_URN = 'urn:li:image:FromComposioTool', OWN_URN = 'urn:li:image:D4E10AQFeLwyrfi4zcw';

function fakeComposioLinkedIn({ uploadNeedsAuth = false, dropPicture = false } = {}) {
  const log = { exec: [], proxy: [], put: [], s3: [], posts: [], deleted: [] };
  let n = 0;
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks), u = new URL(req.url, 'http://x');
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    const b = () => { try { return JSON.parse(raw.toString() || '{}'); } catch { return {}; } };
    let m;
    if (u.pathname === '/upload/own' && req.method === 'PUT') { log.put.push({ size: raw.length, auth: req.headers.authorization || '' }); if (uploadNeedsAuth && !req.headers.authorization) { res.writeHead(401); return res.end(); } res.writeHead(201); return res.end(); }
    if (u.pathname.startsWith('/s3put/')) { log.s3.push(raw.length); res.writeHead(200); return res.end(); }
    const p = u.pathname.replace(/^\/api\/v3\.1/, '');
    if (p === '/auth_configs' && req.method === 'GET') return send(200, { items: [] });
    if (p === '/auth_configs' && req.method === 'POST') return send(200, { auth_config: { id: 'ac_' + b().toolkit.slug } });
    if (p === '/connected_accounts/link') { const id = 'ca_' + (++n); log.link = b(); return send(200, { redirect_url: 'https://connect.example/' + id, connected_account_id: id }); }
    if ((m = p.match(/^\/connected_accounts\/(ca_\d+)$/))) return send(200, { id: m[1], status: 'ACTIVE', state: { val: {} } });
    if (p === '/tools/LINKEDIN_INITIALIZE_IMAGE_UPLOAD') return send(200, { slug: 'LINKEDIN_INITIALIZE_IMAGE_UPLOAD', toolkit: { slug: 'linkedin' }, input_parameters: { type: 'object', properties: { owner: { type: 'string' }, image: { type: 'object', file_uploadable: true } } } });
    if (p.startsWith('/tools/') && req.method === 'GET') return send(404, { error: { message: 'Tool not found' } });
    if (p === '/files/upload/request') return send(200, { key: 'k/' + b().md5, new_presigned_url: 'http://127.0.0.1:' + srv.address().port + '/s3put/x' });
    if ((m = p.match(/^\/tools\/execute\/([A-Z_]+)$/))) {
      log.exec.push({ slug: m[1], args: b().arguments });
      // Composio's tool returns an image URN, but the bytes never reach LinkedIn (what happened on 19 Nov)
      if (m[1] === 'LINKEDIN_INITIALIZE_IMAGE_UPLOAD') return send(200, { successful: true, data: { value: { image: TOOL_URN } } });
      return send(200, { successful: true, data: {} });
    }
    if (p === '/tools/execute/proxy') {
      const j = b(), ep = new URL(j.endpoint), hd = Object.fromEntries((j.parameters || []).map((x) => [x.name, x.value]));
      log.proxy.push({ method: j.method, path: ep.pathname + ep.search, body: j.body, ca: j.connected_account_id, ver: hd['LinkedIn-Version'] });
      const out = (status, data, headers = {}) => send(200, { status, data, headers });
      if (ep.origin !== 'https://api.linkedin.com') return out(404, { message: 'wrong host' });
      if (ep.pathname === '/v2/userinfo') return out(200, { sub: 'Zx9_ab', name: 'Phani M' });
      if (ep.pathname === '/rest/images' && ep.searchParams.get('action') === 'initializeUpload') return out(200, { value: { uploadUrl: 'http://127.0.0.1:' + srv.address().port + '/upload/own', image: OWN_URN } });
      if (ep.pathname.startsWith('/rest/images/')) { const urn = decodeURIComponent(ep.pathname.slice(13)); return out(200, { id: urn, status: urn === OWN_URN && log.put.some((x) => !uploadNeedsAuth || x.auth) ? 'AVAILABLE' : 'WAITING_UPLOAD' }); }
      if (ep.pathname === '/rest/posts' && j.method === 'POST') { log.posts.push(j.body); return out(201, {}, { 'X-RestLi-Id': 'urn:li:share:' + (7000 + log.posts.length) }); }
      if (ep.pathname.startsWith('/rest/posts/') && j.method === 'GET') { const last = log.posts.at(-1); return out(200, { commentary: last.commentary, content: dropPicture ? {} : last.content }); }
      if (ep.pathname.startsWith('/rest/posts/') && j.method === 'DELETE') { log.deleted.push(decodeURIComponent(ep.pathname.slice(12))); return out(204, {}); }
      return out(404, { message: 'no route' });
    }
    send(404, { error: { message: 'no route ' + u.pathname } });
  });
  return { srv, log };
}

async function run(opts) {
  const { srv, log } = fakeComposioLinkedIn(opts);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', SAMPLE_DATA: 'off', COMPOSIO_API_KEY: 'test-composio-key', COMPOSIO_BASE_URL: base + '/api/v3.1', LINKEDIN_POLL_MS: '30', LINKEDIN_WAIT_MS: '400', IMAGE_FALLBACK: 'on' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'cxli' + Math.random().toString(36).slice(2, 7) + '@example.com', name: 'Owner', password: PW })).d.token;
    const H = { 'content-type': 'application/json', authorization: 'Bearer ' + tok };
    await s.api('/api/clinic/profile', { biz: 'Bright Smile', locations: ['Hyderabad'], services: ['Teeth whitening'], audience: ['Families'], final: true, role: 'marketing' }, tok);
    await s.api('/api/clinic/role', { role: 'marketing' }, tok);
    await s.api('/api/ai/key', { provider: 'openrouter', key: 'sk-or-mock-key-000000000000', model: '' }, tok);
    // LinkedIn through Composio (no LinkedIn app keys)
    const r = await fetch(s.base + '/api/connectors/start', { method: 'POST', headers: H, body: JSON.stringify({ c: 'cx:linkedin' }) });
    const d = await r.json(); assert.equal(r.status, 200, JSON.stringify(d)); assert.match(d.url, /^https:\/\/connect\.example\//);
    const ck = (r.headers.get('set-cookie') || '').split(';')[0], state = new URL(log.link.callback_url).searchParams.get('state');
    assert.match(await (await fetch(s.base + '/api/connectors/composio?status=success&state=' + encodeURIComponent(state), { headers: { cookie: ck } })).text(), /Connected/);
    const dr = await s.api('/api/clinic/social/draft', { topic: 'Diwali whitening offer', platforms: ['LinkedIn'] }, tok);
    assert.equal(dr.status, 200, JSON.stringify(dr.d));
    assert.equal((await s.api('/api/agents/approval', { id: dr.d.post.approvalId, decision: 'approve' }, tok)).status, 200);
    await s.api('/api/clinic/posts/publish', { id: dr.d.post.id }, tok);
    let post;
    for (let i = 0; i < 100; i++) { post = (await s.api('/api/clinic', undefined, tok)).d.posts.find((p) => p.id === dr.d.post.id); if (post.publish && post.publish.status !== 'publishing') break; await sleep(150); }
    return { post, log };
  } finally { await s.stop(); srv.close(); }
}

test('Through Composio: picture that never reached LinkedIn is not used; LinkedIn upload slot → AVAILABLE → post with picture → read back', async () => {
  const { post, log } = await run({});
  assert.equal(post.publish.status, 'published', JSON.stringify(post.publish));
  assert.ok(!log.exec.some((x) => x.slug === 'LINKEDIN_CREATE_LINKED_IN_POST'), "Composio's post tool (drops pictures) is never used");
  assert.ok(log.exec.some((x) => x.slug === 'LINKEDIN_INITIALIZE_IMAGE_UPLOAD' && x.args.image && x.args.image.s3key), 'Composio upload tool got the real file');
  assert.ok(log.proxy.some((x) => x.path.startsWith('/rest/images/') && decodeURIComponent(x.path).includes(TOOL_URN)), 'its picture was checked');
  assert.ok(log.put.length === 1 && log.put[0].size > 100, 'picture bytes sent to LinkedIn');
  assert.equal(log.posts.length, 1);
  const p = log.posts[0];
  assert.equal(p.content.media.id, OWN_URN, 'the post carries the picture LinkedIn confirmed AVAILABLE');
  assert.equal(p.author, 'urn:li:person:Zx9_ab'); assert.equal(p.lifecycleState, 'PUBLISHED');
  assert.ok(log.proxy.every((x) => x.ca && (x.ver || !x.path.startsWith('/rest/'))), 'every LinkedIn call goes through your Composio connection, /rest calls with an API version');
  assert.ok(log.proxy.some((x) => x.method === 'GET' && x.path.startsWith('/rest/posts/')), 'post read back');
  assert.ok(post.publish.links.includes('https://www.linkedin.com/feed/update/urn:li:share:7001/'));
});

test('Through Composio: if the picture cannot reach LinkedIn, the post is held — nothing published', async () => {
  const { post, log } = await run({ uploadNeedsAuth: true });
  assert.equal(post.publish.status, 'failed', JSON.stringify(post.publish));
  assert.equal(log.posts.length, 0, 'no text-only post');
  assert.match(post.publish.per[0].line, /Held, not posted/);
  assert.match(post.publish.per[0].line, /own sign-in/);
});

test('Through Composio: LinkedIn drops the picture → that post is deleted and reported', async () => {
  const { post, log } = await run({ dropPicture: true });
  assert.equal(post.publish.status, 'failed', JSON.stringify(post.publish));
  assert.deepEqual(log.deleted, ['urn:li:share:7001']);
  assert.match(post.publish.per[0].line, /deleted straight away/);
});
