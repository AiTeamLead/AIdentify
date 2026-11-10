import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBusinessName, validateService, validateAudience, validateLocation, addChip, validatePhone, validateEmail } from '../lib/validation/onboarding.js';
import { publicPacks } from '../lib/clinic-packs.js';
import { startServer } from './helpers.mjs';

test('business names reject numbers-only and emails and count to 60', () => {
  assert.equal(validateBusinessName('5475676').ok, false);
  assert.equal(validateBusinessName('a@b.com').ok, false);
  assert.equal(validateBusinessName('  Harbour Dental  ').value, 'Harbour Dental');
  assert.equal(validateBusinessName('A').ok, false);
  assert.equal(validateBusinessName('A'.repeat(61)).ok, false);
  assert.match(validateBusinessName('12').error, /2–60/);
});

test('services and audiences need a letter and reject duplicates', () => {
  assert.equal(validateService('12345').ok, false);
  assert.equal(validateService('Cleaning').value, 'Cleaning');
  assert.equal(addChip(['Cleaning'], 'cleaning', 'service', 20).error, 'Already added.');
  assert.equal(validateAudience('123456').ok, false);
  assert.equal(validateAudience('Families within 5 km').ok, true);
  assert.equal(addChip([], '', 'audience', 10).ok, false);
});

test('locations come from the city list or a Places result', () => {
  assert.equal(validateLocation('siva123@gmail.com').ok, false);
  assert.equal(validateLocation('12345').ok, false);
  assert.equal(validateLocation('pune').value, 'Pune');
  assert.equal(validateLocation('Banjara Hills', { places: ['Banjara Hills, Hyderabad'] }).ok, false);
  assert.equal(validateLocation('Banjara Hills, Hyderabad', { places: ['Banjara Hills, Hyderabad'] }).ok, true);
});

test('Digital Marketing Agency is the first industry tile', () => {
  const packs = publicPacks();
  assert.equal(packs[0].id, 'marketing');
  assert.equal(packs[0].title, 'Digital Marketing Agency');
  assert.ok(packs[0].suggest.services.length > 0);
});

test('the draft API rejects a numeric business name', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'e2e-onb-' + Date.now() + '@example.com', name: 'O', password: 'Clinic-pass-123!' })).d.token;
    const bad = await s.api('/api/clinic/onboarding/draft', { step: 1, biz: '5475676' }, tok);
    assert.equal(bad.status, 400);
    assert.match(bad.d.message, /2–60/);
  } finally { await s.stop(); }
});

test('phone numbers are E.164 for India and emails are rejected', () => {
  assert.equal(validatePhone('9876543210').value, '+919876543210');
  assert.equal(validatePhone('+91 98765 43210').value, '+919876543210');
  assert.equal(validatePhone('siva123@gmail.com').ok, false);
  assert.equal(validateEmail('owner@clinic.in').value, 'owner@clinic.in');
  assert.equal(validateEmail('not-an-email').ok, false);
});
