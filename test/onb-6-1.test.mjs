import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the AI step shows validating, success, and the provider error', () => {
  const src = fs.readFileSync(new URL('../clinic.html', import.meta.url), 'utf8');
  assert.match(src, /Validating…/);
  assert.match(src, /API key validated successfully\./);
  assert.match(src, /Unable to validate the API key/);
  const next = src.slice(src.indexOf("b.dataset.ob === 'next'"), src.indexOf("b.dataset.ob === 'back'"));
  assert.match(next, /\/api\/ai\/key/);
  assert.match(next, /if \(!key\)/);
});
