// Composio client: app catalogue (paging, search, categories, sorting), one app's page, tool search and read/write
// classification, reading and acting in a connected app, the proxy, picture uploads, triggers and errors.
// Composio is faked (fetch replaced).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../lib/composio.js';

process.env.COMPOSIO_API_KEY = 'ck_test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const calls = [];
const kit = (slug, i, extra = {}) => ({ slug, name: slug === 'gmail' ? 'Gmail' : 'App ' + i, meta: { description: 'Does ' + slug, categories: [i % 2 ? 'CRM' : { name: 'Productivity' }], tools_count: i, triggers_count: 1, logo: 'https://l/' + slug }, composio_managed_auth_schemes: i % 3 ? ['OAUTH2'] : [], auth_schemes: i % 3 ? [] : [{ mode: 'API_KEY' }], ...extra });
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url), m = opt.method || 'GET', body = opt.body && typeof opt.body === 'string' ? JSON.parse(opt.body) : null;
  calls.push(m + ' ' + u.replace(/^https?:\/\/[^/]+/, ''));
  if (u.startsWith('https://s3.example/')) return new Response('', { status: u.includes('fail') ? 500 : 200 });
  if (u.includes('/toolkits?') && u.includes('limit=500')) return json(u.includes('cursor=p2') ? { items: [kit('serpapi', 7), kit('github', 8)] } : { items: [kit('gmail', 1), kit('slack', 2), kit('notion', 3, { no_auth: true }), kit('Bad Slug', 4), kit('hubspot', 5), kit('tavily', 6)], next_cursor: 'p2' });
  if (u.includes('/toolkits?')) return json({ items: [kit('gmail', 1), kit('slack', 2), { slug: 'x y' }] });
  if (/\/toolkits\/gmail$/.test(u)) return json(kit('gmail', 1));
  if (/\/toolkits\//.test(u)) return json({ error: { message: 'not found' } }, 404);
  if (u.includes('/tools?') && u.includes('search=')) return json({ items: [{ slug: 'GMAIL_SEND_EMAIL', name: 'Send email', description: 'Sends', input_parameters: { properties: { to: { type: 'string', description: 'Recipient' }, cc: { anyOf: [] } }, required: ['to'] } }] });
  if (u.includes('/tools?')) return json({ items: [{ slug: 'GMAIL_FETCH_EMAILS' }, { slug: 'GMAIL_LIST_LABELS' }, { slug: 'GMAIL_SEND_EMAIL' }, { slug: 'GMAIL_CREATE_EMAIL_DRAFT' }, { slug: 'GMAIL_DELETE_MESSAGE' }, { slug: 'GMAIL_SEARCH_PEOPLE' }] });
  if (u.includes('/triggers_types')) return json({ items: [{ slug: 'GMAIL_NEW_GMAIL_MESSAGE', name: 'New email', description: 'When mail arrives', config: { properties: { labelIds: { type: 'string', description: 'Labels' } }, required: ['labelIds'] } }] });
  if (/\/tools\/execute\/proxy$/.test(u)) return json({ status: 201, data: { id: 'urn:li:share:1' }, headers: { 'X-RestLi-Id': ['urn:li:share:1'] } });
  if (u.includes('/tools/execute/')) return json(body && body.text && /fail/.test(body.text) ? { successful: false, error: 'Rate limited' } : body && body.arguments && body.arguments.bad ? { successful: false } : { successful: true, data: { messages: [{ subject: 'Hi' }] } });
  if (/\/tools\/[A-Z_]+$/.test(u)) return json(u.endsWith('NOPE_TOOL') ? { error: { message: 'Tool not found' } } : { slug: 'GMAIL_SEND_EMAIL', toolkit: { slug: 'gmail' }, input_parameters: {} }, u.endsWith('NOPE_TOOL') ? 404 : 200);
  if (u.includes('/files/upload/request')) return json(body.filename.includes('nourl') ? {} : { new_presigned_url: 'https://s3.example/' + body.filename, key: 'k/' + body.filename });
  if (u.includes('/trigger_instances/') && u.includes('/upsert')) return json(body.trigger_config.empty ? {} : { trigger_id: 'ti_1' });
  if (u.includes('/trigger_instances/manage/')) return m === 'DELETE' ? json({ error: 'gone' }, 404) : json({ ok: true });
  return json({ message: 'nope' }, 500);
};

test('catalogue: all pages, invalid slugs dropped, search, categories, sorting, instant apps', async () => {
  const all = await C.composioCatalog();
  assert.deepEqual(all.map((a) => a.slug), ['gmail', 'slack', 'notion', 'hubspot', 'tavily', 'serpapi', 'github']);
  assert.equal(all.find((a) => a.slug === 'notion').auth, 'none'); assert.equal(all.find((a) => a.slug === 'hubspot').auth, 'managed');
  assert.equal(all.find((a) => a.slug === 'serpapi').auth, 'managed');
  assert.equal(await C.composioCatalog(), all, 'cached');
  const r = await C.composioApps({ q: 'gmail' });
  assert.equal(r.items[0].slug, 'gmail'); assert.ok(r.categories.length >= 1); assert.ok(r.popular.length >= 1);
  assert.equal((await C.composioApps({ category: 'CRM', sort: 'az' })).items.every((a) => a.categories.includes('CRM')), true);
  assert.ok((await C.composioApps({ sort: 'tools', limit: 2 })).next === 2);
  const inst = await C.composioApps({ instant: true });
  assert.ok(inst.items.every((a) => a.instant)); assert.ok(inst.instantCount >= 2);
  assert.equal((await C.composioApps({ only: new Set(['slack']) })).items.length, 1);
  const tk = await C.composioToolkits({ search: 'mail', limit: 5 });
  assert.deepEqual(tk.map((t) => t.slug), ['gmail', 'slack']);
});

