// Settings API (settings.html): admin check, save/validate, every connection test, model lists, update check,
// agents, routines, memory, backup/restore (dry run), staff passwords. Outside services are faked (fetch replaced).
import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsRoutes, isSettingsAdmin, isOwnerEmail } from '../lib/settings-api.js';
import { initSettings, publicView, validate } from '../lib/settings.js';

process.env.SETTINGS_OWNERS = 'owner@example.com';
const memStore = () => { const m = new Map(); return { m, kind: 'memory', get: async (k) => (m.has(k) ? { v: m.get(k) } : null), put: async (k, v, at = 0) => { m.set(k, v); void at; }, all: async () => [...m].map(([k, v]) => ({ k, v, at: 1 })) }; };
class HttpError extends Error { constructor(status, code, msg) { super(msg || code); this.status = status; this.code = code; } }
const owner = { email: 'owner@example.com', role: 'customer' };

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let routes = {};
globalThis.fetch = async (url) => {
  const u = String(url);
  for (const [k, fn] of Object.entries(routes)) if (u.includes(k)) return fn(u);
  return json(404, { error: { message: 'no route ' + u } });
};

async function setup() {
  const st = memStore();
  await initSettings(st, async () => 'settings-secret');
  const users = { 'admin@example.com': { role: 'admin', hash: 'x' }, 'team@example.com': { role: 'team', hash: 'y' }, 'owner@example.com': { hash: 'z' } };
  const call = (method, pathname, b = {}, q = '') => settingsRoutes({ method, pathname, query: new URLSearchParams(q), b, st, who: owner, HttpError, users,
    saveUsers: async () => {}, hashPassword: (p) => 'h:' + p, weakPassword: (p) => (p.length < 10 ? 'Too short' : ''), adminEmail: () => 'admin@example.com', teamEmail: () => 'team@example.com' });
  return { st, users, call };
}

test('who may open Settings', async () => {
  assert.equal(isOwnerEmail('OWNER@example.com'), true);
  assert.equal(isSettingsAdmin({ email: 'x@y.z', role: 'admin' }), true);
  assert.equal(isSettingsAdmin({ email: 'x@y.z' }), false);
  const { st } = await setup();
  const r = await settingsRoutes({ method: 'GET', pathname: '/api/settings/me', who: { email: 'x@y.z' }, st, HttpError });
  assert.deepEqual(r, { admin: false, email: 'x@y.z' });
  assert.equal(await settingsRoutes({ method: 'GET', pathname: '/api/other', who: owner, st, HttpError }), undefined);
  await assert.rejects(settingsRoutes({ method: 'GET', pathname: '/api/settings', who: { email: 'x@y.z' }, st, HttpError }), (e) => e.status === 403);
});

test('read and save settings; secrets never come back; bad values refused', async () => {
  const { call, st } = await setup();
  const g = await call('GET', '/api/settings');
  assert.ok(g.schema.length > 20); assert.ok(g.values.AI_PROVIDER);
  const s = await call('POST', '/api/settings', { patch: { TAVILY_API_KEY: 'tvly-secret-123456', AGENT_MAX_STEPS: '9', AI_PROVIDER: 'openrouter' } });
  assert.deepEqual(s.changed.sort(), ['AGENT_MAX_STEPS', 'AI_PROVIDER', 'TAVILY_API_KEY']);
  assert.equal(s.values.TAVILY_API_KEY.set, true); assert.equal(s.values.TAVILY_API_KEY.last4, '3456');
  assert.doesNotMatch(st.m.get('as_settings'), /tvly-secret/, 'secret stored encrypted');
  assert.equal(process.env.AGENT_MAX_STEPS, '9');
  await assert.rejects(call('POST', '/api/settings', { patch: { NOPE: '1' } }), (e) => e.code === 'invalid');
  await assert.rejects(call('POST', '/api/settings', { patch: { AGENT_MAX_STEPS: '999' } }), (e) => e.code === 'invalid');
  await assert.rejects(call('POST', '/api/settings', { patch: { AI_PROVIDER: 'martian' } }), (e) => e.code === 'invalid');
  assert.equal((await call('POST', '/api/settings', { patch: { AGENT_MAX_STEPS: '9' } })).changed.length, 0, 'same value: nothing changes');
  await call('POST', '/api/settings', { patch: { AGENT_MAX_STEPS: '' } });
  assert.equal(publicView().AGENT_MAX_STEPS.source, 'default');
  assert.throws(() => validate('NOT_A_SETTING', 'x'));
  // settings survive a restart (decrypted again)
  await initSettings(st, async () => 'settings-secret');
  assert.equal(publicView().TAVILY_API_KEY.set, true);
  const audit = await call('GET', '/api/settings/audit');
  assert.ok(audit.log.some((x) => x.action === 'save'));
});

