import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeAudit, readAudit, payloadHash } from '../lib/audit.js';
import { createThread, appendMessage, listThreads, recallFacts, renameThread, deleteThread } from '../lib/threads.js';
import { deletionPlan, recordDeletion, finishDeletion, revokeLocalTokens } from '../lib/privacy-job.js';

function memory() {
  const rows = new Map();
  return {
    async get(k) { const v = rows.get(k); return v == null ? null : { v }; },
    async put(k, v) { rows.set(k, v); },
  };
}

test('audit stores a hash, not the payload', async () => {
  const st = memory();
  const row = await writeAudit(st, 'owner@example.com', { action: 'post', actor: 'owner@example.com', payload: { text: 'secret body' }, provider: 'instagram' });
  assert.equal(row.payloadHash, payloadHash({ text: 'secret body' }));
  const saved = JSON.stringify(await readAudit(st, 'owner@example.com'));
  assert.equal(saved.includes('secret body'), false);
  assert.match(saved, /instagram/);
});

test('threads remember a rolling summary and can be renamed or deleted', async () => {
  const st = memory();
  const t = await createThread(st, 'a@b.c', 'Monday');
  for (let i = 0; i < 10; i++) await appendMessage(st, 'a@b.c', t.id, { role: i % 2 ? 'assistant' : 'user', text: 'turn ' + i + ' about invoices' });
  const listed = await listThreads(st, 'a@b.c');
  assert.equal(listed.length, 1);
  assert.match(listed[0].summary, /invoices/);
  await renameThread(st, 'a@b.c', t.id, 'Billing');
  assert.equal((await listThreads(st, 'a@b.c'))[0].title, 'Billing');
  const facts = recallFacts({ summary: listed[0].summary, messages: [] }, 'invoices due');
  assert.ok(facts.hits.includes('invoices'));
  assert.equal(await deleteThread(st, 'a@b.c', t.id), true);
  assert.equal((await listThreads(st, 'a@b.c')).length, 0);
});

test('deletion keeps only a non-PII hash', async () => {
  const st = memory();
  const plan = deletionPlan('person@example.com');
  assert.equal(JSON.stringify(plan).includes('person@example.com'), false);
  const done = await recordDeletion(st, 'person@example.com');
  assert.equal(done.job, 'delete-account');
  const audit = JSON.stringify(await readAudit(st, 'system'));
  assert.equal(audit.includes('person@example.com'), false);
  assert.match(audit, /account-deleted/);
});

test('deletion emails when mail is on, records mail off otherwise, and revokes local tokens', async () => {
  const st = memory();
  await st.put('as_aikey:person@example.com', JSON.stringify({ sealed: 'token-blob' }), 1);
  await st.put('as_toks:person@example.com', JSON.stringify(['ab'.repeat(16)]), 1);
  await st.put('as_tok:' + 'ab'.repeat(16), JSON.stringify({ email: 'person@example.com' }), 1);
  const off = await finishDeletion(st, 'person@example.com', { send: async () => { throw new Error('no_system_mail'); } });
  assert.equal(off.mail, 'off');
  assert.ok(off.revoked.includes('as_aikey'));
  assert.equal(await st.get('as_aikey:person@example.com'), null);
  assert.equal(JSON.stringify(await readAudit(st, 'system')).includes('person@example.com'), false);
  const sent = await finishDeletion(st, 'other@example.com', { send: async (msg) => { assert.equal(msg.to, 'other@example.com'); assert.match(msg.subject, /deleted/); return { id: 'm1' }; } });
  assert.equal(sent.mail, 'sent');
  assert.deepEqual(await revokeLocalTokens(st, 'nobody@example.com'), []);
});
