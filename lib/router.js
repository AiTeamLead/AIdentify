// Auto mode: picks the cheapest model that can do each AI job, through OpenRouter.
//
//   classify()  reads one request (system prompt, messages, tools, images, agent/task hints) and returns a task class:
//                 simple  short chat, widget / front-desk replies, one-line helpers
//                 vision  the request carries an image
//                 build   website builds and edits, JSON drafting, tool-using agent work, moderate reasoning
//                 hard    long or explicitly hard reasoning (strategy, analysis, forecasts) or the "strong" tier
//   chainFor()  turns a class into an ordered model list: the first model, then fallbacks on error or rate limit.
//   planFor()   the user's own model pick (model picker) goes first; "auto" means classify and route.
//
// The routing table is config, not code: defaults below, overridden by the admin (AI credits tab → Routing table),
// saved in as_sys_credits_cfg together with the credit markup (lib/credits.js). Prices are OpenRouter list prices in US$
// per 1M tokens, read live from https://openrouter.ai/api/v1/models (cached 6 h) with the table below as the fallback.
const env = (k, d = '') => String(process.env[k] ?? d).trim();

export const TASKS = ['simple', 'vision', 'build', 'hard'];
export const TASK_LABELS = { simple: 'Simple chat & widget replies', vision: 'Images (vision)', build: 'Website builds, edits & agent work', hard: 'Hard reasoning' };

// Checked against the live OpenRouter list on 29 Nov 2026 (IST).
export const DEFAULT_ROUTES = {
  simple: ['google/gemini-2.5-flash-lite', 'deepseek/deepseek-v4-flash', 'google/gemini-3.1-flash-lite'],
  vision: ['google/gemini-2.5-flash-lite', 'google/gemini-3.1-flash-lite', 'anthropic/claude-haiku-5.5'],
  build: ['anthropic/claude-haiku-5.5', 'anthropic/claude-haiku-4.5', 'google/gemini-3.1-flash-lite'],
  hard: ['anthropic/claude-sonnet-5.5', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-haiku-5.5'],
};
// US$ per 1M tokens (input, output) and whether the model reads images. Fallback when the live list can't be read.
export const PRICE_TABLE = {
  'google/gemini-2.5-flash-lite': { in: 0.10, out: 0.40, vision: true, name: 'Gemini 2.5 Flash-Lite' },
  'google/gemini-3.1-flash-lite': { in: 0.25, out: 1.50, vision: true, name: 'Gemini 3.1 Flash-Lite' },
  'deepseek/deepseek-v4-flash': { in: 0.09, out: 0.18, vision: false, name: 'DeepSeek V4 Flash' },
  'anthropic/claude-haiku-5.5': { in: 0.10, out: 0.50, vision: true, name: 'Claude Haiku 5.5' },
  'anthropic/claude-haiku-4.5': { in: 1.00, out: 5.00, vision: true, name: 'Claude Haiku 4.5' },
  'anthropic/claude-sonnet-5.5': { in: 2.00, out: 10.00, vision: true, name: 'Claude Sonnet 5.5' },
  'anthropic/claude-sonnet-4.6': { in: 3.00, out: 15.00, vision: true, name: 'Claude Sonnet 4.6' },
  'anthropic/claude-sonnet-4.5': { in: 3.00, out: 15.00, vision: true, name: 'Claude Sonnet 4.5' },
  'openai/gpt-5-mini': { in: 0.25, out: 2.00, vision: true, name: 'GPT-5 mini' },
  'openai/gpt-5-nano': { in: 0.05, out: 0.40, vision: true, name: 'GPT-5 nano' },
};
// What the model picker offers (any id in the routing table is offered too).
export const PICKER = ['auto', 'google/gemini-2.5-flash-lite', 'google/gemini-3.1-flash-lite', 'anthropic/claude-haiku-5.5', 'openai/gpt-5-mini', 'anthropic/claude-sonnet-5.5'];

export const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,60}\/[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/;
export const okModel = (m) => typeof m === 'string' && MODEL_ID.test(m.trim()) && !m.includes('..');

// Clean an admin-edited routing table; unknown keys are dropped, every class keeps at least one model.
export function cleanRoutes(input, base = DEFAULT_ROUTES) {
  const out = {};
  for (const t of TASKS) {
    const raw = input && Object.prototype.hasOwnProperty.call(input, t) ? input[t] : base[t];
    const list = (Array.isArray(raw) ? raw : String(raw || '').split(/[\n,]/)).map((s) => String(s).trim()).filter(okModel);
    out[t] = [...new Set(list)].slice(0, 5);
    if (!out[t].length) out[t] = [...base[t]];
  }
  return out;
}

/* ----- classifier ----- */
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : b && (b.text || (typeof b.content === 'string' ? b.content : '')) || '')).join(' ') : '');
const hasImagePart = (c) => Array.isArray(c) && c.some((b) => b && (b.type === 'image_url' || b.type === 'image' || b.type === 'input_image'));
const SIMPLE_AGENTS = /^(frontdesk|front-desk|widget|rules|settings-test|engage|reply|triage|wa-triage|classify)/i;
const BUILD_AGENTS = /^(website|site|builder|launch|workflows|playbook|cos|social|content|writer)/i;
const HARD_AGENTS = /^(planner|strategy|analyst|research)/i;
const BUILD_WORDS = /\b(website|web ?site|landing page|home ?page|html|css|redesign|hero section|section|headline|template|rewrite|draft (a|an|the)|blog post|email sequence|json)\b/i;
const HARD_WORDS = /\b(analy[sz]e|analysis|strategy|strategic|forecast|projection|financial model|step[- ]by[- ]step|reason (through|about)|prove|derive|root cause|debug|trade-?offs?|compare .{0,40} (and|vs\.?|versus)|business plan|pricing model|unit economics)\b/i;

