// v2.15.2: LinkedIn pictures through your own LinkedIn app — upload, wait until ready, post with the picture,
// read the post back; a post that lost its picture is deleted and reported. Chief can't attach LinkedIn pictures
// with Composio tools (its LinkedIn post tool drops them while reporting success).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.mjs';
import { liPictureBlock } from '../lib/orchestrator.js';
import { liEscape } from '../lib/social.js';

const PW = 'Tr1ckyHorse#Blue92';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeLinkedIn({ dropPicture = false } = {}) {
  const log = { token: [], init: [], put: [], status: 0, posts: [], deleted: [], versions: [] };
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks), u = new URL(req.url, 'http://localhost');
    const send = (code, j, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(j)); };
    const ver = req.headers['linkedin-version']; if (ver) log.versions.push(ver);
    if (u.pathname.startsWith('/rest/') && ver === '202610') return send(426, { message: 'Requested version 20261000 is not active' }); // newest one not live yet: app tries the next
    if (u.pathname === '/oauth/v2/accessToken') { log.token.push(raw.toString()); return send(200, { access_token: 'liat', expires_in: 5184000 }); }
    if (u.pathname === '/v2/userinfo') return req.headers.authorization === 'Bearer liat' ? send(200, { sub: 'Zx9_ab', name: 'Phani M' }) : send(401, {});
    if (u.pathname === '/rest/images' && u.searchParams.get('action') === 'initializeUpload') { log.init.push(JSON.parse(raw.toString())); return send(200, { value: { uploadUrl: 'http://127.0.0.1:' + srv.address().port + '/upload/abc', image: 'urn:li:image:D4E10AQFeLwyrfi4zcw', uploadUrlExpiresAt: Date.now() + 3600e3 } }); }
    if (u.pathname === '/upload/abc' && req.method === 'PUT') { log.put.push({ size: raw.length, auth: req.headers.authorization, type: req.headers['content-type'] }); res.writeHead(201); return res.end(); }
    if (u.pathname.startsWith('/rest/images/')) { log.status++; return send(200, { id: decodeURIComponent(u.pathname.slice(13)), status: log.status < 2 ? 'PROCESSING' : 'AVAILABLE' }); }
    if (u.pathname === '/rest/posts' && req.method === 'POST') { const j = JSON.parse(raw.toString()); log.posts.push(j); return send(201, {}, { 'x-restli-id': 'urn:li:share:' + (7000 + log.posts.length) }); }
    if (u.pathname.startsWith('/rest/posts/') && req.method === 'GET') { const p = log.posts.at(-1); return send(200, { id: decodeURIComponent(u.pathname.slice(12)), commentary: p.commentary, content: dropPicture ? {} : p.content }); }
    if (u.pathname.startsWith('/rest/posts/') && req.method === 'DELETE') { log.deleted.push(decodeURIComponent(u.pathname.slice(12))); res.writeHead(204); return res.end(); }
    send(404, { message: 'no route ' + u.pathname });
  });
  return { srv, log };
}

