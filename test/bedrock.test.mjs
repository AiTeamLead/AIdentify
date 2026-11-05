// Amazon Bedrock with a Bedrock API key: Converse API (text and tools), customer keys with a region, model lists.
// A fake Bedrock (control plane + runtime) stands in for AWS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.mjs';

const PW = 'Clinic-pass-123!';
const KEY = 'ABSKQmVkcm9ja0FQSUtleS10ZXN0LWtleS0xMjM0NTY3ODkw';

function fakeBedrock() {
  const log = { converse: [], lists: 0 };
  const srv = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const json = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.headers.authorization !== 'Bearer ' + KEY) return json(403, { message: 'The security token included in the request is invalid.' });
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/foundation-models') { log.lists++; return json(200, { modelSummaries: [
      { modelId: 'amazon.nova-pro-v1:0', modelName: 'Nova Pro', inferenceTypesSupported: ['ON_DEMAND'], outputModalities: ['TEXT'] },
      { modelId: 'amazon.titan-embed-text-v2:0', inferenceTypesSupported: ['ON_DEMAND'], outputModalities: ['EMBEDDING'] },
      { modelId: 'anthropic.claude-sonnet-4-20250514-v1:0', inferenceTypesSupported: ['INFERENCE_PROFILE'], outputModalities: ['TEXT'] },
    ] }); }
    if (u.pathname === '/inference-profiles') return json(200, { inferenceProfileSummaries: [{ inferenceProfileId: 'apac.anthropic.claude-sonnet-4-20250514-v1:0' }] });
    const m = u.pathname.match(/^\/model\/([^/]+)\/converse$/);
    if (m && req.method === 'POST') {
      const b = JSON.parse(body); log.converse.push({ model: decodeURIComponent(m[1]), b });
      // Converse rules: roles alternate, start with user, no empty text
      for (let i = 0; i < b.messages.length; i++) {
        if (b.messages[i].role !== (i % 2 ? 'assistant' : 'user')) return json(400, { message: 'roles must alternate' });
        if (b.messages[i].content.some((c) => 'text' in c && !c.text.trim())) return json(400, { message: 'empty text' });
      }
      const hasResult = b.messages.some((x) => x.content.some((c) => c.toolResult));
      if (b.toolConfig && !hasResult) {
        const t = b.toolConfig.tools[0].toolSpec;
        return json(200, { output: { message: { role: 'assistant', content: [{ text: 'Let me look.' }, { toolUse: { toolUseId: 'tu1', name: t.name, input: { q: 'hello' } } }] } }, stopReason: 'tool_use', usage: { inputTokens: 10, outputTokens: 5 } });
      }
      const res0 = b.messages.flatMap((x) => x.content).find((c) => c.toolResult);
      return json(200, { output: { message: { role: 'assistant', content: [{ text: 'Bedrock says hi' + (res0 ? ' after ' + res0.toolResult.content[0].text : '') }] } }, stopReason: 'end_turn', usage: { inputTokens: 12, outputTokens: 4 } });
    }
    json(404, { message: 'no route ' + u.pathname });
  });
  return { srv, log };
}

