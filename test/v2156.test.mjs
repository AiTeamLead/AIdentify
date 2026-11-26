// v2.15.6: the app's browser starts with Chrome → Microsoft Edge → any Chrome/Edge on disk → Playwright's Chromium,
// and says exactly why when none starts (was: "No browser found" hiding the reason; Take over did nothing).
// X's free button copies the picture for Ctrl+V. db:setup shows the real connection error and the right hint.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { browserChoices, startBrowser } from '../lib/browser.js';
import { connectError, connectHint } from '../scripts/db-setup.mjs';
import { ROOT } from './helpers.mjs';

test('browser order: Chrome, then Edge, then any found on disk, then Playwright Chromium; overrides respected', () => {
  const d = browserChoices({}, 'win32').map((c) => c.label);
  assert.deepEqual([d[0], d[1], d.at(-1)], ['Google Chrome', 'Microsoft Edge', "Playwright's Chromium"]);
  assert.deepEqual(browserChoices({}, 'win32')[1].opt, { channel: 'msedge' });
  assert.deepEqual(browserChoices({ BROWSER_EXECUTABLE: 'C:\\x\\chrome.exe' }).map((c) => c.opt), [{ executablePath: 'C:\\x\\chrome.exe' }]);
  assert.deepEqual(browserChoices({ BROWSER_CHANNEL: 'chromium' }).map((c) => c.opt), [{}]);
  assert.equal(browserChoices({ BROWSER_CHANNEL: 'msedge' })[0].opt.channel, 'msedge');
});

test('startBrowser: falls through to the next browser, remembers the one that worked, and names every reason', async () => {
  const choices = [{ label: 'Google Chrome', opt: { channel: 'chrome' } }, { label: 'Microsoft Edge', opt: { channel: 'msedge' } }, { label: "Playwright's Chromium", opt: {} }];
  const tried = [];
  const r = await startBrowser(async (opt) => { tried.push(opt.channel || 'pw'); if (opt.channel === 'chrome') throw new Error("browserType.launchPersistentContext: Chromium distribution 'chrome' is not found at C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"); return 'edge-ok'; }, choices);
  assert.equal(r, 'edge-ok'); assert.deepEqual(tried, ['chrome', 'msedge']);
  tried.length = 0;
  await startBrowser(async (opt) => { tried.push(opt.channel || 'pw'); return 'ok'; }, choices);
  assert.deepEqual(tried, ['msedge'], 'Edge is tried first next time');
  await assert.rejects(startBrowser(async (opt) => { throw new Error(opt.channel === 'msedge' ? 'Failed to launch: spawn UNKNOWN\n=== logs ===' : "Executable doesn't exist at /x"); }, choices), (e) => {
    assert.match(e.message, /Could not start a browser/); assert.match(e.message, /Google Chrome: not installed/); assert.match(e.message, /Microsoft Edge: Failed to launch: spawn UNKNOWN/);
    assert.match(e.message, /Playwright's Chromium: not installed/); assert.match(e.message, /npx playwright install chromium/); assert.doesNotMatch(e.message, /No browser found/);
    return true;
  });
  await assert.rejects(startBrowser(async () => { throw new Error('Failed to create a ProcessSingleton for your profile directory'); }, choices), /profile is still open in another window/);
});

test('db:setup: real reason instead of a blank "Could not connect:", and the hint matches it', () => {
  assert.equal(connectError(new AggregateError([Object.assign(new Error(''), { code: 'ECONNREFUSED' })], '')), 'ECONNREFUSED');
  assert.match(connectError({}), /no answer from the database server/);
  assert.match(connectHint('password authentication failed for user "aidentify"'), /login is wrong/);
  assert.match(connectHint('database "aidentify" does not exist'), /does not exist yet/);
  assert.match(connectHint('ECONNREFUSED'), /Start PostgreSQL first/);
});

test('Post on X (free) copies the picture for Ctrl+V and opens X with the text', () => {
  const app = fs.readFileSync(ROOT + '/clinic.html', 'utf8');
  assert.match(app, /data-act="x-share"/); assert.match(app, /navigator\.clipboard\.write\(\[new ClipboardItem\(\{ 'image\/png': png \}\)\]\)/);
  assert.match(app, /press Ctrl\+V/); assert.match(app, /window\.open\(href, '_blank', 'noopener'\)/);
  const orch = fs.readFileSync(ROOT + '/lib/orchestrator.js', 'utf8');
  assert.match(orch, /posts automatically with the picture through the app's browser/); assert.match(orch, /X is not connected: after approval the user presses "Post on X \(free\)"/);
});
