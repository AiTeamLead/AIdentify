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

test('locations hold branches and summarize as City +N', async () => {
  const { normalizeLocations, parseBranchCsv, locationSummary } = await import('../lib/validation/onboarding.js');
  assert.equal(locationSummary(['Hyderabad', 'Pune', 'Mumbai']), 'Hyderabad +2');
  const csv = parseBranchCsv('Hyderabad, Banjara, Road 12, 9876543210\nPune, Kothrud, Main road, 9876543211');
  assert.equal(csv.ok, true);
  assert.equal(csv.locations.length, 2);
  assert.equal(csv.locations[0].branches[0].phone, '+919876543210');
  assert.equal(normalizeLocations([{ city: 'siva123@gmail.com' }]).ok, false);
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'e2e-loc-' + Date.now() + '@example.com', name: 'L', password: 'Clinic-pass-123!' })).d.token;
    const saved = await s.api('/api/clinic/onboarding/draft', { step: 2, locations: csv.locations, biz: 'Harbour Dental' }, tok);
    assert.equal(saved.status, 200, JSON.stringify(saved.d));
    assert.equal(saved.d.city, 'Hyderabad');
    assert.equal(saved.d.profile.locationSummary, 'Hyderabad +1');
    assert.equal(saved.d.profile.locations[1].city, 'Pune');
  } finally { await s.stop(); }
});

test('industry offers are structured percent or flat amounts', async () => {
  const { offerTemplates, normalizeOffers } = await import('../lib/validation/onboarding.js');
  const dental = offerTemplates('dental');
  assert.equal(dental[0].type, 'percent');
  assert.equal(dental[1].type, 'flat');
  assert.equal(normalizeOffers([{ title: '123', type: 'percent', value: 10 }]).ok, false);
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'e2e-off-' + Date.now() + '@example.com', name: 'O', password: 'Clinic-pass-123!' })).d.token;
    const saved = await s.api('/api/clinic/onboarding/draft', { step: 3, offers: dental, biz: 'Harbour Dental', city: 'Pune' }, tok);
    assert.equal(saved.status, 200, JSON.stringify(saved.d));
    assert.equal(saved.d.profile.offers[0].type, 'percent');
    assert.equal(saved.d.profile.offers[1].value, 500);
  } finally { await s.stop(); }
});

test('phone numbers are E.164 for India and emails are rejected', () => {
  assert.equal(validatePhone('9876543210').value, '+919876543210');
  assert.equal(validatePhone('+91 98765 43210').value, '+919876543210');
  assert.equal(validatePhone('siva123@gmail.com').ok, false);
  assert.equal(validateEmail('owner@clinic.in').value, 'owner@clinic.in');
  assert.equal(validateEmail('not-an-email').ok, false);
});
