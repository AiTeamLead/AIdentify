// AI credits: every hosted user's AI use is paid from a credit balance (lib/router.js picks the model, this file bills it).
//
//   Credit formula (all values are config, see getConfig):
//     credits = ceil_to_0.01( cost_usd × usd_inr × markup ÷ inr_per_credit ),  at least min_charge when cost > 0
//   cost_usd is OpenRouter's real charge for the call (usage.cost, returned because we send usage:{include:true});
//   when a provider does not report it, it is estimated from the model's list price (lib/router.js estimateUsd).
//   Defaults: ₹1 per credit, markup 3×, ₹93 per US$, 50 free credits at sign-up, 0.01 credit minimum.
//
// Storage follows the repo's key-value pattern (lib/db.js), so it works on data/kv.json and on Neon/Postgres alike:
//   as_credits:<email>      the account: balance, month-to-date use and AI cost, per-model use, cap, pause, model pick,
//                           and the sealed OpenRouter sub-key when sub-keys are on.
//   as_cledger:<email>:<id> one ledger entry per event: grant | usage | recharge | adjust (+/− credits, balance after).
//   as_corder:<id>          a recharge order (test mode until live payments are switched on).
//   as_sys_credits_cfg      routing table + markup + credit unit, edited by the admin.
//   as_sys_credits_audit    the last 500 admin actions (who, what, when).
// Deduction is atomic: one change at a time per account inside this process (a promise chain) and compare-and-swap
// on the row version across servers (st.update in lib/db.js). The balance never goes below zero: a call that costs more
// than what is left takes the rest and the difference is logged as "absorbed".
import crypto from 'node:crypto';
import { LlmError } from './llm.js';
import * as R from './router.js';
import * as K from './orkeys.js';

const env = (k, d = '') => String(process.env[k] ?? d).trim();
const num = (k, d) => { const v = Number(env(k)); return env(k) !== '' && Number.isFinite(v) ? v : d; };
const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const tz = () => env('APP_TIMEZONE', 'Asia/Kolkata');
export const dayOf = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
export const monthOf = (t = Date.now()) => dayOf(t).slice(0, 7);

export const ACC = 'as_credits:', LEDGER = 'as_cledger:', ORDER = 'as_corder:', CFG = 'as_sys_credits_cfg', AUDIT = 'as_sys_credits_audit';
export const STOP_CODES = new Set(['no_credits', 'ai_paused', 'monthly_cap']);

// On when AI_CREDITS=on, or by default on Vercel (the hosted product). Self-hosted installs keep their own keys.
export function creditsOn() {
  const v = env('AI_CREDITS').toLowerCase();
  if (['on', '1', 'true', 'yes'].includes(v)) return true;
  if (['off', '0', 'false', 'no'].includes(v)) return false;
  return !!process.env.VERCEL;
}

