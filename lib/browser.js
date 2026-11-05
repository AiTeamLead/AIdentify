// A real Chromium session for the Research agent and the Browser agent.
// One window (tab) per customer + agent, kept for 10 minutes. Screenshots are signed URLs, not stored in the workspace blob.
// Needs Playwright and Chromium on the machine that runs the server (a VPS or a PC). Serverless hosts cannot run this.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPublicHttpUrl } from './web.js';

const sessions = new Map();
const shots = new Map();
const LIFE = 10 * 60 * 1000;
const SENSITIVE = /\b(pay|buy|purchase|checkout|place order|submit|send money|sign in|log in|confirm payment|delete|transfer)\b/i;
// publishing to the public (a post, a comment, a reply, a message) also waits for the owner, unless a rule allows it
const PUBLISH = /^\s*(share|post|publish|tweet|reply|comment|send|send message|post comment|post reply|like|follow|connect|repost)\s*$/i;

function safeEqual(a, b) {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

// Browser modes:
//   default                 each customer + agent gets its OWN browser with a saved profile on disk
//                           (data/browsers/<account>/<agent>), so sign-ins stay saved, like open-dot's dots.
//                           The owner can watch it live and take over (lib/browser.js computer*, /api/computer/*).
//                           BROWSER_KEEP_LOGINS=off goes back to a fresh browser each time (no cookies kept).
//   BROWSER_PROFILE_DIR set  ONE persistent Chromium profile shared by the agents. The owner signs in to sites once
//                           himself (npm run browser:login opens a visible window on the box display); agents reuse
//                           those cookies. Passwords never pass through chat, the KB or this server.
//   BROWSER_HEADLESS=false  show the agents' window on DISPLAY (or BROWSER_DISPLAY) so the owner can watch.
const profileDir = () => (process.env.BROWSER_PROFILE_DIR || '').trim();
// who may use the signed-in profile: the server owner(s) only (SETTINGS_OWNERS, default SLACK_ACCOUNT_EMAIL)
export const ownsProfile = (email) => ((process.env.SETTINGS_OWNERS || process.env.SLACK_ACCOUNT_EMAIL || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)).includes(String(email || '').toLowerCase());
const headless = () => !/^(0|false|no|off)$/i.test((process.env.BROWSER_HEADLESS || '').trim());
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function playwright() {
  try { return await import('playwright'); }
  catch { throw new Error('The browser is not installed on this server. On a VPS run: npx playwright install chromium'); }
}
export function browserLaunchOptions({ show = !headless() } = {}) {
  const executablePath = process.env.BROWSER_EXECUTABLE || undefined;
  const display = (process.env.BROWSER_DISPLAY || process.env.DISPLAY || '').trim();
  return {
    headless: !show,
    ...(executablePath ? { executablePath } : {}),
    ...(show && display ? { env: { ...process.env, DISPLAY: display } } : {}),
    // Look like a normal browser so sites (Google) keep accepting the owner's saved sign-ins.
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  };
}
// The persistent profile is signed in with real Google Chrome (npm run browser:login), so agents use the same
// Chrome when it is installed (BROWSER_CHANNEL=chrome by default; set BROWSER_CHANNEL=chromium to use Playwright's).
const CHROME_BIN = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/google/chrome/chrome'].find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
function channelOpt() {
  if (process.env.BROWSER_EXECUTABLE) return {};
  const ch = (process.env.BROWSER_CHANNEL || (CHROME_BIN ? 'chrome' : '')).trim();
  return ch && ch !== 'chromium' ? { channel: ch } : {};
}

async function launch() {
  const pw = await playwright();
  return pw.chromium.launch(browserLaunchOptions());
}

// The shared persistent profile. Only one process may use it at a time: whoever opens it writes its pid into
// <profile>/aidentify.lock (the sign-in window or this server). A lock held by a live process means "in use".
// Versions before 1.4 wrote agentsphere.lock; a live pid in that file is still respected.
export const LOCK_NAME = 'aidentify.lock';
export function profileLock(dir, take) {
  const f = path.join(dir, LOCK_NAME);
  for (const name of [LOCK_NAME, 'agentsphere.lock']) {
    try {
      const pid = Number(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (pid && pid !== process.pid) { try { process.kill(pid, 0); return pid; } catch { /* stale lock */ } }
    } catch { /* no lock */ }
  }
  if (take) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.writeFileSync(f, String(process.pid)); }
  return 0;
}
export function releaseProfileLock(dir) {
  const f = path.join(dir, LOCK_NAME);
  try { if (Number(fs.readFileSync(f, 'utf8')) === process.pid) fs.rmSync(f); } catch { /* gone */ }
}
let shared = null;
// True while the agents' own (Playwright) browser holds the shared profile.
export const agentsBrowserBusy = () => !!shared;
async function sharedContext() {
  if (shared && shared.ctx) return shared.ctx;
  if (shared && shared.starting) return shared.starting;
  const pw = await playwright();
  const dir = path.resolve(profileDir());
  if (profileLock(dir, true)) throw new Error('The browser profile is in use: the owner\'s sign-in window or remote browser session ("open browser" in Slack) is open. Try again after it is closed (Slack: "close browser").');
  const starting = pw.chromium.launchPersistentContext(dir, { ...browserLaunchOptions(), ...channelOpt(), viewport: { width: 1280, height: 800 } })
    .catch((e) => {
      shared = null;
      if (/ProcessSingleton|SingletonLock|profile.*in use|already running/i.test(e.message)) throw new Error('The browser profile is in use (a sign-in window may be open). Close it and try again.');
      throw e;
    });
  shared = { starting };
  const ctx = await starting;
  shared = { ctx };
  ctx.on('close', () => { shared = null; releaseProfileLock(dir); for (const [k, v] of sessions) if (v.shared) sessions.delete(k); });
  return ctx;
}
// Close idle tabs after LIFE, and the shared browser once no agent uses it, so the owner can open the sign-in window.
setInterval(async () => {
  for (const [k, v] of sessions) if (Date.now() - v.at > LIFE && !v.owner) { sessions.delete(k); await (v.shared ? v.page.close() : v.browser.close()).catch(() => {}); }
  if (shared && shared.ctx && ![...sessions.values()].some((v) => v.shared)) { const c = shared.ctx; shared = null; await c.close().catch(() => {}); }
}, 60 * 1000).unref();

// ---------- per-agent saved profiles (open-dot style "computer") ----------
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = () => (process.env.AIDENTIFY_DATA_DIR ? path.resolve(process.env.AIDENTIFY_DATA_DIR) : path.join(ROOT, 'data'));
const keepLogins = () => !/^(0|false|no|off)$/i.test((process.env.BROWSER_KEEP_LOGINS || '').trim());
export function agentProfileDir(email, aid) {
  const acct = crypto.createHash('sha256').update('browser:' + String(email).toLowerCase()).digest('hex').slice(0, 24);
  const who = String(aid).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'assistant';
  return path.join(dataDir(), 'browsers', acct, who);
}
// Every request the agent's browser makes (pages, frames, images, scripts) must go to a public address, so a page can't
// make the server's browser reach the server's own network. Lookups are cached for a few minutes.
const hostOk = new Map();
const allowPrivate = () => process.env.BROWSER_ALLOW_PRIVATE_FOR_TESTS === '1';
async function publicRequest(raw) {
  let u; try { u = new URL(raw); } catch { return false; }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return true;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (allowPrivate()) return true;
  const h = u.hostname, hit = hostOk.get(h);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.ok;
  let ok = true; try { await assertPublicHttpUrl(u.origin + '/'); } catch { ok = false; }
  hostOk.set(h, { ok, at: Date.now() }); if (hostOk.size > 2000) hostOk.clear();
  return ok;
}
const checkUrl = (raw) => (allowPrivate() ? Promise.resolve(new URL(String(raw))) : assertPublicHttpUrl(raw));
async function guard(ctx) {
  await ctx.route('**/*', async (route) => { if (await publicRequest(route.request().url())) return route.continue(); return route.abort('blockedbyclient'); });
}

// ---------- the agent's own Chrome (open-dot style) ----------
// Real installed Google Chrome, which Google accepts for sign-in (Playwright's test Chromium is refused), falling back
// to Playwright's Chromium. Headless Chrome announces "HeadlessChrome" in its user agent, which sites treat as a bot,
// so the first launch learns this Chrome's real version and every launch then looks like the normal browser.
// The screen streams from Chrome's own screencast; pop-up windows (e.g. "Sign in with Google") become the shown tab.
const SCREEN = { width: 1280, height: 800 };
let chromeChannel = null, realUA = null;
const asRoot = () => process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0;
function ownOptions() {
  const show = !headless(), display = (process.env.BROWSER_DISPLAY || process.env.DISPLAY || '').trim();
  let tz = 'UTC'; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* default */ }
  return {
    headless: !show, viewport: SCREEN, deviceScaleFactor: 1, locale: process.env.BROWSER_LOCALE || 'en-US', timezoneId: tz, timeout: 30000,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
    ...(show && display ? { env: { ...process.env, DISPLAY: display } } : {}),
    chromiumSandbox: !asRoot(),                // Chrome's sandbox stays on (it can't run as root on Linux)
    ignoreDefaultArgs: ['--enable-automation'], // no "controlled by automated software" bar, no navigator.webdriver
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', ...(realUA ? ['--user-agent=' + realUA] : [])],
  };
}
// A Chrome left running by an earlier server run keeps the profile locked and a new launch hangs: close it.
async function freeProfile(dir) {
  let pid = 0;
  try { pid = Number(String(fs.readlinkSync(path.join(dir, 'SingletonLock'))).split('-').pop()); } catch { return; }
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  if (!pid || pid === process.pid || !alive()) return;
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  for (let i = 0; i < 40 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
  if (alive()) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
}
const noBrowser = (e) => (/Executable doesn't exist|not found|ENOENT|Failed to launch/i.test(e.message) ? new Error('No browser found. Install Google Chrome, or run: npx playwright install chromium') : e);
async function openOwn(pw, dir) {
  const want = process.env.BROWSER_EXECUTABLE ? '' : (process.env.BROWSER_CHANNEL || 'chrome');
  if (chromeChannel === null) chromeChannel = want && want !== 'chromium' ? want : '';
  try { return await pw.chromium.launchPersistentContext(dir, { ...ownOptions(), ...(chromeChannel ? { channel: chromeChannel } : {}) }); }
  catch (e) {
    if (!chromeChannel) throw noBrowser(e);
    chromeChannel = ''; // Chrome isn't installed here: Playwright's Chromium from now on
    try { return await pw.chromium.launchPersistentContext(dir, ownOptions()); } catch (e2) { throw noBrowser(e2); }
  }
}
const lastUrlFile = (dir) => path.join(dir, 'aaas-last-url.txt');
async function launchOwn(email, aid) {
  const pw = await playwright(), dir = agentProfileDir(email, aid);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  await freeProfile(dir);
  let ctx = await openOwn(pw, dir);
  if (!realUA) { // first launch: learn this Chrome's user agent, then relaunch without "Headless" in it
    const probe = ctx.pages()[0] || await ctx.newPage();
    const ua = await probe.evaluate(() => navigator.userAgent).catch(() => '');
    realUA = ua.replace('HeadlessChrome/', 'Chrome/') || UA;
    if (ua !== realUA) { await ctx.close().catch(() => {}); ctx = await openOwn(pw, dir); }
  }
  await guard(ctx);
  const s = { browser: ctx, page: ctx.pages()[0] || await ctx.newPage(), at: Date.now(), email, aid, own: true, dir, stack: [], frame: null, frameN: 0, viewAt: 0, cast: null };
  const track = (pg) => pg.on('framenavigated', (fr) => {
    if (fr !== pg.mainFrame()) return;
    const u = fr.url();
    if (/^https?:\/\//.test(u)) fs.writeFile(lastUrlFile(dir), u, () => {});
  });
  ctx.pages().forEach(track);
  // a pop-up (sign-in window, new tab) becomes the shown tab; when it closes, the previous one comes back
  ctx.on('page', (pg) => {
    track(pg); s.stack.push(s.page); s.page = pg; pg.setDefaultTimeout(20000); restartCast(s);
    pg.on('close', () => { if (s.page !== pg) return; let prev; while ((prev = s.stack.pop()) && prev.isClosed()); s.page = prev || ctx.pages()[0] || null; if (s.page) restartCast(s); });
  });
  ctx.on('close', () => { const k = email + '\n' + aid; if (sessions.get(k) === s) sessions.delete(k); });
  // reopen the last real page, as before the restart
  // reopen the last real page, as before the restart
  try { const last = fs.readFileSync(lastUrlFile(dir), 'utf8').trim(); if (/^https?:\/\//.test(last)) await checkUrl(last).then(() => s.page.goto(last, { waitUntil: 'domcontentloaded', timeout: 20000 })).catch(() => {}); } catch { /* first run */ }
  return s;
}
// what a computer shows when the owner opens it and there is nothing on it yet (BROWSER_START_URL, "blank" for none)
async function startPage(s) {
  const u = process.env.BROWSER_START_URL === 'blank' ? '' : (process.env.BROWSER_START_URL || 'https://www.google.com');
  if (u) await checkUrl(u).then(() => s.page.goto(u, { waitUntil: 'domcontentloaded', timeout: 20000 })).catch(() => {});
}
// live view: Chrome sends a JPEG only when the screen changes; the latest frame is kept for the viewer
async function startCast(s) {
  if (!s.own || s.cast || !s.page || s.page.isClosed()) return;
  const page = s.page;
  try {
    const cdp = await s.browser.newCDPSession(page);
    s.cast = { cdp, page };
    cdp.on('Page.screencastFrame', (f) => {
      if (!s.cast || s.cast.page !== page) return;
      s.frame = Buffer.from(f.data, 'base64'); s.frameN++;
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: SCREEN.width, maxHeight: SCREEN.height, everyNthFrame: 1 });
  } catch { s.cast = null; }
}
async function stopCast(s) { const c = s.cast; s.cast = null; if (c) { await c.cdp.send('Page.stopScreencast').catch(() => {}); await c.cdp.detach().catch(() => {}); } }
function restartCast(s) { const watching = Date.now() - (s.viewAt || 0) < 20000; stopCast(s).then(() => { if (watching) startCast(s); }); }
// stop streaming when nobody has looked for a while
setInterval(() => { for (const s of sessions.values()) if (s.cast && Date.now() - (s.viewAt || 0) > 30000) stopCast(s); }, 15000).unref();

async function sessionFor(email, aid) {
  const k = email + '\n' + aid;
  const cur = sessions.get(k);
  if (cur && Date.now() - cur.at < LIFE && !cur.page.isClosed()) { cur.at = Date.now(); return cur; }
  if (cur) { try { cur.shared ? await cur.page.close() : await cur.browser.close(); } catch { /* already closed */ } }
  let s;
  if (profileDir() && ownsProfile(email)) { // the owner's signed-in profile is never lent to another account
    const page = await (await sharedContext()).newPage();
    s = { page, shared: true, at: Date.now(), email, aid };
  } else if (keepLogins()) { // the agent's own Chrome, with its sign-ins saved on disk
    s = await launchOwn(email, aid);
  } else {
    const browser = await launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: UA });
    await guard(context);
    s = { browser, page: await context.newPage(), at: Date.now(), email, aid };
  }
  s.page.setDefaultTimeout(20000);
  sessions.set(k, s);
  return s;
}

// Close everything (server shutdown). The persistent profile's cookies are already on disk.
export async function closeBrowsers() {
  const jobs = [...sessions.values()].map((s) => (s.shared ? s.page.close() : s.browser.close()).catch(() => {}));
  sessions.clear();
  if (shared && shared.ctx) jobs.push(shared.ctx.close().catch(() => {}));
  shared = null;
  await Promise.all(jobs);
}

async function rememberShot(s) {
  const buf = await s.page.screenshot({ type: 'png' });
  const id = crypto.randomBytes(9).toString('hex');
  shots.set(id, { buf, email: s.email, at: Date.now() });
  if (shots.size > 80) {
    const oldest = [...shots.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 20);
    oldest.forEach(([k]) => shots.delete(k));
  }
  return id;
}

export function shotUrl(id, email, secretStr) {
  const exp = Date.now() + 60 * 60 * 1000;
  const sig = crypto.createHmac('sha256', String(secretStr)).update(`${id}|${email}|${exp}`).digest('base64url');
  return `/api/browser/shot/${id}?exp=${exp}&sig=${sig}`;
}

export function readShot(id, exp, sig, secretStr) {
  const rec = shots.get(id);
  if (!rec || !exp || !sig || Number(exp) < Date.now()) return null;
  const want = crypto.createHmac('sha256', String(secretStr)).update(`${id}|${rec.email}|${exp}`).digest('base64url');
  if (!safeEqual(want, sig)) return null;
  return rec.buf;
}

// Social sites that show their sign-in page instead of the content: the owner signs in once on the agent's computer.
const WALLS = [
  ['Instagram', /(^|\.)instagram\.com$/, /\/accounts\/login|\/challenge|\/accounts\/suspended/, /\b(log in|sign up) to (see|instagram)|log into instagram|phone number, username,? or email/i],
  ['Facebook', /(^|\.)facebook\.com$/, /\/login|\/checkpoint/, /\b(log in|log into) (to )?facebook\b|you must log in to continue/i],
  ['X', /(^|\.)(x|twitter)\.com$/, /\/i\/flow\/login|\/login\b|\/i\/flow\/signup/, /\bsign in to x\b|don.t miss what.s happening/i],
  ['LinkedIn', /(^|\.)linkedin\.com$/, /\/authwall|\/login|\/checkpoint|\/uas\/login|\/signup/, /\bsign in to (see|view|linkedin)|join linkedin|agree & join/i],
  ['WhatsApp', /^web\.whatsapp\.com$/, /^$/, /scan (the )?qr code|log into whatsapp web|steps to log in/i],
];
export function loginWall(url, title = '', text = '') {
  let u; try { u = new URL(url); } catch { return ''; }
  const host = u.hostname.replace(/^www\./, ''), probe = String(title) + '\n' + String(text).slice(0, 1500);
  for (const [name, h, path, words] of WALLS) if (h.test(host) && ((path.source !== '^$' && path.test(u.pathname)) || words.test(probe))) return name;
  return '';
}
async function describe(page) {
  const title = await page.title().catch(() => '');
  const url = page.url();
  const text = await page.evaluate(() => {
    const el = document.querySelector('main, article, [role="main"]') || document.body;
    return (el && el.innerText ? el.innerText : '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4500);
  }).catch(() => '');
  return { title, url, text, loginWall: loginWall(url, title, text) };
}

// Which steps wait for the owner: clicking pay/buy/submit/sign-in/delete…, and typing passwords or codes.
export function needsOwnerApproval(op, input = {}) {
  if (op === 'click') { const t = String(input.text || '').trim().slice(0, 120); return SENSITIVE.test(t) || PUBLISH.test(t); }
  if (op === 'comment') return true;
  if (op === 'key' || op === 'press') return false;
  if (op === 'type') return !!input.secret || /password|passwd|otp|pin code/i.test(String(input.into || ''));
  return false;
}

// op: open | read | click | type | press. approved=true runs a step that would otherwise wait for the owner.
export async function browserAct({ email, aid, op, input = {}, approved = false }) {
  const s = await sessionFor(email, String(aid));
  if (s.owner) throw new Error('The owner has taken over this browser. Wait until they hand it back, or tell them what you need.');
  s.busy = op; s.busyAt = Date.now();
  s.doing = { op, text: doingText(op, input), at: Date.now() };
  try { return await agentStep(s, op, input, approved); } finally { s.busy = ''; if (s.doing) s.doing.end = Date.now(); }
}
// what the owner sees on the computer while the agent works ("Clicking “Share”"), plus where on the screen
function doingText(op, i) {
  const q = (t, n = 60) => '“' + String(t || '').replace(/\s+/g, ' ').trim().slice(0, n) + '”';
  return op === 'open' ? 'Opening ' + String(i.url || '').replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)
    : op === 'click' ? 'Clicking ' + q(i.text) : op === 'type' ? 'Typing into ' + q(i.into, 40) : op === 'press' ? 'Pressing ' + String(i.key || 'Enter')
    : op === 'comment' ? 'Commenting: ' + q(i.text, 60) : op === 'upload' ? 'Uploading an image' : op === 'scroll' ? (Number(i.dy) < 0 ? 'Scrolling up' : 'Scrolling down') : 'Reading the page';
}
// ---- finding the right element: visible ones only, real buttons/links/fields before stray text ----
// (getByText('Post').first() picked Instagram's hidden <title>New post</title> icon label and timed out)
const rx = (t, exact) => new RegExp((exact ? '^\\s*' : '') + String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/(\\\.){3}|…$/g, '(…|\\.\\.\\.)?').replace(/\s+/g, '\\s+') + (exact ? '\\s*$' : ''), 'i');
async function firstVisible(locs, { enabled = false, wait = 0 } = {}) {
  const until = Date.now() + wait;
  do {
    for (const loc of locs) {
      const n = Math.min(await loc.count().catch(() => 0), 15);
      for (let i = 0; i < n; i++) {
        const el = loc.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        if (enabled && !(await el.isEnabled().catch(() => true))) continue;
        if (enabled && (await el.getAttribute('aria-disabled').catch(() => null)) === 'true') continue;
        return el;
      }
    }
    if (Date.now() < until) await new Promise((r) => setTimeout(r, 300));
  } while (Date.now() < until);
  return null;
}
function clickables(page, text) {
  const ex = rx(text, true), loose = rx(text, false);
  return [page.getByRole('button', { name: ex }), page.getByRole('link', { name: ex }), page.getByRole('menuitem', { name: ex }), page.getByRole('tab', { name: ex }),
    page.locator('[role=button], button, a, [tabindex="0"]').filter({ hasText: ex }), page.getByText(ex),
    page.getByRole('button', { name: loose }), page.getByRole('link', { name: loose }), page.getByText(loose)];
}
async function findField(page, into, wait = 4000) {
  const f = into instanceof RegExp ? into : rx(into, false);
  const el = await firstVisible([page.getByRole('textbox', { name: f }), page.getByPlaceholder(f), page.getByLabel(f)], { wait });
  if (el) return el;
  // match aria-placeholder / data-placeholder text (Facebook, LinkedIn editors)
  const ph = page.locator('[aria-placeholder], [data-placeholder]');
  const n = Math.min(await ph.count().catch(() => 0), 20);
  for (let i = 0; i < n; i++) { const e = ph.nth(i); const t = ((await e.getAttribute('aria-placeholder').catch(() => '')) || (await e.getAttribute('data-placeholder').catch(() => '')) || ''); if (f.test(t) && await e.isVisible().catch(() => false)) return e; }
  return null;
}
async function typeInto(s, loc, text) {
  await showTarget(s, loc);
  await loc.click({ timeout: 8000 }).catch(() => {});
  const editable = await loc.evaluate((el) => el.isContentEditable).catch(() => false);
  if (!editable) await loc.fill('', { timeout: 8000 }).catch(() => {});
  if (text.length <= 160 && process.env.BROWSER_SHOW_MS !== '0') await s.page.keyboard.type(text, { delay: 18 });
  else if (editable) await s.page.keyboard.insertText(text);
  else await loc.fill(text, { timeout: 8000 });
}
const COMMENT_BOX = /add a comment|write a comment|write a public comment|post your reply|add a reply|write a reply|reply to|comment as|leave a comment|^comment$/i;
const SUBMIT = ['Post', 'Reply', 'Comment', 'Post comment', 'Post reply', 'Send', 'Submit'];
// One approved step: open the post, write the comment (or @reply), submit it, and check it appears.
async function commentOn(s, input) {
  const page = s.page, url = String(input.url || '').trim();
  let text = String(input.text || '').trim().slice(0, 2000);
  if (!text) throw new Error('Give the comment text.');
  if (input.reply_to) { const h = String(input.reply_to).replace(/^@+/, '').trim(); if (h && !text.toLowerCase().startsWith('@' + h.toLowerCase())) text = '@' + h + ' ' + text; }
  if (url && page.url().split('?')[0].replace(/\/$/, '') !== url.split('?')[0].replace(/\/$/, '')) {
    const u = await checkUrl(url); await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 25000 }); await page.waitForTimeout(2000);
  }
  const wall = loginWall(page.url(), await page.title().catch(() => ''), await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1500) : '').catch(() => ''));
  if (wall) throw new Error(`${wall} needs you to sign in first: open the agent's computer → Take over → sign in → Hand back.`);
  let box = await findField(page, COMMENT_BOX, 3000);
  if (!box) { // LinkedIn/Facebook open the editor with a "Comment" button first
    const btn = await firstVisible([page.getByRole('button', { name: /^\s*comment\s*$/i }), page.getByRole('button', { name: /^\s*(reply|leave a comment)\s*$/i })]);
    if (btn) { await showTarget(s, btn); await btn.click({ timeout: 8000 }).catch(() => {}); box = await findField(page, COMMENT_BOX, 5000); }
  }
  if (!box) throw new Error('No comment box on this page (comments may be turned off, or the post needs sign-in).');
  await typeInto(s, box, text);
  await page.waitForTimeout(400);
  // the submit button next to the box: a visible, enabled Post / Reply / Comment button (Instagram enables it after typing)
  const form = box.locator('xpath=ancestor::*[self::form or @role="dialog" or self::section or self::article][1]');
  const near = [];
  for (const w of SUBMIT) near.push(form.getByRole('button', { name: rx(w, true) }), form.locator('[role=button], button').filter({ hasText: rx(w, true) }));
  let submit = await firstVisible(near, { enabled: true, wait: 3000 });
  if (!submit) submit = await firstVisible(SUBMIT.flatMap((w) => [page.getByRole('button', { name: rx(w, true) }), page.locator('[role=button], button').filter({ hasText: rx(w, true) })]), { enabled: true, wait: 1500 });
  if (submit) { await showTarget(s, submit); await submit.click({ timeout: 8000 }); }
  else await page.keyboard.press('Enter'); // Instagram and Facebook post a comment on Enter
  // check it went out: the box empties and/or the text shows on the page
  const probe = text.replace(/\s+/g, ' ').slice(0, 40);
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(500);
    const left = await box.evaluate((el) => (el.value ?? el.innerText ?? '').trim()).catch(() => '');
    const shown = await page.evaluate((p) => document.body.innerText.replace(/\s+/g, ' ').includes(p), probe).catch(() => false);
    if (!left && shown) return { posted: true };
    if (!left && i > 5) return { posted: true };
  }
  throw new Error('The comment was typed but the site did not take it (it may have been blocked or needs a manual check).');
}
// marks the element the agent is about to use: an outline on the page itself (so it shows in the live screen) and its
// position for the pointer drawn over the screen; a short pause lets the owner see it before it happens
async function showTarget(s, loc) {
  try {
    const bb = await loc.boundingBox({ timeout: 2500 }), vp = s.page.viewportSize() || SCREEN;
    if (bb && s.doing) { s.doing.x = +((bb.x + bb.width / 2) / vp.width).toFixed(4); s.doing.y = +((bb.y + bb.height / 2) / vp.height).toFixed(4); }
    await loc.evaluate((el) => { const o = el.style.outline, f = el.style.outlineOffset; el.style.outline = '3px solid #f59e0b'; el.style.outlineOffset = '2px'; setTimeout(() => { el.style.outline = o; el.style.outlineOffset = f; }, 1600); }, null, { timeout: 2000 });
    await s.page.waitForTimeout(Number(process.env.BROWSER_SHOW_MS ?? 450));
  } catch { /* not visible yet: the action itself reports any problem */ }
}
async function agentStep(s, op, input, approved) {
  const page = s.page;
  if (op === 'open') {
    const u = await checkUrl(input.url);
    const res = await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 25000 });
    await checkUrl(page.url()).catch(async (e) => { await page.goto('about:blank'); throw e; });
    if (res && res.status() >= 400) throw new Error('The page answered ' + res.status());
  } else if (op === 'click') {
    const text = String(input.text || '').trim().slice(0, 120);
    if (!text) throw new Error('Say which words to click.');
    if (!approved && needsOwnerApproval('click', input)) { input._url = page.url(); if (s.lastType && s.lastType.url === page.url()) input._type = s.lastType; return { needsApproval: true, summary: `Browser click “${text}” on ${page.url()}` + (input._type ? `: “${String(input._type.text).slice(0, 140)}”` : '') }; }
    // an approved click runs later: go back to the page it was asked on and re-type what was waiting to be sent
    if (approved && input._url && page.url().split('#')[0] !== input._url.split('#')[0]) {
      const u = await checkUrl(input._url); await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 25000 }); await page.waitForTimeout(1500);
      if (input._type && input._type.text) { const f = await findField(page, input._type.into); if (f) await typeInto(s, f, input._type.text); }
    }
    const target = await firstVisible(clickables(page, text), { enabled: true, wait: 4000 }) || await firstVisible(clickables(page, text), { wait: 1000 });
    if (!target) {
      // "Post"/"Reply" after typing a comment: Enter submits it on Instagram and Facebook
      if (PUBLISH.test(text) && await page.evaluate(() => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || a.isContentEditable); }).catch(() => false)) { await page.keyboard.press('Enter'); await page.waitForTimeout(1500); }
      else throw new Error(`No visible “${text}” button or link on ${page.url()}. Read the page and use the exact words shown.`);
    } else {
      await showTarget(s, target);
      await target.click({ timeout: 8000 });
      await page.waitForTimeout(800);
    }
  } else if (op === 'type') {
    const into = String(input.into || '').trim().slice(0, 80);
    const text = String(input.text || '').slice(0, 2000);
    if (!into) throw new Error('Say which field to type into (its label or placeholder).');
    if (!approved && needsOwnerApproval('type', input)) return { needsApproval: true, summary: `Browser type into “${into}” on ${page.url()}` };
    const loc = await findField(page, into);
    if (!loc) throw new Error(`No visible field “${into}” on ${page.url()}. Read the page and use the field's exact label or placeholder.`);
    // short text is typed key by key so the owner can watch it; long text is pasted at once
    await typeInto(s, loc, text);
    s.lastType = { url: page.url(), into, text };
  } else if (op === 'press') {
    const key = String(input.key || 'Enter').slice(0, 24);
    if (!/^[A-Za-z0-9+]+$/.test(key)) throw new Error('That key is not allowed.');
    await page.keyboard.press(key);
    await page.waitForTimeout(400);
  } else if (op === 'upload') {
    // put an image (one the agent made, one the owner attached, or a public image link) into the page's file picker,
    // e.g. Instagram's "Select from computer"
    const { mediaFile, fetchImage, saveMedia } = await import('./media.js');
    let file = mediaFile(input.image);
    if (!file && /^https?:\/\//.test(String(input.image || ''))) { const f = await fetchImage(String(input.image)); file = saveMedia(f.buf, f.mime, { from: 'link' }).file; }
    if (!file) throw new Error('Give the image: its /api/media/… link from create_image or an attachment, or a public image link.');
    const opener = String(input.click || '').trim().slice(0, 120);
    const inputs = page.locator('input[type=file]');
    if (!opener && await inputs.count()) await inputs.first().setInputFiles(file, { timeout: 10000 });
    else {
      if (!opener) throw new Error('No file picker on this page. Say which button opens it in "click" (e.g. "Select from computer").');
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.getByText(opener, { exact: false }).first().click({ timeout: 8000 })]);
      await chooser.setFiles(file);
    }
    await page.waitForTimeout(1500);
  } else if (op === 'comment') {
    if (!approved && needsOwnerApproval('comment', input)) return { needsApproval: true, summary: `Comment on ${String(input.url || page.url()).slice(0, 120)}: “${String(input.reply_to ? '@' + String(input.reply_to).replace(/^@+/, '') + ' ' : '') + String(input.text || '').slice(0, 160)}”` };
    await commentOn(s, input);
  } else if (op === 'scroll') {
    await page.mouse.wheel(0, Math.max(-4000, Math.min(4000, Number(input.dy) || 800)));
    await page.waitForTimeout(600);
  } else if (op !== 'read' && op !== 'links') throw new Error('Unknown browser action.');
  if (op !== 'open' && page.url() !== 'about:blank') await checkUrl(page.url()).catch(async (e) => { await page.goto('about:blank'); throw e; });
  const d = await describe(page);
  if (op === 'links') d.links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 160) })).filter((l) => /^https?:/.test(l.href)).slice(0, 400)).catch(() => []);
  const shot = await rememberShot(s);
  s.at = Date.now();
  return { ...d, shot };
}

