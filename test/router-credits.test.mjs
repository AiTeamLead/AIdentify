// Auto mode (lib/router.js), AI credits (lib/credits.js), per-user OpenRouter sub-keys (lib/orkeys.js) and their routes.
// Everything runs against local stand-ins: a mock OpenRouter (chat, /key, /keys) and temp stores. Nothing is spent.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.mjs';
import * as R from '../lib/router.js';
import * as C from '../lib/credits.js';
import * as K from '../lib/orkeys.js';
import { sqlStore } from '../lib/db.js';

let PGlite = null; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { /* skipped below */ }

/* ----- a mock OpenRouter ----- */
// opts.keyKind: 'normal' | 'provisioning' | 'reject'; opts.fail: { [model]: status } answers that status for that model
async function mockOpenRouter(opts = {}) {
  const calls = [], keys = new Map();
  const srv = http.createServer(async (req, res) => {
    let raw = ''; for await (const d of req) raw += d;
    const j = raw ? JSON.parse(raw) : {}, auth = String(req.headers.authorization || '');
    const url = new URL(req.url, 'http://x'), p = url.pathname.replace(/^\/v1/, '');
    calls.push({ method: req.method, path: p, auth, body: j });
    const send = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (p === '/key') {
      if (opts.keyKind === 'reject') return send(401, { error: { message: 'bad key' } });
      return send(200, { data: { label: 'sk-or-v1-x…', limit: 50, limit_remaining: 49.5, usage: 0.5, usage_daily: 0.1, usage_monthly: 0.5, is_provisioning_key: opts.keyKind === 'provisioning', is_free_tier: false } });
    }
    if (p === '/keys' && req.method === 'GET') return opts.keyKind === 'provisioning' ? send(200, { data: [...keys.values()] }) : send(403, { error: { message: 'not a provisioning key' } });
    if (p === '/keys' && req.method === 'POST') {
      if (opts.keyKind !== 'provisioning') return send(403, {});
      const hash = 'h' + (keys.size + 1), key = 'sk-or-v1-sub-' + hash + '-' + 'z'.repeat(20);
      const row = { hash, name: j.name, limit: j.limit, disabled: false, usage: 0 };
      keys.set(hash, row); return send(201, { data: row, key });
    }
    const km = p.match(/^\/keys\/([^/]+)$/);
    if (km) {
      const row = keys.get(km[1]); if (!row) return send(404, {});
      if (req.method === 'GET') return send(200, { data: row });
      if (req.method === 'PATCH') { Object.assign(row, j.limit != null ? { limit: j.limit } : {}, j.disabled != null ? { disabled: j.disabled } : {}); return send(200, { data: row }); }
      if (req.method === 'DELETE') { keys.delete(km[1]); return send(200, { deleted: true }); }
    }
    if (p === '/models') return send(200, { data: [] });
    if (p === '/chat/completions') {
      const st = opts.fail && opts.fail[j.model]; if (st) return send(st, { error: { message: 'mock ' + st } });
      return send(200, { id: 'gen', model: j.model, choices: [{ index: 0, message: { role: 'assistant', content: 'Hi from ' + j.model }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: opts.cost ?? 0.002 } });
    }
    send(404, {});
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/v1`, calls, keys, close: () => new Promise((r) => srv.close(r)) };
}

// in-memory store with the same async read-modify-write shape as data/kv.json (lib/backend.js fileStore)
function memStore() {
  const c = {};
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    kind: 'file',
    async get(k) { await tick(); return c[k] || null; },
    async put(k, v, at) { await tick(); if (v === null) delete c[k]; else c[k] = { k, v, at }; },
    async getMany(keys) { return keys.map((k) => c[k]).filter(Boolean); },
    async delMany(keys) { let n = 0; for (const k of keys) if (k in c) { delete c[k]; n++; } return n; },
    async listPrefix(p) { return Object.values(c).filter((x) => x.k.startsWith(p)); },
    async update(k, fn) { await tick(); const cur = c[k] ? c[k].v : null; const next = await fn(cur); if (next === undefined) return cur; await tick(); c[k] = { k, v: next, at: Date.now() }; return next; },
  };
}

/* ----- classifier / router ----- */
test('router: classifies simple, vision, build and hard requests', () => {
  assert.equal(R.classify({ prompt: 'Hi, are you open on Sunday?', meta: { agent: 'frontdesk' } }), 'simple');
  assert.equal(R.classify({ prompt: 'What time is it?' }), 'simple');
  assert.equal(R.classify({ prompt: 'What is in this photo?', images: ['https://x.test/a.png'] }), 'vision');
  assert.equal(R.classify({ messages: [{ role: 'user', content: [{ type: 'text', text: 'see' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }] }] }), 'vision');
  assert.equal(R.classify({ prompt: 'Build a landing page for my dental clinic in Hyderabad' }), 'build');
  assert.equal(R.classify({ prompt: 'Change the headline to Welcome' }), 'build');
  assert.equal(R.classify({ prompt: 'next?', tools: [{ name: 'crm_search' }] }), 'build');
  assert.equal(R.classify({ prompt: 'x', meta: { tier: 'strong' } }), 'hard');
  assert.equal(R.classify({ prompt: 'Analyse my last 6 months of sales and give me a pricing strategy with trade-offs for each plan, step by step, including unit economics and a forecast for next quarter based on the numbers below. ' + 'Jan 10 Feb 12 Mar 9 Apr 14 May 16 Jun 18 '.repeat(5) }), 'hard');
  assert.equal(R.classify({ prompt: 'analyse this' }), 'simple', 'a short ask stays on the cheap model');
  assert.equal(R.classify({ prompt: 'x', meta: { task: 'hard' } }), 'hard');
});

test('router: plan = cheapest capable chain, the user pick goes first, vision falls back from a text-only pick', () => {
  const s = R.planFor({ prompt: 'hello' });
  assert.equal(s.cls, 'simple'); assert.deepEqual(s.plan.map((x) => x.model), R.DEFAULT_ROUTES.simple);
  assert.ok(s.plan.every((x) => x.provider === 'openrouter'));
  assert.equal(R.planFor({ prompt: 'make me a website for my cafe' }).plan[0].model, 'anthropic/claude-haiku-5.5');
  assert.match(R.planFor({ prompt: 'x', meta: { tier: 'strong' } }).plan[0].model, /claude-sonnet/);
  const own = R.planFor({ prompt: 'hello' }, { pick: 'anthropic/claude-sonnet-5.5' });
  assert.equal(own.plan[0].model, 'anthropic/claude-sonnet-5.5'); assert.equal(own.picked, 'anthropic/claude-sonnet-5.5');
  assert.equal(own.plan.length, 1 + R.DEFAULT_ROUTES.simple.length, 'the route stays as the fallback chain');
  const vis = R.planFor({ prompt: 'see', images: ['https://x/y.png'] }, { pick: 'deepseek/deepseek-v4-flash' });
  assert.equal(vis.picked, ''); assert.equal(vis.plan[0].model, R.DEFAULT_ROUTES.vision[0]);
  // the routing table is config
  const custom = R.planFor({ prompt: 'hello' }, { routes: { ...R.DEFAULT_ROUTES, simple: ['openai/gpt-5-nano'] } });
  assert.deepEqual(custom.plan.map((x) => x.model), ['openai/gpt-5-nano']);
});

test('router: an admin-edited table drops junk ids and never leaves a task empty', () => {
  const r = R.cleanRoutes({ simple: 'openai/gpt-5-nano, not a model, ../etc/passwd', vision: [], build: ['anthropic/claude-haiku-5.5', 'anthropic/claude-haiku-5.5'] });
  assert.deepEqual(r.simple, ['openai/gpt-5-nano']);
  assert.deepEqual(r.vision, R.DEFAULT_ROUTES.vision);
  assert.deepEqual(r.build, ['anthropic/claude-haiku-5.5']);
  assert.deepEqual(r.hard, R.DEFAULT_ROUTES.hard);
  assert.equal(R.estimateUsd('anthropic/claude-haiku-5.5', 1e6, 1e6), 0.6);
  assert.equal(R.estimateUsd('unknown/model', 1e6, 0), 3, 'unknown models are priced conservatively');
});

/* ----- credit math ----- */
test('credits: cost → credits with the configured markup, unit and minimum', () => {
  const cfg = C.cleanConfig({ markup: 3, inrPerCredit: 1, usdInr: 93, minCharge: 0.01 });
  assert.equal(C.toCredits(0, cfg), 0);
  assert.equal(C.toCredits(0.01, cfg), 2.79); // $0.01 × ₹93 × 3 ÷ ₹1
  assert.equal(C.toCredits(0.000001, cfg), 0.01, 'tiny calls cost the minimum');
  assert.equal(C.toCredits(0.01, { ...cfg, markup: 2 }), 1.86);
  assert.equal(C.toCredits(0.01, { ...cfg, inrPerCredit: 0.5 }), 5.58);
  assert.ok(Math.abs(C.creditsToUsdAtCost(279, cfg) - 1) < 1e-9, '279 credits are worth $1 of AI at cost');
  const clean = C.cleanConfig({ markup: 0.2, usdInr: 5000, freeCredits: -4 });
  assert.equal(clean.markup, 1, 'never sells below cost'); assert.equal(clean.usdInr, 200); assert.equal(clean.freeCredits, 0);
  assert.ok(C.typicalCredits('anthropic/claude-sonnet-5.5', R.PRICE_TABLE, cfg) > 10 * C.typicalCredits('google/gemini-2.5-flash-lite', R.PRICE_TABLE, cfg), 'pricier models burn more credits');
  assert.equal(C.costUsdOf({ cost: 0.004, model: 'x/y', in: 1, out: 1 }), 0.004, 'OpenRouter\'s reported cost wins');
});

test('credits: 50 free credits, usage, grants, recharge, hard stop at 0 and no negative balance', async () => {
  const st = memStore(); C._resetConfigCache();
  const a = await C.ensureAccount(st, 'u@x.test');
  assert.equal(a.balance, 50);
  assert.equal((await C.ensureAccount(st, 'u@x.test')).balance, 50, 'the grant happens once');
  const r = await C.charge(st, 'u@x.test', { model: 'anthropic/claude-haiku-5.5', in: 1000, out: 200, cost: 0.01 }, { prices: R.PRICE_TABLE });
  assert.equal(r.credits, 2.79); assert.equal(r.balance, 47.21);
  await C.adjust(st, 'u@x.test', -1000, { by: 'admin' });
  assert.equal((await C.getAccount(st, 'u@x.test')).balance, 0, 'a big deduction stops at zero');
  await assert.rejects(C.checkRoom(st, 'u@x.test'), (e) => e.code === 'no_credits' && e.status === 402 && /Recharge/.test(e.message));
  const big = await C.charge(st, 'u@x.test', { model: 'x/y', cost: 1 }, { prices: R.PRICE_TABLE });
  assert.equal(big.take, 0); assert.equal(big.balance, 0); assert.ok(big.short > 0, 'overshoot is absorbed, not owed');
  const o = await C.createOrder(st, 'u@x.test', 'p200');
  assert.equal(o.mode, 'test');
  const paid = await C.confirmTestOrder(st, 'u@x.test', o.id);
  assert.equal(paid.balance, 200);
  const again = await C.confirmTestOrder(st, 'u@x.test', o.id);
  assert.equal(again.duplicate, true); assert.equal((await C.getAccount(st, 'u@x.test')).balance, 200, 'a second confirm adds nothing');
  await assert.rejects(C.confirmTestOrder(st, 'other@x.test', o.id), (e) => e.code === 'not_found');
  await C.setOptions(st, 'u@x.test', { paused: true });
  await assert.rejects(C.checkRoom(st, 'u@x.test'), (e) => e.code === 'ai_paused');
  await C.setOptions(st, 'u@x.test', { paused: false, capMonth: 1 });
  await C.charge(st, 'u@x.test', { model: 'x/y', cost: 0.01 }, { prices: R.PRICE_TABLE });
  await assert.rejects(C.checkRoom(st, 'u@x.test'), (e) => e.code === 'monthly_cap');
  const types = (await C.ledger(st, 'u@x.test', 100)).map((e) => e.type);
  for (const t of ['grant', 'usage', 'adjust', 'recharge']) assert.ok(types.includes(t), 'ledger has ' + t);
});

test('credits: live Razorpay keys are refused (no live payments)', async () => {
  const st = memStore(); const old = process.env.RAZORPAY_KEY_ID;
  process.env.RAZORPAY_KEY_ID = 'rzp_live_abc';
  try { await assert.rejects(C.createOrder(st, 'u@x.test', 'p200'), (e) => e.code === 'payments_off'); }
  finally { if (old === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = old; }
});

test('credits: 200 parallel charges on one account never lose an update or go negative (in-process)', async () => {
  const st = memStore(); C._resetConfigCache();
  await C.ensureAccount(st, 'race@x.test'); // 50 credits
  const cost = 1 / (93 * 3); // exactly 1 credit each
  const res = await Promise.all(Array.from({ length: 200 }, () => C.charge(st, 'race@x.test', { model: 'x/y', cost }, { prices: R.PRICE_TABLE })));
  const a = await C.getAccount(st, 'race@x.test');
  assert.equal(a.balance, 0);
  assert.equal(res.reduce((n, r) => n + r.take, 0), 50, 'exactly the balance was taken');
  assert.equal(a.callsMonth, 200);
  assert.ok(res.every((r) => r.balance >= 0));
});

test('credits: two servers on one Postgres deduct atomically (compare-and-swap)', { skip: !PGlite && 'install devDependencies (@electric-sql/pglite)' }, async () => {
  const db = new PGlite();
  const q = async (text, params = []) => (await db.query(text, params)).rows;
  const st1 = sqlStore(q, { schema: 'credrace' }), st2 = sqlStore(q, { schema: 'credrace' });
  const C2 = await import('../lib/credits.js?server2'); // a second module copy = a second server's in-process lock
  C._resetConfigCache(); C2._resetConfigCache();
  await C.adjust(st1, 'pg@x.test', 50, { type: 'grant' }); // 50 free + 50 = 100
  const cost = 1 / (93 * 3);
  const jobs = [];
  for (let i = 0; i < 60; i++) jobs.push(C.charge(st1, 'pg@x.test', { model: 'x/y', cost }, { prices: R.PRICE_TABLE }), C2.charge(st2, 'pg@x.test', { model: 'x/y', cost }, { prices: R.PRICE_TABLE }));
  const res = await Promise.all(jobs);
  const a = await C.getAccount(st1, 'pg@x.test');
  assert.equal(a.balance, 0);
  assert.equal(res.reduce((n, r) => n + r.take, 0), 100);
  assert.equal(a.callsMonth, 120);
  await db.close();
});

/* ----- provisioning fallback ----- */
test('sub-keys: off without a key, fallback on a normal key, on with a provisioning key (create, raise, disable)', async () => {
  const env0 = { ...process.env };
  const normal = await mockOpenRouter({ keyKind: 'normal' }), prov = await mockOpenRouter({ keyKind: 'provisioning' });
  try {
    delete process.env.OPENROUTER_PROVISIONING_KEY; delete process.env.OPENROUTER_API_KEY; K._resetStatus();
    assert.equal((await K.status()).mode, 'off');
    assert.equal(await K.platformKey(), '');

    process.env.OPENROUTER_BASE_URL = normal.url; process.env.OPENROUTER_PROVISIONING_KEY = 'sk-or-v1-normal-' + 'n'.repeat(30); K._resetStatus();
    const s = await K.status();
    assert.equal(s.mode, 'fallback'); assert.match(s.reason, /normal API key/);
    assert.equal(await K.platformKey(), process.env.OPENROUTER_PROVISIONING_KEY, 'a normal key in the provisioning slot becomes the platform key');
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-platform-' + 'p'.repeat(30);
    assert.equal(await K.platformKey(), process.env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY wins when set');
    const st = memStore(); C._resetConfigCache();
    const k1 = await C.keyFor(st, 'f@x.test', 'secret');
    assert.equal(k1.source, 'platform');
    assert.equal(normal.calls.filter((c) => c.method === 'POST' && c.path === '/keys').length, 0, 'no key creation attempted on a normal key');

    process.env.OPENROUTER_BASE_URL = prov.url; process.env.OPENROUTER_PROVISIONING_KEY = 'sk-or-v1-prov-' + 'q'.repeat(30); K._resetStatus();
    assert.equal((await K.status()).mode, 'subkeys');
    const k2 = await C.keyFor(st, 's@x.test', 'secret');
    assert.equal(k2.source, 'subkey'); assert.match(k2.key, /^sk-or-v1-sub-h1/);
    const acc = await C.getAccount(st, 's@x.test');
    assert.ok(acc.subKey.sealed && !acc.subKey.sealed.includes('sk-or'), 'stored sealed, never in clear');
    assert.ok(Math.abs(prov.keys.get('h1').limit - (C.creditsToUsdAtCost(50) * 1.05 + 0.01)) < 0.011, 'limit = balance at cost + headroom');
    await C.adjust(st, 's@x.test', 279, { type: 'recharge' });
    await C.syncSubKey(st, 's@x.test', 'secret');
    assert.ok(prov.keys.get('h1').limit > 1, 'recharge raises the key limit');
    await C.setOptions(st, 's@x.test', { paused: true });
    await C.syncSubKey(st, 's@x.test', 'secret');
    assert.equal(prov.keys.get('h1').disabled, true, 'pause disables the key');
    assert.equal((await C.keyFor(st, 's@x.test', 'secret')).source, 'platform');
    await C.forgetCredits(st, 's@x.test');
    assert.equal(prov.keys.has('h1'), false, 'account deletion deletes the sub-key');
    assert.equal(await C.getAccount(st, 's@x.test'), null);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in env0)) delete process.env[k];
    Object.assign(process.env, env0); K._resetStatus(); K._resetKeyInfo();
    await normal.close(); await prov.close();
  }
});

/* ----- end to end: server + mock OpenRouter ----- */
const ADMIN_PW = 'Strong-Admin-Passphrase-2026!';
let or, srv, tok, admin;
test.describe('server: Auto mode + credits + admin dashboard', () => {
  test.before(async () => {
    or = await mockOpenRouter({ keyKind: 'normal', cost: 0.002, fail: { 'google/gemini-2.5-flash-lite': 429 } });
    srv = await startServer({ AI_CREDITS: 'on', AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-or-v1-platform-' + 'p'.repeat(30), OPENROUTER_BASE_URL: or.url, ROUTER_LIVE_PRICES: 'off', RATE_LIMIT: 'off', ADMIN_PASSWORD: ADMIN_PW });
    const s = await srv.api('/api/auth/signup', { email: 'owner@demo.test', name: 'Owner', password: 'Correct-Horse-42!' });
    assert.equal(s.status, 200, JSON.stringify(s.d)); tok = s.d.token;
    const a = await srv.api('/api/auth/login', { email: 'admin@aidentify.local', password: ADMIN_PW });
    assert.equal(a.status, 200, JSON.stringify(a.d)); admin = a.d.token;
  });
  test.after(async () => { await srv?.stop(); await or?.close(); });
  const chats = () => or.calls.filter((c) => c.path === '/chat/completions');

  test('sign-up gives 50 credits; a simple chat routes to the cheap model and falls back on a rate limit', async () => {
    const c0 = await srv.api('/api/credits', undefined, tok);
    assert.equal(c0.status, 200); assert.equal(c0.d.balance, 50); assert.equal(c0.d.model, 'auto');
    assert.ok(c0.d.models.some((m) => m.id === 'auto'));
    const r = await srv.api('/api/ai', { prompt: 'Say hello', use_profile: false }, tok);
    assert.equal(r.status, 200, JSON.stringify(r.d));
    const tried = chats().map((c) => c.body.model);
    assert.deepEqual(tried.slice(0, 2), ['google/gemini-2.5-flash-lite', 'deepseek/deepseek-v4-flash'], '429 on the first model → the next one');
    assert.equal(chats().at(-1).body.usage.include, true, 'asks OpenRouter for the real cost');
    const c1 = await srv.api('/api/credits', undefined, tok);
    assert.equal(c1.d.balance, 50 - C.toCredits(0.002, C.defaults()));
    assert.equal(c1.d.history[0].type, 'usage'); assert.equal(c1.d.history[0].model, 'deepseek/deepseek-v4-flash'); assert.equal(c1.d.history[0].cls, 'simple');
  });

  test('a website request routes to Claude Haiku; the model picker overrides Auto', async () => {
    await srv.api('/api/ai', { prompt: 'Build a landing page for my salon with a booking section', use_profile: false }, tok);
    assert.equal(chats().at(-1).body.model, 'anthropic/claude-haiku-5.5');
    assert.equal((await srv.api('/api/credits/model', { model: 'evil/model' }, tok)).status, 400);
    assert.equal((await srv.api('/api/credits/model', { model: 'anthropic/claude-sonnet-5.5' }, tok)).status, 200);
    await srv.api('/api/ai', { prompt: 'Say hello', use_profile: false }, tok);
    assert.equal(chats().at(-1).body.model, 'anthropic/claude-sonnet-5.5');
    await srv.api('/api/credits/model', { model: 'auto' }, tok);
  });

  test('setup can finish on AI credits without the customer\'s own key', async () => {
    assert.equal((await srv.api('/api/clinic/role', { role: 'aesthetic' }, tok)).status, 200);
    const f = await srv.api('/api/clinic/setup/finish', { tone: 'Warm', ack: true }, tok);
    assert.equal(f.status, 200, JSON.stringify(f.d));
  });

  test('customers cannot open the admin dashboard; the admin sees users, totals and the key limit', async () => {
    assert.equal((await srv.api('/api/admin/credits', undefined, tok)).status, 403);
    const d = await srv.api('/api/admin/credits', undefined, admin);
    assert.equal(d.status, 200, JSON.stringify(d.d));
    const u = d.d.users.find((x) => x.email === 'owner@demo.test');
    assert.ok(u && u.started && u.callsMonth >= 3 && u.costMonthUsd > 0 && u.costMonthInr > 0 && u.topModels.length);
    assert.ok(d.d.totals.monthUsd > 0);
    assert.equal(d.d.key.limit, 50); assert.equal(d.d.provisioning.mode, 'off');
    assert.ok(!JSON.stringify(d.d).includes('sk-or-v1'), 'no key ever reaches the page');
  });

  test('admin: deduct to zero → friendly recharge stop; grant, pause, cap and config are audit-logged', async () => {
    const dd = await srv.api('/api/admin/credits/adjust', { email: 'owner@demo.test', delta: -1000, note: 'test' }, admin);
    assert.equal(dd.status, 200); assert.equal(dd.d.balance, 0);
    const n = chats().length;
    const stop = await srv.api('/api/ai', { prompt: 'Say hello', use_profile: false }, tok);
    assert.equal(stop.status, 402); assert.equal(stop.d.error, 'no_credits'); assert.match(stop.d.message, /Recharge/);
    assert.equal(chats().length, n, 'no model is called at zero balance');
    const o = await srv.api('/api/credits/recharge', { pack: 'p200' }, tok);
    assert.equal(o.status, 200); assert.equal(o.d.order.mode, 'test');
    const paid = await srv.api('/api/credits/recharge/confirm', { id: o.d.order.id }, tok);
    assert.equal(paid.d.balance, 200);
    assert.equal((await srv.api('/api/ai', { prompt: 'Say hello', use_profile: false }, tok)).status, 200);
    assert.equal((await srv.api('/api/admin/credits/user', { email: 'owner@demo.test', paused: true }, admin)).status, 200);
    const p = await srv.api('/api/ai', { prompt: 'Say hello', use_profile: false }, tok);
    assert.equal(p.status, 403); assert.equal(p.d.error, 'ai_paused');
    await srv.api('/api/admin/credits/user', { email: 'owner@demo.test', paused: false, capMonth: 500 }, admin);
    assert.equal((await srv.api('/api/admin/credits/config', { routes: { simple: ['nope'] } }, admin)).status, 400);
    const cfg = await srv.api('/api/admin/credits/config', { markup: 4, routes: { simple: ['openai/gpt-5-nano'] } }, admin);
    assert.equal(cfg.status, 200); assert.equal(cfg.d.config.markup, 4);
    await srv.api('/api/ai', { prompt: 'Say hello', use_profile: false }, tok);
    assert.equal(chats().at(-1).body.model, 'openai/gpt-5-nano', 'the edited routing table is used');
    const d = await srv.api('/api/admin/credits', undefined, admin);
    const acts = d.d.audit.map((a) => a.action);
    for (const a of ['deduct', 'user_options', 'config']) assert.ok(acts.includes(a), 'audit has ' + a);
    assert.equal(d.d.audit[0].by, 'admin@aidentify.local');
    const led = await srv.api('/api/admin/credits/ledger?email=owner@demo.test', undefined, admin);
    assert.ok(led.d.ledger.some((e) => e.type === 'recharge'));
  });
});
