// Live apps (FormFirst, AfterJob, Nudge, PartPing, ChangeSlip): connect, records, every action, re-sign-in and
// errors — against an in-process fake of each app's API (fetch is replaced; nothing leaves the machine).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE, liveRoutes, liveConnected, liveContext, liveSpec, liveAct, takeDo, runLiveActs } from '../lib/liveapps.js';

const BASE = 'https://93.184.216.34'; // a public IP literal: passes the private-address check without DNS
const memStore = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? { v: m.get(k) } : null), put: async (k, v) => { m.set(k, v); } }; };
const secret = async () => 'test-secret';
class HttpError extends Error { constructor(status, code, msg) { super(msg); this.status = status; this.code = code; } }

// ----- fake apps -----
function fakeApps() {
  const s = {
    calls: [], expired: new Set(), down: false, badLogin: false, noCookie: false, adminOnlyLogin: false,
    forms: [{ id: 1, slug: 'web', name: 'Website enquiries', active: true }],
    leads: [{ id: 7, name: 'Asha Rao', email: 'asha@example.com', message: 'Need a quote', form_name: 'Website enquiries', status: 'new', asked: 1 }],
    jobs: [{ id: 3, token: 'tok3', customer_name: 'Ravi K', job_ref: 'J-9', service_summary: 'AC service', status: 'open' }],
    nleads: [{ id: 4, name: 'Meena', company: 'Acme', email: 'meena@acme.in', status: 'open' }],
    orders: [{ code: 'PP-100', part_name: 'Brake pad', part_number: 'BP1', quantity: 2, status: 'requested', customer_email: 'c@x.in', customer_name: 'Cust' }],
    slips: [{ id: 11, title: 'Extra wiring', amount_cents: 150000, currency: 'INR', status: 'open', job_ref: 'J-9' }],
  };
  const res = (status, body, cookie) => {
    const h = new Headers({ 'content-type': 'application/json' });
    if (cookie) h.append('set-cookie', cookie + '; Path=/; HttpOnly');
    return new Response(JSON.stringify(body), { status, headers: h });
  };
  globalThis.fetch = async (url, opt = {}) => {
    const u = new URL(url), p = u.pathname, m = (opt.method || 'GET').toUpperCase(), body = opt.body ? JSON.parse(opt.body) : {};
    const cookie = (opt.headers && opt.headers.cookie) || '';
    s.calls.push(m + ' ' + p);
    if (s.down) throw new Error('connect ECONNREFUSED');
    const name = Object.values(LIVE).find((A) => cookie.startsWith(A.cookie + '='));
    if (p.endsWith('/login')) {
      if (s.badLogin && !(s.adminOnlyLogin && p.includes('/admin/'))) return res(401, { error: 'Wrong email or password' });
      if (s.noCookie) return res(200, { user: { name: 'X' } });
      const c = ['ff_token', 'aj_token', 'nd_token', 'pp_token', 'cs_token'].map((k) => k + '=abc' + s.calls.length);
      const h = new Headers({ 'content-type': 'application/json' }); for (const x of c) h.append('set-cookie', x + '; Path=/');
      return new Response(JSON.stringify({ user: { name: 'Owner', business: 'Bright Dental' } }), { status: 200, headers: h });
    }
    if (!p.startsWith('/api/f/') && !p.startsWith('/api/lead/') && !p.startsWith('/api/public/') && !p.startsWith('/api/track/')) {
      if (!cookie) return res(401, { error: 'Sign in' });
      if (s.expired.has(cookie.split('=')[0])) { s.expired.delete(cookie.split('=')[0]); return res(401, { error: 'expired' }); }
    }
    void name;
    // FormFirst
    if (p === '/api/owner/forms' && m === 'GET') return res(200, { forms: s.forms });
    if (p === '/api/owner/forms' && m === 'POST') { const f = { id: 2, slug: 'new-form', name: body.name, active: true }; s.forms.push(f); return res(200, { id: f.id, slug: f.slug }); }
    if (p === '/api/owner/leads') return res(200, { leads: s.leads });
    if (p === '/api/auth/me') return res(200, { user: { name: 'Owner', business: 'Bright Dental' } });
    if (/^\/api\/f\/[^/]+\/submit$/.test(p)) return res(200, { token: 'lt1' });
    if (p === '/api/lead/lt1' && m === 'GET') return res(200, { status: 'asking', messages: [{ role: 'ai', content: 'Thanks! When do you need it?' }] });
    if (p === '/api/lead/lt1/reply') return res(200, { status: body.content.includes('done') ? 'done' : 'asking' });
    if (/^\/api\/owner\/leads\/\d+\/status$/.test(p)) return res(200, { ok: true });
    if (/^\/api\/owner\/leads\/\d+\/summarize$/.test(p)) return res(200, { ok: true });
    if (/^\/api\/owner\/leads\/\d+$/.test(p)) return res(200, { lead: { name: 'Asha Rao', qualification: 'hot', summary: { summary: 'Wants a quote', urgency: 'high', next_step: 'Call today' } } });
    // AfterJob
    if (p === '/api/admin/jobs' && m === 'GET') return res(200, { jobs: s.jobs });
    if (p === '/api/admin/jobs' && m === 'POST') return res(200, { job: { id: 5, token: 'tok5' } });
    if (/^\/api\/admin\/jobs\/\d+\/close$/.test(p)) return res(200, { ok: true });
    if (/^\/api\/public\/jobs\/[^/]+\/feedback$/.test(p)) return res(200, { happy: body.score >= 4 });
    // Nudge
    if (p === '/api/admin/leads' && m === 'GET') return res(200, { leads: s.nleads });
    if (p === '/api/admin/leads' && m === 'POST') return res(200, { lead: { id: 9 } });
    if (/^\/api\/admin\/leads\/\d+\/status$/.test(p)) return res(200, { ok: true });
    // PartPing
    if (p === '/api/orders' && m === 'GET') return res(200, { orders: s.orders });
    if (p === '/api/orders' && m === 'POST') return res(200, { code: 'PP-200' });
    if (/^\/api\/orders\/[^/]+\/cancel$/.test(p)) return res(200, { ok: true });
    if (p === '/api/admin/orders') return res(200, { orders: s.orders });
    if (/^\/api\/admin\/orders\/[^/]+\/status$/.test(p)) return res(200, { ok: true });
    if (p.startsWith('/api/track/')) return res(200, { order: { code: 'PP-100', part_name: 'Brake pad', status: 'dispatched', logs: [{ status: 'requested', at: 1 }, { status: 'dispatched', note: 'Courier', at: 2 }] } });
    // ChangeSlip
    if (p === '/api/my') return res(200, { published: s.slips });
    if (p === '/api/slips' && m === 'POST') return res(200, { id: 12 });
    if (/^\/api\/slips\/\d+\/cancel$/.test(p)) return res(200, { ok: true });
    return res(404, { error: 'not found ' + p });
  };
  return s;
}

