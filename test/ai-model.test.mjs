// The owner can pick the AI provider, model and key; the chosen model is stored with the key and reported back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, startServer } from './helpers.mjs';

const PW = 'Clinic-pass-123!';

test('profile page offers provider, model and API key', () => {
  const src = fs.readFileSync(path.join(ROOT, 'clinic.html'), 'utf8');
  assert.match(src, /Connect your AI/);
  assert.match(src, /data-ob="skip"/);
  assert.match(src, /\$\{aiKeyFields\('profile'\)\}/);
  assert.match(src, /<select name="model" data-ai-model>/);
  assert.doesNotMatch(src, /Load all models/);
  assert.match(src, /Other… \(type a model id\)/);
  assert.match(src, /data-ai-provider>/);
});

test('a chosen model is saved with the key and can be changed without re-pasting', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'model@example.com', name: 'M', password: PW })).d.token;
    const g0 = await s.api('/api/ai/key', undefined, tok);
    assert.ok(g0.d.providers.find((p) => p.id === 'anthropic').models.length > 0);
    const bad = await s.api('/api/ai/key', { provider: 'openai', key: 'sk-mock-' + 'a'.repeat(30), model: 'gpt 4o; drop' }, tok);
    assert.equal(bad.status, 400); assert.equal(bad.d.error, 'bad_model');
    const ok = await s.api('/api/ai/key', { provider: 'openai', key: 'sk-mock-' + 'a'.repeat(30), model: 'gpt-4.1' }, tok);
    assert.equal(ok.status, 200, JSON.stringify(ok.d)); assert.equal(ok.d.byok.model, 'gpt-4.1');
    assert.equal((await s.api('/api/ai/key', undefined, tok)).d.byok.model, 'gpt-4.1');
    const ch = await s.api('/api/ai/key', { provider: 'openai', key: '', model: 'gpt-4o' }, tok);
    assert.equal(ch.status, 200, JSON.stringify(ch.d)); assert.equal(ch.d.byok.model, 'gpt-4o');
    const live = await s.api('/api/ai/models', { provider: 'anthropic' }, tok);
    assert.equal(live.status, 400); assert.equal(live.d.error, 'needs_key');
    const lm = await s.api('/api/ai/models', { provider: 'openai' }, tok);
    assert.equal(lm.status, 200, JSON.stringify(lm.d)); assert.ok(lm.d.models.includes('gpt-5'));
    const other = await s.api('/api/ai/key', { provider: 'anthropic', key: '', model: 'claude-opus-4-1' }, tok);
    assert.equal(other.status, 400);
  } finally { await s.stop(); }
});
