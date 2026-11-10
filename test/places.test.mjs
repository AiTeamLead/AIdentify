import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPlaces } from '../lib/places.js';

test('Places search stays empty until a server key is set, and the key is not returned', async () => {
  const off = await searchPlaces('Harbour Dental', { env: {} });
  assert.equal(off.configured, false);
  assert.deepEqual(off.matches, []);
  let auth = '';
  const on = await searchPlaces('Harbour', {
    env: { GOOGLE_PLACES_API_KEY: 'places-test-key' },
    fetchImpl: async (url, opt) => {
      auth = opt.headers['X-Goog-Api-Key'];
      return { ok: true, json: async () => ({ places: [{ id: 'p1', displayName: { text: 'Harbour Dental' }, formattedAddress: 'Pune', nationalPhoneNumber: '9876543210', rating: 4.5 }] }) };
    },
  });
  assert.equal(on.configured, true);
  assert.equal(on.matches[0].name, 'Harbour Dental');
  assert.equal(on.matches[0].address, 'Pune');
  assert.equal(auth, 'places-test-key');
  assert.doesNotMatch(JSON.stringify(on), /places-test-key/);
});
