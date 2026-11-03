// Bot Mode and the CRM must use the shared tokens, not a second dark palette.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('design tokens are the only palette for Bot Mode and the CRM', () => {
  const theme = read('clinic-theme.css');
  assert.match(theme, /--primary:\s*#2f2a86/i);
  assert.match(theme, /body\.bot-mode \.wp-side[\s\S]*background:\s*var\(--card\)/);
  assert.match(theme, /body\.bot-mode \.go[\s\S]*background:\s*var\(--primary\)/);
  assert.doesNotMatch(theme, /body\.bot-mode[\s\S]{0,400}#050505/);
  const crm = read('assets/crm.js');
  assert.match(crm, /class="field"/);
  assert.doesNotMatch(crm, /#[0-9a-fA-F]{3,8}\b/);
  const app = read('index.html');
  assert.match(app, /dataset\.theme='light'/);
  assert.match(app, /botMode\?'<rect width="32" height="32" rx="8" fill="currentColor"\/>'/);
  assert.doesNotMatch(read('lib/clinic.js'), /Sample Clinic Owner/);
  assert.doesNotMatch(read('clinic.html'), /Clinic owner/);
  assert.doesNotMatch(read('clinic.html'), /AaaS · Clinic team/);
});
