// $1 lifetime starter credit for an account that skips its own model key.
// The ledger is per account. It does not share the workplace daily pool.
export const STARTER_USD = 1;
export const WARN_AT = 0.8;
const key = (email) => 'as_aicredit:' + String(email || '').toLowerCase();
const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };
const round = (n) => Math.round(Number(n) * 10000) / 10000;

export function viewCredit(row) {
  if (!row) return { enrolled: false, capUsd: STARTER_USD, usedUsd: 0, leftUsd: STARTER_USD, blocked: false, warn: false, label: '' };
  const used = round(row.used || 0);
  const left = round(Math.max(0, STARTER_USD - used));
  const blocked = left <= 0;
  const warn = !blocked && used >= STARTER_USD * WARN_AT;
  return {
    enrolled: true, capUsd: STARTER_USD, usedUsd: used, leftUsd: left, blocked, warn,
    label: blocked ? 'Starter credit used up' : `Using AaaS starter credit — $${left.toFixed(2)} left`,
  };
}

export async function readCredit(st, email) {
  const row = parse((await st.get(key(email)))?.v || 'null');
  return viewCredit(row && row.enrolled ? row : null);
}

export async function enrollStarter(st, email) {
  const cur = await readCredit(st, email);
  if (cur.enrolled) return cur;
  await st.put(key(email), JSON.stringify({ enrolled: true, used: 0, at: Date.now() }), Date.now());
  return readCredit(st, email);
}

export async function chargeStarter(st, email, usd) {
  const cur = await readCredit(st, email);
  if (!cur.enrolled) return { ok: false, code: 'not_enrolled', ...cur };
  const cost = round(usd);
  if (!Number.isFinite(cost) || cost < 0) return { ok: false, code: 'bad_cost', ...cur };
  if (cur.blocked || cost > cur.leftUsd + 1e-9) return { ok: false, code: 'cap', ...cur, blocked: true };
  await st.put(key(email), JSON.stringify({ enrolled: true, used: round(cur.usedUsd + cost), at: Date.now() }), Date.now());
  return { ok: true, code: 'charged', ...(await readCredit(st, email)) };
}