test('one app page, tool search and read/write classification', async () => {
  const g = await C.composioAppInfo('gmail');
  assert.equal(g.name, 'Gmail'); assert.equal(g.toolList.length, 6); assert.equal(g.triggerList[0].slug, 'GMAIL_NEW_GMAIL_MESSAGE');
  assert.equal(await C.composioAppInfo('gmail'), g, 'cached for an hour');
  assert.equal((await C.composioAppInfo('slack')).slug, 'slack', 'catalogue entry when the app page is missing');
  await assert.rejects(C.composioAppInfo('BAD!'), (e) => e.status === 400);
  await assert.rejects(C.composioAppInfo('zzz_none'), (e) => e.status === 404);
  const found = await C.composioSearchTools({ query: 'send an email', toolkits: ['gmail'], limit: 5 });
  assert.equal(found[0].slug, 'GMAIL_SEND_EMAIL'); assert.equal(found[0].read, false);
  assert.equal(C.isReadTool('GMAIL_FETCH_EMAILS'), true); assert.equal(C.isReadTool('GMAIL_SEND_EMAIL'), false);
  assert.equal(C.isReadTool('INSTAGRAM_CREATE_MEDIA_CONTAINER'), true, 'preparing media publishes nothing');
  assert.equal((await C.composioToolInfo('gmail_send_email')).toolkit, 'gmail');
  await assert.rejects(C.composioToolInfo('x'), (e) => e.status === 400);
  await assert.rejects(C.composioToolInfo('NOPE_TOOL'), /Tool not found/);
  assert.equal(C.toolkitOf('cx:gmail'), 'gmail'); assert.equal(C.toolkitOf('cx:BAD SLUG'), '');
  assert.equal(C.connectorIdFor('zoho'), 'cx:zoho'); assert.equal(C.prettyToolkit('google_sheets'), 'Google Sheets');
  assert.match(C.composioUser('A@B.c'), /^as_[a-f0-9]+/); assert.equal(C.composioUser('A@B.c'), C.composioUser('a@b.c'));
});

test('read and act in a connected app; proxy, uploads, triggers, failures', async () => {
  const r = await C.composioRead({ id: 'cx:gmail', ca: 'ca_1', email: 'o@x.in', q: 'search my emails from Ravi' });
  assert.match(r.tool, /^GMAIL_/); assert.ok(r.data.messages);
  await assert.rejects(C.composioRead({ id: 'cx:gmail', ca: 'ca_1', email: 'o@x.in', q: 'please fail now' }), /Rate limited/);
  await assert.rejects(C.composioRead({ id: 'nothing', ca: 'x', email: 'e', q: 'x' }), (e) => e.status === 404);
  process.env.COMPOSIO_TOOLS_SLACK = 'SLACK_FETCH_HISTORY';
  assert.equal((await C.composioRead({ id: 'cx:slack', ca: 'c', email: 'e', q: 'x' })).tool, 'SLACK_FETCH_HISTORY');
  const a = await C.composioAct({ id: 'cx:gmail', ca: 'ca_1', email: 'o@x.in', request: 'Create an email draft to Ravi' });
  assert.equal(a.tool, 'GMAIL_CREATE_EMAIL_DRAFT');
  await assert.rejects(C.composioAct({ id: 'cx:gmail', ca: 'ca_1', email: 'o@x.in', request: 'send it, fail please' }), /Rate limited/);
  process.env.COMPOSIO_ACTIONS_NOTION = 'NOTION_CREATE_PAGE';
  assert.equal((await C.composioAct({ id: 'cx:notion', ca: 'c', email: 'e', request: 'add a page' })).tool, 'NOTION_CREATE_PAGE');
  assert.deepEqual(await C.composioExecute({ slug: 'gmail_fetch_emails', args: { q: 'x' }, ca: 'c', email: 'e' }), { messages: [{ subject: 'Hi' }] });
  await assert.rejects(C.composioExecute({ slug: 'gmail_fetch_emails', args: { bad: true }, ca: 'c', email: 'e' }), /tool failed/);
  const p = await C.composioProxy({ ca: 'c', email: 'e', method: 'POST', url: 'https://api.linkedin.com/rest/posts', body: { a: 1 }, headers: { 'LinkedIn-Version': '202501' } });
  assert.equal(p.status, 201); assert.equal(p.headers['x-restli-id'], 'urn:li:share:1');
  const up = await C.composioUpload({ buf: Buffer.from('png'), mime: 'image/png', name: 'pic.png', tool: 'linkedin_create_post', toolkit: 'LINKEDIN' });
  assert.deepEqual(up, { name: 'pic.png', mimetype: 'image/png', s3key: 'k/pic.png' });
  await assert.rejects(C.composioUpload({ buf: Buffer.from('x'), name: 'nourl.png' }), /upload address/);
  await assert.rejects(C.composioUpload({ buf: Buffer.from('x'), name: 'fail.png' }), /failed \(500\)/);
  const types = await C.composioTriggerTypes('gmail');
  assert.equal(types[0].fields[0].required, true);
  assert.equal(await C.composioTriggerUpsert({ slug: 'GMAIL_NEW_GMAIL_MESSAGE', ca: 'c', email: 'e', config: { labelIds: 'INBOX' }, egressUrl: 'https://app/hook' }), 'ti_1');
  await assert.rejects(C.composioTriggerUpsert({ slug: 'X', ca: 'c', email: 'e', config: { empty: true } }), /trigger id/);
  await C.composioTriggerStatus('ti_1', false);
  await C.composioTriggerDelete('ti_1');
  assert.ok(calls.some((c) => c.startsWith('PATCH ')));
});
