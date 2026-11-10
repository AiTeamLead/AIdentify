// Social Media festival calendar: Google "Holidays in India" (API key) or the built-in list, and per-festival drafts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { startServer } from './helpers.mjs';
import { builtinFestivals, DEFAULT_CALENDAR } from '../lib/festivals.js';

const PW = 'Clinic-pass-123!';
const MOCK = { RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', CLINIC_DEMO_PLATFORM_KEY: '1' };

test('built-in list has the 2026 festival dates', () => {
  const nov = builtinFestivals('2026-11');
  assert.ok(nov.some((f) => f.date === '2026-11-08' && f.name === 'Diwali'));
  assert.ok(nov.some((f) => f.date === '2026-11-24' && /Guru Nanak/.test(f.name)));
  assert.ok(builtinFestivals('2026-03').some((f) => f.date === '2026-03-04' && f.name === 'Holi'));
  assert.ok(nov.every((f) => f.date.startsWith('2026-11')));
  assert.throws(() => builtinFestivals('2026-13'));
  assert.equal(DEFAULT_CALENDAR, 'en.indian#holiday@group.v.calendar.google.com');
});

test('the page shows a month festival calendar and keeps the Draft a post box', () => {
  const src = fs.readFileSync(new URL('../clinic.html', import.meta.url), 'utf8');
  assert.match(src, /function festivalCalendar\(\)/);
  assert.match(src, /data-act="fest-draft"/);
  assert.match(src, /<h2>Draft a post<\/h2>/);
  assert.match(src, /<form class="form" data-act="social">/);
});

async function owner(s, email) {
  const tok = (await s.api('/api/auth/signup', { email, name: 'O', password: PW })).d.token;
  await s.api('/api/clinic/profile', { biz: 'Smile Studio', city: 'Hyderabad', services: 'Cleaning', prices: '₹1000', audience: 'Families', offer: 'Free check-up' }, tok);
  await s.api('/api/clinic/role', { role: 'dental' }, tok);
  return tok;
}

test('without Google: built-in list; festival drafts go to Approvals once', async () => {
  const s = await startServer(MOCK);
  try {
    const tok = await owner(s, 'fest-builtin@example.com');
    const cal = await s.api('/api/clinic/festivals', { month: '2026-11' }, tok);
    assert.equal(cal.status, 200, JSON.stringify(cal.d));
    assert.equal(cal.d.source, 'builtin');
    assert.ok(cal.d.events.some((f) => f.name === 'Diwali'));
    assert.equal((await s.api('/api/clinic/festivals', { month: 'nope' }, tok)).status, 400);
    const d = await s.api('/api/clinic/social/festival', { date: '2026-11-08', name: 'Diwali' }, tok);
    assert.equal(d.status, 200, JSON.stringify(d.d));
    assert.equal(d.d.post.festival, 'Diwali');
    assert.equal(d.d.post.status, 'draft');
    assert.deepEqual(d.d.post.platforms, ['Instagram / Facebook', 'X (Twitter)', 'LinkedIn', 'WhatsApp status']);
    assert.match(d.d.post.at, /^2026-11-08T03:30:00/);
    const again = await s.api('/api/clinic/social/festival', { date: '2026-11-08', name: 'Diwali' }, tok);
    assert.equal(again.d.existing, true);
    assert.equal((await s.api('/api/clinic/social/festival', { date: '2026-11-09', name: 'Diwali' }, tok)).status, 404);
    assert.equal((await s.api('/api/clinic/social/festival', { date: 'x' }, tok)).status, 400);
    const home = await s.api('/api/clinic', undefined, tok);
    assert.ok(home.d.drafts.some((x) => x.status === 'pending' && /Diwali posts/.test(x.title)));
    assert.equal((await s.api('/api/clinic/festivals', { month: '2026-11' })).status, 401);
    const due = await s.api('/api/clinic/social/festival-due', {}, tok);
    assert.equal(due.status, 200, JSON.stringify(due.d));
    assert.ok((due.d.drafted || []).length >= 1);
    const pending = (await s.api('/api/clinic', undefined, tok)).d.drafts.find((x) => x.status === 'pending' && x.kind === 'post');
    const decided = await s.api('/api/clinic/decide', { id: pending.approvalId, decision: 'approve' }, tok);
    assert.equal(decided.status, 200, JSON.stringify(decided.d));
    assert.match(decided.d.approval.result, /No social account is connected/);
    assert.match(decided.d.approval.result, /Next: fix that and retry/);
  } finally { await s.stop(); }
});

test('with a Google API key: reads the Holidays in India calendar', async () => {
  let seen = '';
  const g = http.createServer((q, r) => {
    seen = q.url; r.setHeader('content-type', 'application/json');
    r.end(JSON.stringify({ items: [
      { summary: 'Diwali/Deepavali', description: 'Public holiday', start: { date: '2026-11-08' } },
      { summary: 'Chhat Puja (Pratihar Sashthi/Surya Sashthi)', description: 'Observance\nTo hide observances, go to Google Calendar Settings', start: { date: '2026-11-15' } },
    ] }));
  });
  await new Promise((r) => g.listen(0, '127.0.0.1', r));
  const s = await startServer({ ...MOCK, GOOGLE_CALENDAR_API_KEY: 'test-key', GOOGLE_CALENDAR_BASE_URL: 'http://127.0.0.1:' + g.address().port });
  try {
    const tok = await owner(s, 'fest-google@example.com');
    const cal = await s.api('/api/clinic/festivals', { month: '2026-11' }, tok);
    assert.equal(cal.d.source, 'google', JSON.stringify(cal.d));
    assert.match(decodeURIComponent(seen), /calendars\/en\.indian#holiday@group\.v\.calendar\.google\.com\/events\?/);
    assert.match(seen, /key=test-key/);
    assert.deepEqual(cal.d.events.map((e) => [e.date, e.kind]), [['2026-11-08', 'public'], ['2026-11-15', 'festival']]);
    const d = await s.api('/api/clinic/social/festival', { date: '2026-11-08', name: 'Diwali/Deepavali' }, tok);
    assert.equal(d.status, 200, JSON.stringify(d.d));
    assert.equal(d.d.source, 'google');
  } finally { await s.stop(); g.close(); }
});
