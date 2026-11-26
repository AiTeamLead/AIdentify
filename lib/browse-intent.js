import { trimEndChars } from './text.js';
// Plain browser commands in chat ("open google", "go to x.com", "open in browser youtube", "search google for dentists
// in Hyderabad") go straight to the agent's own browser, as in open-dot, so they work even when no AI key is set and the
// owner sees the page on the agent's computer at once. Anything longer or vaguer is left to the agent's AI.
const SITES = {
  google: 'https://www.google.com', youtube: 'https://www.youtube.com', gmail: 'https://mail.google.com', 'google drive': 'https://drive.google.com',
  drive: 'https://drive.google.com', 'google calendar': 'https://calendar.google.com', calendar: 'https://calendar.google.com',
  'google docs': 'https://docs.google.com', 'google sheets': 'https://sheets.google.com', 'google maps': 'https://maps.google.com', maps: 'https://maps.google.com',
  x: 'https://x.com', twitter: 'https://x.com', linkedin: 'https://www.linkedin.com', facebook: 'https://www.facebook.com', instagram: 'https://www.instagram.com',
  github: 'https://github.com', whatsapp: 'https://web.whatsapp.com', 'whatsapp web': 'https://web.whatsapp.com', amazon: 'https://www.amazon.in', flipkart: 'https://www.flipkart.com',
  wikipedia: 'https://www.wikipedia.org', reddit: 'https://www.reddit.com', notion: 'https://www.notion.so', slack: 'https://app.slack.com', outlook: 'https://outlook.live.com',
  canva: 'https://www.canva.com', chatgpt: 'https://chatgpt.com', bing: 'https://www.bing.com', 'just dial': 'https://www.justdial.com', justdial: 'https://www.justdial.com',
};
const FILLER = /\b(please|pls|can you|could you|for me|now|the|a|an|website|site|page|web ?page|app)\b/gi;
const WHERE = /\b(in|on|using|with|inside)\s+(the\s+)?(your\s+|my\s+|own\s+)?(browser|computer|chrome|web)\b/gi;
const google = (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q);

function toUrl(raw) {
  const r0 = trimEndChars(String(raw || '').replace(WHERE, ' ').trim(), '.,!?');
  if (/^https?:\/\/\S+$/i.test(r0)) return r0;
  if (/^(your |my |own |the )?(browser|chrome|computer|web browser)$/i.test(r0)) return SITES.google;
  let t = String(raw || '').replace(WHERE, ' ').replace(/^\s*(the\s+|your\s+)?(browser|chrome)\s+(and\s+)?(then\s+)?(go\s+to|goto|open|visit|search)?\s*/i, ' ').replace(FILLER, ' ').replace(/[“”"'`]/g, '').replace(/\s+/g, ' ').trim();
  t = trimEndChars(t, '.,!?');
  if (!t) return SITES.google;
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t)) return 'https://' + t;
  const k = t.toLowerCase();
  if (SITES[k]) return SITES[k];
  return null;
}

// "search X on google" / "look up X in the browser" → [whole, X] (suffix checked with endsWith, no backtracking)
const SEARCH_ON = [' on google', ' in google', ' on the browser', ' in the browser', ' on browser', ' in browser', ' on chrome', ' in chrome'];
function searchOnSite(q) {
  const head = /^(?:please )?(?:search|look up) /i.exec(q);
  if (!head) return null;
  const rest = q.slice(head[0].length), low = rest.toLowerCase();
  const suf = SEARCH_ON.find((x) => low.endsWith(x) && low.length > x.length);
  return suf ? [q, rest.slice(0, -suf.length)] : null;
}

// → { url, label } or null
export function browseIntent(msg) {
  const q0 = String(msg || '').trim();
  if (!q0 || q0.length > 140 || /\n/.test(q0)) return null;
  const q = q0.replace(/\s+/g, ' '); // one space between words, so the patterns below need no \s+ runs
  let m;
  // "search google for X", "google X", "search the web for X", "search X on google"
  if ((m = q.match(/^(?:please )?(?:search|look up|lookup) (?:on )?(?:google|the web|web|internet|online) (?:for )?(\S.*)$/i))
    || (m = q.match(/^(?:please )?google (?!\.)(\S.*)$/i))
    || (m = searchOnSite(q))) {
    const term = m[1].replace(WHERE, ' ').trim();
    if (term && !/^(com|\.com)$/i.test(term)) return { url: google(term), label: 'Google search for “' + term.slice(0, 80) + '”' };
  }
  // "open google", "go to x.com", "open in browser google", "open the browser", "visit linkedin.com"
  if ((m = q.match(/^(?:please )?(?:open|open up|go to|goto|visit|browse(?: to)?|navigate to|launch|load|show me) (\S.*)$/i))) {
    const rest = m[1];
    const url = toUrl(rest);
    if (url) return { url, label: url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') };
  }
  return null;
}
