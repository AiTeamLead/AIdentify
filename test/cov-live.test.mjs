// Live readers: each connected app's read-only API call is turned into numbered sources (Gmail, Calendar, Drive,
// Outlook, GitHub, Slack, Notion, Stripe, Box, Twilio, HubSpot). The apps are faked (fetch replaced).
import test from 'node:test';
import assert from 'node:assert/strict';
import { READERS, LIVE_READERS } from '../lib/live.js';

const now = new Date().toISOString();
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const seen = [];
globalThis.fetch = async (url) => {
  const u = String(url); seen.push(u);
  if (u.includes('gmail.googleapis.com') && u.includes('/messages?')) return json(u.includes('newer_than:14d') || u.includes('is%3Aunread') ? { messages: [{ id: 'm1' }] } : { messages: [] });
  if (u.includes('gmail.googleapis.com') && u.includes('/messages/m1')) return json({ internalDate: String(Date.now()), labelIds: ['UNREAD'], snippet: 'Can we move the visit?', payload: { headers: [{ name: 'From', value: 'Ravi <ravi@x.in>' }, { name: 'Subject', value: 'Visit' }, { name: 'Date', value: 'today' }] } });
  if (u.includes('calendar/v3')) return json({ items: [{ summary: 'Dr meeting', start: { dateTime: now }, end: { dateTime: now }, location: 'Clinic', attendees: [{ email: 'a@x.in' }], htmlLink: 'https://cal/x' }, { summary: 'Holiday', start: { date: '2026-12-25' } }] });
  if (u.includes('drive/v3')) return json({ files: [{ name: 'Price list', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: now, webViewLink: 'https://drive/x', owners: [{ displayName: 'Phani' }] }] });
  if (u.includes('graph.microsoft.com') && u.includes('calendarView')) return json({ value: [{ subject: 'Standup', start: { dateTime: '2026-11-26T04:00:00' }, end: { dateTime: '2026-11-26T04:15:00' }, location: { displayName: 'Teams' }, organizer: { emailAddress: { name: 'Boss' } }, webLink: 'https://o/x' }] });
  if (u.includes('graph.microsoft.com')) return json({ value: [{ subject: 'Invoice', from: { emailAddress: { name: 'Acme', address: 'a@acme.in' } }, receivedDateTime: now, bodyPreview: 'Please pay', webLink: 'https://o/m', isRead: false }] });
  if (u.includes('api.github.com/search')) return json({ items: [{ title: 'Fix login', number: 4, updated_at: now, repository_url: 'https://api.github.com/repos/me/app', state: 'open', html_url: 'https://github.com/me/app/pull/4', pull_request: {} }] });
  if (u.includes('api.github.com/user/repos')) return json([{ full_name: 'me/app', private: true, description: 'App', pushed_at: now, html_url: 'https://github.com/me/app', language: 'JS' }]);
  if (u.includes('slack.com/api/search.messages')) return json({ ok: true, messages: { matches: [{ channel: { name: 'sales' }, ts: '1700000000.1', username: 'asha', text: 'Diwali offer is live', permalink: 'https://slack/x' }] } });
  if (u.includes('api.notion.com/v1/search')) return json({ results: [{ object: 'page', id: 'p1', last_edited_time: now, url: 'https://notion/p1', properties: { Name: { type: 'title', title: [{ plain_text: 'Roadmap' }] } } }, { object: 'database', id: 'd1', last_edited_time: now, title: [{ plain_text: 'Leads' }] }] });
  if (u.includes('api.notion.com/v1/blocks')) return json({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Q1: launch' }] } }] });
  if (u.includes('api.stripe.com/v1/balance')) return json({ available: [{ amount: 125000, currency: 'inr' }], pending: [{ amount: 500, currency: 'inr' }] });
  if (u.includes('api.stripe.com/v1/charges')) return json({ data: [{ amount: 50000, currency: 'inr', created: 1700000000, status: 'succeeded', refunded: false, billing_details: { name: 'Ravi', email: 'r@x.in' }, description: 'Cleaning' }] });
  if (u.includes('api.box.com')) return json({ entries: [{ name: 'Contract.pdf', type: 'file', modified_at: now, parent: { name: 'Legal' }, description: 'Signed' }] });
  if (u.includes('api.twilio.com')) return json({ messages: [{ direction: 'inbound', from: '+9198', to: '+9199', date_sent: now, body: 'Yes please' }, { direction: 'outbound-api', from: '+9199', to: '+9198', date_created: now, body: 'Reminder', status: 'delivered' }] });
  if (u.includes('api.hubapi.com')) return json({ results: [{ properties: { firstname: 'Meena', lastname: 'R', email: 'm@x.in', company: 'Acme', lifecyclestage: 'lead', lastmodifieddate: now } }] });
  return json({ error: { message: 'not faked ' + u } }, 404);
};

test('every reader turns its app data into sources', async () => {
  assert.ok(LIVE_READERS.includes('gmail') && LIVE_READERS.includes('hubspot'));
  const cr = { access_token: 't', key: 'sk', sid: 'AC1', token: 'tw', authed_user: { access_token: 'ut' } };
  const g1 = await READERS.gmail(cr, 'any unread emails?'); assert.match(g1[0].text, /\(unread\)/);
  const g2 = await READERS.gmail(cr, 'email from ravi@x.in'); assert.equal(g2.length, 1, 'nothing for the search → the last 14 days');
  const g3 = await READERS.gmail(cr, 'mail about the dental visit'); assert.equal(g3[0].title, 'Visit');
  assert.match((await READERS.gcal(cr, 'meetings tomorrow'))[0].text, /Dr meeting/);
  assert.equal((await READERS.gcal(cr, 'my calendar this week')).length, 2);
  assert.match((await READERS.gdrive(cr, 'price list file'))[0].text, /Price list/);
  assert.equal((await READERS.gdrive(cr, 'recent files')).length, 1);
  assert.match((await READERS.outlook(cr, 'unread mail'))[0].text, /Acme/);
  assert.equal((await READERS.m365(cr, 'invoice emails and meetings this week')).length, 2);
  const gh = await READERS.github(cr, 'open pull requests in my repos');
  assert.ok(gh.some((x) => /Pull request #4/.test(x.text)) && gh.some((x) => /Repository me\/app/.test(x.text)));
  assert.equal((await READERS.github(cr, 'issues')).length >= 1, true);
  assert.match((await READERS.slack(cr, 'what did asha say about diwali'))[0].text, /Diwali offer/);
  assert.deepEqual(await READERS.slack(cr, 'slack messages'), []);
  const no = await READERS.notion(cr, 'roadmap notes'); assert.equal(no[0].title, 'Roadmap'); assert.match(no[0].text, /Q1: launch/); assert.equal(no[1].title, 'Leads');
  const sp = await READERS.stripe(cr); assert.match(sp[0].text, /available: 1,250 INR/); assert.match(sp[1].text, /succeeded/);
  assert.match((await READERS.box(cr, 'contract documents'))[0].text, /Contract\.pdf/);
  assert.deepEqual(await READERS.box(cr, 'files'), []);
  const tw = await READERS.twilio(cr); assert.equal(tw.length, 2); assert.match(tw[0].title, /from \+9198/);
  assert.match((await READERS.hubspot(cr, 'contacts at acme'))[0].text, /Meena R/);
  assert.equal((await READERS.hubspot(cr, 'crm contacts')).length, 1);
  assert.ok(seen.length > 15);
});

test('an app error is reported with its message', async () => {
  await assert.rejects(READERS.gmail({ access_token: 't' }, 'emails from nobody').then(() => READERS.gcal({ access_token: 'x' }, 'x')).then(() => { throw new Error('ok'); }), /ok/);
  const old = globalThis.fetch;
  globalThis.fetch = async () => json({ error: { message: 'Invalid Credentials' } }, 401);
  await assert.rejects(READERS.gdrive({ access_token: 'bad' }, 'files'), (e) => e.status === 401 && /Invalid Credentials/.test(e.message));
  globalThis.fetch = async () => json({ ok: false, error: 'not_authed' });
  await assert.rejects(READERS.slack({ access_token: 'bad' }, 'what about diwali'), /not_authed/);
  globalThis.fetch = old;
});
