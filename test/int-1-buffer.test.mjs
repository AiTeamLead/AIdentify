// INT-1: no personal Buffer account and no Buffer client on this tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

function filesUnder(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...filesUnder(p));
    else if (/\.(js|mjs|html|json|md)$/.test(name) && st.size < 2_000_000) out.push(p);
  }
  return out;
}

test('the tree has no Buffer client and no personal Buffer account', () => {
  const hits = [];
  for (const file of filesUnder(ROOT)) {
    if (file.endsWith('test/int-1-buffer.test.mjs') || file.includes(`${path.sep}docs${path.sep}fix-program${path.sep}`)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/shreyas/i.test(text)) hits.push(path.relative(ROOT, file) + ':shreyas');
    if (/api\.buffer\.com/i.test(text)) hits.push(path.relative(ROOT, file) + ':buffer-api');
    if (/lib\/buffer\.js/.test(text) && !file.endsWith('PHASE-0-RECON.md')) hits.push(path.relative(ROOT, file) + ':buffer-lib');
  }
  assert.deepEqual(hits, []);
  assert.equal(fs.existsSync(path.join(ROOT, 'lib/buffer.js')), false);
});
