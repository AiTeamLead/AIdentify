// Image links for social posts: Google Images links become the image's own address, web pages are caught before approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageUrls, checkImages } from '../lib/social-images.js';

test('image links: Google Images result → image file; pages and private addresses refused', async () => {
  const g = imageUrls(['https://www.google.com/imgres?imgurl=https://cdn.example.com/diwali.jpg&tbnid=x', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9Gc&s=10', 'https://www.google.com/search?q=diwali', 'http://127.0.0.1/a.png']);
  assert.deepEqual(g.urls, ['https://cdn.example.com/diwali.jpg', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9Gc&s=10']);
  assert.equal(g.bad.length, 2);
  const fake = async (u) => ({ status: 200, url: u, headers: new Headers({ 'content-type': /page/.test(u) ? 'text/html' : 'image/jpeg' }), body: null });
  const c = await checkImages(['https://a.example/img.jpg', 'https://a.example/page'], fake);
  assert.deepEqual(c.ok, ['https://a.example/img.jpg']);
  assert.match(c.bad[0], /web page, not an image/);
  const off = await checkImages(['https://unreachable.example/x.jpg'], async () => { throw new Error('offline'); });
  assert.deepEqual(off.ok, ['https://unreachable.example/x.jpg']);
});
