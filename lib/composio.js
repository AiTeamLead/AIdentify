// Composio managed sign-in and tool execution (https://composio.dev).
// With COMPOSIO_API_KEY set, connectors whose own OAuth app isn't configured sign in through Composio instead:
// Composio owns the OAuth apps (Google, Slack, GitHub, …), stores the tokens, and runs read-only tools for us.
// Each AaaS customer maps to one Composio user id derived from their email (never the email itself).
import crypto from 'node:crypto';

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
export const composioOn = () => Boolean(env('COMPOSIO_API_KEY'));
const BASE = () => (env('COMPOSIO_BASE_URL') || 'https://backend.composio.dev/api/v3.1').replace(/\/+$/, '');

// AaaS connector id → Composio toolkit slug
export const TOOLKIT = {
  gmail: 'gmail', gcal: 'googlecalendar', gdrive: 'googledrive', gsheets: 'googlesheets',
  outlook: 'outlook', m365: 'one_drive', teams: 'microsoft_teams', github: 'github', slack: 'slack', notion: 'notion',
  dropbox: 'dropbox', box: 'box', zoom: 'zoom', hubspot: 'hubspot', salesforce: 'salesforce', asana: 'asana',
  jira: 'jira', confluence: 'confluence', linear: 'linear', figma: 'figma', canva: 'canva', calendly: 'calendly',
  airtable: 'airtable', quickbooks: 'quickbooks', mailchimp: 'mailchimp', xero: 'xero', docusign: 'docusign',
  zendesk: 'zendesk', shopify: 'shopify', intercom: 'intercom', trello: 'trello', wix: 'wix', vercel: 'vercel',
};
// read tools tried first for each toolkit (others are discovered from Composio's tool list); override with COMPOSIO_TOOLS_<TOOLKIT>=A,B
const READ_TOOLS = { gmail: ['GMAIL_FETCH_EMAILS'], googlecalendar: ['GOOGLECALENDAR_EVENTS_LIST', 'GOOGLECALENDAR_FIND_EVENT'] };

// the 'agentsphere:' salt is kept so existing Composio connections keep their user id
export const composioUser = (email) => 'as_' + crypto.createHash('sha256').update('agentsphere:' + String(email).toLowerCase()).digest('hex').slice(0, 32);

