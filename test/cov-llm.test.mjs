// Model calls through each provider with tools: Anthropic, OpenRouter (OpenAI-style) and Amazon Bedrock (Converse),
// tool loops that end, fall back to the next provider on errors, hit the step limit and wrap up, and strip tool
// text a model wrote as plain text. Providers are faked (fetch replaced).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithTools, complete, attemptPlan, stripToolText, toConverse, bedrockKeyRegion, resolveModel, providerOrder } from '../lib/llm.js';

for (const k of ['AI_PROVIDER', 'AI_MOCK', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GOOGLE_AI_API_KEY', 'OLLAMA_BASE_URL', 'AI_FALLBACKS']) delete process.env[k];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const seen = [];
let mode = {};
globalThis.fetch = async (url, opt) => {
  const u = String(url), body = JSON.parse(opt.body);
  seen.push(u);
  const toolRound = (body.messages || []).some((m) => m.role === 'tool' || (Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_result' || c.toolResult)));
  if (u.includes('api.anthropic.com')) {
    if (mode.anthropic === 'down') return new Response('overloaded', { status: 529 });
    return json(toolRound || !body.tools ? { content: [{ type: 'text', text: 'Anthropic answer' }], usage: { input_tokens: 10, output_tokens: 5 } } : { content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'tu1', name: 'lookup', input: { q: 'x' } }] });
  }
  if (u.includes('openrouter')) {
    if (mode.openrouter === 'empty') return json({ choices: [] });
    if (mode.openrouter === 'loop') return json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c' + seen.length, type: 'function', function: { name: 'lookup', arguments: '{bad json' } }] } }] });
    return json(toolRound || !body.tools ? { choices: [{ message: { role: 'assistant', content: 'OpenRouter answer <tool_call>{"x":1}</tool_call>' } }], usage: { prompt_tokens: 3, completion_tokens: 4, cost: 0.001 } } : { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"q":"y"}' } }] } }] });
  }
  if (u.includes('bedrock')) {
    if (mode.bedrock === 'bad') return new Response(JSON.stringify({ message: 'The model is not available in this region' }), { status: 400 });
    return json(toolRound || !body.toolConfig ? { output: { message: { content: [{ text: 'Bedrock answer' }] } }, usage: { inputTokens: 5, outputTokens: 2 } } : { output: { message: { content: [{ toolUse: { toolUseId: 'b1', name: 'lookup', input: { q: 'z' } } }] } } });
  }
  return json({}, 404);
};
const tools = [{ name: 'lookup', description: 'Look something up', schema: { type: 'object', properties: { q: { type: 'string' } } } }];
const exec = async (name, input) => 'found ' + JSON.stringify(input);

test('no provider → no_key; plans, model resolution and helpers', async () => {
  assert.deepEqual(attemptPlan(''), []);
  await assert.rejects(runWithTools({ system: 's', history: [{ role: 'user', text: 'hi' }], tools, exec }), (e) => e.status === 503);
  assert.equal(stripToolText('Hi <tool_call>{"a":1}</tool_call> there'), 'Hi  there');
  assert.equal(stripToolText('A <｜DSML｜tool_calls>junk'), 'A');
  assert.equal(bedrockKeyRegion('not-a-key'), '');
  const shortKey = 'bedrock-api-key-' + Buffer.from('bedrock.amazonaws.com/?X-Amz-Credential=AKIA%2F20261125%2Fap-south-1%2Fbedrock%2Faws4_request').toString('base64');
  assert.equal(bedrockKeyRegion(shortKey), 'ap-south-1');
  const conv = toConverse([{ role: 'assistant', content: 'skip me' }, { role: 'user', content: 'Q' }, { role: 'assistant', content: '', tool_calls: [{ id: 't', function: { name: 'lookup', arguments: '{"q":1}' } }] }, { role: 'tool', tool_call_id: 't', content: 'R' }], true);
  assert.equal(conv[0].role, 'user'); assert.ok(conv[1].content[0].toolUse); assert.ok(conv[2].content[0].toolResult);
  assert.match(toConverse([{ role: 'tool', content: 'R' }], false)[0].content[0].text, /Result of an earlier step/);
  assert.deepEqual(toConverse([], false), [{ role: 'user', content: [{ text: 'Hello' }] }]);
  assert.equal(typeof resolveModel({ tier: 'strong' }), 'string');
});

test('each provider runs the tool loop to an answer', async () => {
  process.env.ANTHROPIC_API_KEY = 'an';
  const a = await runWithTools({ system: 'sys', history: [{ role: 'assistant', text: 'old' }, { role: 'user', text: 'Find x' }], tools, exec });
  assert.equal(a.text, 'Anthropic answer'); assert.equal(a.provider, 'anthropic');
  delete process.env.ANTHROPIC_API_KEY; process.env.OPENROUTER_API_KEY = 'or';
  const o = await runWithTools({ system: 'sys', history: [{ role: 'user', text: 'Find y' }], tools, exec, model: 'openai/gpt-4o-mini' });
  assert.equal(o.text, 'OpenRouter answer'); assert.equal(o.provider, 'openrouter');
  delete process.env.OPENROUTER_API_KEY; process.env.AWS_BEARER_TOKEN_BEDROCK = 'bk'; process.env.BEDROCK_REGION = 'us-east-1';
  const b = await runWithTools({ system: 'sys', history: [{ role: 'user', text: 'Find z' }], tools, exec, model: 'anthropic.claude-3-haiku-20240307-v1:0' });
  assert.equal(b.text, 'Bedrock answer');
  assert.equal((await complete('Say OK', { max: 50 })).text, 'Bedrock answer');
  delete process.env.AWS_BEARER_TOKEN_BEDROCK;
});

test('errors fall back to the next provider; step limit wraps up; empty answers fail cleanly', async () => {
  process.env.ANTHROPIC_API_KEY = 'an'; process.env.OPENROUTER_API_KEY = 'or'; process.env.AWS_BEARER_TOKEN_BEDROCK = 'bk';
  assert.ok(providerOrder().length >= 3);
  mode = { anthropic: 'down' };
  const f = await runWithTools({ system: 's', history: [{ role: 'user', text: 'q' }], tools, exec });
  assert.notEqual(f.provider, 'anthropic');
  mode = { anthropic: 'down', openrouter: 'loop' };
  delete process.env.AWS_BEARER_TOKEN_BEDROCK;
  const w = await runWithTools({ system: 's', history: [{ role: 'user', text: 'q' }], tools, exec, maxSteps: 2 });
  assert.ok(typeof w.text === 'string');
  mode = { anthropic: 'down', openrouter: 'empty' };
  await assert.rejects(runWithTools({ system: 's', history: [{ role: 'user', text: 'q' }], tools, exec }));
  process.env.AWS_BEARER_TOKEN_BEDROCK = 'bk'; process.env.AI_FALLBACKS = 'bedrock:amazon.nova-pro-v1:0';
  mode = { anthropic: 'down', openrouter: 'empty', bedrock: 'bad' };
  await assert.rejects(complete('x'), /not available in this region|Bedrock/);
  mode = {};
  for (const k of ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'AWS_BEARER_TOKEN_BEDROCK', 'AI_FALLBACKS']) delete process.env[k];
});
