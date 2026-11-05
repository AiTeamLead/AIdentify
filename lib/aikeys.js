// Customer AI keys (BYOK) and the shared platform-key budget.
//
// BYOK: a customer can paste their own OpenRouter (or OpenAI / xAI / Google Gemini / Anthropic) key, at onboarding or later
// from the user menu → AI key. It is checked with the provider once, then stored AES-256-GCM encrypted (key derived from
// SESSION_SECRET, same pattern as connector credentials) under as_aikey:<email>, which never leaves the server. Only the last
// four characters are ever shown back. While a customer has a key, every AI call in their requests uses it and only it.
//
// Shared platform key: customers without their own key use the server's key. When PLATFORM_AI_BUDGET_USD is set, spend on
// it is tracked in as_sys_aipool (real cost from OpenRouter's usage.cost, else a conservative token estimate) and calls are
// refused once the total budget, the daily pool or a customer's daily allowance is used. This is the in-app soft cap; the
// hard cap is the credit limit on the OpenRouter key itself (see docs/HOSTED-AI.md).
import crypto from 'node:crypto';
import { aiScope, setDefaultAiContext, LlmError, mockOn, bedrockKeyRegion, bedrockRegionOk, BEDROCK_DEFAULT_MODEL } from './llm.js';

const env = (k, d = '') => String(process.env[k] ?? d).trim();
const num = (k, d) => { const v = Number(env(k)); return Number.isFinite(v) && env(k) !== '' ? v : d; };
const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
const tz = () => env('APP_TIMEZONE', 'Asia/Kolkata');
const dayOf = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
const POOL = 'as_sys_aipool';
export const KEY_PREFIX = 'as_aikey:';

