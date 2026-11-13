// Social prospecting: sign-in walls are recognised, social leads land in the CRM by handle (no email needed),
// and the playbook walks the agent through find → read → comment (approval) → save_lead.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('sign-in pages of the social networks are recognised', async () => {
  const { loginWall } = await import('../lib/browser.js');
  assert.equal(loginWall('https://www.instagram.com/accounts/login/?next=%2Fexplore%2Ftags%2Fskincare%2F'), 'Instagram');
  assert.equal(loginWall('https://www.instagram.com/p/abc/', 'Instagram', 'Log in to see photos and videos from friends.'), 'Instagram');
  assert.equal(loginWall('https://www.instagram.com/explore/tags/skincare/', 'Instagram', '#skincare 12M posts'), '');
  assert.equal(loginWall('https://www.linkedin.com/authwall?trk=x'), 'LinkedIn');
  assert.equal(loginWall('https://x.com/i/flow/login'), 'X');
  assert.equal(loginWall('https://www.google.com/search?q=skincare'), '');
});

test('save_lead: a commenter becomes a CRM lead by handle; the same handle updates it', async () => {
  const { addSocialLead } = await import('../lib/leads.js');
  const kv = new Map();
  const st = { kind: 'memory', get: async (k) => (kv.has(k) ? { v: kv.get(k) } : null), put: async (k, v) => { kv.set(k, v); } };
  const lock = async (_e, fn) => fn();
  const r1 = await addSocialLead(st, 'o@x.com', { name: 'Priya', handle: '@priya.glow', network: 'instagram', interest: 'acne treatment price', post_url: 'https://www.instagram.com/p/abc/', score: 'Warm' }, lock);
  assert.equal(r1.created, true); assert.equal(r1.lead.source, 'Instagram'); assert.equal(r1.lead.social, 'instagram:@priya.glow');
  assert.match(r1.lead.notes, /instagram\.com\/p\/abc/); assert.equal(r1.lead.score, 'Warm'); assert.ok(r1.lead.tags.includes('social'));
  const r2 = await addSocialLead(st, 'o@x.com', { handle: 'priya.glow', network: 'Instagram', interest: 'wants a Saturday slot', phone: '+91 98480 12345' }, lock);
  assert.equal(r2.created, false); assert.equal(r2.lead.id, r1.lead.id); assert.equal(r2.lead.first_name, 'Priya'); assert.equal(r2.lead.phone, '+91 98480 12345');
  const data = JSON.parse(kv.get('as_data:o@x.com'));
  assert.equal(data.agents.find((a) => a.kind === 'crm').db.lead.length, 1);
  await assert.rejects(addSocialLead(st, 'o@x.com', { network: 'x' }, lock), /handle/);
});

test('the playbook walks find → read → comment with approval → save_lead', async () => {
  const { socialPlaybook } = await import('../lib/orchestrator.js');
  const p = socialPlaybook({ socialApps: ['instagram'], canBrowse: true, waOn: false, find: 'F', run: 'R' });
  for (const w of ['find_social_posts', 'browser_comment', 'waits for approval', 'save_lead', 'sign-in page']) assert.ok(p.includes(w), w);
});
