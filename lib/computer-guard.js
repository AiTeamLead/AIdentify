// Extra checks around /api/computer/*. The browser already refuses private URLs.
// This adds a per-account rate limit, an audit line, and a plan gate. Secrets are not written.
import crypto from 'node:crypto';

const hits = new Map();
const hash = (s) => crypto.createHash('sha256').update(String(s || '')).digest('hex').slice(0, 12);

export async function guardComputer({ st, email, ip, pathname, HttpError }) {
  if (String(process.env.RATE_LIMIT || '').toLowerCase() !== 'off') {
    const now = Date.now();
    const list = (hits.get(email) || []).filter((t) => now - t < 60e3);
    if (list.length >= 60) throw new HttpError(429, 'rate_limited', 'Too many computer actions. Wait a minute.');
    list.push(now);
    hits.set(email, list);
  }
  const sub = await st.get('as_sub:' + String(email).toLowerCase());
  let status = 'trial';
  try { status = (JSON.parse(sub && sub.v) || {}).status || 'trial'; } catch { status = 'trial'; }
  if (status === 'locked' || status === 'inactive') throw new HttpError(402, 'plan', 'The computer is available on an active plan. Ask us to mark the account paid.');
  const line = { at: Date.now(), path: String(pathname).slice(0, 80), ip: hash(ip), email: hash(email) };
  const key = 'as_caudit:' + email;
  let prev = [];
  try { prev = JSON.parse((await st.get(key))?.v || '[]') || []; } catch { prev = []; }
  if (!Array.isArray(prev)) prev = [];
  prev.unshift(line);
  await st.put(key, JSON.stringify(prev.slice(0, 100)), Date.now());
  return { ok: true };
}
