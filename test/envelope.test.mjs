import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealEnvelope, openEnvelope, envelopeInfo } from '../lib/envelope.js';

test('an API key is envelope-encrypted and the blob does not contain it', () => {
  const secret = 'session-secret-for-test';
  const key = 'sk-or-v1-customer-secret-value';
  const blob = sealEnvelope({ provider: 'openrouter', key }, secret);
  assert.match(blob, /^env1\.local\./);
  assert.equal(blob.includes(key), false);
  assert.deepEqual(openEnvelope(blob, secret), { provider: 'openrouter', key });
  assert.throws(() => openEnvelope(blob, 'other-secret'));
  assert.equal(envelopeInfo({ AWS_KMS_KEY_ID: 'alias/aaas' }).mode, 'kms-unconfigured');
  const marked = sealEnvelope({ key }, secret, { AWS_KMS_KEY_ID: 'alias/aaas' });
  assert.match(marked, /^env1\.kms-unconfigured\./);
  assert.equal(openEnvelope(marked, secret).key, key);
});
