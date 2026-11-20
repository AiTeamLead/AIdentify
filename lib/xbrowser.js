// X (Twitter) through the app's own browser (v2.15.4): the owner signs in to x.com once in the app's browser
// (live view on Settings › Integrations › X), and approved posts are made there with text + picture.
// Fixed steps, no AI: compose → type → attach picture → wait for its preview → Post → take the link → open the post and
// check the picture is on it (deleted at once if not). Max X_BROWSER_DAILY (10) posts a day, spaced 90 s apart.
// Warning shown to the owner: X's rules forbid automating its website; the account can be locked. The API route
// (your X app) is the safe one and is used first when connected.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { withAgentPage } from './browser.js';

export const X_AID = 'assistant'; // the Chief's browser: the owner signs in there once
const env = (k) => String(process.env[k] || '').trim();
export const xWeb = () => (env('X_WEB_BASE') || 'https://x.com').replace(/\/+$/, '');
const cap = () => Math.max(1, Number(env('X_BROWSER_DAILY')) || 10);
const gapMs = () => (env('X_BROWSER_GAP_MS') === '' ? 90000 : Math.max(0, Number(env('X_BROWSER_GAP_MS')) || 0));
const parse = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
const day = (t) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
export class XBrowserError extends Error { constructor(m, code) { super(m); this.code = code || 'x_browser'; } }

export async function xBrowserState(st, email) { return parse((await st.get('as_xbrowser:' + email))?.v, null) || { signedIn: false, handle: '', at: 0, day: '', n: 0, last: 0 }; }
async function putState(st, email, s) { await st.put('as_xbrowser:' + email, JSON.stringify(s), Date.now()); }

