// Per-user OpenRouter keys (sub-keys) through OpenRouter's key management API (Provisioning / Management keys).
//
//   OPENROUTER_PROVISIONING_KEY  a Provisioning (now called "Management") key from openrouter.ai → Settings →
//                                Provisioning Keys. It can create, read, change and delete normal API keys, each with its
//                                own US$ credit limit. It cannot run models itself.
//
// Detection (status(), cached 10 min): GET /api/v1/key with that key. is_provisioning_key / is_management_key = true, or a
// working GET /api/v1/keys list, means sub-keys are ON. Anything else means FALLBACK: one platform key for everyone
// (OPENROUTER_API_KEY; if that is empty and the "provisioning" value is really a normal key, that normal key) and the
// app's own credit ledger enforces each user's cap. As soon as a real provisioning key is set, sub-keys switch on by
// themselves; nothing else changes.
//
// Sub-keys: created at the first AI use after sign-up (or a plan change), limit = what the user's credit balance is worth
// at cost plus a small headroom, raised on recharge or grant, disabled on pause. Stored AES-256-GCM sealed (key derived
// from SESSION_SECRET) inside the user's credit row; only the hash and the last 4 characters are ever shown.
// Keys are never logged: errors carry the HTTP status only.
import crypto from 'node:crypto';