export class ComposioError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function call(method, path, body, ms = 15000) {
  const r = await fetch(BASE() + path, {
    method, signal: AbortSignal.timeout(ms),
    headers: { 'x-api-key': env('COMPOSIO_API_KEY'), 'content-type': 'application/json', accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ComposioError(j.error?.message || j.message || 'Composio error ' + r.status, r.status);
  return j;
}

// one Composio-managed auth config per toolkit, created on first use and cached (memory + store)
const acCache = new Map();
async function authConfigFor(slug, st) {
  const fixed = env('COMPOSIO_AUTH_CONFIG_' + slug.toUpperCase());
  if (fixed) return fixed;
  if (acCache.has(slug)) return acCache.get(slug);
  const key = 'as_sys_composio_ac:' + slug, row = await st.get(key);
  if (row && row.v) { acCache.set(slug, row.v); return row.v; }
  // apps Composio signs in itself use its managed auth; apps that need the owner's own key get a custom config with no
  // stored credentials, so Composio's hosted sign-in page asks the owner for the key
  const app = catalog && catalog.find((a) => a.slug === slug);
  const keyScheme = app && app.auth === 'key' ? app.schemes.find((x) => /API_KEY|BEARER|BASIC|TOKEN/.test(x)) : '';
  const j = await call('POST', '/auth_configs', { toolkit: { slug }, auth_config: keyScheme ? { type: 'use_custom_auth', authScheme: keyScheme, credentials: {} } : { type: 'use_composio_managed_auth' } });
  const id = j.auth_config?.id || j.id;
  if (!id) throw new ComposioError('Composio did not return an auth config for ' + slug);
  await st.put(key, id, Date.now()); acCache.set(slug, id);
  return id;
}

// start a managed sign-in: returns the Composio-hosted URL to send the customer to
export async function composioLink({ id, email, st, callbackUrl }) {
  const slug = toolkitOf(id); if (!slug) throw new ComposioError('No Composio toolkit for ' + id, 400);
  const auth_config_id = await authConfigFor(slug, st);
  const j = await call('POST', '/connected_accounts/link', { auth_config_id, user_id: composioUser(email), callback_url: callbackUrl });
  if (!j.redirect_url) throw new ComposioError('Composio did not return a sign-in link');
  return { url: j.redirect_url, ca: j.connected_account_id };
}

// after the redirect: confirm the account is ACTIVE and belongs to this customer
export async function composioConfirm({ ca, email }) {
  const j = await call('GET', '/connected_accounts/' + encodeURIComponent(ca));
  const status = j.status || j.state?.val?.status;
  if (j.user_id && j.user_id !== composioUser(email)) throw new ComposioError('This connection belongs to someone else.', 403);
  if (status !== 'ACTIVE') throw new ComposioError(status === 'FAILED' ? 'The sign-in failed.' : 'The sign-in has not finished yet.', 409);
  const v = j.state?.val || j.connectionData?.val || {};
  return { acct: v.email || v.account_email || v.user_email || '' };
}

export async function composioDelete(ca) { try { await call('DELETE', '/connected_accounts/' + encodeURIComponent(ca)); } catch { /* already gone */ } }

// ---------- any of Composio's ~1,500 apps (open-dot style) ----------
// A connector id is either one of AaaS's named connectors (gmail, gcal, …) or "cx:<toolkit slug>" for any other app.
export const CX = 'cx:';
export const isCx = (id) => typeof id === 'string' && id.startsWith(CX) && /^[a-z0-9_]{2,60}$/.test(id.slice(CX.length));
export const toolkitOf = (id) => (isCx(id) ? id.slice(CX.length) : TOOLKIT[id] || '');
// the connector id used for a toolkit: the named connector if AaaS has one, else cx:<slug>
const NAMED = Object.fromEntries(Object.entries(TOOLKIT).map(([k, v]) => [v, k]));
export const connectorIdFor = (slug) => NAMED[slug] || CX + slug;
export const prettyToolkit = (slug) => String(slug || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const toolkitLogo = (slug) => 'https://logos.composio.dev/api/' + encodeURIComponent(slug);

// Search Composio's app catalogue (toolkits). Returns [{ slug, name, logo, description, categories, id }]
export async function composioToolkits({ search = '', limit = 24 } = {}) {
  const q = new URLSearchParams({ limit: String(Math.max(1, Math.min(50, limit))), sort_by: 'usage' });
  if (search) q.set('search', String(search).slice(0, 80));
  const j = await call('GET', '/toolkits?' + q, null, 10000);
  return (j.items || []).map((t) => ({
    slug: t.slug, name: t.name || prettyToolkit(t.slug), logo: (t.meta && t.meta.logo) || toolkitLogo(t.slug),
    description: String((t.meta && t.meta.description) || t.description || '').slice(0, 200),
    categories: ((t.meta && t.meta.categories) || []).map((c) => (typeof c === 'string' ? c : c.name)).filter(Boolean).slice(0, 3),
    id: connectorIdFor(t.slug),
  })).filter((t) => /^[a-z0-9_]{2,60}$/.test(t.slug || ''));
}

// ---------- the Apps catalogue (open-dot's Apps page) ----------
// The whole catalogue (~1,500 apps) is read once from Composio, kept for 6 hours, and searched, sorted, counted and
// paged here, so the page gets totals, category counts and "popular" order without hitting Composio on every key.
let catalog = null, catalogAt = 0, catalogLoading = null;
const CAT_TTL = 6 * 3600e3;
const catName = (c) => String(typeof c === 'string' ? c : (c && (c.name || c.id)) || '').trim();
function toCatalogItem(t, rank) {
  const meta = t.meta || {};
  const managed = Array.isArray(t.composio_managed_auth_schemes) && t.composio_managed_auth_schemes.length > 0;
  const schemes = (t.auth_schemes || meta.auth_schemes || []).map((x) => String(typeof x === 'string' ? x : x.mode || x.auth_mode || '').toUpperCase()).filter(Boolean);
  const noAuth = !!t.no_auth;
  return {
    slug: t.slug, name: t.name || prettyToolkit(t.slug), logo: meta.logo || toolkitLogo(t.slug),
    description: String(meta.description || t.description || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    categories: (meta.categories || t.categories || []).map(catName).filter(Boolean).slice(0, 4),
    tools: Number(meta.tools_count ?? t.tools_count ?? 0) || 0, triggers: Number(meta.triggers_count ?? t.triggers_count ?? 0) || 0,
    auth: noAuth ? 'none' : managed ? 'managed' : schemes.some((x) => /API_KEY|BEARER|BASIC|TOKEN/.test(x)) ? 'key' : schemes.length ? 'custom' : 'managed',
    schemes, rank, id: connectorIdFor(t.slug),
  };
}
async function loadCatalog() {
  const all = [], seen = new Set();
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ limit: '500', sort_by: 'usage' });
    if (cursor) q.set('cursor', cursor);
    const j = await call('GET', '/toolkits?' + q, null, 20000);
    for (const t of j.items || []) if (/^[a-z0-9_]{2,60}$/.test(t.slug || '') && !seen.has(t.slug)) { seen.add(t.slug); all.push(toCatalogItem(t, all.length)); }
    cursor = j.next_cursor || j.nextCursor || '';
    if (!cursor || !(j.items || []).length) break;
  }
  if (!all.length) throw new ComposioError('Composio returned no apps.');
  return all;
}
export async function composioCatalog() {
  if (catalog && Date.now() - catalogAt < CAT_TTL) return catalog;
  if (!catalogLoading) catalogLoading = loadCatalog().then((c) => { catalog = c; catalogAt = Date.now(); return c; }).finally(() => { catalogLoading = null; });
  try { return await catalogLoading; } catch (e) { if (catalog) return catalog; throw e; }
}
const POPULAR = ['gmail', 'googlecalendar', 'googledrive', 'outlook', 'twitter', 'googlesheets', 'slack', 'notion', 'github', 'googledocs', 'hubspot', 'linkedin'];
// { total, items, next, categories:[{name,count}], popular:[...] }
// Apps Composio runs on its own keys: connecting them needs no sign-in to the app (Composio's "Instant Apps")
export const INSTANT = ['serpapi', 'firecrawl', 'tavily', 'exa', 'elevenlabs', 'peopledatalabs'];
export async function composioApps({ q = '', category = '', sort = 'popular', offset = 0, limit = 48, only = null, instant = false, load = composioCatalog } = {}) {
  const all = (await load()).filter((a) => /^[a-z0-9_]{2,60}$/.test(a.slug)).map((a) => ({ ...a, id: a.id || connectorIdFor(a.slug), ...(INSTANT.includes(a.slug) ? { instant: true, auth: 'instant' } : {}) }));
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const cats = new Map();
  for (const a of all) for (const c of a.categories) cats.set(c, (cats.get(c) || 0) + 1);
  let list = all.filter((a) => (!category || a.categories.includes(category)) && (!only || only.has(a.slug)) && (!instant || a.instant)
    && words.every((w) => (a.name + ' ' + a.slug + ' ' + a.description + ' ' + a.categories.join(' ')).toLowerCase().includes(w)));
  if (words.length) { const w0 = words.join(' '); list = list.slice().sort((x, y) => (y.name.toLowerCase().startsWith(w0) - x.name.toLowerCase().startsWith(w0)) || x.rank - y.rank); }
  if (sort === 'az') list = list.slice().sort((x, y) => x.name.localeCompare(y.name));
  else if (sort === 'tools') list = list.slice().sort((x, y) => y.tools - x.tools || x.rank - y.rank);
  const o = Math.max(0, Number(offset) || 0), n = Math.max(1, Math.min(120, Number(limit) || 48));
  const bySlug = new Map(all.map((a) => [a.slug, a]));
  return {
    total: all.length, count: list.length, items: list.slice(o, o + n), next: o + n < list.length ? o + n : null,
    categories: [...cats.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })),
    popular: POPULAR.map((s) => bySlug.get(s)).filter(Boolean).slice(0, 6),
    instant: INSTANT.map((s) => bySlug.get(s)).filter(Boolean), instantCount: all.filter((a) => a.instant).length,
  };
}
// one app's page: description, counts, how it signs in, its tools and triggers
const appCache = new Map();
export async function composioAppInfo(slug) {
  if (!/^[a-z0-9_]{2,60}$/.test(String(slug || ''))) throw new ComposioError('Unknown app.', 400);
  const hit = appCache.get(slug);
  if (hit && Date.now() - hit.at < 3600e3) return hit.v;
  const base = (await composioCatalog().catch(() => [])).find((a) => a.slug === slug);
  const [tk, tools, trig] = await Promise.all([
    call('GET', '/toolkits/' + encodeURIComponent(slug), null, 12000).catch(() => null),
    call('GET', '/tools?' + new URLSearchParams({ toolkit_slug: slug, limit: '500' }), null, 15000).catch(() => ({ items: [] })),
    call('GET', '/triggers_types?' + new URLSearchParams({ toolkit_slugs: slug, limit: '100' }), null, 12000).catch(() => ({ items: [] })),
  ]);
  if (!tk && !base) throw new ComposioError('Composio has no app called ' + slug + '.', 404);
  const item = tk ? toCatalogItem(tk, base ? base.rank : 9999) : base;
  const list = (tools.items || []).map((t) => ({ slug: t.slug, name: t.name || prettyToolkit(String(t.slug).replace(/^[A-Z0-9]+_/, '')), description: String(t.description || '').replace(/\s+/g, ' ').trim().slice(0, 260), read: isReadTool(t.slug) }));
  const v = { ...item, tools: list.length || item.tools, triggers: (trig.items || []).length || item.triggers, toolList: list,
    triggerList: (trig.items || []).map((t) => ({ slug: t.slug, name: t.name || t.slug, description: String(t.description || '').slice(0, 200) })) };
  appCache.set(slug, { at: Date.now(), v });
  return v;
}

