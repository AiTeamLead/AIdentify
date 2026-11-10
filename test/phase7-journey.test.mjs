import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

let pw = null;
try { pw = await import('playwright'); } catch { /* not installed */ }

test('dental signup reaches onboarding and the home page shows rupee plans', { skip: !pw && 'playwright is not installed' }, async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on' });
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(s.base + '/');
    await page.getByRole('heading', { name: /Start free\. Pay in rupees/ }).waitFor();
    assert.match(await page.locator('#pricing').innerText(), /₹2,999/);
    assert.match(await page.locator('#pricing').innerText(), /₹4,999/);
    await page.getByRole('link', { name: 'Build my AI team — free' }).click();
    await page.waitForSelector('form[data-act="auth"]');
    const email = 'e2e-journey-' + Date.now() + '@example.com';
    await page.fill('input[name="name"]', 'Journey Owner');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', 'Journey-pass-123!');
    await page.click('form[data-act="auth"] button[type="submit"]');
    await page.waitForSelector('.ob-form', { timeout: 15000 });
    assert.match(await page.locator('.ob-q').first().innerText(), /What kind of business/);
    await page.getByText('Digital Marketing Agency', { exact: true }).click();
    assert.equal(await page.locator('input[name="role"][value="marketing"]').isChecked(), true);
    assert.match(page.url(), /Aesthetic|onboarding/);
  } finally { await browser.close(); await s.stop(); }
});
