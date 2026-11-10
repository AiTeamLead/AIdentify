import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('starter credit warns at 80 percent and blocks with an upgrade modal', () => {
  const src = fs.readFileSync(new URL('../clinic.html', import.meta.url), 'utf8');
  assert.match(src, /starter\.warn/);
  assert.match(src, /Add your own key before it runs out/);
  assert.match(src, /id="upTitle">Upgrade/);
  assert.match(src, /The \$1 starter credit is used up/);
});