// Read vs write, as in open-dot: reads run straight away, anything else waits for the owner's approval.
const READ_VERB = /_(GET|LIST|SEARCH|FETCH|FIND|READ|RETRIEVE|QUERY|DESCRIBE|LOOKUP|VIEW|CHECK|COUNT|EXPORT|DOWNLOAD)(_|$)/;
const WRITE_WORD = /_(SEND|CREATE|UPDATE|DELETE|REMOVE|POST|REPLY|ARCHIVE|MOVE|PATCH|INSERT|ADD|TRASH|MODIFY|INVITE|SHARE|PUBLISH|UPLOAD|SET|EXECUTE|RUN|CANCEL|APPROVE|MERGE|TRANSFER|PAY|CHARGE|REFUND)(_|$)/;
export const isReadTool = (slug) => { const s = String(slug || '').toUpperCase(); return READ_VERB.test(s) && !WRITE_WORD.test(s); };

// Find tools in the given toolkits for a plain-English need. Returns compact tool cards with their inputs.
const compactParams = (schema) => {
  const props = (schema && schema.properties) || {}, req = new Set((schema && schema.required) || []);
  return Object.entries(props).slice(0, 14).map(([k, v]) => `${k}${req.has(k) ? '*' : ''}:${(v && (v.type || (v.anyOf && 'any'))) || 'any'}${v && v.description ? ' — ' + String(v.description).replace(/\s+/g, ' ').slice(0, 80) : ''}`);
};
export async function composioSearchTools({ query = '', toolkits = [], limit = 10 }) {
  const out = [], per = Math.max(3, Math.ceil(limit / Math.max(1, toolkits.length)));
  for (const slug of toolkits.slice(0, 6)) {
    const q = new URLSearchParams({ toolkit_slug: slug, limit: String(per) });
    if (query) q.set('search', String(query).slice(0, 120));
    try {
      const j = await call('GET', '/tools?' + q, null, 10000);
      for (const t of j.items || []) out.push({ slug: t.slug, toolkit: (t.toolkit && t.toolkit.slug) || slug, name: t.name || t.slug, description: String(t.description || '').replace(/\s+/g, ' ').slice(0, 220), params: compactParams(t.input_parameters), read: isReadTool(t.slug) });
    } catch { /* one app failing should not hide the others */ }
  }
  return out.slice(0, limit);
}
// A tool's own toolkit, from Composio (cached): the guard that a tool belongs to an app this owner connected.
const infoCache = new Map();
export async function composioToolInfo(slug) {
  const k = String(slug || '').toUpperCase();
  if (!/^[A-Z0-9_]{3,120}$/.test(k)) throw new ComposioError('That is not a tool name.', 400);
  if (infoCache.has(k)) return infoCache.get(k);
  const j = await call('GET', '/tools/' + encodeURIComponent(k), null, 10000);
  const info = { slug: j.slug || k, toolkit: (j.toolkit && j.toolkit.slug) || '', params: j.input_parameters || {} };
  infoCache.set(k, info);
  return info;
}
// Run one tool with exact arguments for this owner's connected account.
export async function composioExecute({ slug, args, ca, email }) {
  const j = await call('POST', '/tools/execute/' + encodeURIComponent(String(slug).toUpperCase()), { connected_account_id: ca, user_id: composioUser(email), arguments: args && typeof args === 'object' ? args : {} }, 45000);
  if (j.successful === false) throw new ComposioError(typeof j.error === 'string' ? j.error : 'The tool failed.');
  return j.data;
}

