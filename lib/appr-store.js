// The approvals list ("as_appr:<email>") is written from many places: Chief, the owner app, channels, workflows.
// Each write used to read the whole list, change it and write the whole list back. When two of those overlapped
// (for example approving one post while Chief queued another, or a long publish finishing after a newer approval
// was added) the later write put back an old copy and a card vanished: "That approval no longer exists".
// Every change now goes through one queue per account, and always starts from the freshest copy.
const parse = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
const queues = new Map();
const KEEP = 200;

// Run fn(list) with the latest list; whatever fn leaves in the list is saved. Changes for one account never overlap.
export function withApprovals(st, email, fn) {
  const key = 'as_appr:' + email;
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    const all = parse((await st.get(key))?.v, []) || [];
    const out = await fn(all);
    await st.put(key, JSON.stringify(all.slice(0, KEEP)), Date.now());
    return out;
  });
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}
// Add one approval at the top.
export const addApproval = (st, email, a) => withApprovals(st, email, (all) => { all.unshift(a); return a; });
// Save one approval's new state without touching the others; it is added back if something removed it meanwhile.
export const saveApproval = (st, email, a) => withApprovals(st, email, (all) => { const i = all.findIndex((x) => x && x.id === a.id); if (i >= 0) all[i] = a; else all.unshift(a); return a; });