async function connectAll(st, email, extra = {}) {
  for (const app of Object.keys(LIVE)) {
    const b = { app, base: BASE + '/', email: 'Owner@Example.com', password: 'Secr3t-Pass!', ...(extra[app] || {}) };
    const r = await liveRoutes({ method: 'POST', pathname: '/api/liveapps/connect', json: () => b, st, email, secret, HttpError });
    assert.equal(r.ok, true); assert.equal(r.base, BASE); assert.equal(r.account, 'owner@example.com');
  }
}

test('connect, list, disconnect and stored credentials are encrypted', async () => {
  const fake = fakeApps(), st = memStore(), email = 'o@example.com';
  await connectAll(st, email, { partping: { admin_email: 'admin@pp.in', admin_password: 'apw' } });
  assert.doesNotMatch(st.m.get('as_live:' + email), /Secr3t-Pass|owner@example/, 'credentials are sealed');
  const list = await liveRoutes({ method: 'GET', pathname: '/api/liveapps', json: () => ({}), st, email, secret, HttpError });
  assert.equal(list.apps.length, 5); assert.ok(list.apps.every((a) => a.connected)); assert.ok(list.apps.find((a) => a.id === 'partping').admin);
  assert.deepEqual((await liveConnected(st, email, secret)).sort(), Object.keys(LIVE).sort());
  assert.equal(await liveRoutes({ method: 'GET', pathname: '/api/liveapps/records', json: () => ({}), st, email, secret, HttpError }), null);
  assert.equal(await liveRoutes({ method: 'GET', pathname: '/api/other', json: () => ({}), st, email, secret, HttpError }), undefined);
  await liveRoutes({ method: 'POST', pathname: '/api/liveapps/disconnect', json: () => ({ app: 'nudge' }), st, email, secret, HttpError });
  assert.ok(!(await liveConnected(st, email, secret)).includes('nudge'));
  // a different secret cannot read them
  assert.deepEqual(await liveConnected(st, email, async () => 'other'), []);
  assert.ok(fake.calls.length > 5);
});

