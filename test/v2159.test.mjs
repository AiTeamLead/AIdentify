// v2.15.9: tests never open the Cloudflare tunnel (it made npm test wait ~25 s on machines with cloudflared and
// needed the internet); the tunnel still works for the app; the Windows-only failure in security.test.mjs is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-v2159-'));
for (const k of ['MEDIA_TUNNEL', 'IMAGE_HOST', 'IMAGE_HOST_URL', 'IMGBB_API_KEY', 'S3_BUCKET', 'APP_URL', 'PUBLIC_URL']) delete process.env[k];
const { tunnelOff, tunnelBase } = await import('../lib/media-tunnel.js');
const { publicMediaUrl } = await import('../lib/media.js');

test('the tunnel is off while tests run, unless MEDIA_TUNNEL=on', async () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'node --test sets NODE_TEST_CONTEXT');
  assert.equal(tunnelOff(), true);
  await assert.rejects(tunnelBase(() => ''), /off while tests run/);
  process.env.MEDIA_TUNNEL = 'off';
  await assert.rejects(tunnelBase(() => ''), /MEDIA_TUNNEL=off/);
  process.env.MEDIA_TUNNEL = 'on';
  assert.equal(tunnelOff(), false, 'explicitly on');
  delete process.env.MEDIA_TUNNEL;
});

test('a post picture on a laptop address fails fast in tests: no tunnel, no upload to a public image host', async () => {
  const id = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(path.join(process.env.DATA_DIR, 'media'), { recursive: true });
  fs.writeFileSync(path.join(process.env.DATA_DIR, 'media', id + '.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (...a) => { calls++; return realFetch(...a); };
  const t0 = Date.now();
  await assert.rejects(publicMediaUrl('/api/media/' + id + '.png', 'http://localhost:3000'), /off while tests run/);
  assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + ' ms');
  assert.equal(calls, 0, 'nothing is uploaded to a public image host from a test');
  globalThis.fetch = realFetch;
  // a public server address needs no tunnel at all
  assert.match(await publicMediaUrl('/api/media/' + id + '.png', 'https://app.example.com'), new RegExp('^https://app\\.example\\.com/api/media/' + id + '\\.(png|jpg)$'));
});

test('test files use the OS temp folder, never /tmp (Windows has none)', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /mkdtempSync\(\s*['"`]\/tmp/, f);
  }
});
