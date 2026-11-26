// Small text helpers that replace regular expressions SonarQube flags as slow (super-linear backtracking, S5852).
// Every helper is a single left-to-right or right-to-left pass, so its time grows linearly with the input.

// remove any of `chars` from the end / start / both ends:  trimEndChars('a///', '/') === 'a'
export function trimEndChars(s, chars) {
  s = String(s ?? ''); let i = s.length;
  while (i > 0 && chars.includes(s[i - 1])) i--;
  return s.slice(0, i);
}
export function trimStartChars(s, chars) {
  s = String(s ?? ''); let i = 0;
  while (i < s.length && chars.includes(s[i])) i++;
  return s.slice(i);
}
export const trimChars = (s, chars) => trimStartChars(trimEndChars(s, chars), chars);
export const WS = ' \t\n\r\f\v\u00a0\u2028\u2029\ufeff';
export const noTrailingSlash = (s) => trimEndChars(s, '/');

// same rule as /^[^@\s]+@[^@\s]+\.[^@\s]+$/: one "@", no spaces, and a dot with text on both sides after the "@"
export function isEmail(e) {
  const s = String(e ?? '');
  if (!s || s.length > 320) return false;
  for (const ch of s) if (/\s/.test(ch)) return false;
  const at = s.indexOf('@');
  if (at <= 0 || at !== s.lastIndexOf('@')) return false;
  const dom = s.slice(at + 1);
  for (let i = 1; i < dom.length - 1; i++) if (dom[i] === '.') return true;
  return false;
}

// "Front Desk Agent" → "Front Desk" (a trailing word, case-insensitive, with the spaces before it)
export function stripEndWord(s, word) {
  s = String(s ?? '');
  if (s.length >= word.length && s.slice(-word.length).toLowerCase() === word.toLowerCase()) return trimEndChars(s.slice(0, -word.length), WS);
  return s;
}

// the first {...} (or [...]) block in a text, from the first opening bracket to the last closing one
// (what /\{[\s\S]*\}/ matched), found with indexOf instead of a regular expression
export function outerBlock(text, open = '{', close = '}') {
  const s = String(text ?? ''), a = s.indexOf(open), b = s.lastIndexOf(close);
  return a >= 0 && b > a ? s.slice(a, b + 1) : '';
}
// either a {...} or a [...] block, whichever starts first
export function outerJson(text) {
  const s = String(text ?? ''), a = s.indexOf('{'), b = s.indexOf('[');
  const objFirst = a >= 0 && (b < 0 || a < b);
  return objFirst ? outerBlock(s, '{', '}') || outerBlock(s, '[', ']') : outerBlock(s, '[', ']') || outerBlock(s, '{', '}');
}

// HTML tags out, one pass:  stripTags('<b>hi</b>', ' ') === ' hi '
export function stripTags(html, repl = '') {
  const s = String(html ?? ''); let out = '', i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { out += s.slice(i); break; }
    const gt = s.indexOf('>', lt + 1);
    if (gt < 0) { out += s.slice(i); break; }
    if (gt === lt + 1) { out += s.slice(i, gt + 1); i = gt + 1; continue; } // "<>" is not a tag
    out += s.slice(i, lt) + repl; i = gt + 1;
  }
  return out;
}

// KEY=value lines (.env files); returns [key, value] or null. Value keeps inner spaces, outer spaces trimmed.
export function envLine(line, keyChars = /[A-Z0-9_]/) {
  const s = String(line ?? ''), eq = s.indexOf('=');
  if (eq <= 0) return null;
  const key = s.slice(0, eq).trim();
  if (!key || ![...key].every((c) => keyChars.test(c))) return null;
  return [key, s.slice(eq + 1).trim()];
}

// 2.50 → "2.5", 3.00 → "3" (what .toFixed(n).replace(/\.?0+$/, '') did for numbers with a decimal point)
export const fixedTrim = (v, n = 2) => String(Number(Number(v).toFixed(n)));

