// One sign-in page: "/" (AaaS owner sign-in). /app, /app#signup, #forgot and reset links never show the workplace's own
// sign-in screen; the reset flow works on "/". Bot Mode frames (/app?bot=1) still open the workplace directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, startServer } from './helpers.mjs';

const EXE = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', process.env.BROWSER_EXECUTABLE].find((p) => p && fs.existsSync(p));
let pw = null; try { pw = await import('playwright'); } catch { /* not installed */ }

test('sign-in password has an accessible show/hide control', () => {
  const src = fs.readFileSync(path.join(ROOT, 'clinic.html'), 'utf8');
  assert.match(src, /<b>AIdentify<\/b>/);
  assert.doesNotMatch(src, /<b>AaaS<\/b>/);
  assert.match(src, /class="password-toggle" type="button" data-password-toggle aria-label="Show password" aria-pressed="false"/);
  assert.match(src, /input\.type = visible \? 'text' : 'password'/);
  assert.match(src, /toggle\.setAttribute\('aria-label', visible \? 'Hide password' : 'Show password'\)/);
  const reset = src.slice(src.indexOf('mode===\'reset\''), src.indexOf('mode===\'create\''));
  assert.match(reset, /id="reset-password"/);
  assert.match(reset, /id="reset-password2"/);
  assert.equal((reset.match(/data-password-toggle/g) || []).length, 2);
  const wipe = src.slice(src.indexOf('data-act="wipe-account"'), src.indexOf('function settings()'));
  assert.match(wipe, /data-password-toggle/);
});

test('Google sign-in stays below the email sign-in button and uses the existing OAuth route', () => {
  const src = fs.readFileSync(path.join(ROOT, 'clinic.html'), 'utf8');
  const primary = src.indexOf('<button class="btn" type="submit">${mode===\'create\'?\'Create account\':\'Sign in\'}</button>');
  const google = src.indexOf('href="/api/auth/google/start?next=clinic"');
  assert.ok(primary >= 0 && google > primary);
  assert.match(src, /meta\.google \? '<div class="auth-divider" aria-hidden="true">or<\/div><a class="btn-ghost google-signin" href="\/api\/auth\/google\/start\?next=clinic"><span class="google-mark" aria-hidden="true">G<\/span>Continue with Google<\/a>' : ''/);
});

test('sign-in page omits pricing while keeping the in-app Pricing screen', () => {
  const src = fs.readFileSync(path.join(ROOT, 'clinic.html'), 'utf8');
  const login = src.slice(src.indexOf('function loginView() {'), src.indexOf('const AI_PROVIDERS_FALLBACK'));
  assert.doesNotMatch(login, /planCards|Nothing is charged on this page|annualNote|byokNote/);
  assert.match(src, /function pricing\(\)/);
});

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
    const password = page.locator('form[data-act="auth"] input[name="password"]');
    await password.fill('typed-password');
    await page.locator('[data-password-toggle]').click();
    assert.equal(await password.getAttribute('type'), 'text');
    assert.equal(await password.inputValue(), 'typed-password');
    assert.equal(await page.locator('[data-password-toggle]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-password-toggle]').click();
    assert.equal(await password.getAttribute('type'), 'password');
    assert.equal(await password.inputValue(), 'typed-password');
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