test('Converse: text, tools (toolUse → toolResult), system prompt, and the key’s region', async () => {
  const { srv, log } = fakeBedrock(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  Object.assign(process.env, { AWS_BEARER_TOKEN_BEDROCK: KEY, BEDROCK_BASE_URL: base, AI_PROVIDER: 'bedrock', BEDROCK_MODEL: 'amazon.nova-pro-v1:0' });
  try {
    const L = await import('../lib/llm.js?bedrock1');
    assert.ok(L.providerOrder().includes('bedrock'));
    const r = await L.complete('Say hi', { max: 50 });
    assert.equal(r.provider, 'bedrock'); assert.equal(r.text, 'Bedrock says hi');
    const out = await L.runWithTools({ system: 'You are Chief.', history: [{ role: 'user', text: 'find it' }],
      tools: [{ name: 'lookup', description: 'Look up', schema: { type: 'object', properties: { q: { type: 'string' } } } }],
      exec: async (name, input) => `found ${input.q} via ${name}` });
    assert.equal(out.text, 'Bedrock says hi after found hello via lookup');
    const last = log.converse.at(-1).b;
    assert.deepEqual(last.system, [{ text: 'You are Chief.' }]);
    assert.equal(last.toolConfig.tools[0].toolSpec.name, 'lookup');
    assert.deepEqual(last.messages.map((x) => x.role), ['user', 'assistant', 'user']);
    assert.ok(last.messages[1].content.some((c) => c.toolUse && c.toolUse.toolUseId === 'tu1'));
    assert.equal(last.messages[2].content[0].toolResult.toolUseId, 'tu1');
    assert.equal(log.converse.at(-1).model, 'amazon.nova-pro-v1:0');
    // without tools (wrap-up), earlier tool steps travel as text: Converse refuses toolUse blocks without toolConfig
    const flat = L.toConverse([{ role: 'user', content: 'q' }, { role: 'assistant', content: '', tool_calls: [{ id: 'a', function: { name: 'x', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'a', content: 'r' }, { role: 'user', content: 'wrap up' }], false);
    assert.ok(flat.every((m) => m.content.every((c) => 'text' in c)));
    assert.deepEqual(flat.map((m) => m.role), ['user', 'assistant', 'user']);
    // short-term keys carry their region
    const presigned = 'bedrock.amazonaws.com/?Action=CallWithBearerToken&X-Amz-Credential=ASIA%2F20261103%2Fap-south-1%2Fbedrock%2Faws4_request&Version=1';
    assert.equal(L.bedrockKeyRegion('bedrock-api-key-' + Buffer.from(presigned).toString('base64')), 'ap-south-1');
    assert.equal(L.bedrockKeyRegion(KEY), '');
  } finally {
    for (const k of ['AWS_BEARER_TOKEN_BEDROCK', 'BEDROCK_BASE_URL', 'AI_PROVIDER', 'BEDROCK_MODEL']) delete process.env[k];
    srv.close();
  }
});

test('a customer’s own Bedrock key: checked, region saved, models listed, chats answer through it', async () => {
  const { srv, log } = fakeBedrock(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const s = await startServer({ RATE_LIMIT: 'off', BEDROCK_BASE_URL: base, BEDROCK_CONTROL_URL: base });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'bed@example.com', name: 'Bed', password: PW })).d.token;
    const provs = (await s.api('/api/ai/key', undefined, tok)).d.providers;
    const bp = provs.find((p) => p.id === 'bedrock');
    assert.ok(bp && bp.regions.includes('ap-south-1'));
    // live model list: on-demand text models plus inference profiles, no embeddings
    const ml = (await s.api('/api/ai/models', { provider: 'bedrock', key: KEY, region: 'ap-south-1' }, tok)).d;
    assert.equal(ml.live, true); assert.equal(ml.region, 'ap-south-1');
    assert.ok(ml.models.includes('apac.anthropic.claude-sonnet-4-20250514-v1:0') && ml.models.includes('amazon.nova-pro-v1:0'));
    assert.ok(!ml.models.some((m) => /embed/.test(m)));
    // a wrong key is refused, a bad region is refused
    assert.equal((await s.api('/api/ai/key', { provider: 'bedrock', key: 'ABSK' + 'x'.repeat(40), region: 'ap-south-1' }, tok)).status, 400);
    assert.equal((await s.api('/api/ai/key', { provider: 'bedrock', key: KEY, region: 'mars-1' }, tok)).status, 400);
    const saved = await s.api('/api/ai/key', { provider: 'bedrock', key: KEY, region: 'ap-south-1', model: 'apac.anthropic.claude-sonnet-4-20250514-v1:0' }, tok);
    assert.equal(saved.status, 200, JSON.stringify(saved.d)); assert.equal(saved.d.byok.name, 'Amazon Bedrock');
    const got = (await s.api('/api/ai/key', undefined, tok)).d;
    assert.equal(got.byok.provider, 'bedrock'); assert.equal(got.byok.region, 'ap-south-1'); assert.equal(got.byok.hint, '…' + KEY.slice(-4));
    // the agents now answer through Bedrock with the chosen model
    const n0 = log.converse.length;
    const chat = await s.api('/api/workplace/chat', { message: 'What can you do?' }, tok);
    assert.equal(chat.status, 200, JSON.stringify(chat.d));
    assert.ok(log.converse.length > n0, 'Bedrock was called');
    assert.equal(log.converse.at(-1).model, 'apac.anthropic.claude-sonnet-4-20250514-v1:0');
    assert.match(chat.d.answer, /Bedrock says hi/);
  } finally { await s.stop(); srv.close(); }
});