test('connect errors: unknown app, bad address, missing login, wrong password, no session, PartPing admin-only', async () => {
  const fake = fakeApps(), st = memStore(), email = 'e@example.com';
  const go = (b) => liveRoutes({ method: 'POST', pathname: '/api/liveapps/connect', json: () => b, st, email, secret, HttpError });
  await assert.rejects(go({ app: 'nope' }), /Unknown app/);
  await assert.rejects(go({ app: 'nudge', base: 'http://127.0.0.1', email: 'a@b.c', password: 'x' }), (e) => e.code === 'bad_url');
  await assert.rejects(go({ app: 'nudge', base: BASE }), (e) => e.code === 'missing');
  fake.badLogin = true;
  await assert.rejects(go({ app: 'nudge', base: BASE, email: 'a@b.c', password: 'x' }), (e) => e.status === 401 && /Wrong email/.test(e.message));
  fake.adminOnlyLogin = true; // PartPing shop admin connects on its own
  const r = await go({ app: 'partping', base: BASE, email: 'admin@pp.in', password: 'x' });
  assert.equal(r.admin, true);
  fake.adminOnlyLogin = false;
  await assert.rejects(go({ app: 'partping', base: BASE, email: 'admin@pp.in', password: 'x' }), /PartPing/);
  fake.badLogin = false; fake.noCookie = true;
  await assert.rejects(go({ app: 'nudge', base: BASE, email: 'a@b.c', password: 'x' }), /didn’t return a session/);
  fake.noCookie = false; fake.down = true;
  await assert.rejects(go({ app: 'nudge', base: BASE, email: 'a@b.c', password: 'x' }), /Couldn’t reach/);
  fake.down = false;
  // PartPing admin login given but wrong
  fake.badLogin = true; fake.adminOnlyLogin = false;
  await assert.rejects(go({ app: 'changeslip', base: BASE, email: 'a@b.c', password: 'x' }), /ChangeSlip/);
});

test('prompt section lists records for each app; unreadable app says so', async () => {
  const fake = fakeApps(), st = memStore(), email = 'p@example.com';
  await connectAll(st, email, { partping: { admin_email: 'admin@pp.in', admin_password: 'apw' } });
  const ctx = await liveContext(st, email, secret);
  for (const k of Object.keys(LIVE)) {
    const spec = await liveSpec(ctx, k);
    assert.match(spec, new RegExp('WORKING IN YOUR LIVE APP \\(' + LIVE[k].name));
  }
  assert.match(await liveSpec(ctx, 'formfirst'), /Asha Rao/);
  assert.match(await liveSpec(ctx, 'partping'), /PP-100/);
  assert.equal(await liveSpec(ctx, 'unknown'), '');
  fake.down = true;
  assert.match(await liveSpec(ctx, 'nudge'), /Could not read the app/);
  fake.down = false;
  await ctx.save();
});

