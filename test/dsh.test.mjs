import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { advance, STEPS } from '../lib/workflow.js';

test('the sidebar is the same six entries for every industry', () => {
  const src = fs.readFileSync(new URL('../clinic.html', import.meta.url), 'utf8');
  const nav = src.slice(src.indexOf('<nav class="nav">'), src.indexOf('</nav>'));
  for (const label of ['Dashboard', 'Front Desk', 'Social Media', 'Billing & Invoicing', 'Approvals', 'Settings']) {
    assert.match(nav, new RegExp(label));
  }
  assert.doesNotMatch(nav, /Owner Insights|Connections|Pricing|Usage & cost|Privacy/);
});

test('front desk opens enquiry and appointment from two buttons', () => {
  const src = fs.readFileSync(new URL('../clinic.html', import.meta.url), 'utf8');
  assert.match(src, /\+ New Enquiry/);
  assert.match(src, /\+ Book Appointment/);
  assert.match(src, /Members & Follow-ups/);
  assert.match(src, /Reviews & Referrals/);
});

test('the journey moves enquiry to follow-up and flags an external send', () => {
  let state = 'enquiry';
  const seen = [state];
  while (state !== 'followup') {
    const step = advance(state, { external: state === 'review' });
    assert.equal(step.ok, true);
    state = step.state;
    seen.push(state);
  }
  assert.deepEqual(seen, STEPS);
  assert.equal(advance('followup').ok, false);
});