// Email addresses inside free text (same as /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g), found by expanding
// around each "@" — linear time. Returns [{ start, end, email }] in order.
const LOCAL_CH = /[A-Za-z0-9._%+-]/, DOMAIN_CH = /[A-Za-z0-9.-]/, LETTERS = /^[A-Za-z]{2,}$/;
export function findEmails(text) {
  const s = String(text ?? ''), out = [];
  let from = 0;
  for (let at = s.indexOf('@'); at >= 0; at = s.indexOf('@', Math.max(at + 1, from))) {
    let a = at; while (a > from && LOCAL_CH.test(s[a - 1])) a--;
    if (a === at) continue;
    let b = at + 1; while (b < s.length && b - at <= 255 && DOMAIN_CH.test(s[b])) b++;
    const dom = s.slice(at + 1, b);
    let end = -1;
    for (let dot = dom.lastIndexOf('.'); dot > 0; dot = dom.lastIndexOf('.', dot - 1)) {
      let k = dot + 1; while (k < dom.length && /[A-Za-z]/.test(dom[k])) k++; // the letters right after this dot
      if (k - dot - 1 >= 2 && LETTERS.test(dom.slice(dot + 1, k))) { end = k; break; }
    }
    if (end < 0) continue;
    out.push({ start: a, end: at + 1 + end, email: s.slice(a, at + 1 + end) });
    from = at + 1 + end;
  }
  return out;
}

// <<NAME: op || args>> markers written by the AI. Calls fn(op, args, whole) for each and puts back what it returns.
// Same as /<<NAME:\s*([^|>]+?)\s*\|\|([\s\S]*?)>>/g, without the backtracking.
export function replaceMarkers(text, name, fn) {
  const s = String(text ?? ''), open = '<<' + name + ':';
  let out = '', i = 0;
  for (;;) {
    const a = s.indexOf(open, i);
    if (a < 0) { out += s.slice(i); break; }
    const bar = s.indexOf('||', a + open.length), op = bar < 0 ? '' : s.slice(a + open.length, bar);
    const close = bar < 0 ? -1 : s.indexOf('>>', bar + 2);
    if (bar < 0 || close < 0 || !op.trim() || op.includes('|') || op.includes('>')) { out += s.slice(i, a + 1); i = a + 1; continue; }
    out += s.slice(i, a) + fn(op.trim(), s.slice(bar + 2, close), s.slice(a, close + 2));
    i = close + 2;
  }
  return out;
}

// what .replace(/RE.*$/, '') did (cut from the first match of RE to the end), linear: `.*$` cannot cross a line break,
// so only the last line can hold the cut
const LINE_END = /[\n\r\u2028\u2029]/;
export function cutFrom(s, re) {
  s = String(s ?? '');
  let last = -1;
  for (let i = s.length - 1; i >= 0; i--) if (LINE_END.test(s[i])) { last = i; break; }
  const k = s.slice(last + 1).search(re);
  return k < 0 ? s : s.slice(0, last + 1 + k);
}

// phone-like numbers in free text (same as /\+?\d[\d\s().-]{8,}\d/g): a digit, at least 8 digits/spaces/().- , a digit
const PHONE_CH = /[\d\s().-]/, DIGIT = /\d/;
export function findPhones(text) {
  const s = String(text ?? ''), out = [];
  let i = 0;
  while (i < s.length) {
    if (!DIGIT.test(s[i])) { i++; continue; }
    let j = i + 1; while (j < s.length && PHONE_CH.test(s[j])) j++;
    let end = j - 1; while (end > i && !DIGIT.test(s[end])) end--;
    if (end - i - 1 >= 8) { const start = i > 0 && s[i - 1] === '+' ? i - 1 : i; out.push({ start, end: end + 1 }); i = end + 1; }
    else i = j;
  }
  return out;
}
// e-mail addresses first, then phone numbers, each replaced by repl
export function redactContacts(text, repl) {
  const cut = (s, spans) => { let out = '', i = 0; for (const p of spans) { out += s.slice(i, p.start) + repl; i = p.end; } return out + s.slice(i); };
  const a = cut(String(text ?? ''), findEmails(text));
  return cut(a, findPhones(a));
}

// sort compare in plain code-unit order (what .sort() does on strings), written out so the order is explicit;
// signatures (Twilio, AWS) need exactly this order, not a locale-aware one
export const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
