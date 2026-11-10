// Each agent's computer (open-dot style): its own browser with a saved profile, a live screen, owner take-over,
// logins that survive a browser restart, agent steps that wait while the owner drives, and the private-address guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.mjs';
import { chromiumPath } from './chromium.mjs';

const PW = 'Clinic-pass-123!';
const EXE = chromiumPath();

function site() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), who = /(?:^|;\s*)who=([^;]+)/.exec(req.headers.cookie || '');
    res.setHeader('content-type', 'text/html');
    if (u.pathname === '/login' && u.searchParams.get('user')) {
      res.writeHead(302, { 'set-cookie': 'who=' + encodeURIComponent(u.searchParams.get('user')) + '; Max-Age=86400; Path=/', location: '/account' }); return res.end();
    }
    if (u.pathname === '/login') return res.end('<title>Sign in</title><form action="/login"><input name="user" id="u" style="font-size:30px" autofocus><button style="font-size:30px;width:300px;height:80px">Next</button></form>');
    if (u.pathname === '/account') return res.end(`<title>Account</title><h1>${who ? 'Signed in as ' + decodeURIComponent(who[1]) : 'Not signed in'}</h1>`);
    res.end('<title>Home</title><h1>Hello</h1>');
  });
}

test('agent computer: take over, sign in, hand back; sign-in survives a restart', { skip: !EXE && 'no Chromium on this machine' }, async () => {
  const web = site(); await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + web.address().port;
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', BROWSER_EXECUTABLE: EXE, BROWSER_ALLOW_PRIVATE_FOR_TESTS: '1' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'pc@example.com', name: 'Pc', password: PW })).d.token;
    const get = (p) => fetch(s.base + p, { headers: { authorization: 'Bearer ' + tok } });
    assert.deepEqual((await s.api('/api/computer/state?aid=assistant', undefined, tok)).d, { available: true, open: false, control: false, status: 'off', url: '', title: '' });
    assert.equal((await s.api('/api/computer/state?aid=999', undefined, tok)).status, 404);
    // open it: a JPEG of the agent's own browser
    const shot = await get('/api/computer/screen?aid=assistant&start=1');
    assert.equal(shot.headers.get('content-type'), 'image/jpeg');
    assert.ok((await shot.arrayBuffer()).byteLength > 500);
    // input needs take-over first
    assert.equal((await s.api('/api/computer/input', { aid: 'assistant', ev: { type: 'nav', url: base + '/login' } }, tok)).status, 409);
    const on = await s.api('/api/computer/control', { aid: 'assistant', on: true }, tok);
    assert.equal(on.d.control, true); assert.equal(on.d.status, 'owner');
    // while the owner drives, the agent's browser steps wait
    const busy = await s.api('/api/workplace/chat', { message: `[[mock:browser_open {"url":"${base}/"}]]` }, tok);
    assert.match(busy.d.answer, /taken over this browser/);
    // the owner signs in: navigate, click the field, type, press Enter
    let st = await s.api('/api/computer/input', { aid: 'assistant', ev: { type: 'nav', url: base + '/login' } }, tok);
    assert.equal(st.d.url, base + '/login');
    await s.api('/api/computer/input', { aid: 'assistant', ev: { type: 'click', x: 0.05, y: 0.04 } }, tok);
    await s.api('/api/computer/input', { aid: 'assistant', ev: { type: 'type', text: 'asha' } }, tok);
    st = await s.api('/api/computer/input', { aid: 'assistant', ev: { type: 'key', key: 'Enter' } }, tok);
    assert.equal(st.d.url, base + '/account');
    assert.equal((await s.api('/api/computer/input', { aid: 'assistant', ev: { type: 'key', key: 'rm -rf' } }, tok)).status, 400);
    // live view: newest screencast frame as JSON; asking again with its number answers "same"
    const f1 = (await s.api('/api/computer/frame?aid=assistant', undefined, tok)).d;
    assert.equal(f1.open, true); assert.match(f1.img, /^data:image\/jpeg;base64,/); assert.equal(f1.url, base + '/account');
    const f2 = (await s.api('/api/computer/frame?aid=assistant&since=' + f1.n, undefined, tok)).d;
    assert.ok(f2.same || f2.n > f1.n);
    // hand back: the agent can browse again and sees the signed-in page
    assert.equal((await s.api('/api/computer/control', { aid: 'assistant', on: false }, tok)).d.control, false);
    const seen = await s.api('/api/workplace/chat', { message: `[[mock:browser_open {"url":"${base}/account"}]]` }, tok);
    assert.match(seen.d.answer, /Signed in as asha/);
    // close the browser (as after 10 idle minutes); the saved profile keeps the sign-in
    await s.api('/api/computer/close', { aid: 'assistant' }, tok);
    assert.equal((await s.api('/api/computer/state?aid=assistant', undefined, tok)).d.open, false);
    // reopening restores the last page
    await get('/api/computer/screen?aid=assistant&start=1');
    assert.equal((await s.api('/api/computer/state?aid=assistant', undefined, tok)).d.url, base + '/account');
    const again = await s.api('/api/workplace/chat', { message: `[[mock:browser_open {"url":"${base}/account"}]]` }, tok);
    assert.match(again.d.answer, /Signed in as asha/);
    // "open <address>" in chat goes straight to the agent's browser (no AI needed) and asks the page to show the computer
    const opened = await s.api('/api/workplace/chat', { message: 'open ' + base + '/account in browser' }, tok);
    assert.equal(opened.d.computer, true); assert.equal(opened.d.mode, 'browser'); assert.match(opened.d.answer, /in Chief’s computer/);
    assert.equal((await s.api('/api/computer/state?aid=assistant', undefined, tok)).d.url, base + '/account');
    // another account's agent browser is separate
    const tok2 = (await s.api('/api/auth/signup', { email: 'pc2@example.com', name: 'Pc2', password: PW })).d.token;
    const other = await s.api('/api/workplace/chat', { message: `[[mock:browser_open {"url":"${base}/account"}]]` }, tok2);
    assert.match(other.d.answer, /Not signed in/);
  } finally { await s.stop(); web.close(); }
});

test('agent computer refuses private and internal addresses', { skip: !EXE && 'no Chromium on this machine' }, async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', BROWSER_EXECUTABLE: EXE });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'pc3@example.com', name: 'Pc3', password: PW })).d.token;
    await fetch(s.base + '/api/computer/screen?aid=assistant&start=1', { headers: { authorization: 'Bearer ' + tok } });
    await s.api('/api/computer/control', { aid: 'assistant', on: true }, tok);
    for (const url of [s.base + '/api/health', 'http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd', 'localhost:3000']) {
      const r = await s.api('/api/computer/input', { aid: 'assistant', ev: { type: 'nav', url } }, tok);
      assert.equal(r.status, 400, url + ' ' + JSON.stringify(r.d));
    }
    await s.api('/api/computer/close', { aid: 'assistant' }, tok);
  } finally { await s.stop(); }
});