async function run(dropPicture) {
  const { srv, log } = fakeLinkedIn({ dropPicture });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', SAMPLE_DATA: 'off', LINKEDIN_CLIENT_ID: 'licid', LINKEDIN_CLIENT_SECRET: 'lisec', LINKEDIN_AUTH_URL: 'https://li.example/oauth/v2/authorization', LINKEDIN_TOKEN_URL: base + '/oauth/v2/accessToken', LINKEDIN_API_BASE: base, LINKEDIN_POLL_MS: '50', IMAGE_FALLBACK: 'on' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'li' + (dropPicture ? 2 : 1) + '@example.com', name: 'Owner', password: PW })).d.token;
    const H = { 'content-type': 'application/json', authorization: 'Bearer ' + tok };
    await s.api('/api/clinic/profile', { biz: 'Bright Smile', locations: ['Hyderabad'], services: ['Teeth whitening'], audience: ['Families'], final: true, role: 'marketing' }, tok);
    await s.api('/api/clinic/role', { role: 'marketing' }, tok);
    await s.api('/api/ai/key', { provider: 'openrouter', key: 'sk-or-mock-key-000000000000', model: '' }, tok);
    // Connect LinkedIn: the LinkedIn card goes straight to LinkedIn with your app
    const r = await fetch(s.base + '/api/connectors/start', { method: 'POST', headers: H, body: JSON.stringify({ c: 'cx:linkedin' }) });
    const d = await r.json(); assert.equal(r.status, 200, JSON.stringify(d));
    const au = new URL(d.url);
    assert.equal(au.origin + au.pathname, 'https://li.example/oauth/v2/authorization');
    assert.equal(au.searchParams.get('client_id'), 'licid'); assert.match(au.searchParams.get('scope'), /w_member_social/); assert.match(au.searchParams.get('scope'), /openid/);
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    assert.match(await (await fetch(s.base + '/api/connectors/callback?code=abc&state=' + encodeURIComponent(au.searchParams.get('state')), { headers: { cookie } })).text(), /Connected/);
    assert.match(log.token[0], /client_secret=lisec/);
    const list = (await s.api('/api/connectors', undefined, tok)).d;
    assert.equal(list.li.own, true); assert.equal(list.items.find((x) => x.id === 'li').acct, 'Phani M');
    // approve a LinkedIn post (picture made for it) and publish
    const dr = await s.api('/api/clinic/social/draft', { topic: 'Diwali (festival) offer #Diwali', platforms: ['LinkedIn'] }, tok);
    assert.equal(dr.status, 200, JSON.stringify(dr.d));
    assert.equal((await s.api('/api/agents/approval', { id: dr.d.post.approvalId, decision: 'approve' }, tok)).status, 200);
    await s.api('/api/clinic/posts/publish', { id: dr.d.post.id }, tok);
    let post;
    for (let i = 0; i < 80; i++) { post = (await s.api('/api/clinic', undefined, tok)).d.posts.find((p) => p.id === dr.d.post.id); if (post.publish && post.publish.status !== 'publishing') break; await sleep(150); }
    return { post, log };
  } finally { await s.stop(); srv.close(); }
}

test('LinkedIn post goes out WITH the picture: upload → ready → post with media → read back', async () => {
  const { post, log } = await run(false);
  assert.equal(post.publish.status, 'published', JSON.stringify(post.publish));
  assert.equal(log.init[0].initializeUploadRequest.owner, 'urn:li:person:Zx9_ab');
  assert.ok(log.put[0].size > 100 && log.put[0].auth === 'Bearer liat', 'picture bytes uploaded to LinkedIn');
  assert.ok(log.status >= 2, 'waited until LinkedIn said AVAILABLE');
  const p = log.posts[0];
  assert.equal(p.author, 'urn:li:person:Zx9_ab'); assert.equal(p.lifecycleState, 'PUBLISHED'); assert.equal(p.visibility, 'PUBLIC');
  assert.equal(p.content.media.id, 'urn:li:image:D4E10AQFeLwyrfi4zcw', 'the uploaded picture is attached to the post');
  assert.ok(!/[^\\]\(/.test(p.commentary), 'brackets escaped so LinkedIn does not cut the text');
  assert.ok(log.versions.includes('202610') && log.versions.some((v) => v !== '202610'), 'retired/unknown API version skipped');
  assert.equal(log.deleted.length, 0);
  assert.ok(post.publish.links.some((l) => l === 'https://www.linkedin.com/feed/update/urn:li:share:7001/'));
});

test('If LinkedIn drops the picture, that post is deleted at once and reported — never left text-only', async () => {
  const { post, log } = await run(true);
  assert.equal(post.publish.status, 'failed', JSON.stringify(post.publish));
  assert.deepEqual(log.deleted, ['urn:li:share:7001']);
  assert.match(post.publish.per[0].line, /without the picture, so that post was deleted/);
});

test('Chief cannot attach LinkedIn pictures with Composio tools; hashtags stay clickable', () => {
  assert.match(liPictureBlock([{ tool_slug: 'LINKEDIN_INITIALIZE_IMAGE_UPLOAD', arguments: {} }]), /never made with Composio tools/);
  assert.match(liPictureBlock([{ tool_slug: 'LINKEDIN_CREATE_LINKED_IN_POST', arguments: { commentary: 'x', images: ['urn:li:image:1'] } }]), /publish_social_post/);
  assert.match(liPictureBlock([{ tool_slug: 'LINKEDIN_CREATE_LINKED_IN_POST', arguments: { commentary: 'text only' } }]), /publish_social_post/);
  assert.equal(liPictureBlock([{ tool_slug: 'LINKEDIN_GET_MY_INFO', arguments: {} }]), '');
  assert.equal(liEscape('Offer (today) #Diwali'), 'Offer \\(today\\) {hashtag|\\#|Diwali}');
});
