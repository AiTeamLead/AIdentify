// Image generation (OpenRouter → OpenAI → Bedrock, then the designed-card fallback), image download checks,
// web search (Tavily and DuckDuckGo HTML), and the Composio app directory read from its public pages.
// All outside services are faked (fetch replaced); files go to a temp folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-cov-'));
process.env.DATA_DIR = TMP;
process.env.COMPOSIO_SITE = 'https://composio.test';
process.env.COMPOSIO_CATALOG_COUNTS = 'off';
for (const k of ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'AWS_BEARER_TOKEN_BEDROCK', 'TAVILY_API_KEY', 'IMAGE_PROVIDER', 'IMAGE_MODEL', 'IMAGE_MODELS', 'AI_PROVIDER', 'AI_MOCK']) delete process.env[k];
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let route = (_url, _opt) => json({}, 404);
globalThis.fetch = async (url, opt) => route(String(url), opt || {});

const media = await import('../lib/media.js');
const web = await import('../lib/web.js');
const cat = await import('../lib/composio-catalog.js');

test('image generation: provider order, fallbacks between models and providers, designed card when all fail', async () => {
  await assert.rejects(media.generateImage('hi'), /Describe the image/);
  await assert.rejects(media.generateImage('A dental clinic at sunrise'), /needs an OpenRouter, OpenAI or Amazon Bedrock key/);
  Object.assign(process.env, { OPENROUTER_API_KEY: 'or', OPENAI_API_KEY: 'oa', AWS_BEARER_TOKEN_BEDROCK: 'bk', BEDROCK_REGION: 'ap-south-1' });
  const calls = [];
  route = (u, o) => {
    calls.push(u);
    if (u.includes('/chat/completions')) { const m = JSON.parse(o.body).model; return m.includes('flash-image') && !m.includes('preview') ? json({ error: { message: 'busy' } }, 429) : json({ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,' + PNG } }] } }] }); }
    return json({}, 500);
  };
  const a = await media.generateImage('A dental clinic at sunrise, warm light');
  assert.equal(a.provider, 'openrouter'); assert.ok(fs.existsSync(a.file)); assert.match(a.path, /^\/api\/media\/[a-f0-9]{32}\.png$/);
  assert.ok(calls.length >= 2, 'the busy model is skipped for the next one');
  // OpenRouter key rejected → OpenAI (base64), then a URL answer
  route = (u) => {
    if (u.includes('/chat/completions')) return json({ error: { message: 'invalid key' } }, 401);
    if (u.includes('/images/generations')) return json({ data: [{ b64_json: PNG }] });
    return json({}, 404);
  };
  assert.equal((await media.generateImage('Offer banner', { size: 'portrait' })).provider, 'openai');
  route = (u) => {
    if (u.includes('/chat/completions')) return json({ error: { message: 'invalid key' } }, 401);
    if (u.includes('/images/generations')) return json({ error: { message: 'billing' } }, 400);
    if (u.includes('bedrock-runtime')) return json({ images: [PNG] });
    return json({}, 404);
  };
  const b = await media.generateImage('Offer banner', { size: 'landscape' });
  assert.equal(b.provider, 'bedrock'); assert.match(b.model, /nova-canvas/);
  process.env.IMAGE_MODEL = 'stability.sd3-large-v1:0';
  assert.equal((await media.generateImage('Logo idea')).model, 'stability.sd3-large-v1:0');
  delete process.env.IMAGE_MODEL;
  // everything fails → a designed card is still made, with the reason kept
  route = () => json({ message: 'down' }, 503);
  const c = await media.generateImage('"Diwali offer 20% off" for Bright Dental', { brand: { name: 'Bright Dental', color: '#0ea5e9' } });
  assert.equal(c.provider, 'local'); assert.equal(c.model, 'designed-card');
  process.env.IMAGE_FALLBACK = 'off';
  await assert.rejects(media.generateImage('Something'), /Couldn’t make the image/);
  delete process.env.IMAGE_FALLBACK;
  process.env.IMAGE_PROVIDER = 'openai';
  route = (u) => (u.includes('/images/generations') ? json({ data: [{ url: 'https://img.example/x.png' }] }) : u.startsWith('https://img.example') ? new Response(Buffer.from(PNG, 'base64'), { headers: { 'content-type': 'image/png' } }) : json({}, 500));
  assert.equal((await media.generateImage('From a link')).provider, 'openai');
  delete process.env.IMAGE_PROVIDER;
  // the saved file can be read back by name and by reference
  assert.ok(media.readMedia(path.basename(a.file)).buf.length > 10);
  assert.equal(media.readMedia('../etc/passwd'), null);
  assert.ok(media.mediaFile(a.path)); assert.ok(media.mediaFile(path.basename(a.file, '.png')));
  assert.equal(media.mediaFile('nothing'), null);
});

test('downloading an image: only public http(s) image links', async () => {
  await assert.rejects(media.fetchImage('not a url'), /not a link/);
  await assert.rejects(media.fetchImage('ftp://x.com/a.png'), /Only http/); // NOSONAR - test: a plain ftp link must be refused
  await assert.rejects(media.fetchImage('http://127.0.0.1/a.png'), /private/);
  route = (u) => (u.includes('page') ? new Response('<html>', { headers: { 'content-type': 'text/html' } }) : u.includes('gone') ? new Response('', { status: 404 }) : new Response(Buffer.from(PNG, 'base64'), { headers: { 'content-type': 'image/png; charset=binary' } }));
  assert.equal((await media.fetchImage('https://cdn.example/a.png')).mime, 'image/png');
  await assert.rejects(media.fetchImage('https://cdn.example/page'), /not an image file \(text\/html\)/);
  await assert.rejects(media.fetchImage('https://cdn.example/gone'), /answered 404/);
  assert.equal(media.isPublicBase('https://app.example.com'), true);
  assert.equal(media.isPublicBase('http://localhost:3000'), false);
});

test('web search: Tavily when a key is set, DuckDuckGo HTML otherwise', async () => {
  assert.deepEqual(await web.webSearch('   '), []);
  process.env.TAVILY_API_KEY = 'tv';
  route = () => json({ results: [{ title: 'Best dentists', url: 'https://a.example', content: 'List of clinics' }] });
  assert.deepEqual(await web.webSearch('dentists hyderabad'), [{ title: 'Best dentists', url: 'https://a.example', text: 'List of clinics' }]);
  delete process.env.TAVILY_API_KEY;
  const ddg = '<div><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fclinic.example%2Fabout&amp;rut=1">Smile <b>Clinic</b></a><a class="result__snippet" href="x">Open <b>7 days</b> &amp; Sundays</a></div>'
    + '<a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a>'
    + '<a class="result__a" href="https://second.example/">Second</a><div class="result__snippet">Two</div>'
    + '<a class="result__a" href="/relative">Bad</a>';
  route = () => new Response(ddg, { headers: { 'content-type': 'text/html' } });
  const r = await web.webSearch('smile clinic', 5);
  assert.equal(r.length, 2); assert.equal(r[0].url, 'https://clinic.example/about'); assert.equal(r[0].title, 'Smile Clinic'); assert.match(r[0].text, /Open 7 days & Sundays/);
  assert.equal((await web.webSearch('smile clinic', 1)).length, 1);
  route = () => new Response('', { status: 503 });
  await assert.rejects(web.webSearch('x'), /answered 503/);
});

function directoryHtml(n) {
  const apps = Array.from({ length: n }, (_, i) => ({ slug: 'app' + i, name: 'App ' + i, short_description: 'Does thing ' + i + '. More text.', categories: [i % 2 ? 'CRM' : { name: 'Marketing & Social Media' }], logo_url: 'https://logo/' + i, rank: i }));
  apps.push({ slug: 'github', description: 'Code hosting.', categories: ['Developer Tools & DevOps'], rank: 0.5 });
  apps.push({ slug: 'dead', description: 'x', categories: [], is_live: false });
  return '<script>self.__next_f.push([1,' + JSON.stringify(JSON.stringify({ apps })) + '])</script>';
}
const appMd = `# GitHub
## Description
Code hosting and issues.
## Authentication
- **OAuth2** (composio-managed)
## Suggested Prompts
- "Star a repo"
- List my open PRs
## Supported Tools
| Slug | Name | Description |
|---|---|---|
| \`GITHUB_CREATE_ISSUE\` | Create issue | Opens an issue |
## Supported Triggers
| Slug | Name | Description |
|---|---|---|
| GITHUB_STAR_ADDED | Star added | When starred |
- Tools: 1
`;

test('Composio app directory: parsed from the public page, cached on disk, details per app, offline fallback', async () => {
  cat._forTests.reset();
  route = (u) => (u.endsWith('/toolkits') ? new Response(directoryHtml(25)) : u.endsWith('/github.md') ? new Response(appMd) : new Response('', { status: 404 }));
  const apps = await cat.publicCatalog();
  assert.equal(apps.length, 26); assert.equal(apps[0].slug, 'app0'); assert.equal(apps[1].name, 'GitHub');
  assert.ok(apps.find((a) => a.slug === 'app1').categories.includes('Sales & CRM'));
  assert.ok(fs.existsSync(path.join(TMP, 'composio-apps.json')), 'kept on disk');
  assert.equal((await cat.publicCatalog()).length, 26, 'served from memory');
  cat._forTests.reset();
  assert.equal((await cat.publicCatalog()).length, 26, 'served from disk after a restart');
  const gh = await cat.publicAppInfo('github');
  assert.equal(gh.name, 'GitHub'); assert.equal(gh.tools, 1); assert.equal(gh.triggers, 1); assert.equal(gh.auth, 'managed');
  assert.deepEqual(gh.prompts, ['Star a repo', 'List my open PRs']);
  assert.equal((await cat.publicAppInfo('github')).toolList[0].slug, 'GITHUB_CREATE_ISSUE', 'cached details');
  await assert.rejects(cat.publicAppInfo('Bad Slug!'), (e) => e.status === 400);
  await assert.rejects(cat.publicAppInfo('nosuchapp'), (e) => e.status === 502);
  // offline and nothing on disk: the best-known apps
  fs.rmSync(path.join(TMP, 'composio-apps.json'));
  cat._forTests.reset();
  route = () => new Response('', { status: 404 });
  const off = await cat.publicCatalog();
  assert.ok(off.length > 30 && off.some((a) => a.slug === 'gmail'));
  assert.equal(cat.parseAppPage('x', '# X\nNo auth needed').auth, 'none');
});
