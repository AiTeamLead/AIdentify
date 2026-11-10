import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the brief and the header use a validated business name only', () => {
  const src = fs.readFileSync(new URL('../clinic.html', import.meta.url), 'utf8');
  assert.match(src, /\['Name', obCheck\('biz'\) \? ob\.biz : '—'/);
  assert.match(src, /obCheck\('biz'\) \? ` for <span>/);
  assert.match(src, /data-ob="goto"/);
});
