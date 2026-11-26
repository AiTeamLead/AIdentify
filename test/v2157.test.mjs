// v2.15.7: the linear text helpers that replaced SonarQube-flagged regular expressions give the same answers
// as the old patterns, and stay fast on hostile input.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as T from '../lib/text.js';
import { htmlToText } from '../lib/mailer.js';
import { browseIntent } from '../lib/browse-intent.js';
import { groupGoal } from '../lib/slack.js';
import { parseModelJson } from '../lib/workflows.js';

const rand = (alphabet, max) => { let s = ''; const n = crypto.randomInt(max + 1); for (let i = 0; i < n; i++) s += alphabet[crypto.randomInt(alphabet.length)]; return s; };

test('trim helpers match the old end/start regexes', () => {
  for (let i = 0; i < 3000; i++) {
    const s = rand('ab/.,!? \n', 12);
    assert.equal(T.noTrailingSlash(s), s.replace(/\/+$/, '')); // NOSONAR - the old pattern, kept as the reference answer
    assert.equal(T.trimEndChars(s, '.,!?'), s.replace(/[.,!?]+$/, '')); // NOSONAR - the old pattern, kept as the reference answer
    assert.equal(T.trimChars(s, '/'), s.replace(/^\/+|\/+$/g, '')); // NOSONAR - the old pattern, kept as the reference answer
  }
});

test('isEmail and findEmails match the old patterns', () => {
  const OLD = /^[^@\s]+@[^@\s]+\.[^@\s]+$/, FIND = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g; // NOSONAR - the old pattern, kept as the reference answer
  for (let i = 0; i < 5000; i++) {
    const s = rand('ab1.@ -_x', 14);
    assert.equal(T.isEmail(s), OLD.test(s), s);
    assert.deepEqual(T.findEmails(s).map((m) => m.email), s.match(FIND) || [], s);
  }
});

test('phone redaction matches the old pattern', () => {
  const OLD = /\+?\d[\d\s().-]{8,}\d/g;
  for (let i = 0; i < 5000; i++) {
    const s = rand('0123456789 ().-+ab', 30);
    assert.equal(T.redactContacts(s, '#'), s.replace(OLD, '#'), s);
  }
});

test('markers, cutFrom and stripTags keep their old meaning', () => {
  const s = 'a <<DO: crm.add || {"n":1}>> b <<DO: x>> c <<DO: y || z>>';
  const old = s.replace(/<<DO:\s*([^|>]+?)\s*\|\|([\s\S]*?)>>/g, (m, op, args) => `[${op}|${args}]`); // NOSONAR - the old pattern, kept as the reference answer
  assert.equal(T.replaceMarkers(s, 'DO', (op, args) => `[${op}|${args}]`), old);
  for (const t of ['Ask Ravi And then go', 'one\nTwo Then x', 'x, y. z', 'plain']) {
    assert.equal(T.cutFrom(t, /\b(And|Then)\b/), t.replace(/\b(And|Then)\b.*$/, ''));
  }
  assert.equal(T.stripTags('<b>hi</b> <> x', ' '), '<b>hi</b> <> x'.replace(/<[^>]+>/g, ' ')); // NOSONAR - the old pattern, kept as the reference answer
});

test('mail HTML → text is unchanged for normal mail', () => {
  const html = '<p>Hi <b>Ravi</b>,</p><p>See <a href="https://x.co/a?b=1" class="c">our offer</a>.<br> Next</p><img src=x.png><div>bye</div>';
  assert.equal(htmlToText(html), 'Hi Ravi,\nSee our offer (https://x.co/a?b=1).\nNext\nbye');
});

test('browse intent, Slack group goals and fenced JSON still parse', () => {
  assert.equal(browseIntent('search  dentists in hyderabad on google').url, 'https://www.google.com/search?q=dentists%20in%20hyderabad');
  assert.equal(browseIntent('google best biryani').url, 'https://www.google.com/search?q=best%20biryani');
  assert.equal(browseIntent('open linkedin.com').url, 'https://linkedin.com');
  assert.deepEqual(groupGoal('Sales team : find 10 leads'), ['Sales team : find 10 leads', 'Sales team', 'find 10 leads']);
  assert.equal(groupGoal('no colon here'), null);
  assert.deepEqual(parseModelJson('here:\n```json\n{"a":1}\n```'), { a: 1 });
});

test('helpers stay linear on hostile input', () => {
  const big = 'a'.repeat(50000) + '@' + 'b.'.repeat(25000) + '!';
  const t0 = Date.now();
  T.findEmails(big); T.isEmail(big); T.redactContacts('1 '.repeat(50000), '#'); T.stripTags('<'.repeat(50000));
  T.replaceMarkers('<<DO:'.repeat(20000), 'DO', () => ''); T.cutFrom(' x'.repeat(50000), /\sAnd\b/);
  htmlToText('<a href="'.repeat(20000));
  assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + 'ms');
});