// ---------- triggers (events from an app wake an agent) ----------
export async function composioTriggerTypes(slug) {
  const j = await call('GET', '/triggers_types?toolkit_slugs=' + encodeURIComponent(slug) + '&limit=50', null, 10000);
  return (j.items || []).map((t) => {
    const cfg = t.config || {}, req = new Set(cfg.required || []);
    return { slug: t.slug, name: t.name || t.slug, description: String(t.description || '').slice(0, 240),
      fields: Object.entries(cfg.properties || {}).map(([name, p]) => ({ name, type: (p && p.type) || 'string', required: req.has(name), description: String((p && p.description) || '').slice(0, 140), ...(p && p.default !== undefined ? { default: p.default } : {}) })) };
  });
}
export async function composioTriggerUpsert({ slug, ca, email, config, egressUrl }) {
  const j = await call('POST', '/trigger_instances/' + encodeURIComponent(slug) + '/upsert', { connected_account_id: ca, user_id: composioUser(email), trigger_config: config || {}, ...(egressUrl ? { egress_url: egressUrl } : {}) }, 20000);
  const id = j.trigger_id || j.triggerId || j.id || (j.trigger && j.trigger.id);
  if (!id) throw new ComposioError('Composio did not return a trigger id.');
  return id;
}
export async function composioTriggerStatus(id, enable) { await call('PATCH', '/trigger_instances/manage/' + encodeURIComponent(id), { status: enable ? 'enable' : 'disable' }); }
export async function composioTriggerDelete(id) { try { await call('DELETE', '/trigger_instances/manage/' + encodeURIComponent(id)); } catch { /* already gone */ } }

