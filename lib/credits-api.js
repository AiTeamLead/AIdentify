// HTTP routes for AI credits (lib/credits.js) and Auto mode (lib/router.js).
//   Customer:  GET  /api/credits                     balance, month use, history, model picker, recharge packs
//              POST /api/credits/model {model}       "auto" or one model id from the picker
//              POST /api/credits/recharge {pack}     creates a TEST order (no money moves)
//              POST /api/credits/recharge/confirm {id}  test mode: marks it paid and adds the credits once
//   Admin:     GET  /api/admin/credits               every customer + totals vs the OpenRouter key limit + config + audit
//              GET  /api/admin/credits/ledger?email= one customer's ledger
//              POST /api/admin/credits/adjust {email, delta, note}     grant (+) or deduct (−)
//              POST /api/admin/credits/user {email, capMonth?, paused?} monthly cap, pause / resume AI
//              POST /api/admin/credits/config {routes?, markup?, inrPerCredit?, usdInr?, freeCredits?, lowBalance?, packs?}
// Every admin change writes an audit row (who, what, before → after).
import * as C from './credits.js';
import * as R from './router.js';
import * as K from './orkeys.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function pickerList(st, cfg) {
  const prices = await R.prices().catch(() => R.PRICE_TABLE);
  const ids = [...new Set([...R.PICKER, ...Object.values(cfg.routes).flat()])];
  return ids.map((id) => id === 'auto'
    ? { id: 'auto', name: 'Auto (recommended)', note: 'Picks the cheapest model that can do each job.' }
    : { id, name: (prices[id] && prices[id].name) || id, in: prices[id] ? prices[id].in : null, out: prices[id] ? prices[id].out : null, vision: !!(prices[id] && prices[id].vision), perMessage: C.typicalCredits(id, prices, cfg) });
}

