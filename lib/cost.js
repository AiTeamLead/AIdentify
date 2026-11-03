// Cheap model for drafts and reminders. A stronger model for Chief. Figures are estimates, not a bill.
export const CHEAP = {
  openrouter: 'openai/gpt-4o-mini',
  openai: 'gpt-4o-mini',
  google: 'gemini-2.5-flash',
  anthropic: 'claude-haiku-4-5',
  xai: 'grok-4-fast',
};
export const STRONG = {
  openrouter: 'anthropic/claude-sonnet-4.5',
  openai: 'gpt-4o',
  google: 'gemini-2.5-pro',
  anthropic: 'claude-sonnet-4-5',
  xai: 'grok-4',
};
// USD per million tokens, rough public list prices. Enough to show a monthly estimate.
const PRICE = {
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  'gemini-2.5-flash': { in: 0.15, out: 0.6 },
  'claude-sonnet-4-5': { in: 3, out: 15 },
  'gpt-4o': { in: 2.5, out: 10 },
};

export function modelFor(provider, tier) {
  const table = tier === 'strong' ? STRONG : CHEAP;
  return table[provider] || table.openrouter;
}
export function estimateUsd({ model, inTok = 0, outTok = 0 }) {
  const id = String(model || '');
  const hit = Object.entries(PRICE).find(([k]) => id.includes(k));
  const p = hit ? hit[1] : PRICE['gpt-4o-mini'];
  return (Number(inTok) * p.in + Number(outTok) * p.out) / 1e6;
}
// A small clinic or agency: drafts and reminders on the cheap model, Chief on the strong one.
export function monthlyEstimate({ drafts = 400, chief = 80, inTok = 800, outTok = 250, inrPerUsd = 84 } = {}) {
  const cheap = estimateUsd({ model: 'gpt-4o-mini', inTok, outTok });
  const strong = estimateUsd({ model: 'claude-sonnet-4-5', inTok: inTok * 2, outTok });
  const usd = drafts * cheap + chief * strong;
  return {
    drafts, chief, usd: Math.round(usd * 100) / 100,
    inr: Math.round(usd * inrPerUsd),
    cheapModel: 'gpt-4o-mini', strongModel: 'claude-sonnet-4-5',
    note: 'Estimate only. You pay your AI provider. AaaS does not add a model fee.',
  };
}