// read tools for a toolkit: configured list → known defaults → discovered (names that read: FETCH/LIST/SEARCH/GET/FIND)
const toolCache = new Map();
async function readTools(slug) {
  const over = env('COMPOSIO_TOOLS_' + slug.toUpperCase());
  if (over) return over.split(',').map((x) => x.trim()).filter(Boolean);
  if (toolCache.has(slug)) return toolCache.get(slug);
  let list = READ_TOOLS[slug] || [];
  try {
    const j = await call('GET', '/tools?limit=60&toolkit_slug=' + encodeURIComponent(slug), null, 8000);
    const found = (j.items || []).map((t) => t.slug).filter((s) => /_(FETCH|LIST|SEARCH|FIND|GET)_?/.test(s) && !/(DELETE|CREATE|SEND|UPDATE|REMOVE|MOVE|PATCH|ADD|REPLY|ARCHIVE|MODIFY|INSERT)/.test(s));
    found.sort((a, b) => /SEARCH|FETCH|LIST/.test(b) - /SEARCH|FETCH|LIST/.test(a));
    list = [...new Set([...list, ...found])].slice(0, 6);
  } catch { /* fall back to the known defaults */ }
  toolCache.set(slug, list);
  return list;
}

// run one read-only tool with the customer's question as a natural-language request; returns plain text
export async function composioRead({ id, ca, email, q }) {
  const slug = toolkitOf(id), tools = slug ? await readTools(slug) : [];
  if (!tools.length) throw new ComposioError('No read tool available for ' + id, 404);
  // pick the tool whose name shares the most words with the question
  const qw = String(q).toUpperCase().match(/[A-Z]{3,}/g) || [];
  const tool = tools.map((t) => [t, qw.filter((w) => t.includes(w)).length]).sort((a, b) => b[1] - a[1])[0][0];
  const j = await call('POST', '/tools/execute/' + encodeURIComponent(tool), {
    connected_account_id: ca, user_id: composioUser(email),
    text: `Read-only request. ${q}\n(Return the most relevant recent items, at most 8.)`,
  }, 20000);
  if (j.successful === false) throw new ComposioError(j.error || 'The tool failed.');
  return { tool, data: j.data };
}