/* ----- config ----- */
export function defaults() {
  return {
    markup: num('AI_CREDIT_MARKUP', 3),
    inrPerCredit: num('AI_CREDIT_INR', 1),
    usdInr: num('AI_USD_INR', 93),
    freeCredits: num('AI_FREE_CREDITS', 50),
    minCharge: num('AI_CREDIT_MIN', 0.01),
    lowBalance: num('AI_CREDIT_LOW', 10),
    routes: R.DEFAULT_ROUTES,
    packs: [{ id: 'p200', inr: 199, credits: 200 }, { id: 'p550', inr: 499, credits: 550 }, { id: 'p1200', inr: 999, credits: 1200 }],
  };
}
const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export function cleanConfig(input = {}, base = defaults()) {
  const c = { ...base };
  if (input.markup != null) c.markup = clamp(input.markup, 1, 20, base.markup);
  if (input.inrPerCredit != null) c.inrPerCredit = clamp(input.inrPerCredit, 0.01, 100, base.inrPerCredit);
  if (input.usdInr != null) c.usdInr = clamp(input.usdInr, 50, 200, base.usdInr);
  if (input.freeCredits != null) c.freeCredits = Math.round(clamp(input.freeCredits, 0, 10000, base.freeCredits));
  if (input.minCharge != null) c.minCharge = clamp(input.minCharge, 0, 10, base.minCharge);
  if (input.lowBalance != null) c.lowBalance = clamp(input.lowBalance, 0, 100000, base.lowBalance);
  c.routes = R.cleanRoutes(input.routes || base.routes);
  if (Array.isArray(input.packs)) {
    const packs = input.packs.map((p, i) => ({ id: String(p.id || 'p' + i).replace(/[^a-z0-9_-]/gi, '').slice(0, 20) || 'p' + i, inr: Math.round(clamp(p.inr, 1, 1e6, 0)), credits: Math.round(clamp(p.credits, 1, 1e7, 0)) })).filter((p) => p.inr && p.credits).slice(0, 6);
    if (packs.length) c.packs = packs;
  }
  return c;
}
let cfgCache = { at: 0, val: null, st: null };
export async function getConfig(st) {
  if (cfgCache.val && cfgCache.st === st && Date.now() - cfgCache.at < 15000) return cfgCache.val;
  const saved = parse((await st.get(CFG))?.v, null) || {};
  const val = cleanConfig(saved);
  cfgCache = { at: Date.now(), val, st };
  return val;
}
export async function saveConfig(st, input) {
  const cur = parse((await st.get(CFG))?.v, null) || {};
  const next = cleanConfig({ ...cur, ...input });
  const stored = { markup: next.markup, inrPerCredit: next.inrPerCredit, usdInr: next.usdInr, freeCredits: next.freeCredits, minCharge: next.minCharge, lowBalance: next.lowBalance, routes: next.routes, packs: next.packs };
  await st.put(CFG, JSON.stringify(stored), Date.now());
  cfgCache = { at: 0, val: null, st: null };
  return next;
}
export const _resetConfigCache = () => { cfgCache = { at: 0, val: null, st: null }; };

/* ----- credit math ----- */
export function toCredits(costUsd, cfg = defaults()) {
  const c = Number(costUsd) || 0;
  if (c <= 0) return 0;
  const raw = (c * cfg.usdInr * cfg.markup) / cfg.inrPerCredit;
  return Math.max(r2(cfg.minCharge), Math.ceil(raw * 100 - 1e-9) / 100);
}
// what N credits are worth at cost (US$): used for sub-key limits
export const creditsToUsdAtCost = (credits, cfg = defaults()) => ((Number(credits) || 0) * cfg.inrPerCredit) / cfg.markup / cfg.usdInr;
export const usdToInr = (usd, cfg = defaults()) => (Number(usd) || 0) * cfg.usdInr;
// typical message (2,000 tokens in, 500 out) in credits, for the model picker
export function typicalCredits(model, prices, cfg = defaults()) { return toCredits(R.estimateUsd(model, 2000, 500, prices), cfg); }
export function costUsdOf(u, prices) { return typeof u.cost === 'number' && u.cost >= 0 ? u.cost : R.estimateUsd(u.model, u.in, u.out, prices); }

/* ----- accounts ----- */
function newAccount(cfg, now = Date.now()) {
  return { v: 1, balance: r2(cfg.freeCredits), granted: r2(cfg.freeCredits), recharged: 0, used: 0, absorbed: 0, month: monthOf(now), usedMonth: 0, callsMonth: 0, costMonthUsd: 0, day: dayOf(now), usedToday: 0, costTodayUsd: 0, models: {}, capMonth: null, paused: false, model: 'auto', created: now, lastActive: null, subKey: null };
}
function roll(a, now = Date.now()) {
  const m = monthOf(now), d = dayOf(now);
  if (a.month !== m) { a.month = m; a.usedMonth = 0; a.callsMonth = 0; a.costMonthUsd = 0; a.models = {}; }
  if (a.day !== d) { a.day = d; a.usedToday = 0; a.costTodayUsd = 0; }
  return a;
}
const chains = new Map();
async function serial(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  let release; const gate = new Promise((r) => { release = r; });
  const tail = prev.catch(() => {}).then(() => gate);
  chains.set(key, tail);
  await prev.catch(() => {});
  try { return await fn(); } finally { release(); if (chains.get(key) === tail) chains.delete(key); }
}
// fn(account|null) → { acc, result } to save, or undefined to leave the row. fn must be synchronous and pure: on Postgres it
// is re-run when another server changed the row first.
export async function mutate(st, email, fn) {
  const k = ACC + email;
  return serial(k, async () => {
    let result;
    await st.update(k, (cur) => {
      const a = cur ? parse(cur, null) : null;
      const out = fn(a ? roll(a) : null);
      if (out === undefined) { result = undefined; return undefined; }
      result = out.result; return JSON.stringify(out.acc);
    });
    return result;
  });
}
export async function getAccount(st, email) { const a = parse((await st.get(ACC + email))?.v, null); return a ? roll(a) : null; }

