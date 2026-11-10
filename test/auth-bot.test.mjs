import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

test('Bot Mode reuses the clinic session instead of opening a second sign-in', () => {
  const clinic = fs.readFileSync(path.join(ROOT, 'clinic.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(clinic, /function botSrc\(\) \{[\s\S]*as_auth=/);
  assert.match(app, /html\.bot-boot #auth/);
  assert.match(app, /hp\.get\('as_auth'\)/);
  assert.match(app, /!botMode&&!hp\.get\('as_auth'\)/);
  assert.match(app, /This Bot Mode session expired/);
});
