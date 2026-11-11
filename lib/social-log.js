// Request log for social networks we do not call live from this server.
// LinkedIn failures seen in the field are Composio or the browser session: this tree has no
// first-party LinkedIn client, so there is no token refresh to fix here. The log records status
// and a backoff so a later adapter can wait instead of hammering a 429.
const key = (email) => 'as_soclog:' + String(email || '').toLowerCase();
const parse = (v) => { try { return JSON.parse(v); } catch { return []; } };

export function backoffMs(status, attempt = 0) {
  if (Number(status) !== 429) return 0;
  return Math.min(8000, 400 * (2 ** Math.max(0, Number(attempt) || 0)));
}

export async function logSocial(st, email, { network, status, op }) {
  const row = { at: Date.now(), network: String(network || ''), status: Number(status) || 0, op: String(op || ''), backoffMs: backoffMs(status, 0) };
  const list = parse((await st.get(key(email)))?.v || '[]');
  const next = (Array.isArray(list) ? list : []).concat(row).slice(-100);
  await st.put(key(email), JSON.stringify(next), Date.now());
  return row;
}

export async function readSocialLog(st, email) {
  const list = parse((await st.get(key(email)))?.v || '[]');
  return Array.isArray(list) ? list : [];
}
