// Owner rules for agent actions: "When Chief wants to <action>, it should allow | ask | never".
// Each action that changes something outside AaaS (an app, an email, a post, a browser step) is checked against
// the rules before it runs. A small AI review picks the rules that clearly apply; without AI (or if the review
// fails) a word-overlap match is used. When several rules apply, "never" beats "ask" beats "allow".
// No rule applies → the default: reading runs, changing waits for approval.
import crypto from 'node:crypto';
import { complete, llmReady, mockOn } from './llm.js';

const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
const KEY = (email) => 'as_rules:' + email;
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const DECISIONS = ['allow', 'ask', 'never'];
const MAX_RULES = 60;

export async function listRules(st, email) { return parse((await st.get(KEY(email)))?.v, []) || []; }
async function saveRules(st, email, list) { await st.put(KEY(email), list.length ? JSON.stringify(list) : null, Date.now()); }

export async function addRule(st, email, { action, decision, aid = null }) {
  const a = clip(String(action || '').replace(/^(when\s+(chief|the agent|it)\s+wants\s+to\s+)/i, ''), 200);
  if (a.length < 3) throw Object.assign(new Error('Describe the action, e.g. “send an email to a customer”.'), { status: 400 });
  if (!DECISIONS.includes(decision)) throw Object.assign(new Error('Pick allow, ask or never.'), { status: 400 });
  const list = await listRules(st, email);
  const same = list.find((r) => r.action.toLowerCase() === a.toLowerCase() && (r.aid || null) === (aid || null));
  if (same) { same.decision = decision; same.at = Date.now(); await saveRules(st, email, list); return same; }
  if (list.length >= MAX_RULES) throw Object.assign(new Error('Too many rules; remove some first.'), { status: 400 });
  const r = { id: 'ru' + crypto.randomBytes(5).toString('hex'), action: a, decision, aid: aid || null, at: Date.now() };
  list.push(r); await saveRules(st, email, list);
  return r;
}
export async function removeRule(st, email, id) {
  const list = await listRules(st, email), next = list.filter((r) => r.id !== id);
  if (next.length !== list.length) await saveRules(st, email, next);
  return { ok: true, was: next.length !== list.length };
}

// ---------- matching ----------
const STOP = new Set('the a an and or of to in on for with is are be it its this that my me i you your our we us do does any some all from by at as into onto about wants want chief agent should when it'.split(' '));
const stem = (w) => w.replace(/(ings|ing|ies|ied|es|ed|s)$/, '');
const words = (s) => [...new Set((String(s).toLowerCase().match(/[a-z0-9@._-]{3,}/g) || []).filter((w) => !STOP.has(w)).map(stem))];
function overlapApplies(rule, action) {
  const rw = words(rule), aw = words(action);
  if (!rw.length) return false;
  const hit = rw.filter((w) => aw.some((x) => x === w || (w.length > 4 && (x.startsWith(w) || w.startsWith(x))))).length;
  return hit / rw.length >= 0.7;
}
async function aiApplying(rules, action) {
  const list = rules.map((r, i) => `${i + 1}. ${r.action}`).join('\n');
  const prompt = `You check one pending action of a business owner's AI agent against the owner's rules.
A rule applies only if the action clearly falls under what the rule describes. Answer with JSON only: {"applying":[numbers]} — an empty list when none apply.

Rules (each describes actions):
${list}

Pending action: the agent wants to ${action}`;
  const r = await complete(prompt, { max: 60, meta: { agent: 'rules' } });
  const m = String(r.text || '').match(/\{[\s\S]*\}/);
  const j = m ? parse(m[0], null) : null;
  if (!j || !Array.isArray(j.applying)) throw new Error('unreadable review');
  return j.applying.map((n) => rules[Number(n) - 1]).filter(Boolean);
}

// → { decision: 'allow'|'ask'|'never', rule: Rule|null }
export async function review({ st, email, aid = null, action, fallback = 'ask' }) {
  const rules = (await listRules(st, email)).filter((r) => !r.aid || r.aid === aid);
  if (!rules.length) return { decision: fallback, rule: null };
  let matched;
  if (llmReady() && !mockOn()) {
    try { matched = await aiApplying(rules, action); }
    catch { matched = rules.filter((r) => overlapApplies(r.action, action)); }
  } else matched = rules.filter((r) => overlapApplies(r.action, action));
  if (!matched.length) return { decision: fallback, rule: null };
  const pick = (d) => matched.find((r) => r.decision === d);
  const rule = pick('never') || pick('ask') || pick('allow');
  return { decision: rule.decision, rule };
}
export const _forTests = { overlapApplies };

// ---------- skills: step-by-step instructions an agent saves and reuses ----------
const SK = (email) => 'as_skills:' + email;
export async function listSkills(st, email) { return parse((await st.get(SK(email)))?.v, []) || []; }
export async function saveSkill(st, email, { id, name, description, body, aid = null }) {
  const n = clip(name, 60), d = clip(description, 200), b = String(body || '').slice(0, 6000).trim();
  if (n.length < 2 || !b) throw Object.assign(new Error('A skill needs a name and instructions.'), { status: 400 });
  const list = await listSkills(st, email);
  const cur = (id && list.find((k) => k.id === id)) || list.find((k) => k.name.toLowerCase() === n.toLowerCase());
  if (cur) Object.assign(cur, { name: n, description: d || cur.description, body: b, aid: aid || cur.aid || null, at: Date.now() });
  else { if (list.length >= 80) throw Object.assign(new Error('Too many skills; remove some first.'), { status: 400 }); list.push({ id: 'sk' + crypto.randomBytes(5).toString('hex'), name: n, description: d, body: b, aid: aid || null, at: Date.now() }); }
  await st.put(SK(email), JSON.stringify(list), Date.now());
  return cur || list[list.length - 1];
}
export async function removeSkill(st, email, id) {
  const list = await listSkills(st, email), next = list.filter((k) => k.id !== id);
  await st.put(SK(email), next.length ? JSON.stringify(next) : null, Date.now());
  return { ok: true, was: next.length !== list.length };
}