const env = (k, d = '') => String(process.env[k] ?? d).trim();
const base = () => (env('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
let cache = { at: 0, val: null, keyTag: '' };
const tagOf = (k) => (k ? crypto.createHash('sha256').update(k).digest('hex').slice(0, 12) : '');

async function call(path, { method = 'GET', key, body, fetchImpl = fetch } = {}) {
  const r = await fetchImpl(base() + path, { method, signal: AbortSignal.timeout(10000), headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let d = null; try { d = await r.json(); } catch { /* empty */ }
  return { ok: r.ok, status: r.status, d };
}

// → { mode: 'off' | 'subkeys' | 'fallback', reason, platformKeySource, limit, remaining }
export async function status({ fetchImpl = fetch, force = false } = {}) {
  const pk = env('OPENROUTER_PROVISIONING_KEY'), tag = tagOf(pk);
  if (!force && cache.val && cache.keyTag === tag && Date.now() - cache.at < 600e3) return cache.val;
  let val;
  if (!pk) val = { mode: 'off', reason: 'OPENROUTER_PROVISIONING_KEY is not set: one platform key plus credit caps.' };
  else {
    try {
      const k = await call('/key', { key: pk, fetchImpl });
      const d = (k.d && k.d.data) || {};
      if (k.ok && (d.is_provisioning_key === true || d.is_management_key === true)) val = { mode: 'subkeys', reason: 'Provisioning key detected: each user gets their own capped OpenRouter key.' };
      else {
        const l = await call('/keys?offset=0', { key: pk, fetchImpl }).catch(() => ({ ok: false }));
        if (l.ok && l.d && Array.isArray(l.d.data)) val = { mode: 'subkeys', reason: 'Key management works with this key: each user gets their own capped OpenRouter key.' };
        else if (k.ok) val = { mode: 'fallback', reason: 'OPENROUTER_PROVISIONING_KEY is a normal API key (is_provisioning_key: false), so it cannot create per-user keys. Using one platform key plus credit caps.', normalKey: true, limit: d.limit ?? null, remaining: d.limit_remaining ?? null };
        else val = { mode: 'fallback', reason: `OpenRouter did not accept OPENROUTER_PROVISIONING_KEY (${k.status}). Using one platform key plus credit caps.` };
      }
    } catch (e) { val = { mode: 'fallback', reason: 'OpenRouter could not be reached to check the provisioning key. Using one platform key plus credit caps.', transient: true }; }
  }
  val.platformKeySource = env('OPENROUTER_API_KEY') ? 'OPENROUTER_API_KEY' : val.normalKey ? 'OPENROUTER_PROVISIONING_KEY (normal key)' : 'none';
  cache = { at: val.transient ? Date.now() - 540e3 : Date.now(), val, keyTag: tag };
  return val;
}
export const _resetStatus = () => { cache = { at: 0, val: null, keyTag: '' }; };

// The key every non-sub-key user runs on. Never returned to a page.
export async function platformKey(opts) {
  if (env('OPENROUTER_API_KEY')) return env('OPENROUTER_API_KEY');
  const s = await status(opts);
  return s.normalKey ? env('OPENROUTER_PROVISIONING_KEY') : '';
}

// Limit info for the key the platform runs on (GET /api/v1/key): { limit, remaining, usage, usageDaily, usageMonthly }
let keyInfo = { at: 0, val: null };
export async function platformKeyInfo({ fetchImpl = fetch, force = false } = {}) {
  if (!force && keyInfo.val && Date.now() - keyInfo.at < 60e3) return keyInfo.val;
  const k = await platformKey({ fetchImpl });
  if (!k) return null;
  try {
    const r = await call('/key', { key: k, fetchImpl });
    if (!r.ok) return { error: r.status };
    const d = (r.d && r.d.data) || {};
    keyInfo = { at: Date.now(), val: { limit: d.limit ?? null, remaining: d.limit_remaining ?? null, usage: d.usage ?? null, usageDaily: d.usage_daily ?? null, usageMonthly: d.usage_monthly ?? null } };
    return keyInfo.val;
  } catch { return { error: 'unreachable' }; }
}
export const _resetKeyInfo = () => { keyInfo = { at: 0, val: null }; };

/* ----- sealing (same AES-256-GCM scheme as lib/aikeys.js, its own derived key) ----- */
const encKey = (secret) => crypto.createHash('sha256').update(String(secret) + ':orsubkeys').digest();
export function seal(text, secret) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', encKey(secret), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
}
export function unseal(s, secret) {
  try {
    const [iv, tag, ct] = String(s || '').split('.').map((x) => Buffer.from(x || '', 'base64url'));
    const d = crypto.createDecipheriv('aes-256-gcm', encKey(secret), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch { return ''; }
}

const round = (n) => Math.max(0.01, Math.round(n * 100) / 100);
const nameFor = (email) => 'aidentify:' + crypto.createHash('sha256').update(String(email)).digest('hex').slice(0, 16);

// Creates a capped key. → { hash, sealed, hint, limitUsd, disabled:false, at }
export async function createSubKey(email, limitUsd, secret, { fetchImpl = fetch } = {}) {
  const pk = env('OPENROUTER_PROVISIONING_KEY');
  const r = await call('/keys', { method: 'POST', key: pk, fetchImpl, body: { name: nameFor(email), limit: round(limitUsd), include_byok_in_limit: false } });
  const key = r.d && (r.d.key || (r.d.data && r.d.data.key));
  const hash = r.d && r.d.data && r.d.data.hash;
  if (!r.ok || !key || !hash) { const e = new Error('OpenRouter key create failed (' + r.status + ')'); e.status = r.status; throw e; }
  return { hash, sealed: seal(key, secret), hint: '…' + String(key).slice(-4), limitUsd: round(limitUsd), disabled: false, at: Date.now() };
}
export async function getSubKey(hash, { fetchImpl = fetch } = {}) {
  const r = await call('/keys/' + encodeURIComponent(hash), { key: env('OPENROUTER_PROVISIONING_KEY'), fetchImpl });
  if (!r.ok) { const e = new Error('OpenRouter key read failed (' + r.status + ')'); e.status = r.status; throw e; }
  return (r.d && r.d.data) || {};
}
export async function updateSubKey(hash, patch, { fetchImpl = fetch } = {}) {
  const body = {};
  if (patch.limitUsd != null) body.limit = round(patch.limitUsd);
  if (patch.disabled != null) body.disabled = !!patch.disabled;
  const r = await call('/keys/' + encodeURIComponent(hash), { method: 'PATCH', key: env('OPENROUTER_PROVISIONING_KEY'), fetchImpl, body });
  if (!r.ok) { const e = new Error('OpenRouter key update failed (' + r.status + ')'); e.status = r.status; throw e; }
  return (r.d && r.d.data) || {};
}
export async function deleteSubKey(hash, { fetchImpl = fetch } = {}) {
  const r = await call('/keys/' + encodeURIComponent(hash), { method: 'DELETE', key: env('OPENROUTER_PROVISIONING_KEY'), fetchImpl });
  return r.ok || r.status === 404;
}
