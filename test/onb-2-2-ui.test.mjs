import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the business name field searches Places after three characters', () => {
  const src = fs.readFileSync(new URL('../clinic.html', import.meta.url), 'utf8');
  assert.match(src, /function obSearchPlaces/);
  assert.match(src, /query\.length < 3/);
  assert.match(src, /\/api\/clinic\/places/);
  assert.match(src, /My business isn\\'t listed/);
  assert.match(src, /setTimeout\(\(\) => \{/,);
});