export const BYOK_PROVIDERS = {
  openrouter: { name: 'OpenRouter', check: (k) => ({ url: (env('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1') + '/key', headers: { authorization: 'Bearer ' + k } }), site: 'https://openrouter.ai/keys' },
  openai: { name: 'OpenAI', check: (k) => ({ url: (env('OPENAI_BASE_URL') || 'https://api.openai.com/v1') + '/models', headers: { authorization: 'Bearer ' + k } }), site: 'https://platform.openai.com/api-keys' },
  xai: { name: 'xAI Grok', check: (k) => ({ url: (env('XAI_BASE_URL') || 'https://api.x.ai/v1') + '/models', headers: { authorization: 'Bearer ' + k } }), site: 'https://console.x.ai' },
  google: { name: 'Google Gemini', check: (k) => ({ url: (env('GOOGLE_AI_BASE_URL') || 'https://generativelanguage.googleapis.com/v1beta/openai') + '/models', headers: { authorization: 'Bearer ' + k } }), site: 'https://aistudio.google.com/apikey' },
  // Amazon Bedrock API key (long-term "ABSK…" or short-term "bedrock-api-key-…"); the region is saved with it
  bedrock: { name: 'Amazon Bedrock', check: (k, region) => ({ url: `${bedrockControl(bedrockRegion(k, region))}/foundation-models?byOutputModality=TEXT`, headers: { authorization: 'Bearer ' + k, accept: 'application/json' } }), site: 'https://console.aws.amazon.com/bedrock/home#/api-keys', regions: true },
  anthropic: { name: 'Anthropic', check: (k) => ({ url: (env('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com') + '/v1/models', headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } }), site: 'https://console.anthropic.com/settings/keys' },
};

const bedrockControl = (region) => (env('BEDROCK_CONTROL_URL') || `https://bedrock.${region}.amazonaws.com`).replace(/\/+$/, '');
export function bedrockRegion(key, region) { return (bedrockRegionOk(region) && region) || bedrockKeyRegion(key) || env('BEDROCK_REGION') || env('AWS_REGION') || 'us-east-1'; }
export const BEDROCK_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2', 'ap-south-1', 'ap-south-2', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2', 'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1', 'ca-central-1', 'sa-east-1'];
const keyOk = (provider, key) => key.length >= 20 && key.length <= (provider === 'bedrock' ? 4000 : 400) && !/\s/.test(key);
/* ----- encryption (same scheme as lib/connectors.js, its own derived key) ----- */
async function encKey(secret) { return crypto.createHash('sha256').update(String(await secret()) + ':aikeys').digest(); }
async function seal(obj, secret) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', await encKey(secret), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
}
async function open(s, secret) {
  const [iv, tag, ct] = String(s || '').split('.').map((x) => Buffer.from(x || '', 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', await encKey(secret), iv); d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
}

const MODEL = {
  openrouter: ['OPENROUTER_MODEL', 'anthropic/claude-sonnet-4.5'],
  openai: ['OPENAI_MODEL', 'gpt-4o-mini'],
  xai: ['XAI_MODEL', 'grok-4.5'],
  google: ['GOOGLE_AI_MODEL', 'gemini-2.5-flash'],
  anthropic: ['ANTHROPIC_MODEL', 'claude-sonnet-4-5'],
  bedrock: ['BEDROCK_MODEL', BEDROCK_DEFAULT_MODEL],
};
// Suggested models per provider for the picker. Any valid model id the provider accepts can be typed instead.
export const MODEL_CHOICES = {
  openrouter: ['anthropic/claude-sonnet-4.5', 'anthropic/claude-opus-4.1', 'anthropic/claude-haiku-4.5', 'anthropic/claude-3.7-sonnet', 'openai/gpt-5', 'openai/gpt-5-mini', 'openai/gpt-4.1', 'openai/gpt-4o', 'openai/gpt-4o-mini', 'openai/o3', 'openai/o4-mini', 'google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'google/gemini-2.0-flash-001', 'x-ai/grok-4', 'x-ai/grok-3-mini', 'meta-llama/llama-3.3-70b-instruct', 'meta-llama/llama-3.1-405b-instruct', 'deepseek/deepseek-chat', 'deepseek/deepseek-r1', 'mistralai/mistral-large', 'mistralai/mistral-small', 'qwen/qwen-2.5-72b-instruct', 'cohere/command-r-plus'],
  openai: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o3-mini', 'o4-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  xai: ['grok-4.5', 'grok-4', 'grok-code-fast-1', 'grok-3', 'grok-3-mini'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  bedrock: [BEDROCK_DEFAULT_MODEL, 'global.anthropic.claude-haiku-4-5-20251001-v1:0', 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'apac.anthropic.claude-sonnet-4-20250514-v1:0', 'apac.anthropic.claude-3-7-sonnet-20250219-v1:0', 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
    'amazon.nova-pro-v1:0', 'amazon.nova-lite-v1:0', 'amazon.nova-micro-v1:0', 'apac.amazon.nova-pro-v1:0', 'apac.amazon.nova-lite-v1:0', 'us.meta.llama3-3-70b-instruct-v1:0', 'mistral.mistral-large-2402-v1:0', 'openai.gpt-oss-120b-1:0', 'openai.gpt-oss-20b-1:0'],
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-0', 'claude-sonnet-4-0', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
};
// Live model list endpoints (the provider's own catalogue for this key).
const MODEL_LIST = {
  openrouter: () => ({ url: (env('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1') + '/models', headers: {} }),
  openai: (k) => BYOK_PROVIDERS.openai.check(k),
  xai: (k) => BYOK_PROVIDERS.xai.check(k),
  google: (k) => BYOK_PROVIDERS.google.check(k),
  anthropic: (k) => ({ ...BYOK_PROVIDERS.anthropic.check(k), url: BYOK_PROVIDERS.anthropic.check(k).url + '?limit=1000' }),
  bedrock: (k, region) => BYOK_PROVIDERS.bedrock.check(k, region),
};
// chat-capable ids only (drops embeddings, audio, image, moderation… from OpenAI-style catalogues)
const NOT_CHAT = /(embed|whisper|tts|dall-e|davinci|babbage|moderation|transcribe|audio|realtime|image|search-preview|computer-use|aqa|imagen|veo|text-bison|gecko)/i;
export function cleanModel(m) {
  const s = String(m || '').trim();
  return s && s.length <= 120 && /^[A-Za-z0-9._:\/-]+$/.test(s) ? s : '';
}
export function modelFor(provider) {
  const row = MODEL[provider] || MODEL.openrouter;
  return env(row[0], row[1]);
}
export const providerList = () => Object.entries(BYOK_PROVIDERS).map(([id, p]) => ({ id, name: p.name, site: p.site, models: MODEL_CHOICES[id] || [], defaultModel: modelFor(id), ...(p.regions ? { regions: BEDROCK_REGIONS, defaultRegion: bedrockRegion('', '') } : {}) }));

// The server key is for the sample business on staging. Production leaves this unset.
export function demoPlatformKey() { return env('CLINIC_DEMO_PLATFORM_KEY') === '1'; }
export const DEMO_KEY_LABEL = 'Demo key, demo only';
export function usageLabel(name) { return `Usage on your ${name} key, paid to your provider`; }
// Empty string means the call may run. A sentence means the clinic must refuse it.
export function clinicAiBlock(card) {
  if (card && card.source === 'own') return '';
  if (demoPlatformKey()) return '';
  return 'Save your AI key in Settings. Agent calls use that key, and you pay your provider directly.';
}

// What the clinic can show. Never includes the key. source is "own" only when the stored key can be opened.
export async function byokSummary(st, email, secret) {
  const providers = providerList();
  const row = parse((await st.get(KEY_PREFIX + email))?.v, null);
  const platformId = (() => { const id = env('AI_PROVIDER').toLowerCase().replace('grok', 'xai'); return BYOK_PROVIDERS[id] ? id : 'openrouter'; })();
  const model = mockOn() ? 'mock-1' : modelFor(platformId);
  const platform = demoPlatformKey()
    ? { source: 'demo', provider: platformId, name: 'Demo key', hint: '', model, billedTo: DEMO_KEY_LABEL, label: DEMO_KEY_LABEL, providers }
    : { source: 'none', provider: platformId, name: '', hint: '', model, billedTo: '', label: 'Save your AI key in Settings. Agent calls stay off until then.', providers };
  if (!row || !row.sealed || !BYOK_PROVIDERS[row.provider]) return platform;
  if (secret) {
    const live = await getByok(st, email, secret);
    if (!live) return platform;
  }
  const name = BYOK_PROVIDERS[row.provider].name;
  const ownModel = mockOn() ? 'mock-1' : (cleanModel(row.model) || modelFor(row.provider));
  return {
    source: 'own', provider: row.provider, name, hint: row.hint || '', model: ownModel, ...(row.provider === 'bedrock' ? { region: row.region || '' } : {}),
    billedTo: usageLabel(name), label: usageLabel(name), providers,
  };
}

export async function getByok(st, email, secret) {
  const row = parse((await st.get(KEY_PREFIX + email))?.v, null);
  if (!row || !row.sealed) return null;
  try { const o = await open(row.sealed, secret); return BYOK_PROVIDERS[o.provider] && o.key ? { provider: o.provider, key: o.key, model: cleanModel(row.model), hint: row.hint, at: row.at, ...(o.provider === 'bedrock' ? { region: bedrockRegion(o.key, row.region) } : {}) } : null; }
  catch { console.error('AI key: could not decrypt a stored customer key (SESSION_SECRET changed?)'); return null; }
}

// Asks the provider whether the key works. Returns { ok, status, limit } (limit: OpenRouter credit limit info when present).
async function checkKey(provider, key, region) {
  if (env('AI_KEY_CHECK') === 'off') return { ok: true };
  if (mockOn() && /mock/.test(key)) return { ok: true }; // test keys on a mock-AI server (AI_PROVIDER=mock + AI_MOCK=on) are never sent to a provider
  const c = BYOK_PROVIDERS[provider].check(key, region);
  try {
    const r = await fetch(c.url, { headers: c.headers, signal: AbortSignal.timeout(15000) });
    if (provider === 'bedrock' && r.status === 403) { const t = await r.text().catch(() => ''); if (!/invalid|expired|signature|security token/i.test(t)) return { ok: true }; return { ok: false, status: 403 }; } // valid key, just no list permission
    if (!r.ok) return { ok: false, status: r.status };
    const d = await r.json().catch(() => ({}));
    const lim = provider === 'openrouter' && d && d.data ? { limit: d.data.limit ?? null, remaining: d.data.limit_remaining ?? null } : null;
    return { ok: true, limit: lim };
  } catch { return { ok: false, status: 0 }; }
}

/* ----- shared-key budget ----- */
export const platformBudget = () => num('PLATFORM_AI_BUDGET_USD', 0);
const limits = () => ({
  budget: platformBudget(),
  stopAt: platformBudget() * Math.min(1, Math.max(0.5, num('PLATFORM_AI_STOP_AT', 0.95))), // stop a little early: one call can overshoot
  daily: num('PLATFORM_AI_DAILY_USD', 2),
  userCalls: num('PLATFORM_AI_USER_DAILY_CALLS', 60),
  userUsd: num('PLATFORM_AI_USER_DAILY_USD', 0.5),
});
// cost of one call: OpenRouter's real charge, else a conservative estimate ($3 / $15 per million tokens in / out)
const costOf = (u) => (typeof u.cost === 'number' ? u.cost : ((u.in || 0) * 3 + (u.out || 0) * 15) / 1e6);
const emptyPool = () => ({ total: { cost: 0, n: 0 }, days: {} });
export async function poolState(st) { return parse((await st.get(POOL))?.v, null) || emptyPool(); }

const capErr = (m) => new LlmError(m, 429, 'platform_cap');
const BYOK_HINT = ' Add your own OpenRouter key (user menu → AI key) to keep going on your own credit.';
async function poolCheck(st, email, staff) {
  const L = limits(); if (!L.budget) return;
  const p = await poolState(st), d = p.days[dayOf()] || { cost: 0, n: 0, u: {} };
  if (p.total.cost >= L.stopAt) throw capErr(`The shared demo AI credit ($${L.budget}) is used up.` + BYOK_HINT);
  if (L.daily && d.cost >= L.daily) throw capErr('Today’s shared demo AI credit is used up. It resets at midnight IST.' + BYOK_HINT);
  if (staff || !email) return;
  const me = (d.u || {})[email] || { n: 0, cost: 0 };
  if ((L.userCalls && me.n >= L.userCalls) || (L.userUsd && me.cost >= L.userUsd)) throw capErr('You’ve reached today’s free AI allowance on the shared demo key. It resets at midnight IST.' + BYOK_HINT);
}
function poolRecord(st, email, u) {
  if (!platformBudget() || u.byok) return Promise.resolve();
  const c = costOf(u), day = dayOf();
  return st.update(POOL, (cur) => {
    const p = parse(cur, null) || emptyPool();
    p.total.cost += c; p.total.n += 1;
    const d = (p.days[day] ||= { cost: 0, n: 0, u: {} }); d.cost += c; d.n += 1;
    if (email) { const me = (d.u[email] ||= { n: 0, cost: 0 }); me.n += 1; me.cost += c; }
    for (const k of Object.keys(p.days).sort().slice(0, -14)) delete p.days[k]; // keep two weeks of days
    return JSON.stringify(p);
  }).catch((e) => console.error('AI pool:', e.message));
}

// Account deleted: its email leaves the spend log. Its usage stays, under a short one-way hash, so totals still add up.
export async function forgetPoolUser(st, email) {
  if (!email) return;
  const cur = parse((await st.get(POOL))?.v, null);
  if (!cur || !Object.values(cur.days || {}).some((d) => d.u && d.u[email])) return;
  const anon = 'gone:' + crypto.createHash('sha256').update(String(email)).digest('hex').slice(0, 12);
  await st.update(POOL, (txt) => {
    const p = parse(txt, null); if (!p) return undefined;
    for (const d of Object.values(p.days || {})) if (d.u && d.u[email]) { const o = d.u[email], g = (d.u[anon] ||= { n: 0, cost: 0 }); g.n += o.n; g.cost += o.cost; delete d.u[email]; }
    return JSON.stringify(p);
  }).catch((e) => console.error('AI pool forget:', e.message));
}

// Runs fn with the right AI context for this signed-in user, and waits for spend records before returning
// (serverless functions can freeze right after the response).
export async function withAiFor({ st, email, staff, secret }, fn) {
  const byok = staff ? null : await getByok(st, email, secret);
  const pending = [];
  const ctx = {
    byok: byok ? { provider: byok.provider, key: byok.key, model: byok.model || '' } : null,
    check: async () => {
      const { assertAiRoom } = await import('./agency.js');
      await assertAiRoom(st, email);
      if (!byok) await poolCheck(st, email, staff);
    },
    record: (u) => {
      if (!byok) pending.push(poolRecord(st, email, u));
      const c = costOf(u);
      pending.push(import('./agency.js').then((m) => m.noteUsage(st, email, { ai_calls: 1, ai_cost_usd: c })));
      pending.push(import('./clinic.js').then((m) => m.noteClinicAi(st, email, u)));
    },
  };
  try { return await aiScope(ctx, fn); }
  finally { await Promise.allSettled(pending); }
}
// Calls outside a user request (routines, cron) still count against the shared pool.
export function initDefaultAiContext(st) {
  setDefaultAiContext({ byok: null, check: () => poolCheck(st, '', true), record: (u) => { poolRecord(st, '', u); } });
}

/* ----- routes: GET /api/ai/key, POST /api/ai/key, POST /api/ai/key/delete ----- */
export async function aiKeyRoutes({ method, pathname, json, st, who, secret, HttpError }) {
  if (pathname !== '/api/ai/key' && pathname !== '/api/ai/key/delete' && pathname !== '/api/ai/models') return undefined;
  const k = KEY_PREFIX + who.email;
  // POST /api/ai/models {provider, key?}: the provider's live model list, using the pasted key or the saved one.
  // The key is only sent to that provider's own API and never stored by this call.
  if (pathname === '/api/ai/models' && method === 'POST') {
    const b = json(), provider = String(b.provider || '').toLowerCase();
    if (!BYOK_PROVIDERS[provider]) throw new HttpError(400, 'bad_provider', 'Choose OpenRouter, Amazon Bedrock, OpenAI, xAI, Google Gemini or Anthropic.');
    let key = String(b.key || '').trim(), region = String(b.region || '').trim();
    if (key && !keyOk(provider, key)) throw new HttpError(400, 'bad_key', 'That doesn’t look like an API key. Paste the whole key, with no spaces.');
    if (!key) { const saved = await getByok(st, who.email, secret); if (saved && saved.provider === provider) { key = saved.key; region = region || saved.region || ''; } }
    if (!key && provider !== 'openrouter') throw new HttpError(400, 'needs_key', 'Paste your API key first, then load the models.');
    if (mockOn() && (!key || /mock/.test(key))) return { provider, live: false, models: MODEL_CHOICES[provider] || [] };
    const c = MODEL_LIST[provider](key, region);
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 9000);
    let r, d;
    try { r = await fetch(c.url, { headers: c.headers, signal: ac.signal }); d = await r.json().catch(() => ({})); }
    catch { throw new HttpError(502, 'unreachable', `Couldn’t reach ${BYOK_PROVIDERS[provider].name}. Check the connection and try again.`); }
    finally { clearTimeout(timer); }
    if (provider === 'bedrock' && r.status === 403 && !/invalid|expired|signature|security token/i.test(JSON.stringify(d))) return { provider, live: false, models: MODEL_CHOICES.bedrock, note: 'This key can’t list models, so here are common ones. Any model id enabled in your Bedrock account works.' };
    if (r.status === 401 || r.status === 403) throw new HttpError(400, 'key_rejected', `${BYOK_PROVIDERS[provider].name} didn’t accept that key (${r.status}).`);
    if (!r.ok) throw new HttpError(502, 'upstream', `${BYOK_PROVIDERS[provider].name} answered ${r.status}. Try again.`);
    if (provider === 'bedrock') { // on-demand models plus cross-region inference profiles (most Claude models need a profile id)
      const ids = (d.modelSummaries || []).filter((x) => (x.inferenceTypesSupported || []).includes('ON_DEMAND') && (x.outputModalities || ['TEXT']).includes('TEXT') && !NOT_CHAT.test(x.modelId || '')).map((x) => x.modelId);
      try {
        const pr = await fetch(c.url.replace(/\/foundation-models.*$/, '/inference-profiles?maxResults=1000'), { headers: c.headers, signal: AbortSignal.timeout(9000) });
        if (pr.ok) for (const x of ((await pr.json()).inferenceProfileSummaries || [])) if (x.inferenceProfileId && !NOT_CHAT.test(x.inferenceProfileId)) ids.unshift(x.inferenceProfileId);
      } catch { /* profiles are optional */ }
      const list = [...new Set(ids.map(cleanModel).filter(Boolean))];
      list.sort((x, y) => (/anthropic\.claude/.test(y) - /anthropic\.claude/.test(x)) || x.localeCompare(y));
      return { provider, live: true, region: bedrockRegion(key, region), models: list.slice(0, 1500) };
    }
    const rows = Array.isArray(d.data) ? d.data : Array.isArray(d.models) ? d.models : [];
    const ids = [...new Set(rows.map((x) => cleanModel(String((x && (x.id || x.name)) || '').replace(/^models\//, ''))).filter((id) => id && !NOT_CHAT.test(id)))];
    ids.sort((x, y) => x.localeCompare(y));
    return { provider, live: true, models: ids.slice(0, 1500) };
  }
  if (pathname === '/api/ai/key' && method === 'GET') {
    const row = parse((await st.get(k))?.v, null), L = limits();
    let platform = { on: !!(env('OPENROUTER_API_KEY') || env('AWS_BEARER_TOKEN_BEDROCK') || env('ANTHROPIC_API_KEY') || env('OPENAI_API_KEY') || env('XAI_API_KEY') || env('GOOGLE_AI_API_KEY')), budget: L.budget || null };
    if (L.budget) {
      const p = await poolState(st), d = p.days[dayOf()] || { u: {} }, me = (d.u || {})[who.email] || { n: 0, cost: 0 };
      platform = { ...platform, exhausted: p.total.cost >= L.stopAt, today: { calls: me.n, callLimit: L.userCalls || null } };
    }
    const card = await byokSummary(st, who.email, secret);
    return { byok: card.source === 'own' ? { provider: card.provider, name: card.name, hint: card.hint, model: cleanModel(row.model), at: row.at, ...(row.region ? { region: row.region } : {}) } : null,
      providers: card.providers, source: card.source, model: card.model, billedTo: card.billedTo, platform };
  }
  if (method !== 'POST') return undefined;
  if (who.role && who.role !== 'customer') throw new HttpError(403, 'customers_only', 'Staff accounts use the server’s AI keys (Settings).');
  if (pathname === '/api/ai/key/delete') { await st.put(k, null, Date.now()); return { ok: true, byok: null }; }
  const b = json(), provider = String(b.provider || 'openrouter').toLowerCase(), key = String(b.key || '').trim();
  if (!BYOK_PROVIDERS[provider]) throw new HttpError(400, 'bad_provider', 'Choose OpenRouter, Amazon Bedrock, OpenAI, xAI, Google Gemini or Anthropic.');
  const model = cleanModel(b.model);
  const region = provider === 'bedrock' ? String(b.region || '').trim() : '';
  if (region && !bedrockRegionOk(region)) throw new HttpError(400, 'bad_region', 'Pick an AWS region, e.g. us-east-1 or ap-south-1.');
  if (b.model && String(b.model).trim() && !model) throw new HttpError(400, 'bad_model', 'That model name has characters a model id cannot have.');
  if (!key) {
    // model-only change on the key already saved for this provider
    const cur = parse((await st.get(k))?.v, null);
    if (!cur || !cur.sealed || cur.provider !== provider) throw new HttpError(400, 'bad_key', 'Paste your API key for this provider.');
    const next = { ...cur, model, ...(region ? { region } : {}), at: Date.now() };
    await st.put(k, JSON.stringify(next), Date.now());
    return { ok: true, byok: { provider, name: BYOK_PROVIDERS[provider].name, hint: cur.hint, model, at: next.at } };
  }
  if (!keyOk(provider, key)) throw new HttpError(400, 'bad_key', 'That doesn’t look like an API key. Paste the whole key, with no spaces.');
  const chk = await checkKey(provider, key, region);
  if (!chk.ok) throw new HttpError(400, 'key_rejected', `${BYOK_PROVIDERS[provider].name} didn’t accept that key${chk.status ? ' (' + chk.status + ')' : ''}. Check it and try again.`);
  const row = { provider, model, ...(provider === 'bedrock' ? { region: bedrockRegion(key, region) } : {}), hint: '…' + key.slice(-4), at: Date.now(), sealed: await seal({ provider, key }, secret) };
  await st.put(k, JSON.stringify(row), Date.now());
  return { ok: true, byok: { provider, name: BYOK_PROVIDERS[provider].name, hint: row.hint, model, at: row.at }, limit: chk.limit || null };
}