// req: { system, messages: [{role, content}], prompt, tools: [], images: [], meta: { agent, task, tier } }
export function classify(req = {}) {
  const meta = req.meta || {};
  const msgs = Array.isArray(req.messages) ? req.messages : [];
  if ((req.images && req.images.length) || meta.vision || msgs.some((m) => hasImagePart(m && m.content))) return 'vision';
  const task = String(meta.task || '').toLowerCase();
  if (TASKS.includes(task)) return task;
  if (/^(chat|widget|reply|frontdesk)$/.test(task)) return 'simple';
  if (/^(website|site|build|edit|draft|json)$/.test(task)) return 'build';
  if (/^(reason|reasoning|plan|analysis)$/.test(task)) return 'hard';
  if (meta.tier === 'strong') return 'hard';
  const agent = String(meta.agent || '');
  const sys = String(req.system || '');
  const user = String(req.prompt || '') + ' ' + msgs.filter((m) => m && m.role === 'user').slice(-2).map((m) => textOf(m.content)).join(' ');
  const size = sys.length + msgs.reduce((n, m) => n + textOf(m && m.content).length, 0) + String(req.prompt || '').length;
  if (HARD_AGENTS.test(agent)) return 'hard';
  if (HARD_WORDS.test(user) && (size > 1500 || user.trim().length > 240)) return 'hard'; // a short "analyse this" stays cheap
  if (size > 24000) return 'hard'; // very long context: the strong model reads it better and avoids a retry
  if (SIMPLE_AGENTS.test(agent) && !BUILD_WORDS.test(user)) return 'simple';
  if (/AIDENTIFY_(WORKFLOW|SITE|WEBSITE)_JSON/.test(sys)) return 'build';
  if (BUILD_AGENTS.test(agent) || BUILD_WORDS.test(user)) return 'build';
  if (Array.isArray(req.tools) && req.tools.length) return 'build'; // tool-using agent work is multi-step: a moderate model
  if (user.trim().length > 1200) return 'build';
  return 'simple';
}

export function chainFor(cls, routes = DEFAULT_ROUTES) {
  const r = cleanRoutes(routes);
  return [...(r[cls] || r.simple)];
}

// → [{ provider: 'openrouter', model }] in try order, plus the class. pick = the user's model picker value.
export function planFor(req, { routes = DEFAULT_ROUTES, pick = 'auto' } = {}) {
  const cls = classify(req);
  const chain = chainFor(cls, routes);
  const own = pick && pick !== 'auto' && okModel(pick) ? pick : '';
  // a picked model that cannot read images falls back to the vision route for image requests
  const ownOk = own && !(cls === 'vision' && PRICE_TABLE[own] && PRICE_TABLE[own].vision === false);
  const models = ownOk ? [own, ...chain.filter((m) => m !== own)] : chain;
  return { cls, picked: ownOk ? own : '', plan: models.map((model) => ({ provider: 'openrouter', model })) };
}

/* ----- live prices (US$ per 1M tokens) ----- */
let live = { at: 0, map: null, p: null };
export async function prices({ fetchImpl = fetch, force = false } = {}) {
  if (!force && live.map && Date.now() - live.at < 6 * 3600e3) return live.map;
  if (env('AI_PROVIDER').toLowerCase() === 'mock' || env('ROUTER_LIVE_PRICES') === 'off') return PRICE_TABLE;
  if (live.p) return live.p;
  live.p = (async () => {
    try {
      const r = await fetchImpl((env('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1') + '/models', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('models ' + r.status);
      const d = await r.json(), map = { ...PRICE_TABLE };
      for (const m of d.data || []) {
        const pIn = Number(m.pricing && m.pricing.prompt), pOut = Number(m.pricing && m.pricing.completion);
        if (!Number.isFinite(pIn) || !Number.isFinite(pOut)) continue;
        const mods = (m.architecture && m.architecture.input_modalities) || [];
        map[m.id] = { in: +(pIn * 1e6).toFixed(4), out: +(pOut * 1e6).toFixed(4), vision: mods.includes('image'), name: m.name || m.id };
      }
      live = { at: Date.now(), map, p: null };
      return map;
    } catch { live.p = null; return live.map || PRICE_TABLE; }
  })();
  return live.p;
}
export const _resetPrices = () => { live = { at: 0, map: null, p: null }; };
export function priceOf(model, map = PRICE_TABLE) { return map[model] || PRICE_TABLE[model] || null; }
// cost in US$ for a call when the provider did not report one; unknown models use a conservative $3 / $15
export function estimateUsd(model, tokIn, tokOut, map = PRICE_TABLE) {
  const p = priceOf(model, map) || { in: 3, out: 15 };
  return ((Number(tokIn) || 0) * p.in + (Number(tokOut) || 0) * p.out) / 1e6;
}