test('FormFirst: create form, add lead, mark, qualify, summarize, errors', async () => {
  fakeApps(); const st = memStore(), email = 'ff@example.com';
  await connectAll(st, email);
  const ctx = await liveContext(st, email, secret), memo = { tokens: {} };
  assert.match((await liveAct(ctx, 'formfirst', 'create_form', { title: 'Diwali offer' })).link, /\/f\/new-form$/);
  const add = await liveAct(ctx, 'formfirst', 'add_lead', { name: 'Asha Rao', email: 'asha@example.com', message: 'Quote please' }, memo);
  assert.equal(add.token, 'lt1'); assert.match(add.copy[0][1], /When do you need it/); assert.equal(memo.tokens['asha@example.com'], 'lt1');
  assert.match((await liveAct(ctx, 'formfirst', 'add_lead', { name: 'X' })).err, /needs a name/);
  assert.match((await liveAct(ctx, 'formfirst', 'mark', { lead: 'asha', status: 'contacted' })).t, /marked contacted/);
  assert.match((await liveAct(ctx, 'formfirst', 'mark', { lead: 'asha', status: 'weird' })).err, /Status must be/);
  assert.match((await liveAct(ctx, 'formfirst', 'qualify', { lead: 'asha@example.com', q1a: 'Next week', q2a: 'done' }, memo)).t, /HOT lead/);
  assert.match((await liveAct(ctx, 'formfirst', 'qualify', { lead: 'asha' }, memo)).err, /needs the lead’s answers/);
  assert.match((await liveAct(ctx, 'formfirst', 'qualify', { lead: 'Asha', q1a: 'soon' }, { tokens: {} })).t, /HOT/);
  assert.match((await liveAct(ctx, 'formfirst', 'summarize', { lead: 7 })).sub, /Urgency: high/);
  assert.match((await liveAct(ctx, 'formfirst', 'mark', { lead: 'nobody-here', status: 'new' })).err, /Couldn’t find/);
  assert.match((await liveAct(ctx, 'formfirst', 'fly', {})).err, /can’t do/);
});

test('FormFirst adds a lead when the account has no form yet', async () => {
  const fake = fakeApps(); fake.forms = []; const st = memStore(), email = 'ff2@example.com';
  await connectAll(st, email);
  const ctx = await liveContext(st, email, secret);
  const r = await liveAct(ctx, 'formfirst', 'add_lead', { name: 'Ravi', phone: '9876543210', message: 'Hi' }, null);
  assert.match(r.link, /\/f\/new-form$/);
});

test('AfterJob, Nudge, ChangeSlip actions', async () => {
  fakeApps(); const st = memStore(), email = 'aj@example.com';
  await connectAll(st, email);
  const ctx = await liveContext(st, email, secret);
  assert.match((await liveAct(ctx, 'afterjob', 'add_job', { name: 'Ravi K', summary: 'AC service' })).link, /\/f\/tok5$/);
  assert.match((await liveAct(ctx, 'afterjob', 'add_job', { name: 'Ravi K' })).err, /needs the customer name/);
  assert.match((await liveAct(ctx, 'afterjob', 'close', { job: 'J-9' })).t, /Job closed: Ravi K/);
  assert.match((await liveAct(ctx, 'afterjob', 'rate', { job: 'Ravi', score: 5, comment: 'great' })).t, /5\/5 recorded \(happy\)/);
  assert.match((await liveAct(ctx, 'afterjob', 'rate', { job: 'Ravi', score: 2 })).t, /complaint, kept private/);
  assert.match((await liveAct(ctx, 'afterjob', 'rate', { job: 'Ravi', score: 9 })).err, /1 to 5/);
  assert.match((await liveAct(ctx, 'afterjob', 'close', { job: 'zzz-none' })).err, /Couldn’t find that job/);
  assert.match((await liveAct(ctx, 'nudge', 'add_lead', { name: 'Kiran', company: 'Kiran Co' })).open, /\/admin\/leads\/9$/);
  assert.match((await liveAct(ctx, 'nudge', 'add_lead', {})).err, /needs a name/);
  assert.match((await liveAct(ctx, 'nudge', 'mark', { lead: 'Meena', status: 'won' })).t, /marked won/);
  assert.match((await liveAct(ctx, 'nudge', 'mark', { lead: 'Meena', status: 'x' })).err, /Status must be/);
  assert.match((await liveAct(ctx, 'nudge', 'mark', { lead: 'qqq-none', status: 'won' })).err, /Couldn’t find/);
  assert.match((await liveAct(ctx, 'changeslip', 'add_slip', { title: 'Extra socket', amount: 1200, currency: 'inr' })).link, /\/slips\/12$/);
  assert.match((await liveAct(ctx, 'changeslip', 'add_slip', { title: '' })).err, /needs a title/);
  assert.match((await liveAct(ctx, 'changeslip', 'cancel', { slip: 'wiring' })).t, /Slip cancelled/);
  assert.match((await liveAct(ctx, 'changeslip', 'cancel', { slip: 'zzz-none' })).err, /Couldn’t find/);
});

