// v2.15.1: X with your own X app (direct, no Composio), pictures always attached (X + LinkedIn), Engagement
// (comments → drafted replies, leads → enquiries, follow-ups, comments on other posts with a daily cap).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.mjs';
import * as EG from '../lib/engage.js';

const PW = 'Tr1ckyHorse#Blue92';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeNetworks() {
  const log = { token: [], media: [], tweets: [], s3: [], exec: [], links: [] };
  let n = 0, mentionsServed = false;
  const accounts = new Map();
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks), u = new URL(req.url, 'http://localhost');
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    const b = () => { try { return JSON.parse(raw.toString() || '{}'); } catch { return {}; } };
    let m;
    // ---- X API ----
    if (u.pathname === '/2/oauth2/token') { log.token.push({ auth: req.headers.authorization || '', body: raw.toString() }); return send(200, { access_token: 'xat', refresh_token: 'xrt', expires_in: 7200, token_type: 'bearer' }); }
    if (u.pathname === '/2/users/me') return req.headers.authorization === 'Bearer xat' ? send(200, { data: { id: '42', username: 'brightsmile', name: 'Bright Smile' } }) : send(401, { title: 'Unauthorized' });
    if (u.pathname === '/2/media/upload') { log.media.push({ size: raw.length, multipart: /multipart\/form-data/.test(req.headers['content-type'] || ''), cat: /tweet_image/.test(raw.toString('latin1')) }); return send(200, { data: { id: 'm' + (++n) } }); }
    if (u.pathname === '/2/tweets') { const j = b(); log.tweets.push(j); return send(201, { data: { id: String(1000 + (++n)), text: j.text } }); }
    if (u.pathname === '/2/users/42/mentions') {
      if (mentionsServed) return send(200, { meta: { result_count: 0 } }); mentionsServed = true;
      return send(200, { data: [{ id: '900', text: '@brightsmile how much for whitening? call me 98765 43210', author_id: '7' }, { id: '901', text: 'Thanks, great post!', author_id: '8' }], includes: { users: [{ id: '7', username: 'ravi', name: 'Ravi Kumar' }, { id: '8', username: 'asha', name: 'Asha' }] } });
    }
    if (u.pathname === '/2/tweets/search/recent') return send(200, { data: [{ id: '800', text: 'Any good dentist in Hyderabad for a root canal?', author_id: '9' }], includes: { users: [{ id: '9', username: 'kiran', name: 'Kiran' }] } });
    // ---- Composio ----
    const p = u.pathname.replace(/^\/api\/v3\.1/, '');
    if (p === '/auth_configs' && req.method === 'GET') return send(200, { items: [] });
    if (p === '/auth_configs' && req.method === 'POST') return send(200, { auth_config: { id: 'ac_' + b().toolkit.slug } });
    if (p === '/connected_accounts/link') { const id = 'ca_' + (++n); accounts.set(id, 1); log.links.push(b()); return send(200, { redirect_url: 'https://connect.example/' + id, connected_account_id: id }); }
    if ((m = p.match(/^\/connected_accounts\/(ca_\d+)$/))) return send(200, { id: m[1], status: 'ACTIVE', state: { val: { email: 'owner@linkedin.example' } } });
    if (p === '/tools/LINKEDIN_CREATE_LINKED_IN_POST') return send(200, { slug: 'LINKEDIN_CREATE_LINKED_IN_POST', toolkit: { slug: 'linkedin' }, input_parameters: { type: 'object', properties: { author: { type: 'string' }, commentary: { type: 'string' }, visibility: { type: 'string' }, lifecycleState: { type: 'string' }, images: { type: 'array', items: { type: 'object', file_uploadable: true } } }, required: ['author', 'commentary'] } });
    if (p === '/files/upload/request') { const j = b(); log.s3.push({ req: j }); return send(200, { key: 'uploads/' + j.md5 + '.jpg', new_presigned_url: 'http://127.0.0.1:' + srv.address().port + '/s3put/' + j.md5 }); }
    if (u.pathname.startsWith('/s3put/')) { log.s3.push({ put: raw.length, type: req.headers['content-type'] }); res.writeHead(200); return res.end(); }
    if ((m = p.match(/^\/tools\/execute\/([A-Z_]+)$/))) {
      const j = b(); log.exec.push({ slug: m[1], args: j.arguments });
      if (m[1] === 'LINKEDIN_GET_MY_INFO') return send(200, { successful: true, data: { response_dict: { author_id: 'AbC123', name: 'Owner' } } });
      if (m[1] === 'LINKEDIN_CREATE_LINKED_IN_POST') return send(200, { successful: true, data: { response_headers: { 'x-restli-id': 'urn:li:share:7001' } } });
      return send(200, { successful: true, data: {} });
    }
    send(404, { error: { message: 'no route ' + u.pathname } });
  });
  return { srv, log };
}

