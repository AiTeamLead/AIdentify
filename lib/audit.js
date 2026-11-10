import crypto from 'node:crypto';

const key = (email) => 'as_audit:' + String(email || '').toLowerCase();
const parse = (v) => { try { return JSON.parse(v); } catch { return []; } };

export function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

export async function writeAudit(st, email, { action, payload, actor, provider }) {
  const row = {
    id: crypto.randomBytes(8).toString('hex'),
    at: Date.now(),
    actor: String(actor || email || ''),
    action: String(action || ''),
    payloadHash: payloadHash(payload),
    provider: provider ? String(provider) : '',
  };
  const cur = parse((await st.get(key(email)))?.v || '[]');
  const list = Array.isArray(cur) ? cur : [];
  list.push(row);
  await st.put(key(email), JSON.stringify(list.slice(-500)), Date.now());
  return row;
}

export async function readAudit(st, email) {
  const cur = parse((await st.get(key(email)))?.v || '[]');
  return Array.isArray(cur) ? cur : [];
}