const ledgerId = () => Date.now().toString(36).padStart(9, '0') + '-' + crypto.randomBytes(4).toString('hex');
export async function addLedger(st, email, entry) {
  const e = { t: Date.now(), ...entry };
  await st.put(LEDGER + email + ':' + ledgerId(), JSON.stringify(e), e.t);
  return e;
}
export async function ledger(st, email, limit = 50) {
  const rows = await st.listPrefix(LEDGER + email + ':');
  return rows.map((r) => parse(r.v, null)).filter(Boolean).sort((a, b) => b.t - a.t).slice(0, limit);
}

// The account, created with the free sign-up credits the first time (sign-up, or the first request of an older account).
export async function ensureAccount(st, email) {
  const cur = await getAccount(st, email);
  if (cur) return cur;
  const cfg = await getConfig(st);
  let created = false;
  const acc = await mutate(st, email, (a) => { if (a) return { acc: a, result: a }; created = true; const n = newAccount(cfg); return { acc: n, result: n }; });
  if (created && cfg.freeCredits > 0) await addLedger(st, email, { type: 'grant', credits: r2(cfg.freeCredits), balance: acc.balance, note: 'Free sign-up credits' });
  return acc;
}

const noCredits = () => new LlmError('You’re out of AI credits. Recharge in Settings › AI credits to keep going. Nothing you’ve built is lost.', 402, 'no_credits');
// Throws when this account may not start another AI call.
export async function checkRoom(st, email) {
  const a = await ensureAccount(st, email);
  if (a.paused) throw new LlmError('AI is paused on this account. Please contact support to turn it back on.', 403, 'ai_paused');
  if (a.capMonth != null && a.usedMonth >= a.capMonth) throw new LlmError(`This account reached its monthly AI limit of ${a.capMonth} credits. It resets on the 1st, or ask support to raise it.`, 429, 'monthly_cap');
  if (!(a.balance > 0)) throw noCredits();
  return a;
}

// Bills one finished AI call. u = { provider, model, in, out, cost, cls, agent }
export async function charge(st, email, u, { prices } = {}) {
  const cfg = await getConfig(st);
  const p = prices || await R.prices().catch(() => R.PRICE_TABLE);
  const usd = costUsdOf(u, p), credits = toCredits(usd, cfg), now = Date.now();
  const res = await mutate(st, email, (a0) => {
    const a = a0 || newAccount(cfg, now);
    const take = r2(Math.min(Math.max(0, a.balance), credits)), short = r2(credits - take);
    a.balance = r2(a.balance - take); a.used = r2(a.used + take); a.absorbed = r2((a.absorbed || 0) + short);
    a.usedMonth = r2(a.usedMonth + take); a.usedToday = r2((a.usedToday || 0) + take); a.callsMonth = (a.callsMonth || 0) + 1;
    a.costMonthUsd = +(a.costMonthUsd + usd).toFixed(6); a.costTodayUsd = +((a.costTodayUsd || 0) + usd).toFixed(6);
    const m = (a.models[u.model || 'unknown'] ||= { n: 0, credits: 0, usd: 0 }); m.n += 1; m.credits = r2(m.credits + take); m.usd = +(m.usd + usd).toFixed(6);
    a.lastActive = now;
    return { acc: a, result: { credits, take, short, balance: a.balance, usd } };
  });
  if (credits > 0 || usd > 0) await addLedger(st, email, { type: 'usage', credits: -res.take, balance: res.balance, model: u.model || '', cls: u.cls || '', agent: u.agent || '', in: u.in || 0, out: u.out || 0, usd: +usd.toFixed(6), ...(res.short ? { absorbed: res.short } : {}) });
  return res;
}

