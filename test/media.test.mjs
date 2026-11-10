// Images for social posts: agents make them (create_image), owners attach them, AaaS serves them publicly by an
// unguessable name, and the agent's browser can upload them into a page's file picker (e.g. Instagram's new post).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.mjs';
import { chromiumPath } from './chromium.mjs';

const PW = 'Clinic-pass-123!';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const EXE = chromiumPath();

test('create_image, attached images, public media links, and uploading into a page in the agent’s browser', { skip: !EXE && 'no Chromium on this machine' }, async () => {
  const web = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<title>New post</title><h1>Create new post</h1><input type="file" id="f" accept="image/*"><p id="o">nothing yet</p><script>f.onchange=()=>{const x=f.files[0];o.textContent="selected "+x.type+" "+x.size+" bytes";document.title="Got "+x.type}</script>');
  });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + web.address().port;
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', BROWSER_EXECUTABLE: EXE, BROWSER_ALLOW_PRIVATE_FOR_TESTS: '1', BROWSER_START_URL: 'blank' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'img@example.com', name: 'Img', password: PW })).d.token;
    // the agent makes an image: shown in chat, served publicly, handed back as a link
    const made = await s.api('/api/workplace/chat', { message: '[[mock:create_image {"prompt":"Diwali diya poster for a real estate office","size":"square"}]]' }, tok);
    assert.equal(made.status, 200, JSON.stringify(made.d));
    const step = (made.d.steps || []).find((x) => x.k === 'image');
    assert.ok(step && /^\/api\/media\/[a-f0-9]{32}\.png$/.test(step.shot), JSON.stringify(made.d.steps));
    const img = await fetch(s.base + step.shot);
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(s.base + '/api/media/' + 'f'.repeat(32) + '.png')).status, 404);
    // the owner attaches an image in chat
    assert.equal((await s.api('/api/media/upload', { name: 'a.png', type: 'image/png', data: PNG })).status, 401);
    assert.equal((await s.api('/api/media/upload', { name: 'a.svg', type: 'image/svg+xml', data: PNG }, tok)).status, 400);
    const up = await s.api('/api/media/upload', { name: 'diwali.png', type: 'image/png', data: PNG }, tok);
    assert.equal(up.status, 200); assert.match(up.d.path, /^\/api\/media\/[a-f0-9]{32}\.png$/); assert.ok(up.d.url.endsWith(up.d.path));
    // the agent opens a "new post" page and puts the image into its file picker
    await s.api('/api/workplace/chat', { message: `[[mock:browser_open {"url":"${base}/new"}]]` }, tok);
    const r = await s.api('/api/workplace/chat', { message: `[[mock:browser_upload {"image":"${up.d.path}"}]]` }, tok);
    assert.match(r.d.answer, /selected image\/png 70 bytes/, r.d.answer);
    // publishing clicks wait for the owner
    const share = await s.api('/api/workplace/chat', { message: '[[mock:browser_click {"text":"Share"}]]' }, tok);
    assert.ok((share.d.approvals || []).some((a) => a.kind === 'browser' && a.status === 'pending'), JSON.stringify(share.d.approvals));
  } finally { await s.stop(); web.close(); }
});
