// Accounts and workspace API on a server with NO AI key: sign-up, lookup, password change, admin reset and remove,
// workspace sync (/api/kv), the agent builder and knowledge writer refusing cleanly, inbox acknowledgements, and
// My Workplace answering from saved data without a model (extractive mode).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers.mjs';

const STRONG = 'Very-strong-pass-829x!';

test('accounts, admin tools, workspace sync and answers without an AI key', async () => {
  const s = await startServer({ RATE_LIMIT: 'off' });
  try {
    const code = fs.readFileSync(path.join(s.dir, 'data', 'setup-code'), 'utf8').trim();
    const admin = (await s.api('/api/setup', { code, email: 'boss@example.com', password: STRONG, name: 'Boss' })).d.token;
    assert.ok(admin);
    const su = await s.api('/api/auth/signup', { email: 'asha@example.com', name: 'Asha', password: 'Asha-pass-2026', business: { business: 'Asha Dental', vertical: 'dental' } });
    assert.equal(su.status, 200); const t = su.d.token;
    assert.equal((await s.api('/api/auth/signup', { email: 'asha@example.com', name: 'Asha', password: 'Asha-pass-2026' })).status, 409);
    assert.equal((await s.api('/api/auth/signup', { email: 'x@example.com', name: '', password: 'Asha-pass-2026' })).status, 400);
    assert.deepEqual((await s.api('/api/auth/lookup', { email: 'asha@example.com' })).d, { exists: true, role: 'customer' });
    assert.deepEqual((await s.api('/api/auth/lookup', { email: 'nobody@example.com' })).d, { exists: false, role: null });
    // password change
    assert.equal((await s.api('/api/auth/password', { current: 'wrong', next: 'New-pass-2026x' }, t)).status, 400);
    assert.equal((await s.api('/api/auth/password', { current: 'Asha-pass-2026', next: 'short' }, t)).status, 400);
    const pw = await s.api('/api/auth/password', { current: 'Asha-pass-2026', next: 'New-pass-2026x' }, t);
    assert.equal(pw.status, 200); const t2 = pw.d.token;
    assert.equal((await s.api('/api/auth/login', { email: 'asha@example.com', password: 'New-pass-2026x' })).status, 200);
    // workspace sync: own profile edits only; admin may suspend
    const kv = await s.api('/api/kv', undefined, t2);
    assert.equal(kv.status, 200);
    const put = (body, tok) => fetch(s.base + '/api/kv', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, d: await r.json().catch(() => null) }));
    assert.equal((await put({ k: 'as_users', v: JSON.stringify({ 'asha@example.com': { name: 'Asha R', plan: 'pro', role: 'admin' } }) }, t2)).status, 200);
    assert.equal((await put({ k: 'as_requests', v: JSON.stringify([{ id: 'r1', by: 'asha@example.com', text: 'Need a WhatsApp agent' }, { id: 'r2', by: 'other@example.com', text: 'spoof' }, null]) }, t2)).status, 200);
    assert.equal((await put({ k: 'as_data:asha@example.com', v: 5 }, t2)).status, 400);
    assert.equal((await put({ k: 'as_users', v: JSON.stringify({ 'asha@example.com': { suspended: false }, 'boss@example.com': { suspended: true } }) }, admin)).status, 200);
    assert.equal((await put({ k: 'as_requests', v: JSON.stringify([{ id: 'r1', by: 'asha@example.com', text: 'Edited by admin' }]) }, admin)).status, 200);
    const me = (await s.api('/api/kv', undefined, t2)).d;
    assert.ok(JSON.stringify(me).includes('Asha R')); assert.ok(!JSON.stringify(me).includes('"role":"admin"'), 'a customer cannot make itself admin');
    // AI features refuse cleanly without a key
    assert.equal((await s.api('/api/agents/build', { prompt: '' }, t2)).status, 400);
    assert.ok((await s.api('/api/agents/build', { prompt: 'A front desk agent' }, t2)).status >= 400);
    assert.equal((await s.api('/api/agents/kb/generate', { prompt: '' }, t2)).status, 400);
    assert.equal((await s.api('/api/agents/inbox/ack', { ids: ['x'] }, t2)).status, 200);
    assert.equal((await s.api('/api/agents/unknown', {}, t2)).status, 404);
    // My Workplace without a model: answers from what the agents saved
    const data = { agents: [{ id: 1, name: 'Front Desk', kind: 'custom', recs: [{ name: 'Ravi', note: 'Wants braces next month' }], kb: [{ title: 'Prices', text: 'Braces cost 45000 rupees.' }] }] };
    await put({ k: 'as_data:asha@example.com', v: JSON.stringify(data) }, t2);
    const w1 = await s.api('/api/workplace/chat', { message: 'How much do braces cost?' }, t2);
    assert.equal(w1.status, 200); assert.ok(w1.d.answer);
    const w2 = await s.api('/api/workplace/chat', { message: 'What does Ravi want?', aid: 1 }, t2);
    assert.equal(w2.status, 200); assert.ok(w2.d.answer);
    // admin tools
    assert.equal((await s.api('/api/auth/reset', { email: 'asha@example.com' }, t2)).status, 403);
    assert.equal((await s.api('/api/auth/reset', { email: 'boss@example.com' }, admin)).status, 404);
    const reset = await s.api('/api/auth/reset', { email: 'asha@example.com' }, admin);
    assert.equal(reset.status, 200); assert.ok(reset.d.temp);
    assert.equal((await s.api('/api/auth/login', { email: 'asha@example.com', password: reset.d.temp })).status, 200);
    assert.equal((await s.api('/api/auth/remove', { email: 'asha@example.com' }, t2)).status, 401, 'old sessions end after a reset');
    assert.equal((await s.api('/api/auth/remove', { email: 'nobody@example.com' }, admin)).status, 404);
    assert.equal((await s.api('/api/auth/remove', { email: 'asha@example.com' }, admin)).status, 200);
    assert.deepEqual((await s.api('/api/auth/lookup', { email: 'asha@example.com' })).d, { exists: false, role: null });
  } finally { await s.stop(); }
});