test('connection tests for each provider and service', async () => {
  const { call } = await setup();
  const T = (kind) => call('POST', '/api/settings/test', { kind });
  routes = {
    'openrouter.ai/api/v1/key': () => json(200, { data: { limit: 10, usage: 2 } }),
    'api.anthropic.com/v1/models': () => json(200, { data: [{ id: 'claude' }] }),
    'api.openai.com/v1/models': () => json(401, { error: { message: 'Incorrect API key sk-abc123' } }),
    'slack.com/api/auth.test': () => json(200, { ok: true, user: 'aidbot', team: 'Bright' }),
    'slack.com/api/conversations.open': () => json(200, { ok: true, channel: { id: 'D1' } }),
    'slack.com/api/chat.postMessage': () => json(200, { ok: true }),
    'api.github.com/user': () => json(200, { login: 'phani' }),
    'api.gumroad.com': () => json(200, { success: true, user: { name: 'Phani' } }),
    'composio.dev': () => json(200, { items: [] }),
    'api.tavily.com': () => json(200, { results: [] }),
    'bedrock.': () => json(200, { modelSummaries: [{ modelId: 'anthropic.claude' }] }),
    '/models': () => json(200, { data: [{ id: 'm1' }] }),
  };
  for (const k of ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'SLACK_BOT_TOKEN', 'SLACK_OWNER_USER_ID', 'GITHUB_TOKEN', 'GUMROAD_ACCESS_TOKEN', 'COMPOSIO_API_KEY', 'TAVILY_API_KEY', 'AWS_BEARER_TOKEN_BEDROCK', 'XAI_API_KEY']) delete process.env[k];
  assert.match((await T('openrouter')).detail, /No key set/);
  assert.match((await T('slack')).detail, /No bot token/);
  assert.match((await T('slack_dm')).detail, /needed/);
  assert.match((await T('github')).detail, /No token/);
  assert.match((await T('gumroad')).detail, /No token/);
  assert.match((await T('composio')).detail, /No key/);
  assert.match((await T('tavily')).detail, /No key/);
  assert.match((await T('gmail')).detail, /needed/);
  Object.assign(process.env, { OPENROUTER_API_KEY: 'or-key', ANTHROPIC_API_KEY: 'an-key', OPENAI_API_KEY: 'sk-abc123', XAI_API_KEY: 'x-key', SLACK_BOT_TOKEN: 'xoxb-1', SLACK_OWNER_USER_ID: 'U1', GITHUB_TOKEN: 'gh', GUMROAD_ACCESS_TOKEN: 'gr', COMPOSIO_API_KEY: 'ck', TAVILY_API_KEY: 'tv', AWS_BEARER_TOKEN_BEDROCK: 'bk' });
  assert.equal((await T('openrouter')).ok, true);
  assert.match((await T('anthropic')).detail, /Key works \(1 models/);
  const oa = await T('openai'); assert.equal(oa.ok, false); assert.match(oa.detail, /OpenAI answered 401/); assert.doesNotMatch(oa.detail, /sk-abc123/, 'keys are redacted');
  assert.equal((await T('xai')).ok, true);
  assert.equal((await T('bedrock')).ok, true);
  assert.match((await T('slack')).detail, /bot aidbot in Bright/);
  assert.match((await T('slack_dm')).detail, /Test DM sent/);
  assert.equal((await T('github')).ok, true);
  assert.equal((await T('gumroad')).ok, true);
  assert.equal((await T('composio')).ok, true);
  assert.equal((await T('tavily')).ok, true);
  assert.equal(typeof (await T('browser_tools')).detail, 'string');
  assert.match((await T('nope')).detail, /Unknown test/);
  routes['slack.com/api/auth.test'] = () => json(200, { ok: false, error: 'invalid_auth' });
  routes['slack.com/api/conversations.open'] = () => json(200, { ok: false, error: 'user_not_found' });
  assert.match((await T('slack')).detail, /invalid_auth/);
  assert.match((await T('slack_dm')).detail, /user_not_found/);
  delete process.env.OLLAMA_BASE_URL;
  assert.match((await T('ollama')).detail, /No base URL/);
});

