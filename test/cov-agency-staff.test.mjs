// Agency staff and client lifecycle: creating the agency twice, changing a staff role, removing staff and clients
// (with the right permissions), deleting the agency's data, and unknown routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

const PW = 'Agency-pass-123!', STAFF_PW = 'Staff-pass-123!', CLIENT_PW = 'Client-pass-123!';
async function req(s, method, p, body, token) {
  const r = await fetch(s.base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let d = null; try { d = text ? JSON.parse(text) : null; } catch { d = text; }
  return { status: r.status, d };
}

test('agency staff roles, removals and client removal', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on' });
  try {
    const owner = (await req(s, 'POST', '/api/auth/signup', { email: 'boss@example.com', name: 'Boss', password: PW })).d.token;
    assert.equal((await req(s, 'POST', '/api/agency', { name: 'Desk Co' }, owner)).d.created, true);
    assert.equal((await req(s, 'POST', '/api/agency', { name: 'Again' }, owner)).d.created, false, 'one agency per owner');
    assert.equal((await req(s, 'POST', '/api/agency/staff', { email: 'mem@example.com', name: 'Mem', password: STAFF_PW, role: 'member' }, owner)).status, 200);
    assert.equal((await req(s, 'POST', '/api/agency/staff', { email: 'adm@example.com', name: 'Adm', password: STAFF_PW, role: 'admin' }, owner)).status, 200);
    assert.equal((await req(s, 'POST', '/api/agency/clients', { email: 'cli@example.com', name: 'Client', password: CLIENT_PW }, owner)).status, 200);
    const mem = (await req(s, 'POST', '/api/auth/login', { email: 'mem@example.com', password: STAFF_PW })).d.token;
    const adm = (await req(s, 'POST', '/api/auth/login', { email: 'adm@example.com', password: STAFF_PW })).d.token;
    // roles: only the owner changes them
    assert.equal((await req(s, 'POST', '/api/agency/staff/role', { email: 'mem@example.com', role: 'admin' }, adm)).status, 403);
    assert.equal((await req(s, 'POST', '/api/agency/staff/role', { email: 'mem@example.com', role: 'king' }, owner)).status, 400);
    assert.equal((await req(s, 'POST', '/api/agency/staff/role', { email: 'cli@example.com', role: 'member' }, owner)).status, 404);
    assert.deepEqual((await req(s, 'POST', '/api/agency/staff/role', { email: 'mem@example.com', role: 'admin' }, owner)).d.staff, { email: 'mem@example.com', role: 'admin' });
    await req(s, 'POST', '/api/agency/staff/role', { email: 'mem@example.com', role: 'member' }, owner);
    // removals: a member cannot remove an admin; the owner can; the owner cannot be removed
    assert.equal((await req(s, 'POST', '/api/agency/staff/remove', { email: 'adm@example.com' }, mem)).status, 403);
    assert.equal((await req(s, 'POST', '/api/agency/staff/remove', { email: 'boss@example.com' }, owner)).status, 404);
    assert.equal((await req(s, 'POST', '/api/agency/staff/remove', { email: 'nobody@example.com' }, owner)).status, 404);
    assert.equal((await req(s, 'POST', '/api/agency/staff/remove', { email: 'mem@example.com' }, adm)).status, 200);
    assert.equal((await req(s, 'POST', '/api/agency/staff/remove', { email: 'adm@example.com' }, owner)).status, 200);
    assert.equal((await req(s, 'POST', '/api/auth/login', { email: 'adm@example.com', password: STAFF_PW })).status, 401);
    // clients
    assert.equal((await req(s, 'POST', '/api/agency/clients/remove', { email: 'stranger@example.com' }, owner)).status, 404);
    assert.equal((await req(s, 'POST', '/api/agency/clients/remove', { email: 'cli@example.com' }, owner)).status, 200);
    assert.equal((await req(s, 'POST', '/api/auth/login', { email: 'cli@example.com', password: CLIENT_PW })).status, 401);
    assert.equal((await req(s, 'GET', '/api/agency/nothing', undefined, owner)).status, 404);
    // an agency owner with clients cannot delete the account until the clients are gone
    await req(s, 'POST', '/api/agency/clients', { email: 'cli2@example.com', name: 'Client 2', password: CLIENT_PW }, owner);
    assert.equal((await req(s, 'POST', '/api/auth/delete', { password: 'wrong' }, owner)).status, 400);
    assert.equal((await req(s, 'POST', '/api/auth/delete', { password: PW }, owner)).status, 409);
  } finally { await s.stop(); }
});