// ---------- the agent's computer: live view and owner take-over (open-dot style) ----------
// The owner watches the agent's own browser and can take over to sign in to sites; sign-ins stay in that agent's
// profile. While the owner is in control the agent's browser steps wait. Only the account's own agents are reachable.
const KEY_OK = /^[A-Za-z0-9+]{1,24}$/;
const sessionKey = (email, aid) => email + '\n' + String(aid);
export function computerState(email, aid) {
  const s = sessions.get(sessionKey(email, aid));
  if (!s || !s.page || s.page.isClosed()) return { open: false, control: false, status: 'off', url: '', title: '' };
  const d = s.doing && (!s.doing.end || Date.now() - s.doing.end < 5000) ? { text: s.doing.text, op: s.doing.op, x: s.doing.x, y: s.doing.y, done: !!s.doing.end } : null;
  return { open: true, control: !!s.owner, status: s.owner ? 'owner' : s.busy ? 'working' : 'idle', working: s.busy || '', url: s.page.url(), title: s.shownTitle || '', doing: d };
}
export async function computerScreen(email, aid, { start = false } = {}) {
  let s = sessions.get(sessionKey(email, aid));
  if ((!s || !s.page || s.page.isClosed()) && !start) return null;
  if (!s || !s.page || s.page.isClosed()) s = await sessionFor(email, String(aid));
  s.at = Date.now();
  s.shownTitle = await s.page.title().catch(() => '');
  return s.page.screenshot({ type: 'jpeg', quality: 70 });
}
// { n, img } — the newest live frame; { n, same: true } when the viewer already has frame n
export async function computerFrame(email, aid, { since = -1, start = false } = {}) {
  let s = sessions.get(sessionKey(email, aid));
  if ((!s || !s.page || s.page.isClosed()) && !start) return { open: false };
  if (!s || !s.page || s.page.isClosed()) s = await sessionFor(email, String(aid));
  s.at = Date.now(); s.viewAt = Date.now();
  if (start && !s.owner && !s.busy && s.page.url() === 'about:blank') await startPage(s);
  if (s.own && !s.cast) await startCast(s);
  if (!s.frame || !s.own) { const img = await s.page.screenshot({ type: 'jpeg', quality: 70 }).catch(() => null); if (img) { s.frame = img; s.frameN++; } }
  s.shownTitle = await s.page.title().catch(() => s.shownTitle || '');
  if (!s.frame || Number(since) === s.frameN) return { open: true, n: s.frameN, same: true };
  return { open: true, n: s.frameN, img: 'data:image/jpeg;base64,' + s.frame.toString('base64') };
}
export async function computerControl(email, aid, on) {
  const s = await sessionFor(email, String(aid));
  s.owner = !!on; s.at = Date.now();
  return computerState(email, aid);
}
// ev: {type:'click'|'dblclick'|'move'|'down'|'up', x, y} (0..1 of the screen) | {type:'type', text} | {type:'key', key}
//     | {type:'scroll', x, y, dx, dy} (wheel under the pointer) | {type:'edge', top}
//     | {type:'nav', url} | {type:'back'} | {type:'forward'} | {type:'reload'}
export async function computerInput(email, aid, ev = {}) {
  const s = sessions.get(sessionKey(email, aid));
  if (!s || !s.page || s.page.isClosed()) throw Object.assign(new Error('The browser is closed. Open it first.'), { status: 409 });
  if (!s.owner) throw Object.assign(new Error('Take over first.'), { status: 409 });
  const page = s.page, vp = page.viewportSize() || { width: 1280, height: 800 };
  s.at = Date.now();
  const t = String(ev.type || '');
  const pt = () => { // normalised 0..1 position → page pixels
    const x = Math.max(0, Math.min(1, Number(ev.x))), y = Math.max(0, Math.min(1, Number(ev.y)));
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw Object.assign(new Error('Bad position.'), { status: 400 });
    return [Math.round(x * vp.width), Math.round(y * vp.height)];
  };
  const quick = t === 'move' || t === 'down' || t === 'up' || t === 'scroll' || t === 'edge';
  if (t === 'move') { await page.mouse.move(...pt(), { steps: 2 }).catch(() => {}); }
  else if (t === 'down') { await page.mouse.move(...pt()).catch(() => {}); await page.mouse.down().catch(() => {}); }
  else if (t === 'up') { await page.mouse.move(...pt(), { steps: 3 }).catch(() => {}); await page.mouse.up().catch((e) => { if (!page.isClosed()) throw e; }); }
  else if (t === 'edge') { // top / bottom of the page, or of the scrolling panel under the middle of the screen
    await page.evaluate((top) => {
      const big = (el) => el && el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY);
      let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      while (el && !big(el)) el = el.parentElement;
      const box = el || document.scrollingElement || document.documentElement;
      box.scrollTo({ top: top ? 0 : box.scrollHeight, behavior: 'instant' });
    }, !!ev.top).catch(() => {});
  }
  else if (t === 'dblclick') { await page.mouse.dblclick(...pt()).catch(() => {}); }
  else if (t === 'click') {
    const x = Math.max(0, Math.min(1, Number(ev.x))), y = Math.max(0, Math.min(1, Number(ev.y)));
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw Object.assign(new Error('Bad click.'), { status: 400 });
    await page.mouse.click(Math.round(x * vp.width), Math.round(y * vp.height)).catch((e) => { if (!page.isClosed()) throw e; });
  } else if (t === 'type') {
    const text = String(ev.text || '').slice(0, 500);
    if (text) await page.keyboard.type(text, { delay: 8 });
  } else if (t === 'key') {
    const key = String(ev.key || '');
    if (!KEY_OK.test(key)) throw Object.assign(new Error('That key is not allowed.'), { status: 400 });
    await page.keyboard.press(key);
  } else if (t === 'scroll') {
    // scroll whatever is under the pointer (inner panels, lists, dialogs), like a real mouse wheel
    if (ev.x != null && ev.y != null) await page.mouse.move(...pt()).catch(() => {});
    const lim = (v) => Math.max(-4000, Math.min(4000, Number(v) || 0));
    await page.mouse.wheel(lim(ev.dx), lim(ev.dy));
  } else if (t === 'nav') {
    let raw = String(ev.url || '').trim();
    if (raw && !/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    const u = await checkUrl(raw).catch((e) => { throw Object.assign(new Error(e.message), { status: 400 }); });
    await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
  } else if (t === 'back') await page.goBack({ timeout: 15000 }).catch(() => {});
  else if (t === 'forward') await page.goForward({ timeout: 15000 }).catch(() => {});
  else if (t === 'reload') await page.reload({ timeout: 20000 }).catch(() => {});
  else throw Object.assign(new Error('Unknown action.'), { status: 400 });
  await new Promise((r) => setTimeout(r, quick ? 40 : t === 'type' ? 120 : 450)); // the page may have closed itself (sign-in pop-up)
  if (!s.cast) { s.frame = null; }
  if (!quick && !page.isClosed() && page.url() !== 'about:blank') await checkUrl(page.url()).catch(async () => { await page.goto('about:blank').catch(() => {}); });
  return computerState(email, aid);
}
export async function computerClose(email, aid) {
  const k = sessionKey(email, aid), s = sessions.get(k);
  if (!s) return { ok: true };
  sessions.delete(k);
  await stopCast(s);
  await (s.shared ? s.page.close() : s.browser.close()).catch(() => {});
  return { ok: true };
}
