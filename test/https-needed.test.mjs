// On a plain-http public address Composio refuses the sign-in; AaaS says exactly how to fix it (deploy/https).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

test('Composio sign-in on http://<ip> explains the HTTPS fix (with the sslip.io address)', async () => {
  const s = await startServer({ RATE_LIMIT: 'off', APP_URL: 'http://54.81.208.96:3000', COMPOSIO_MCP_URL: 'http://127.0.0.1:9/mcp' });
  try {
    const tok = (await s.api('/api/auth/signup', { email: 'h@example.com', name: 'H', password: 'Clinic-pass-123!' })).d.token;
    const r = await s.api('/api/connectors/account/signin', {}, tok);
    assert.equal(r.status, 409); assert.equal(r.d.error, 'needs_https');
    assert.match(r.d.message, /https:\/\/54-81-208-96\.sslip\.io/); assert.match(r.d.message, /setup-https\.sh/);
  } finally { await s.stop(); }
});