test('PartPing: orders as customer and admin, status moves, tracking, re-sign-in on expiry', async () => {
  const fake = fakeApps(); const st = memStore(), email = 'pp@example.com';
  await connectAll(st, email, { partping: { admin_email: 'admin@pp.in', admin_password: 'apw' } });
  const ctx = await liveContext(st, email, secret);
  assert.match((await liveAct(ctx, 'partping', 'add_order', { part: 'Clutch plate', address: '12 MG Road', quantity: 3 })).t, /PP-200/);
  assert.match((await liveAct(ctx, 'partping', 'add_order', { part: 'Clutch' })).err, /delivery address/);
  assert.match((await liveAct(ctx, 'partping', 'update_status', { order: 'PP-100', status: 'in transit', note: 'Left hub' })).t, /moved to In transit/);
  assert.match((await liveAct(ctx, 'partping', 'update_status', { order: 'PP-100', status: 'flying' })).err, /Unknown status/);
  assert.match((await liveAct(ctx, 'partping', 'update_status', { order: 'zzz-none', status: 'delivered' })).err, /Couldn’t find/);
  assert.match((await liveAct(ctx, 'partping', 'get_order', { order: 'PP-100' })).sub, /History: Request placed .*Dispatched \(Courier\)/);
  assert.match((await liveAct(ctx, 'partping', 'get_order', { order: 'Brake' })).link, /\/track\/PP-100$/);
  assert.match((await liveAct(ctx, 'partping', 'cancel', { order: 'Brake pad' })).t, /Order cancelled: PP-100/);
  assert.match((await liveAct(ctx, 'partping', 'cancel', { order: 'zzz-none' })).err, /Couldn’t find/);
  // session expired → signs in again once, transparently
  fake.expired.add('pp_token');
  assert.match((await liveAct(ctx, 'partping', 'update_status', { order: 'PP-100', status: 'delivered' })).t, /Delivered/);
  fake.expired.add('nd_token');
  assert.match((await liveAct(ctx, 'nudge', 'mark', { lead: 'Meena', status: 'lost' })).t, /marked lost/);
  assert.equal(ctx.dirty, true); await ctx.save(); assert.equal(ctx.dirty, false);
  // customer-only connection cannot move orders; admin-only cannot place them
  ctx.all.partping.admin = null;
  assert.match((await liveAct(ctx, 'partping', 'update_status', { order: 'PP-100', status: 'delivered' })).err, /admin login/);
  ctx.all.partping.adminOnly = true;
  assert.match((await liveAct(ctx, 'partping', 'add_order', { part: 'x', address: 'y' })).err, /customer login/);
});

test('<<DO:>> lines: parsed, run against the right agent, removed from the reply', async () => {
  fakeApps(); const st = memStore(), email = 'do@example.com';
  await connectAll(st, email);
  const parsed = takeDo('Done.\n<<DO: add_lead || {"name":"Kiran"}>>\n<<DO: broken || {not json>>\nBye');
  assert.equal(parsed.acts.length, 1); assert.equal(parsed.acts[0].op, 'add_lead'); assert.doesNotMatch(parsed.text, /<<DO/);
  assert.deepEqual(takeDo('no actions').acts, []);
  const ctx = await liveContext(st, email, secret);
  const agents = [{ id: 'a1', name: 'Sales', kind: 'nudge' }, { id: 'a2', name: 'Forms', kind: 'formfirst' }, { id: 'a3', name: 'Plain', kind: 'custom' }];
  const text = 'Adding them now.\n<<DO: add_lead || {"name":"Kiran","company":"K Co"}>>\n<<DO: Forms.add_lead || {"name":"Asha","email":"a@b.in","message":"hi"}>>\n<<DO: Plain.note || {}>>';
  const r = await runLiveActs(ctx, text, agents[0], agents);
  assert.equal(r.acts.length, 2); assert.equal(r.acts[0].live, 'Nudge'); assert.equal(r.acts[1].live, 'FormFirst');
  assert.match(r.text, /Plain\.note/, 'not a live app: left for the page');
  assert.equal((await runLiveActs(ctx, 'nothing to do', agents[0], agents)).acts.length, 0);
  const bad = await runLiveActs(ctx, '<<DO: fly || {}>>', agents[0], agents);
  assert.match(bad.acts[0].err, /can’t do/);
});