test('model lists, update check, usage, logs, status, diagnostics', async () => {
  const { call } = await setup();
  routes = {
    'api.anthropic.com/v1/models': () => json(200, { data: [{ id: 'claude-x', display_name: 'Claude X' }] }),
    'bedrock.': () => json(200, { modelSummaries: [{ modelId: 'anthropic.claude', modelName: 'Claude', inferenceTypesSupported: ['ON_DEMAND'] }] }),
    'api.x.ai/v1/models': () => json(200, { data: [{ id: 'grok' }] }),
    'releases/latest': () => json(200, { tag_name: 'v99.0.0', published_at: '2026-11-01', html_url: 'https://github.com/x', body: 'notes' }),
    'commits/main': () => json(200, { sha: 'abcdef1234', commit: { committer: { date: '2026-11-01' }, message: 'fix' } }),
    'openrouter.ai/api/v1/models': () => json(200, { data: [{ id: 'a/b', name: 'AB', context_length: 1000, pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['tools'] }] }),
  };
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'an', AWS_BEARER_TOKEN_BEDROCK: 'bk', XAI_API_KEY: 'x' });
  assert.equal((await call('GET', '/api/settings/models', {}, 'provider=anthropic')).models[0].id, 'claude-x');
  assert.ok((await call('GET', '/api/settings/models', {}, 'provider=bedrock')).models.length >= 1);
  assert.equal((await call('GET', '/api/settings/models', {}, 'provider=xai')).models[0].id, 'grok');
  assert.ok(Array.isArray((await call('GET', '/api/settings/models', {}, 'provider=openrouter')).models));
  routes['api.x.ai/v1/models'] = () => json(500, { error: 'down' });
  await assert.rejects(call('GET', '/api/settings/models', {}, 'provider=xai'), (e) => e.code === 'models');
  const up = await call('GET', '/api/settings/update', {}, 'force=1');
  assert.equal(up.updateAvailable, true); assert.equal(up.latest.version, '99.0.0');
  process.env.UPDATE_CHANNEL = 'main';
  assert.equal((await call('GET', '/api/settings/update', {}, 'force=1')).latest.sha, 'abcdef1');
  delete process.env.UPDATE_CHANNEL;
  assert.ok(await call('GET', '/api/settings/usage'));
  assert.ok(Array.isArray((await call('GET', '/api/settings/logs', {}, 'n=5')).lines));
  const s = await call('GET', '/api/settings/status'); assert.equal(s.db, 'memory'); assert.ok(s.slack);
  assert.ok((await call('GET', '/api/settings/diagnostics')).settings);
  assert.ok(await call('POST', '/api/settings/remote-browser', { action: 'status' }));
  await assert.rejects(call('GET', '/api/settings/nothing'), (e) => e.status === 404);
});

test('agents, routines and memory', async () => {
  const { call, st } = await setup();
  st.m.set('as_data:' + owner.email, JSON.stringify({ agents: [{ id: 1, name: 'Sales', kind: 'custom' }, null] }));
  assert.equal((await call('GET', '/api/settings/agents')).agents.length, 1);
  const r = await call('POST', '/api/settings/agents', { id: 1, model: 'openai/gpt-4o', tier: 'strong', tools: ['sandbox', 'evil'] });
  assert.deepEqual(r.agent, { id: 1, model: 'openai/gpt-4o', tier: 'strong', tools: ['sandbox'] });
  await assert.rejects(call('POST', '/api/settings/agents', { id: 1, model: 'has space' }), (e) => e.code === 'invalid');
  await assert.rejects(call('POST', '/api/settings/agents', { id: 1, tier: 'mega' }), (e) => e.code === 'invalid');
  await assert.rejects(call('POST', '/api/settings/agents', { id: 99 }), (e) => e.status === 404);
  st.m.set('as_rt:' + owner.email, JSON.stringify([{ id: 'r1', on: true, title: 'Morning brief', aid: 1, next: 5 }, { id: 'r2', on: false }]));
  assert.equal((await call('GET', '/api/settings/routines')).routines.length, 1);
  const p = await call('POST', '/api/settings/routines', { all: true, paused: true });
  assert.equal(p.changed.length, 1);
  await call('POST', '/api/settings/routines', { id: 'missing', paused: false });
  st.m.set('as_mem:' + owner.email, JSON.stringify({ 1: [{ id: 'm1', text: 'likes tea' }, { id: 'm2', text: 'x' }] }));
  assert.ok(await call('GET', '/api/settings/memory'));
  assert.equal((await call('POST', '/api/settings/memory/delete', { aid: 1, id: 'm1' })).left, 1);
  assert.equal((await call('POST', '/api/settings/memory/delete', { aid: 1, all: true })).left, 0);
});

test('backup, restore preview, staff passwords and sign out everyone', async () => {
  const { call, st, users } = await setup();
  st.m.set('as_data:a', '{}'); st.m.set('as_sess:x', 'secret-session');
  const b = await call('GET', '/api/settings/backup');
  const file = JSON.parse(b.__bytes.toString());
  assert.ok(file.items.some((i) => i.k === 'as_data:a')); assert.ok(!file.items.some((i) => i.k === 'as_sess:x'), 'sessions are not exported');
  const prev = await call('POST', '/api/settings/restore', { items: [{ k: 'as_data:a', v: '{}' }, { k: 'as_data:b', v: '{"x":1}' }] });
  assert.deepEqual(prev, { dryRun: true, diff: { add: 1, change: 0, same: 1, total: 2 } });
  await assert.rejects(call('POST', '/api/settings/restore', { items: [{ k: 'other', v: '' }] }), (e) => e.code === 'invalid');
  assert.equal((await call('POST', '/api/settings/password', { account: 'team', next: 'Long-enough-pass1' })).account, 'team@example.com');
  assert.equal(users['team@example.com'].hash, 'h:Long-enough-pass1');
  assert.equal((await call('POST', '/api/settings/password', { next: 'Long-enough-pass2' })).account, 'admin@example.com');
  await assert.rejects(call('POST', '/api/settings/password', { next: 'short' }), (e) => e.code === 'weak_password');
  assert.equal((await call('POST', '/api/settings/signout-all', { exceptMe: true })).accounts, 2);
});
