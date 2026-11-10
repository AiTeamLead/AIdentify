import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('a category tile selects and does not advance by itself', () => {
  const src = fs.readFileSync(new URL('../clinic.html', import.meta.url), 'utf8');
  assert.match(src, /Please select a business category to continue\./);
  assert.doesNotMatch(src, /a pick moves on/);
  const change = src.slice(src.indexOf("r.name !== 'role'"), src.indexOf("root.addEventListener('paste'"));
  assert.doesNotMatch(change, /obShow\(ob\.step \+ 1\)/);
});