test('X connects with your own X app (no Composio), LinkedIn and X posts carry the picture, comments become replies and leads', async () => {
  const { srv, log } = fakeNetworks();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', SAMPLE_DATA: 'off', X_CLIENT_ID: 'xcid', X_CLIENT_SECRET: 'xsec', X_API_BASE: base, X_AUTH_URL: 'https://x.example/i/oauth2/authorize', COMPOSIO_API_KEY: 'test-composio-key', COMPOSIO_BASE_URL: base + '/api/v3.1', BROWSER_ALLOW_PRIVATE_FOR_TESTS: '1', IMAGE_FALLBACK: 'on' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'mk@example.com', name: 'Owner', password: PW })).d.token;
    const H = { 'content-type': 'application/json', authorization: 'Bearer ' + tok };
    await s.api('/api/clinic/profile', { biz: 'Bright Smile', locations: ['Hyderabad'], services: ['Teeth whitening'], audience: ['Families'], final: true, role: 'marketing' }, tok);
    await s.api('/api/clinic/role', { role: 'marketing' }, tok);
    await s.api('/api/ai/key', { provider: 'openrouter', key: 'sk-or-mock-key-000000000000', model: '' }, tok);

    // 1. X: Connect goes straight to X with PKCE and the scopes for posting pictures and replies
    let r = await fetch(s.base + '/api/connectors/start', { method: 'POST', headers: H, body: JSON.stringify({ c: 'cx:twitter' }) });
    let d = await r.json(); assert.equal(r.status, 200, JSON.stringify(d));
    const au = new URL(d.url);
    assert.equal(au.origin + au.pathname, 'https://x.example/i/oauth2/authorize');
    assert.equal(au.searchParams.get('client_id'), 'xcid');
    assert.equal(au.searchParams.get('code_challenge_method'), 'S256'); assert.ok(au.searchParams.get('code_challenge'));
    assert.match(au.searchParams.get('scope'), /tweet\.write/); assert.match(au.searchParams.get('scope'), /media\.write/); assert.match(au.searchParams.get('scope'), /offline\.access/);
    assert.match(au.searchParams.get('redirect_uri'), /\/api\/connectors\/callback$/);
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    const page = await (await fetch(s.base + '/api/connectors/callback?code=abc&state=' + encodeURIComponent(au.searchParams.get('state')), { headers: { cookie } })).text();
    assert.match(page, /Connected/);
    assert.match(log.token[0].auth, /^Basic /); assert.match(log.token[0].body, /code_verifier=/);
    let list = (await s.api('/api/connectors', undefined, tok)).d;
    assert.equal(list.x.own, true); assert.match(list.x.callback, /\/api\/connectors\/callback$/);
    assert.equal(list.items.find((x) => x.id === 'x').acct, '@brightsmile');

    // 2. LinkedIn through Composio
    r = await fetch(s.base + '/api/connectors/start', { method: 'POST', headers: H, body: JSON.stringify({ c: 'cx:linkedin' }) });
    d = await r.json(); assert.equal(r.status, 200, JSON.stringify(d));
    const ck2 = (r.headers.get('set-cookie') || '').split(';')[0], st2 = new URL(log.links.at(-1).callback_url).searchParams.get('state');
    assert.match(await (await fetch(s.base + '/api/connectors/composio?status=success&state=' + encodeURIComponent(st2), { headers: { cookie: ck2 } })).text(), /Connected/);

    // 3. an approved post goes to LinkedIn and X with its picture (never text-only)
    const dr = await s.api('/api/clinic/social/draft', { topic: 'Diwali whitening offer', platforms: ['LinkedIn', 'X'] }, tok);
    assert.equal(dr.status, 200, JSON.stringify(dr.d));
    assert.equal((await s.api('/api/agents/approval', { id: dr.d.post.approvalId, decision: 'approve' }, tok)).status, 200);
    await s.api('/api/clinic/posts/publish', { id: dr.d.post.id }, tok);
    let post;
    for (let i = 0; i < 80; i++) { post = (await s.api('/api/clinic', undefined, tok)).d.posts.find((p) => p.id === dr.d.post.id); if (post.publish && post.publish.status !== 'publishing') break; await sleep(150); }
    assert.equal(post.publish.status, 'partial', JSON.stringify(post.publish));
    assert.ok(log.media.length >= 1 && log.media[0].multipart && log.media[0].cat && log.media[0].size > 100, 'X got the picture as a file');
    const tw = log.tweets.find((t) => t.media); assert.ok(tw, 'the X post carries the picture');
    // LinkedIn through Composio drops pictures: held, nothing posted (v2.15.2)
    assert.ok(!log.exec.some((x) => x.slug === 'LINKEDIN_CREATE_LINKED_IN_POST'), 'no Composio LinkedIn post with a picture');
    assert.match(post.publish.per.find((x) => /linkedin/i.test(x.network)).line, /Held, not posted/);
    assert.ok(post.publish.links.some((l) => /x\.com\/i\/web\/status\//.test(l)));

    // 4. Engagement: mentions + keyword search → drafted replies; the price question becomes an enquiry with the number
    assert.equal((await s.api('/api/clinic/engage/settings', { keywords: 'dentist Hyderabad, root canal', auto: { thanks: true, leads: false } }, tok)).status, 200);
    const ck = await s.api('/api/clinic/engage/check', {}, tok);
    assert.equal(ck.status, 200, JSON.stringify(ck.d)); assert.equal(ck.d.found, 3);
    let cl = (await s.api('/api/clinic', undefined, tok)).d;
    const items = cl.engage.items;
    const lead = items.find((i) => i.cid === '900'), thanks = items.find((i) => i.cid === '901'), other = items.find((i) => i.cid === '800');
    assert.equal(lead.lead, true); assert.equal(lead.phone, '9876543210'); assert.equal(lead.status, 'pending');
    assert.equal(thanks.status, 'sent', 'thank-you auto-reply was on'); assert.equal(other.kind, 'comment'); assert.equal(other.status, 'pending', 'comments on other posts are never automatic');
    const enq = cl.enquiries.find((e) => e.source === 'Comments');
    assert.ok(enq, 'lead from comments added to Enquiries'); assert.equal(enq.phone, '919876543210'); assert.equal(enq.channel, 'X');
    // owner edits and sends the reply: it goes as a reply in the same X thread
    const sent = await s.api('/api/clinic/engage/send', { id: lead.id, text: 'Hi Ravi, we will call you today with the whitening price.' }, tok);
    assert.equal(sent.status, 200, JSON.stringify(sent.d)); assert.equal(sent.d.ok, true);
    const rep = log.tweets.find((t) => t.reply && t.reply.in_reply_to_tweet_id === '900'); assert.ok(rep); assert.match(rep.text, /whitening price/);
    assert.equal((await s.api('/api/clinic/engage/send', { id: lead.id }, tok)).status, 409, 'never sent twice');
    // comment on another business post (pasted link), then the daily cap
    const cm = await s.api('/api/clinic/engage/comment', { url: 'https://x.com/someclinic/status/12345', text: 'Tips for healthy teeth' }, tok);
    assert.equal(cm.status, 200, JSON.stringify(cm.d)); assert.equal(cm.d.item.kind, 'comment'); assert.equal(cm.d.item.cid, '12345');
    assert.equal((await s.api('/api/clinic/engage/comment', { url: 'https://www.facebook.com/somepage/posts/1' }, tok)).status, 400);
    cl = (await s.api('/api/clinic', undefined, tok)).d;
    assert.equal(cl.engage.networks.x, true); assert.equal(cl.engage.networks.linkedin, true);
    assert.ok(cl.engage.xToday.reads >= 3 && cl.engage.xToday.posts >= 2);
  } finally { await s.stop(); srv.close(); }
});

test('Without your own X app, Connect explains instead of opening X’s error page', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', SAMPLE_DATA: 'off' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'nx@example.com', name: 'Owner', password: PW })).d.token;
    const r = await s.api('/api/connectors/start', { c: 'cx:twitter' }, tok);
    assert.equal(r.status, 409); assert.match(r.d.message, /X_CLIENT_ID and X_CLIENT_SECRET/); assert.match(r.d.message, /Post on X \(free\)/);
    assert.equal((await s.api('/api/connectors', undefined, tok)).d.x.own, false);
  } finally { await s.stop(); }
});

