// Social networks fetch post images from a link: on a non-public server images get a public copy automatically;
// on a public https APP_URL the server's own link is used. Preparing media (Instagram container) needs no approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('local image links become public links inside tool calls; copies are made once', async () => {
  let uploads = 0, form = '';
  const host = http.createServer(async (req, res) => { let b = ''; for await (const c of req) b += c.toString('latin1'); uploads++; form = b; res.end('https://litter.catbox.moe/abc123.png'); });
  await new Promise((r) => host.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-media-'));
  Object.assign(process.env, { DATA_DIR: dir, IMAGE_HOST_URL: 'http://127.0.0.1:' + host.address().port + '/up', APP_URL: 'http://127.0.0.1:3000' });
  try {
    const M = await import('../lib/media.js?pub1');
    const m = M.saveMedia(PNG, 'image/png');
    const args = { tools: [{ tool_slug: 'INSTAGRAM_CREATE_MEDIA_CONTAINER', arguments: { image_url: 'http://127.0.0.1:3000' + m.path, caption: 'Happy Diwali' } }], note: 'see ' + m.path };
    const out = await M.publicizeMedia(args);
    assert.equal(out.tools[0].arguments.image_url, 'https://litter.catbox.moe/abc123.png');
    assert.equal(out.note, 'see https://litter.catbox.moe/abc123.png');
    assert.equal(out.tools[0].arguments.caption, 'Happy Diwali');
    assert.equal(uploads, 1, 'one copy for the same image'); assert.match(form, /name="time"\r\n\r\n72h/);
    await M.publicizeMedia({ again: m.path }); assert.equal(uploads, 1, 'cached');
    // a public https server uses its own link, no copy
    process.env.APP_URL = 'https://app.example.com';
    assert.equal(await M.publicMediaUrl(m.path), 'https://app.example.com' + m.path.replace('.png', '.jpg'), 'photos go out as JPEG');
    assert.equal(fs.readFileSync(M.mediaPath(m.id, 'jpg')).subarray(0, 2).toString('hex'), 'ffd8');
    // IMAGE_HOST=off explains what to do
    process.env.APP_URL = 'http://10.0.0.5:3000'; process.env.IMAGE_HOST = 'off';
    const m2 = M.saveMedia(PNG, 'image/png');
    await assert.rejects(M.publicMediaUrl(m2.path), /public https/);
    // every host failing on a public plain-http server falls back to the server's own link
    delete process.env.IMAGE_HOST; process.env.APP_URL = 'http://54.81.208.96:3000';
    host.close(); await new Promise((r) => setTimeout(r, 50));
    const m3 = M.saveMedia(PNG, 'image/png');
    assert.equal(await M.publicMediaUrl(m3.path), 'http://54.81.208.96:3000/api/media/' + m3.id + '.jpg');
    // on a private address with every host failing, the error says what failed and how to fix it
    process.env.APP_URL = 'http://192.168.1.5:3000';
    const m4 = M.saveMedia(PNG, 'image/png');
    await assert.rejects(M.publicMediaUrl(m4.path), /litterbox: .*deploy\/https/);
  } finally { for (const k of ['DATA_DIR', 'IMAGE_HOST_URL', 'APP_URL', 'IMAGE_HOST']) delete process.env[k]; host.close(); }
});

test('preparing media runs without approval; publishing still waits', async () => {
  const { isReadTool } = await import('../lib/composio.js');
  const { execIsRead } = await import('../lib/composio-account.js');
  assert.equal(isReadTool('INSTAGRAM_CREATE_MEDIA_CONTAINER'), true);
  assert.equal(isReadTool('TWITTER_UPLOAD_MEDIA'), true);
  assert.equal(isReadTool('INSTAGRAM_CREATE_POST'), false);
  assert.equal(isReadTool('INSTAGRAM_PUBLISH_MEDIA'), false);
  assert.equal(execIsRead({ tools: [{ tool_slug: 'INSTAGRAM_CREATE_MEDIA_CONTAINER' }] }), true);
  assert.equal(execIsRead({ tools: [{ tool_slug: 'INSTAGRAM_CREATE_MEDIA_CONTAINER' }, { tool_slug: 'INSTAGRAM_CREATE_POST' }] }), false);
});

test('S3 signed links match AWS Signature V4 (AWS documentation example)', async () => {
  const M = await import('../lib/media.js?s3v');
  const c = { key: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', host: 'examplebucket.s3.amazonaws.com' };
  const u = M.s3Sign(c, 'GET', 'test.txt', { query: true, expires: 86400, now: new Date('2013-05-24T00:00:00Z') }).url;
  assert.match(u, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
  const put = M.s3Sign(c, 'PUT', 'aaas-media/a.jpg', { headers: { 'content-type': 'image/jpeg' } });
  assert.match(put.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
});

test('the laptop tunnel serves only post images, never the app', async () => {
  const { mediaServer } = await import('../lib/media-tunnel.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-tun-'));
  const id = 'a'.repeat(32); fs.writeFileSync(path.join(dir, id + '.jpg'), Buffer.from('ffd8ffe0', 'hex'));
  const srv = mediaServer((i, x) => path.join(dir, i + '.' + x));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const ok = await fetch(base + '/api/media/' + id + '.jpg');
    assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'image/jpeg');
    for (const p of ['/', '/api/auth/me', '/api/media/' + id + '.json', '/api/media/../.env', '/api/media/' + 'b'.repeat(32) + '.jpg']) assert.equal((await fetch(base + p)).status, 404, p);
    assert.equal((await fetch(base + '/api/media/' + id + '.jpg', { method: 'POST' })).status, 404);
  } finally { srv.close(); }
});
