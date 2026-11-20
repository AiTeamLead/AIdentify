// v2.15.4: (1) Chief's posts no longer loop — publish_social_post queues ONE post with its picture and ONE approval,
// approving it publishes with that same picture, a repeat returns the existing post; approved drafts publish whatever
// their wording. (2) X through the app's browser: sign in once, then approved posts go out with text + picture, the
// link is captured and the picture checked (post deleted if missing).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { startServer } from './helpers.mjs';
import { queueSocialPost, clinicAfterDecision } from '../lib/clinic.js';

const PW = 'Tr1ckyHorse#Blue92';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXE = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', process.env.BROWSER_EXECUTABLE].find((p) => p && fs.existsSync(p));

function memStore() { const m = new Map(); return { m, get: async (k) => (m.has(k) ? { v: m.get(k) } : null), put: async (k, v) => { m.set(k, v); } }; }
const lock = async (_e, fn) => fn();

test('Chief: one post + one approval with the picture; approve → publishing now with THAT picture; no loop', async () => {
  const st = memStore(), email = 'loop@example.com';
  st.m.set('as_clinic:' + email, JSON.stringify({ role: 'marketing', biz: 'Bright', posts: [], drafts: [], patients: [], appointments: [], enquiries: [], invoices: [] }));
  const pic = '/api/media/18b1708a31de4981da3c0fd61dd96db2.jpg';
  const r1 = await queueSocialPost(st, email, { text: 'Diwali offer: 20% off whitening this week!\nImage attached by the user: ' + pic, platforms: ['LinkedIn'], image: pic }, lock);
  assert.ok(r1.approval && r1.post); assert.equal(r1.post.image, pic); assert.equal(r1.post.status, 'draft');
  assert.doesNotMatch(r1.post.text, /Image attached|api\/media/, 'picture travels separately, not in the text');
  const r2 = await queueSocialPost(st, email, { text: 'Diwali offer: 20% off whitening this week!', platforms: ['LinkedIn'], image: pic }, lock);
  assert.equal(r2.existing, true, 'same post again → the existing one, no second approval');
  const appr = JSON.parse(st.m.get('as_appr:' + email)); assert.equal(appr.length, 1);
  const note = await clinicAfterDecision(st, email, { ...appr[0], status: 'done' }, lock);
  assert.match(note, /Publishing now on LinkedIn/);
  const c = JSON.parse(st.m.get('as_clinic:' + email)), p = c.posts[0];
  assert.equal(p.image, pic, 'the same picture is published (no new image)'); assert.equal(p.status, 'scheduled'); assert.ok(p.publish);
  await assert.rejects(queueSocialPost(st, email, { text: 'x', platforms: ['LinkedIn'] }, lock), /post text/);
  await assert.rejects(queueSocialPost(st, email, { text: 'A real post', platforms: [] }, lock), /which networks/);
});

test('An approved Chief draft publishes whatever its wording, with its picture', async () => {
  const st = memStore(), email = 'word@example.com';
  st.m.set('as_clinic:' + email, JSON.stringify({ role: 'marketing', biz: 'Bright', posts: [], drafts: [], patients: [], appointments: [], enquiries: [], invoices: [] }));
  const note = await clinicAfterDecision(st, email, { id: 'a1', status: 'done', kind: 'draft', app: 'linkedin', summary: 'Publish the Diwali offer', request: 'Diwali offer for families!\nImage attached by the user: https://example.com/p/diwali.jpg' }, lock);
  assert.match(note, /Publishing now on LinkedIn/);
  const p = JSON.parse(st.m.get('as_clinic:' + email)).posts[0];
  assert.deepEqual(p.platforms, ['LinkedIn']); assert.equal(p.image, 'https://example.com/p/diwali.jpg'); assert.equal(p.text, 'Diwali offer for families!');
});

function xSite({ dropPicture = false } = {}) {
  const log = { created: [], deleted: [] };
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks), u = new URL(req.url, 'http://x'), signed = /(?:^|;\s*)xauth=1/.test(req.headers.cookie || '');
    const html = (b) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8">' + b); };
    const go = (to, h = {}) => { res.writeHead(302, { location: to, ...h }); res.end(); };
    if (u.pathname === '/login') return html('<title>Log in to X</title><a href="/dologin">Log in</a>');
    if (u.pathname === '/dologin') return go('/home', { 'set-cookie': 'xauth=1; Path=/; Max-Age=86400' });
    if (u.pathname === '/i/flow/login') return html('<title>Sign in</title><h1>Sign in to X</h1>');
    if (u.pathname === '/home') return signed ? html('<title>Home / X</title><a data-testid="AppTabBar_Profile_Link" href="/brightsmile">Profile</a>') : go('/i/flow/login');
    if (u.pathname === '/compose/post') {
      if (!signed) return go('/i/flow/login');
      return html(`<title>Post / X</title><div data-testid="tweetTextarea_0" contenteditable="true" role="textbox" style="min-height:60px;border:1px solid #999"></div>
        <input type="file" data-testid="fileInput" accept="image/*" style="display:none"><div data-testid="attachments"></div>
        <button data-testid="tweetButton" disabled>Post</button><div id="toastArea"></div>
        <script>const box=document.querySelector('[data-testid=tweetTextarea_0]'),btn=document.querySelector('[data-testid=tweetButton]'),file=document.querySelector('[data-testid=fileInput]');
        box.addEventListener('input',()=>{btn.disabled=!box.innerText.trim()});
        file.addEventListener('change',()=>{const f=file.files[0];document.querySelector('[data-testid=attachments]').innerHTML='<img src="'+URL.createObjectURL(f)+'">'});
        btn.addEventListener('click',async()=>{const fd=new FormData();fd.append('text',box.innerText);if(file.files[0])fd.append('media',file.files[0]);const r=await fetch('/create',{method:'POST',body:fd});const j=await r.json();
        document.getElementById('toastArea').innerHTML='<div data-testid="toast">Your post was sent. <a href="/brightsmile/status/'+j.id+'">View</a></div>'});</script>`);
    }
    if (u.pathname === '/create' && req.method === 'POST') {
      const body = raw.toString('latin1'), text = (body.match(/name="text"\r\n\r\n([\s\S]*?)\r\n--/) || [])[1] || '';
      const id = String(555 + log.created.length); log.created.push({ id, text, size: raw.length, hasImage: /name="media"/.test(body) && !dropPicture });
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id }));
    }
    let m;
    if ((m = u.pathname.match(/^\/brightsmile\/status\/(\d+)$/))) {
      const p = log.created.find((x) => x.id === m[1]); if (!p) return html('<h1>Not found</h1>');
      return html(`<article><div>${p.text.replace(/</g, '&lt;')}</div>${p.hasImage ? '<div data-testid="tweetPhoto"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>' : ''}<button data-testid="caret">…</button></article>
        <div id="menu" style="display:none"><div role="menuitem" onclick="document.getElementById('conf').style.display='block'">Delete</div></div>
        <button id="conf" data-testid="confirmationSheetConfirm" style="display:none" onclick="fetch('/delete/${p.id}',{method:'POST'})">Delete</button>
        <script>document.querySelector('[data-testid=caret]').onclick=()=>{document.getElementById('menu').style.display='block'}</script>`);
    }
    if ((m = u.pathname.match(/^\/delete\/(\d+)$/))) { log.deleted.push(m[1]); res.writeHead(200); return res.end('{}'); }
    html('<title>X</title>');
  });
  return { srv, log };
}