test('lead rules and the follow-up a day later', async () => {
  assert.ok(EG.isLead('How much for braces?')); assert.ok(EG.isLead('pls DM details')); assert.ok(EG.isLead('my number 9876543210'));
  assert.ok(!EG.isLead('Lovely picture')); assert.ok(EG.isThanks('Thank you so much')); assert.ok(!EG.isThanks('thanks, what is the price?'));
  assert.equal(EG.phoneIn('call +91 98765-43210 pls'), '9876543210'); assert.equal(EG.phoneIn('no number'), '');
  // a lead reply sent two days ago, no number yet → one follow-up drafted, only once
  const c = { role: 'marketing', biz: 'Bright', profile: { biz: 'Bright Smile', phone: '9000000001' }, enquiries: [], engage: { items: [{ id: 1, key: 'X:900', network: 'X', kind: 'reply', cid: '900', author: '@ravi', authorName: 'Ravi', text: 'price?', lead: true, phone: '', status: 'sent', sentAt: Date.now() - 2 * 86400e3 }] } };
  const edit = async (fn) => fn(c);
  const st = { get: async () => null, put: async () => {} };
  const r1 = await EG.checkEngagement({ st, email: 'f@example.com', secret: 's', edit, force: true });
  assert.equal(r1.followups, 1);
  const f = c.engage.items.find((i) => i.kind === 'followup'); assert.ok(f); assert.equal(f.cid, '900'); assert.match(f.draft, /just checking in/); assert.equal(f.status, 'pending');
  const r2 = await EG.checkEngagement({ st, email: 'f@example.com', secret: 's', edit, force: true });
  assert.equal(r2.followups, 0, 'one follow-up only');
});
