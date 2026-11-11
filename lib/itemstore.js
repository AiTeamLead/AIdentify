// Per-item copies of list blobs (approvals, rules, skills) plus a lock around read-modify-write.
// The legacy key stays, so existing readers keep working. Each item is also its own key.
const BUCKETS = [
  { prefix: 'as_appr:', bucket: 'appr' },
  { prefix: 'as_rules:', bucket: 'rules' },
  { prefix: 'as_skills:', bucket: 'skills' },
];
const parse = (v, d) => { try { return v == null ? d : (JSON.parse(v) ?? d); } catch { return d; } };

export function bucketOf(key) {
  const k = String(key || '');
  for (const b of BUCKETS) {
    if (!k.startsWith(b.prefix)) continue;
    const owner = k.slice(b.prefix.length);
    if (owner && !owner.includes(':')) return { ...b, owner };
  }
  return null;
}

async function fanout(origPut, origDel, st, hit, raw, at) {
  const p = 'as_i:' + hit.bucket + ':' + hit.owner + ':';
  if (typeof st.listPrefix === 'function' && origDel) {
    const old = await st.listPrefix(p);
    for (const row of old) await origDel(row.k);
  }
  const list = parse(raw, []);
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (item && item.id) await origPut(p + item.id, JSON.stringify(item), at || Date.now());
  }
  await origPut('as_imeta:' + hit.bucket + ':' + hit.owner, JSON.stringify({ n: list.length, at: Date.now() }), Date.now());
}

export function attachItemStore(st) {
  if (!st || st.__items || typeof st.put !== 'function') return st;
  const origPut = st.put.bind(st);
  const origDel = st.del ? st.del.bind(st) : null;
  st.put = async (k, v, at) => {
    await origPut(k, v, at);
    if (String(k).startsWith('as_i:') || String(k).startsWith('as_imeta:')) return;
    const hit = bucketOf(k);
    if (!hit) return;
    await fanout(origPut, origDel, st, hit, v, at);
  };
  st.__items = true;
  return st;
}

const chains = new Map();
export async function mutateList(st, key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((r) => { release = r; });
  const tail = prev.catch(() => {}).then(() => gate);
  chains.set(key, tail);
  await prev.catch(() => {});
  let unlock = null;
  try {
    if (st.lock && st.kind && st.kind !== 'file') unlock = await st.lock('list:' + key).catch(() => null);
    const cur = parse((await st.get(key))?.v, []);
    const list = Array.isArray(cur) ? cur : [];
    const next = await fn(list);
    if (next === undefined) return list;
    const text = next == null ? null : JSON.stringify(next);
    await st.put(key, text, Date.now());
    return next;
  } finally {
    if (unlock) await unlock();
    release();
    if (chains.get(key) === tail) chains.delete(key);
  }
}
