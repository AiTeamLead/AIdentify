// Envelope encryption for customer secrets.
// A random data key encrypts the payload. That data key is wrapped with a key
// derived from SESSION_SECRET. When AWS_KMS_KEY_ID is set, the wrapper is still
// local until a KMS client is configured in this process: the blob records that
// so a later swap does not pretend the cloud key was used.
import crypto from 'node:crypto';

function kek(secret) {
  return crypto.createHash('sha256').update(String(secret || '') + ':envelope').digest();
}

export function envelopeInfo(env = process.env) {
  const keyId = String(env.AWS_KMS_KEY_ID || '').trim();
  return { mode: keyId ? 'kms-unconfigured' : 'local', kmsKeyId: keyId };
}

export function sealEnvelope(obj, secret, env = process.env) {
  const info = envelopeInfo(env);
  const dek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const wiv = crypto.randomBytes(12);
  const wrap = crypto.createCipheriv('aes-256-gcm', kek(secret), wiv);
  const wrapped = Buffer.concat([wrap.update(dek), wrap.final()]);
  return ['env1', info.mode, wiv, wrap.getAuthTag(), wrapped, iv, cipher.getAuthTag(), ct]
    .map((p) => Buffer.isBuffer(p) ? p.toString('base64url') : String(p)).join('.');
}

export function openEnvelope(blob, secret) {
  const parts = String(blob || '').split('.');
  if (parts[0] !== 'env1' || parts.length !== 8) throw new Error('bad envelope');
  const [, , wiv, wtag, wrapped, iv, tag, ct] = parts.map((p, i) => i < 2 ? p : Buffer.from(p, 'base64url'));
  const wrap = crypto.createDecipheriv('aes-256-gcm', kek(secret), wiv);
  wrap.setAuthTag(wtag);
  const dek = Buffer.concat([wrap.update(wrapped), wrap.final()]);
  const cipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(ct), cipher.final()]).toString('utf8'));
}