const NEEDS_SIGNIN = /\/(login|i\/flow|account\/access|i\/flow\/login|logout)/i;
async function signedInHandle(page) {
  const prof = page.locator('[data-testid="AppTabBar_Profile_Link"]').first();
  try { await prof.waitFor({ state: 'attached', timeout: 15000 }); } catch { return ''; }
  const href = (await prof.getAttribute('href').catch(() => '')) || '';
  return href.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '').split(/[/?#]/)[0];
}
// Is the app's browser signed in to X? Saved for the publisher and the Integrations row.
export async function xBrowserCheck(st, email) {
  const handle = await withAgentPage(email, X_AID, 'checking X sign-in', async (page) => {
    await page.goto(xWeb() + '/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    if (NEEDS_SIGNIN.test(page.url())) return '';
    return signedInHandle(page);
  });
  const s = await xBrowserState(st, email);
  Object.assign(s, { signedIn: !!handle, handle: handle ? '@' + handle : '', at: Date.now() });
  await putState(st, email, s);
  return s;
}

async function articleFor(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  const art = page.locator('article').first();
  await art.waitFor({ timeout: 20000 });
  return art;
}
// One post with its picture. image: { buf, mime } or null.
export async function xBrowserPost({ st, email, text, image }) {
  const s0 = await xBrowserState(st, email);
  if (!s0.signedIn) throw new XBrowserError('X is not signed in in the app’s browser. Settings › Integrations › X › Sign in to X in the app’s browser.', 'x_signin');
  const today = day(Date.now()); if (s0.day !== today) { s0.day = today; s0.n = 0; }
  if (s0.n >= cap()) throw new XBrowserError(`Daily limit reached (${cap()} X posts a day through the browser, to keep the account safe). It will go out tomorrow, or press Post on X (free).`, 'x_cap');
  const wait = gapMs() - (Date.now() - (s0.last || 0)); if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 120000)));
  let tmp = '';
  if (image) { tmp = path.join(os.tmpdir(), 'xpost-' + crypto.randomBytes(6).toString('hex') + (image.mime === 'image/png' ? '.png' : '.jpg')); fs.writeFileSync(tmp, image.buf, { mode: 0o600 }); }
  try {
    const url = await withAgentPage(email, X_AID, 'posting on X', async (page) => {
      await page.goto(xWeb() + '/compose/post', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      if (NEEDS_SIGNIN.test(page.url())) throw new XBrowserError('X wants you to sign in or confirm it is you. Open Settings › Integrations › X › Sign in to X in the app’s browser, finish there, then press Try again.', 'x_signin');
      const box = page.locator('[data-testid="tweetTextarea_0"]').first();
      try { await box.waitFor({ timeout: 25000 }); } catch { throw new XBrowserError(NEEDS_SIGNIN.test(page.url()) ? 'X wants you to sign in again (Settings › Integrations › X).' : 'X’s post box did not open (X may have changed its page, or it is asking for a check). Open the app’s browser to see.', 'x_page'); }
      await box.click();
      await page.keyboard.insertText(clip(text, 280));
      if (tmp) {
        const input = page.locator('input[data-testid="fileInput"], input[type="file"][accept*="image"]').first();
        await input.setInputFiles(tmp);
        try { await page.locator('[data-testid="attachments"] img, [data-testid="attachments"] [style*="background-image"]').first().waitFor({ timeout: 45000 }); }
        catch { throw new XBrowserError('X did not take the picture, so nothing was posted (never text-only).', 'x_picture'); }
      }
      const btn = page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').first();
      await btn.waitFor({ timeout: 15000 });
      for (let i = 0; i < 40 && !(await btn.isEnabled().catch(() => false)); i++) await page.waitForTimeout(250);
      if (!(await btn.isEnabled().catch(() => false))) throw new XBrowserError('X kept the Post button off (text too long or the picture still loading). Nothing was posted.', 'x_page');
      await btn.click();
      // the new post's link: X's "Your post was sent · View" message, else the newest post on the profile
      let link = '';
      try { const a = page.locator('[data-testid="toast"] a[href*="/status/"]').first(); await a.waitFor({ timeout: 20000 }); link = await a.getAttribute('href'); } catch { /* look on the profile */ }
      if (!link) {
        const handle = String(s0.handle || '').replace(/^@/, '');
        if (handle) {
          await page.goto(xWeb() + '/' + handle, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          const want = clip(text, 40).trim();
          const arts = page.locator('article');
          try { await arts.first().waitFor({ timeout: 20000 }); } catch { /* none */ }
          for (let i = 0; i < Math.min(5, await arts.count()); i++) {
            const art = arts.nth(i);
            if (!(await art.innerText().catch(() => '')).includes(want)) continue;
            link = await art.locator('a[href*="/status/"]').first().getAttribute('href').catch(() => ''); if (link) break;
          }
        }
      }
      if (!link) throw new XBrowserError('X did not confirm the post. Check your X profile before trying again (it may be there).', 'x_unconfirmed');
      link = /^https?:/.test(link) ? link.replace(/^https?:\/\/[^/]+/, xWeb()) : xWeb() + link;
      // read it back: the picture must be on it
      if (tmp) {
        const art = await articleFor(page, link).catch(() => null);
        const has = art ? await art.locator('[data-testid="tweetPhoto"]').count() : 0;
        if (!has) {
          if (art) {
            try {
              await art.locator('[data-testid="caret"]').first().click();
              await page.locator('[role="menuitem"]', { hasText: /Delete/i }).first().click();
              await page.locator('[data-testid="confirmationSheetConfirm"]').first().click();
              await page.waitForTimeout(800);
            } catch { throw new XBrowserError('X posted it without the picture and the app could not delete it. Delete it on X: ' + link, 'x_nopic'); }
          }
          throw new XBrowserError('X published the text without the picture, so that post was deleted straight away. Press Try again.', 'x_nopic');
        }
      }
      return link.replace(xWeb(), 'https://x.com');
    });
    const s1 = await xBrowserState(st, email); if (s1.day !== today) { s1.day = today; s1.n = 0; }
    s1.n++; s1.last = Date.now(); await putState(st, email, s1);
    return { url };
  } catch (e) {
    if (e.code === 'x_signin') { const s2 = await xBrowserState(st, email); s2.signedIn = false; await putState(st, email, s2); }
    throw e;
  } finally { if (tmp) fs.rm(tmp, { force: true }, () => {}); }
}