// + adds credits (grant / recharge / admin top-up); − removes them, never below zero. → { applied, balance }
export async function adjust(st, email, delta, { type = 'adjust', by = '', note = '', orderId = '' } = {}) {
  const d = r2(delta);
  if (!Number.isFinite(d) || d === 0) throw Object.assign(new Error('Enter a non-zero number of credits.'), { status: 400, code: 'bad_amount' });
  const cfg = await getConfig(st);
  const res = await mutate(st, email, (a0) => {
    const a = a0 || newAccount(cfg);
    const applied = d > 0 ? d : -r2(Math.min(a.balance, -d));
    a.balance = r2(a.balance + applied);
    if (applied > 0) { if (type === 'recharge') a.recharged = r2((a.recharged || 0) + applied); else a.granted = r2((a.granted || 0) + applied); }
    return { acc: a, result: { applied, balance: a.balance } };
  });
  await addLedger(st, email, { type, credits: res.applied, balance: res.balance, ...(by ? { by } : {}), ...(note ? { note: String(note).slice(0, 200) } : {}), ...(orderId ? { orderId } : {}) });
  return res;
}

// Admin / user settings on the account: { capMonth, paused, model }
export async function setOptions(st, email, o = {}) {
  const cfg = await getConfig(st);
  return mutate(st, email, (a0) => {
    const a = a0 || newAccount(cfg);
    if (o.capMonth !== undefined) a.capMonth = o.capMonth === null || o.capMonth === '' ? null : Math.max(0, Math.round(Number(o.capMonth) || 0));
    if (o.paused !== undefined) a.paused = !!o.paused;
    if (o.model !== undefined) a.model = o.model === 'auto' || !o.model ? 'auto' : String(o.model);
    return { acc: a, result: a };
  });
}

/* ----- per-user OpenRouter sub-keys (lib/orkeys.js) ----- */
// Keeps the user's sub-key in line with the account: created when missing, limit = spent so far + balance at cost
// (+5% and 1¢ headroom), disabled while paused or empty. No-op unless a real provisioning key is configured.
export async function syncSubKey(st, email, secret, { fetchImpl = fetch } = {}) {
  const s = await K.status({ fetchImpl });
  if (s.mode !== 'subkeys' || !secret) return { mode: s.mode };
  const cfg = await getConfig(st), a = await ensureAccount(st, email);
  const head = creditsToUsdAtCost(a.balance, cfg) * 1.05 + 0.01;
  const disabled = !!a.paused || !(a.balance > 0);
  try {
    if (!a.subKey) {
      const sk = await K.createSubKey(email, head, secret, { fetchImpl });
      if (disabled) await K.updateSubKey(sk.hash, { disabled: true }, { fetchImpl });
      await mutate(st, email, (x) => (x ? { acc: { ...x, subKey: { ...sk, disabled } }, result: null } : undefined));
      return { mode: 'subkeys', created: true, hash: sk.hash };
    }
    const info = await K.getSubKey(a.subKey.hash, { fetchImpl });
    const limitUsd = (Number(info.usage) || 0) + head;
    await K.updateSubKey(a.subKey.hash, { limitUsd, disabled }, { fetchImpl });
    await mutate(st, email, (x) => (x && x.subKey ? { acc: { ...x, subKey: { ...x.subKey, limitUsd: Math.round(limitUsd * 100) / 100, disabled, synced: Date.now() } }, result: null } : undefined));
    return { mode: 'subkeys', updated: true, hash: a.subKey.hash };
  } catch (e) { console.error('OpenRouter sub-key:', e.message); return { mode: 'subkeys', error: e.status || 'failed' }; }
}
// The OpenRouter key this user's calls run on: their own sub-key when sub-keys are on, else the platform key.
export async function keyFor(st, email, secret, opts = {}) {
  const s = await K.status(opts);
  if (s.mode === 'subkeys' && secret) {
    let a = await getAccount(st, email);
    if (!a || !a.subKey) { await syncSubKey(st, email, secret, opts); a = await getAccount(st, email); }
    if (a && a.subKey && !a.subKey.disabled) { const k = K.unseal(a.subKey.sealed, secret); if (k) return { key: k, source: 'subkey' }; }
  }
  return { key: await K.platformKey(opts), source: 'platform' };
}

