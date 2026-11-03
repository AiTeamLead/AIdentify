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
  const r0 = String(raw || '').replace(WHERE, ' ').trim().replace(/[.,!?]+$/, '');
  if (/^https?:\/\/\S+$/i.test(r0)) return r0;
  if (/^(your |my |own |the )?(browser|chrome|computer|web browser)$/i.test(r0)) return SITES.google;
  const t = String(raw || '').replace(WHERE, ' ').replace(/^\s*(the\s+|your\s+)?(browser|chrome)\s+(and\s+)?(then\s+)?(go\s+to|goto|open|visit|search)?\s*/i, ' ').replace(FILLER, ' ').replace(/[“”"'`]/g, '').replace(/\s+/g, ' ').trim().replace(/[.,!?]+$/, '');
  if (!t) return SITES.google;
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t)) return 'https://' + t;
  const k = t.toLowerCase();
  if (SITES[k]) return SITES[k];
  return null;
}

// → { url, label } or null
export function browseIntent(msg) {
  const q = String(msg || '').trim();
  if (!q || q.length > 140 || /\n/.test(q)) return null;
  let m;
  // "search google for X", "google X", "search the web for X", "search X on google"
  if ((m = q.match(/^(?:please\s+)?(?:search|look up|lookup)\s+(?:on\s+)?(?:google|the web|web|internet|online)\s+(?:for\s+)?(.+)$/i))
    || (m = q.match(/^(?:please\s+)?google\s+(?!\.)(.+)$/i))
    || (m = q.match(/^(?:please\s+)?(?:search|look up)\s+(.+?)\s+(?:on|in)\s+(?:google|the browser|browser|chrome)$/i))) {
    const term = m[1].replace(WHERE, ' ').trim();
    if (term && !/^(com|\.com)$/i.test(term)) return { url: google(term), label: 'Google search for “' + term.slice(0, 80) + '”' };
  }
  // "open google", "go to x.com", "open in browser google", "open the browser", "visit linkedin.com"
  if ((m = q.match(/^(?:please\s+)?(?:open|open up|go to|goto|visit|browse(?:\s+to)?|navigate to|launch|load|show me)\s+(.*)$/i))) {
    const rest = m[1];
    const url = toUrl(rest);
    if (url) return { url, label: url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') };
  }
  return null;
}