async function xRun(opts) {
  const { srv, log } = xSite(opts);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', SAMPLE_DATA: 'off', BROWSER_EXECUTABLE: EXE, BROWSER_ALLOW_PRIVATE_FOR_TESTS: '1', X_WEB_BASE: base, X_BROWSER_GAP_MS: '0', IMAGE_FALLBACK: 'on' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'xb' + Math.random().toString(36).slice(2, 7) + '@example.com', name: 'Owner', password: PW })).d.token;
    await s.api('/api/clinic/profile', { biz: 'Bright Smile', locations: ['Hyderabad'], services: ['Teeth whitening'], audience: ['Families'], final: true, role: 'marketing' }, tok);
    await s.api('/api/clinic/role', { role: 'marketing' }, tok);
    await s.api('/api/ai/key', { provider: 'openrouter', key: 'sk-or-mock-key-000000000000', model: '' }, tok);
    // not signed in yet: X shows its sign-in flow
    let r = await s.api('/api/clinic/xbrowser/check', {}, tok); assert.equal(r.status, 200, JSON.stringify(r.d)); assert.equal(r.d.state.signedIn, false);
    // the owner opens the app's browser on X's sign-in and signs in there (live view)
    r = await s.api('/api/clinic/xbrowser/open', {}, tok); assert.equal(r.status, 200, JSON.stringify(r.d));
    const st0 = (await s.api('/api/computer/state?aid=assistant', undefined, tok)).d; assert.equal(st0.control, true); assert.match(st0.url, /\/login$/);
    r = await s.api('/api/computer/input', { aid: 'assistant', ev: { type: 'nav', url: base + '/dologin' } }, tok); assert.equal(r.status, 200, JSON.stringify(r.d));
    r = await s.api('/api/clinic/xbrowser/done', {}, tok); assert.equal(r.status, 200, JSON.stringify(r.d));
    assert.equal(r.d.state.signedIn, true); assert.equal(r.d.state.handle, '@brightsmile');
    const cl = (await s.api('/api/clinic', undefined, tok)).d; assert.equal(cl.xBrowser.signedIn, true);
    // approve an X post → it goes out through the app's browser with its picture
    const dr = await s.api('/api/clinic/social/draft', { topic: 'Diwali whitening offer', platforms: ['X'] }, tok);
    assert.equal((await s.api('/api/agents/approval', { id: dr.d.post.approvalId, decision: 'approve' }, tok)).status, 200);
    await s.api('/api/clinic/posts/publish', { id: dr.d.post.id }, tok);
    let post;
    for (let i = 0; i < 200; i++) { post = (await s.api('/api/clinic', undefined, tok)).d.posts.find((p) => p.id === dr.d.post.id); if (post.publish && post.publish.status !== 'publishing') break; await sleep(150); }
    return { post, log, s, tok };
  } finally { await s.stop(); srv.close(); }
}

test('X through the app’s browser: sign in once, approved post goes out with text + picture, link captured', { skip: !EXE && 'no Chromium on this machine' }, async () => {
  const { post, log } = await xRun({});
  assert.equal(post.publish.status, 'published', JSON.stringify(post.publish));
  assert.equal(log.created.length, 1); assert.ok(log.created[0].hasImage, 'picture attached'); assert.ok(log.created[0].text.length > 5, 'text typed');
  assert.ok(post.publish.links.includes('https://x.com/brightsmile/status/555'), JSON.stringify(post.publish.links));
  assert.match(post.publish.per[0].line, /through the app's browser/);
  assert.equal(log.deleted.length, 0);
});

test('X through the app’s browser: picture missing on the live post → deleted at once and reported', { skip: !EXE && 'no Chromium on this machine' }, async () => {
  const { post, log } = await xRun({ dropPicture: true });
  assert.equal(post.publish.status, 'failed', JSON.stringify(post.publish));
  assert.deepEqual(log.deleted, ['555']);
  assert.match(post.publish.per[0].line, /without the picture, so that post was deleted/);
});