/* ----- audit ----- */
export async function audit(st, by, action, detail = {}) {
  const row = { t: Date.now(), by, action, ...detail };
  await st.update(AUDIT, (cur) => { const l = parse(cur, []) || []; l.unshift(row); return JSON.stringify(l.slice(0, 500)); });
  return row;
}
export async function auditLog(st, limit = 100) { return (parse((await st.get(AUDIT))?.v, []) || []).slice(0, limit); }

/* ----- recharge orders (test stub; live payments stay off) ----- */
// Live Razorpay keys are refused here on purpose: payments are shelved until the GSTIN is in place (HANDOFF.md).
export function paymentsMode() {
  const id = env('RAZORPAY_KEY_ID');
  if (id && /^rzp_live_/.test(id)) return 'blocked_live';
  return 'test';
}
export async function createOrder(st, email, packId) {
  const cfg = await getConfig(st), pack = cfg.packs.find((p) => p.id === packId);
  if (!pack) throw Object.assign(new Error('Pick one of the recharge packs.'), { status: 400, code: 'bad_pack' });
  if (paymentsMode() === 'blocked_live') throw Object.assign(new Error('Live payments are switched off for now. Ask support to add credits.'), { status: 503, code: 'payments_off' });
  const id = 'ord_test_' + crypto.randomBytes(8).toString('hex');
  const o = { id, email, pack: pack.id, inr: pack.inr, credits: pack.credits, mode: 'test', status: 'created', at: Date.now() };
  await st.put(ORDER + id, JSON.stringify(o), o.at);
  return o;
}
// Test mode only: marks the order paid and adds the credits once (a second confirm does nothing).
export async function confirmTestOrder(st, email, id) {
  if (paymentsMode() !== 'test') throw Object.assign(new Error('Test payments are off.'), { status: 403, code: 'payments_off' });
  let order = null, first = false;
  await st.update(ORDER + String(id), (cur) => {
    const o = parse(cur, null);
    if (!o || o.email !== email) return undefined;
    order = o; if (o.status === 'paid') return undefined;
    first = true; order = { ...o, status: 'paid', paidAt: Date.now(), charged: false }; return JSON.stringify(order);
  });
  if (!order) throw Object.assign(new Error('That recharge was not found.'), { status: 404, code: 'not_found' });
  if (!first) return { order, applied: 0, balance: (await getAccount(st, email))?.balance ?? 0, duplicate: true };
  const r = await adjust(st, email, order.credits, { type: 'recharge', note: `Test recharge ₹${order.inr} (no money charged)`, orderId: order.id });
  return { order, ...r };
}

// Account deleted: its OpenRouter sub-key is deleted, then its credit account and ledger rows.
export async function forgetCredits(st, email) {
  const a = await getAccount(st, email).catch(() => null);
  if (a && a.subKey && a.subKey.hash) await K.deleteSubKey(a.subKey.hash).catch((e) => console.error('OpenRouter sub-key delete:', e.message));
  const rows = await st.listPrefix(LEDGER + email + ':').catch(() => []);
  const keys = [ACC + email, ...rows.map((r) => r.k)];
  if (st.delMany) await st.delMany(keys); else for (const k of keys) await st.put(k, null, Date.now());
}
