// Public social actions are counted and capped per day; preparing media doesn't count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { socialActions, socialQuota } from '../lib/orchestrator.js';

test('what counts as a public social action', () => {
  assert.equal(socialActions({ kind: 'cfy', items: [{ tool_slug: 'INSTAGRAM_CREATE_MEDIA_CONTAINER' }] }), 0);
  assert.equal(socialActions({ kind: 'cfy', items: [{ tool_slug: 'INSTAGRAM_CREATE_POST' }, { tool_slug: 'INSTAGRAM_REPLY_TO_COMMENT' }] }), 2);
  assert.equal(socialActions({ kind: 'cfy', items: [{ tool_slug: 'GMAIL_SEND_EMAIL' }] }), 0);
  assert.equal(socialActions({ kind: 'browser', op: 'click', input: { text: 'Post' } }), 1);
  assert.equal(socialActions({ kind: 'browser', op: 'click', input: { text: 'Next' } }), 0);
  assert.equal(socialActions({ kind: 'social', channels: [{}, {}] }), 2);
});

test('the daily limit stops public actions once reached', async () => {
  process.env.SOCIAL_DAILY_LIMIT = '3';
  try {
    const mem = new Map(), st = { get: async (k) => (mem.has(k) ? { v: mem.get(k) } : null), put: async (k, v) => { mem.set(k, v); } };
    assert.equal((await socialQuota(st, 'q@example.com', 2)).ok, true);
    assert.equal((await socialQuota(st, 'q@example.com', 1)).ok, true);
    const no = await socialQuota(st, 'q@example.com', 1);
    assert.equal(no.ok, false); assert.equal(no.limit, 3);
    assert.equal((await socialQuota(st, 'other@example.com', 1)).ok, true, 'per account');
  } finally { delete process.env.SOCIAL_DAILY_LIMIT; }
});

test('social playbook: every connected network gets its own rules; WhatsApp only to people who wrote or opted in', async () => {
  const { socialPlaybook } = await import('../lib/orchestrator.js');
  const p = socialPlaybook({ socialApps: ['instagram', 'facebook', 'twitter', 'linkedin'], canBrowse: true, canSocial: false, waOn: true, find: 'COMPOSIO_SEARCH_TOOLS', run: 'COMPOSIO_MULTI_EXECUTE_TOOL' });
  for (const w of ['INSTAGRAM_CREATE_MEDIA_CONTAINER with ig_user_id', 'Facebook Page', 'X (Twitter)', 'LinkedIn: create a post', 'Post on all my accounts', 'save them with save_lead', 'At most 10 such comments a day', 'WhatsApp: reply to customers', 'Never message numbers', 'WhatsApp Web']) assert.ok(p.includes(w), w);
  assert.match(socialPlaybook({ socialApps: [], canBrowse: false, canSocial: false, waOn: false }), /No social network is connected yet/);
});