// run one approved write action (send email, create event, post message, …) described in plain words
const actCache = new Map();
async function writeTools(slug) {
  const over = env('COMPOSIO_ACTIONS_' + slug.toUpperCase());
  if (over) return over.split(',').map((x) => x.trim()).filter(Boolean);
  if (actCache.has(slug)) return actCache.get(slug);
  let list = [];
  try {
    const j = await call('GET', '/tools?limit=100&toolkit_slug=' + encodeURIComponent(slug), null, 8000);
    list = (j.items || []).map((t) => t.slug).filter((s) => /(SEND|CREATE|ADD|POST|REPLY|DRAFT|INSERT|UPDATE|SCHEDULE|INVITE)/.test(s) && !/(DELETE|REMOVE|TRASH|ARCHIVE)/.test(s));
  } catch { /* none */ }
  actCache.set(slug, list);
  return list;
}
export async function composioAct({ id, ca, email, request }) {
  const slug = toolkitOf(id), tools = slug ? await writeTools(slug) : [];
  if (!tools.length) throw new ComposioError('No action tool available for ' + id, 404);
  const words = String(request).toUpperCase().match(/[A-Z]{3,}/g) || [];
  const score = (t) => words.filter((w) => t.includes(w)).length + (/DRAFT/.test(t) && /DRAFT/.test(words.join(' ')) ? 2 : 0);
  const tool = tools.map((t) => [t, score(t)]).sort((a, b) => b[1] - a[1])[0][0];
  const j = await call('POST', '/tools/execute/' + encodeURIComponent(tool), { connected_account_id: ca, user_id: composioUser(email), text: String(request) }, 30000);
  if (j.successful === false) throw new ComposioError(j.error || 'The action failed.');
  return { tool, data: j.data };
}
