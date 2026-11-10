import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';
import { chromiumPath } from './chromium.mjs';

let pw = null;
try { pw = await import('playwright'); } catch { /* not installed */ }

const EXE = chromiumPath();

test('signup through a verified festival post, with the publisher mocked', { skip: !pw && 'playwright is not installed' }, async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', CLINIC_DEMO_PLATFORM_KEY: '1', CLINIC_PUBLISH_MOCK: 'verified' });
  const browser = await pw.chromium.launch(EXE ? { executablePath: EXE } : {});
  try {
    const page = await browser.newPage();
    await page.goto(s.base + '/');
    await page.getByRole('heading', { name: /Start free\. Pay in rupees/ }).waitFor();
    assert.match(await page.locator('#pricing').innerText(), /₹2,999/);
    assert.match(await page.locator('#pricing').innerText(), /₹4,999/);
    assert.match(await page.locator('#how').innerText(), /You approve/);
    await page.getByRole('link', { name: 'Build my AI team — free' }).first().click();
    await page.waitForSelector('form[data-act="auth"]');
    const email = 'e2e-journey-' + Date.now() + '@example.com';
    await page.fill('input[name="name"]', 'Journey Owner');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', 'Journey-pass-123!');
    await page.click('form[data-act="auth"] button[type="submit"]');
    await page.waitForSelector('.ob-form', { timeout: 15000 });
    await page.getByText('Digital Marketing Agency', { exact: true }).click();
    assert.equal(await page.locator('input[name="role"][value="marketing"]').isChecked(), true);
    const snap = async (label) => {
      const q = await page.locator('.ob-step.on .ob-q').innerText().catch(() => '');
      const msg = await page.locator('.ob-msg').innerText().catch(() => '');
      if (!q) throw new Error(label + ' has no question');
      return q + ' | ' + msg;
    };
    const next = async () => { await page.locator('.ob-step.on button.ob-ok').click(); await page.waitForTimeout(200); };
    await next();
    await page.locator('.ob-step.on input[name="biz"]').fill('North Agency');
    await next();
    await page.locator('.ob-step.on input[name="city"]').fill('Hyderabad');
    await next();
    await page.locator('.ob-step.on .ob-tag-in').fill('Audit');
    await page.locator('.ob-step.on .ob-tag-in').press('Enter');
    await next();
    const tags = page.locator('.ob-step.on .ob-tag');
    if (await tags.count() === 0) {
      await page.locator('.ob-step.on .ob-tag-in').fill('Local owners');
      await page.locator('.ob-step.on .ob-tag-in').press('Enter');
    }
    await next();
    const where = await snap('before skip');
    if (!(await page.locator('.ob-step.on button.ob-skip').count())) throw new Error('not on the AI step: ' + where);
    await page.locator('.ob-step.on button.ob-skip').click();
    await page.locator('button.ob-go').click();
    await page.locator('#tour').waitFor({ timeout: 20000 });
    assert.match(await page.locator('#tourTitle').innerText(), /Dashboard/);
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: 'Social Media' }).click();
    await page.getByRole('button', { name: 'Draft festivals due this week' }).click();
    await page.getByText(/Drafted \d+ festival/).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Approvals' }).click();
    const card = page.locator('article.draft', { hasText: 'Bhai Dooj posts' });
    const decided = page.waitForResponse((r) => r.url().includes('/api/clinic/decide'));
    await card.getByRole('button', { name: 'Approve' }).click();
    const res = await decided;
    const body = await res.json();
    assert.match(body.approval.result, /Published\./);
    assert.match(body.approval.result, /example\.test\/posts\/mock-post-1/);
    await page.getByRole('button', { name: 'Social Media' }).click();
    await page.locator('.post', { hasText: 'example.test/posts/mock-post-1' }).first().waitFor({ timeout: 15000 });
    assert.match(await page.locator('.post', { hasText: 'Bhai Dooj' }).first().innerText(), /published/);
  } finally { await browser.close(); await s.stop(); }
});
