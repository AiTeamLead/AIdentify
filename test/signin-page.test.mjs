// One sign-in page: "/" (AaaS owner sign-in). /app, /app#signup, #forgot and reset links never show the workplace's own
// sign-in screen; the reset flow works on "/". Bot Mode frames (/app?bot=1) still open the workplace directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from './helpers.mjs';

const EXE = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', process.env.BROWSER_EXECUTABLE].find((p) => p && fs.existsSync(p));
let pw = null; try { pw = await import('playwright'); } catch { /* not installed */ }

test('Sign in from the landing page (/app links) lands on the AaaS sign-in page, with forgot and reset password', { skip: (!EXE || !pw) && 'no browser' }, async () => {
  const s = await startServer({ RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on' });
  const browser = await pw.chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext();
  // no admin yet on this server: the owner sign-in must still open (first-run admin setup is only at /setup)
  try {
    const page = await ctx.newPage();
    assert.equal((await s.api('/api/setup')).d.needed, true);
    // home page Sign in → /clinic sign-in
    await page.goto(s.base + '/'); await page.locator('.topacts a', { hasText: 'Sign in' }).click();
    await page.waitForSelector('form[data-act="auth"]'); assert.equal(new URL(page.url()).pathname, '/Aesthetic');
    assert.match(await page.locator('.landing').innerText(), /Skin, hair and aesthetic clinic/);
    // old links to /app also land on the sign-in (not the black workplace sign-in, not /setup)
    await page.goto(s.base + '/app'); await page.waitForURL((u) => new URL(u).pathname !== '/app', { timeout: 10000 });
    await page.waitForSelector('form[data-act="auth"]');
    assert.equal(await page.locator('#auth').isVisible().catch(() => false), false);
    assert.match(await page.locator('form[data-act="auth"] h1').innerText(), /Sign in/);
    // landing "Create free account" → /app#signup → create-account form
    await page.goto(s.base + '/app#signup'); await page.waitForSelector('form[data-act="auth"] input[name="name"]');
    assert.match(await page.locator('form[data-act="auth"] h1').innerText(), /Create your account/);
    // create the account there, sign out, then forgot → reset → sign in with the new password
    const email = 'e2e-signin-' + Date.now() + '@example.com';
    await page.fill('input[name="name"]', 'E2E'); await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', 'First-pass-123!');
    await page.click('form[data-act="auth"] button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('form[data-act="auth"]'), null, { timeout: 15000 });
    const page2 = await ctx.newPage();
    await page2.goto(s.base + '/#forgot'); await page2.waitForSelector('form[data-act="forgot"]');
    const fr = await s.api('/api/auth/forgot', { email }); assert.ok(fr.d.testToken);
    await page2.fill('form[data-act="forgot"] input[name="email"]', email); await page2.click('form[data-act="forgot"] button[type="submit"]');
    await page2.waitForSelector('form[data-act="forgot"] [role="status"], form[data-act="forgot"] .err:not(:empty)');
    const tok = (await s.api('/api/auth/forgot', { email })).d.testToken;
    await page2.goto(s.base + '/app#as_reset=' + tok); // old reset links point at /app
    await page2.waitForSelector('form[data-act="reset"]');
    await page2.fill('input[name="password"]', 'Second-pass-456!'); await page2.fill('input[name="password2"]', 'Second-pass-456!');
    await page2.click('form[data-act="reset"] button[type="submit"]');
    await page2.waitForSelector('form[data-act="auth"] [role="status"]');
    assert.equal((await s.api('/api/auth/login', { email, password: 'Second-pass-456!' })).status, 200);
    // the Bot Mode frame still opens the workplace app
    await page2.goto(s.base + '/app?bot=1'); await page2.waitForTimeout(800);
    assert.equal(new URL(page2.url()).pathname, '/app');
  } finally { await browser.close(); await s.stop(); }
});
