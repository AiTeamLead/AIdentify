// Signup -> CRM contact -> draft task. WhatsApp QR and send are mocked (no socket).
// Run: npx playwright test test/e2e/playwright/onboard.spec.mjs
import { test, expect } from '@playwright/test';

const base = process.env.E2E_BASE || 'http://127.0.0.1:3000';

test('owner can sign up, keep records in AaaS, and not send', async ({ request }) => {
  const email = 'e2e-' + Date.now() + '@example.com';
  const signup = await request.post(base + '/api/auth/signup', { data: { email, name: 'E2E Owner', password: 'Clinic-pass-123!' } });
  expect(signup.ok()).toBeTruthy();
  const token = (await signup.json()).token;
  const headers = { authorization: 'Bearer ' + token };
  const contact = await request.post(base + '/api/crm/contacts', { headers, data: { name: 'Asha Rao', phone: '919800011122' } });
  expect(contact.ok()).toBeTruthy();
  const id = (await contact.json()).item.id;
  const remind = await request.post(base + '/api/crm/agent/remind', { headers, data: { contactId: id, title: 'Follow up' } });
  const body = await remind.json();
  expect(body.sent).toBe(false);
  const wa = await request.post(base + '/api/clinic/waqr/send', { headers, data: { to: '919800011122', approved: false } });
  expect(wa.status()).toBe(400);
  const blocked = await request.post(base + '/api/connectors/start', { headers, data: { c: 'salesforce' } });
  expect(blocked.status()).toBe(409);
});
