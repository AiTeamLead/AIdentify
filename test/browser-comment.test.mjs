// Commenting on social posts in the agent's browser: a fake Instagram-like post page with the traps that broke it
// (a hidden <title>New post</title> icon label matched "Post"; a Post button that is disabled until you type).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.mjs';
import { chromiumPath } from './chromium.mjs';

const PW = 'Clinic-pass-123!';
const EXE = chromiumPath();

function fakeInsta() {
  const comments = [];
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST' && u.pathname === '/c') { let b = ''; for await (const c of req) b += c; comments.push(JSON.parse(b)); res.end('{}'); return; }
    res.setHeader('content-type', 'text/html');
    const post = u.pathname.match(/^\/p\/(\w+)\/?$/);
    if (!post) return res.end('<title>Instagram</title><a href="/p/AAA/">x</a>');
    res.end(`<title>Instagram</title>
<nav><a href="/create" aria-label="New post"><svg width="24" height="24"><title>New post</title><rect width="24" height="24"/></svg></a><span style="display:none">Post</span></nav>
<main><article><h2>glow.clinic</h2><p>Post ${post[1]}: my acne routine?</p>
<ul id="list">${comments.filter((c) => c.p === post[1]).map((c) => `<li>${c.t}</li>`).join('')}</ul>
<section><form id="f" onsubmit="return false"><textarea aria-label="Add a comment…" placeholder="Add a comment…" id="t"></textarea>
<div role="button" tabindex="0" id="b" aria-disabled="true" style="opacity:.3">Post</div></form></section></article></main>
<script>
const t=document.getElementById('t'),b=document.getElementById('b');
t.addEventListener('input',()=>{const on=!!t.value.trim();b.setAttribute('aria-disabled',on?'false':'true');b.style.opacity=on?1:.3});
function send(){if(!t.value.trim())return;const v=t.value;fetch('/c',{method:'POST',body:JSON.stringify({p:'${post[1]}',t:v})});const li=document.createElement('li');li.textContent=v;document.getElementById('list').appendChild(li);t.value='';b.setAttribute('aria-disabled','true')}
b.addEventListener('click',()=>{if(b.getAttribute('aria-disabled')!=='true')send()});
t.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
</script>`);
  });
  return { srv, comments };
}

test('browser_comment and click "Post": right button, waits for approval, lands on the right post', { skip: !EXE && 'no Chromium on this machine' }, async () => {
  const { srv, comments } = fakeInsta(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', BROWSER_EXECUTABLE: EXE, BROWSER_ALLOW_PRIVATE_FOR_TESTS: '1', BROWSER_SHOW_MS: '0' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'cm@example.com', name: 'Cm', password: PW })).d.token;
    const chat = (m) => s.api('/api/workplace/chat', { message: m }, tok);
    const approve = async (r) => { const a = (r.d.approvals || [])[0]; assert.ok(a, 'an approval: ' + JSON.stringify(r.d).slice(0, 300)); return (await s.api('/api/agents/approval', { id: a.id, decision: 'approve' }, tok)).d.approval; };
    // 1) one-step comment: waits for approval, then posts on that post
    const r1 = await chat(`[[mock:browser_comment {"url":"${base}/p/AAA/","text":"Gentle cleanser + SPF daily helps a lot. Happy to share more!"}]]`);
    assert.equal(comments.length, 0, 'nothing posted before approval');
    const a1 = await approve(r1);
    assert.equal(a1.status, 'done', a1.result);
    assert.deepEqual(comments, [{ p: 'AAA', t: 'Gentle cleanser + SPF daily helps a lot. Happy to share more!' }]);
    // 2) @reply to a commenter
    const r2 = await chat(`[[mock:browser_comment {"url":"${base}/p/AAA/","text":"DM us for a slot!","reply_to":"@priya.glow"}]]`);
    assert.equal((await approve(r2)).status, 'done');
    assert.equal(comments[1].t, '@priya.glow DM us for a slot!');
    // 3) the old way, type then click "Post" — even after the browser moved to another post before approval
    await chat(`[[mock:browser_open {"url":"${base}/p/BBB/"}]]`);
    await chat('[[mock:browser_type {"into":"Add a comment...","text":"Love this routine!"}]]');
    const r3 = await chat('[[mock:browser_click {"text":"Post"}]]');
    await chat(`[[mock:browser_open {"url":"${base}/p/CCC/"}]]`);
    const a3 = await approve(r3);
    assert.equal(a3.status, 'done', a3.result);
    assert.deepEqual(comments[2], { p: 'BBB', t: 'Love this routine!' });
    assert.equal(comments.length, 3);
    // 4) propose_reply (lead reply) on a social post with no team board: posted directly after approval, as an @reply
    const r4 = await chat(`[[mock:propose_reply {"platform":"instagram","url":"${base}/p/DDD/","to":"@asha.skin","lead":"Asks about toner for oily skin","text":"Try a gentle BHA toner twice a week. DM us for a free skin check!"}]]`);
    assert.equal(comments.length, 3, 'nothing before approval');
    const a4 = await approve(r4);
    assert.equal(a4.status, 'done', a4.result);
    assert.deepEqual(comments[3], { p: 'DDD', t: '@asha.skin Try a gentle BHA toner twice a week. DM us for a free skin check!' });
  } finally { await s.stop(); srv.close(); }
});