export async function creditRoutes({ method, pathname, query, json, st, who, users, secret, HttpError, isStaff }) {
  if (!pathname.startsWith('/api/credits') && !pathname.startsWith('/api/admin/credits')) return undefined;
  const fail = (e) => { throw new HttpError(e.status || 400, e.code || 'bad_request', e.message); };

  /* ----- admin ----- */
  if (pathname.startsWith('/api/admin/credits')) {
    if (who.role !== 'admin') throw new HttpError(403, 'admin_only', 'Only an admin can manage AI credits.');
    const cfg = await C.getConfig(st);
    if (pathname === '/api/admin/credits' && method === 'GET') {
      const list = Object.entries(users || {}).filter(([, u]) => u && (u.role || 'customer') === 'customer');
      const rows = st.getMany ? await st.getMany(list.map(([e]) => C.ACC + e)) : [];
      const byKey = Object.fromEntries(rows.map((r) => [r.k, r]));
      const month = C.monthOf(), day = C.dayOf();
      const out = list.map(([email, u]) => {
        let a = null; try { a = byKey[C.ACC + email] ? JSON.parse(byKey[C.ACC + email].v) : null; } catch { a = null; }
        const live = a && a.month === month, today = a && a.day === day;
        const models = live ? Object.entries(a.models || {}).sort((x, y) => y[1].usd - x[1].usd).slice(0, 3).map(([id, m]) => ({ id, n: m.n, usd: m.usd })) : [];
        const costMonthUsd = live ? a.costMonthUsd : 0;
        return {
          email, name: u.name || '', plan: u.plan || (u.agency ? 'Agency' : 'Free'), joined: u.joined || null,
          started: !!a, balance: a ? a.balance : cfg.freeCredits, usedMonth: live ? a.usedMonth : 0, callsMonth: live ? a.callsMonth : 0,
          costMonthUsd: +costMonthUsd.toFixed(4), costMonthInr: r2(C.usdToInr(costMonthUsd, cfg)), costTodayUsd: today ? +a.costTodayUsd.toFixed(4) : 0,
          topModels: models, lastActive: (a && a.lastActive) || u.last || null, capMonth: a ? a.capMonth : null, paused: !!(a && a.paused), model: (a && a.model) || 'auto',
          low: !!a && a.balance <= cfg.lowBalance, empty: !!a && !(a.balance > 0),
          subKey: a && a.subKey ? { hint: a.subKey.hint, limitUsd: a.subKey.limitUsd, disabled: !!a.subKey.disabled } : null,
        };
      }).sort((x, y) => (y.lastActive || 0) - (x.lastActive || 0));
      const sum = (f) => out.reduce((n, x) => n + (Number(f(x)) || 0), 0);
      const todayUsd = sum((x) => x.costTodayUsd), monthUsd = sum((x) => x.costMonthUsd);
      const [prov, key] = await Promise.all([K.status().catch(() => ({ mode: 'fallback', reason: 'check failed' })), K.platformKeyInfo().catch(() => null)]);
      return {
        enabled: C.creditsOn(), month,
        totals: { todayUsd: +todayUsd.toFixed(4), monthUsd: +monthUsd.toFixed(4), todayInr: r2(C.usdToInr(todayUsd, cfg)), monthInr: r2(C.usdToInr(monthUsd, cfg)), creditsMonth: r2(sum((x) => x.usedMonth)), balances: r2(sum((x) => x.started ? x.balance : 0)), users: out.length, low: out.filter((x) => x.low).length, paused: out.filter((x) => x.paused).length },
        key: key && !key.error ? key : null, keyError: key && key.error ? String(key.error) : null,
        provisioning: { mode: prov.mode, reason: prov.reason, platformKeySource: prov.platformKeySource },
        config: cfg, tasks: R.TASK_LABELS, picker: await pickerList(st, cfg), users: out, audit: await C.auditLog(st, 50),
        payments: C.paymentsMode(),
      };
    }
    if (pathname === '/api/admin/credits/ledger' && method === 'GET') {
      const email = String(query.get('email') || '').toLowerCase();
      if (!users[email]) throw new HttpError(404, 'not_found', 'Customer not found.');
      return { email, account: await C.getAccount(st, email), ledger: await C.ledger(st, email, 200) };
    }
    if (method !== 'POST') return undefined;
    const b = json();
    const target = () => { const e = String(b.email || '').trim().toLowerCase(), u = users[e]; if (!u || isStaff(u.role || 'customer')) throw new HttpError(404, 'not_found', 'Customer not found.'); return e; };
    if (pathname === '/api/admin/credits/adjust') {
      const email = target(), delta = Number(b.delta);
      if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1e6) throw new HttpError(400, 'bad_amount', 'Enter a number of credits, e.g. 100 or -25.');
      let r; try { r = await C.adjust(st, email, delta, { type: delta > 0 ? 'grant' : 'adjust', by: who.email, note: b.note || (delta > 0 ? 'Admin grant' : 'Admin deduction') }); } catch (e) { fail(e); }
      await C.audit(st, who.email, delta > 0 ? 'grant' : 'deduct', { email, credits: r.applied, balance: r.balance, note: String(b.note || '').slice(0, 200) });
      const sk = await C.syncSubKey(st, email, secret);
      return { ok: true, ...r, subKey: sk };
    }
    if (pathname === '/api/admin/credits/user') {
      const email = target(), before = await C.ensureAccount(st, email), o = {};
      if (b.capMonth !== undefined) o.capMonth = b.capMonth === null || b.capMonth === '' ? null : Number(b.capMonth);
      if (o.capMonth != null && (!Number.isFinite(o.capMonth) || o.capMonth < 0)) throw new HttpError(400, 'bad_cap', 'The monthly cap must be 0 or more credits, or empty for no cap.');
      if (b.paused !== undefined) o.paused = !!b.paused;
      const a = await C.setOptions(st, email, o);
      await C.audit(st, who.email, 'user_options', { email, before: { capMonth: before.capMonth, paused: before.paused }, after: { capMonth: a.capMonth, paused: a.paused } });
      const sk = await C.syncSubKey(st, email, secret);
      return { ok: true, account: { capMonth: a.capMonth, paused: a.paused, balance: a.balance }, subKey: sk };
    }
    if (pathname === '/api/admin/credits/config') {
      const input = {};
      for (const k of ['markup', 'inrPerCredit', 'usdInr', 'freeCredits', 'minCharge', 'lowBalance', 'packs']) if (b[k] !== undefined) input[k] = b[k];
      if (b.routes !== undefined) {
        if (!b.routes || typeof b.routes !== 'object') throw new HttpError(400, 'bad_routes', 'The routing table must list models for each task.');
        for (const t of R.TASKS) {
          const raw = b.routes[t]; if (raw === undefined) continue;
          const list = (Array.isArray(raw) ? raw : String(raw).split(/[\n,]/)).map((s) => String(s).trim()).filter(Boolean);
          const bad = list.find((m) => !R.okModel(m));
          if (!list.length || bad) throw new HttpError(400, 'bad_routes', bad ? `“${String(bad).slice(0, 60)}” is not an OpenRouter model id (vendor/model).` : `Add at least one model for ${R.TASK_LABELS[t]}.`);
        }
        input.routes = { ...cfg.routes, ...b.routes };
      }
      const next = await C.saveConfig(st, input);
      await C.audit(st, who.email, 'config', { before: { markup: cfg.markup, inrPerCredit: cfg.inrPerCredit, freeCredits: cfg.freeCredits, routes: cfg.routes }, after: { markup: next.markup, inrPerCredit: next.inrPerCredit, freeCredits: next.freeCredits, routes: next.routes } });
      return { ok: true, config: next };
    }
    return undefined;
  }

  /* ----- customer ----- */
  if (isStaff(who.role)) throw new HttpError(403, 'customers_only', 'AI credits belong to customer accounts. Admins use the AI credits tab.');
  if (!C.creditsOn()) return { enabled: false };
  const cfg = await C.getConfig(st);
  if (pathname === '/api/credits' && method === 'GET') {
    const a = await C.ensureAccount(st, who.email);
    return {
      enabled: true, balance: a.balance, usedMonth: a.usedMonth, callsMonth: a.callsMonth, capMonth: a.capMonth, paused: a.paused, model: a.model || 'auto',
      low: a.balance <= cfg.lowBalance, freeCredits: cfg.freeCredits, inrPerCredit: cfg.inrPerCredit, packs: cfg.packs, payments: C.paymentsMode(),
      models: await pickerList(st, cfg), history: (await C.ledger(st, who.email, 50)).map((e) => ({ t: e.t, type: e.type, credits: e.credits, balance: e.balance, model: e.model || '', cls: e.cls || '', note: e.note || '' })),
    };
  }
  if (method !== 'POST') return undefined;
  const b = json();
  if (pathname === '/api/credits/model') {
    const m = String(b.model || 'auto').trim();
    const allowed = (await pickerList(st, cfg)).map((x) => x.id);
    if (!allowed.includes(m)) throw new HttpError(400, 'bad_model', 'Pick Auto or one of the listed models.');
    const a = await C.setOptions(st, who.email, { model: m });
    return { ok: true, model: a.model };
  }
  if (pathname === '/api/credits/recharge') { try { return { ok: true, order: await C.createOrder(st, who.email, String(b.pack || '')) }; } catch (e) { fail(e); } }
  if (pathname === '/api/credits/recharge/confirm') {
    let r; try { r = await C.confirmTestOrder(st, who.email, String(b.id || '')); } catch (e) { fail(e); }
    if (!r.duplicate) await C.syncSubKey(st, who.email, secret);
    return { ok: true, ...r };
  }
  return undefined;
}
