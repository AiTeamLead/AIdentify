// Engagement (v2.15.1): comments on the owner's own posts are read, a reply is drafted for each, people who ask
// about price / booking / details become enquiries (→ leads → the normal follow-up), and the owner can comment on
// other business posts (X by keyword search, LinkedIn by pasting a post link).
// Nothing goes out without the owner: each reply waits on Social Media › Engagement for Send, unless the owner turned
// on an auto-reply rule (thank-yous / lead questions). Comments on other people's posts are never automatic and
// are capped at 10 a day so the account is not flagged as spam.
//
// What the networks allow (their APIs, not this app): Facebook Page + Instagram Business — read and reply on your own
// posts only (no commenting on other Pages/accounts); X — mentions, replies and search (each read/post is charged by
// X); LinkedIn — posting comments works, but Composio has no tool to READ LinkedIn comments, so no auto-replies there.
import { socialConnections, xMentions, xSearch, xPost } from './social.js';

const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const parse = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
const day = (t) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10); // India day
export const CAP_COMMENTS = 10;
const EVERY = 15 * 60e3, META_EVERY = 60 * 60e3, SEARCH_EVERY = 6 * 3600e3, FOLLOW_AFTER = 24 * 3600e3;

export const LEAD_RE = /\b(price|prices|pricing|cost|costs|how much|rate|rates|fee|fees|charges?|book|booking|appointment|slot|available|availability|interested|dm|inbox|contact|call me|your number|whatsapp|details|quote|quotation|enquir\w*|inquir\w*|demo|visit|address|location|where are you|timings?|open today)\b/i;
const THANKS_RE = /^\W*(thanks|thank you|thx|great|nice|awesome|amazing|love (it|this)|congrats|congratulations|well done|superb|wow|good one|👍|🙏|❤️|🔥|👏)\b/i;
const PHONE_RE = /(?:\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5})/;
export const phoneIn = (t) => { const m = String(t || '').match(PHONE_RE); return m ? m[1].replace(/\D/g, '') : ''; };
export const isLead = (t) => LEAD_RE.test(String(t || '')) || !!phoneIn(t);
export const isThanks = (t) => THANKS_RE.test(String(t || '')) && !isLead(t);

export function blankEngage() { return { items: [], seen: [], xSince: '', auto: { thanks: false, leads: false }, keywords: '', sentDay: '', sentToday: 0, lastRun: 0, lastMeta: 0, lastSearch: 0, lastError: '', costDay: '', xReads: 0, xPosts: 0 }; }
const E = (c) => { c.engage = { ...blankEngage(), ...(c.engage || {}) }; return c.engage; };
const nid = (list) => (list.reduce((m, x) => Math.max(m, x.id || 0), 0) || 0) + 1;

export function engageView(c, conns = {}) {
  const e = { ...blankEngage(), ...((c && c.engage) || {}) };
  return {
    items: e.items.slice(0, 60), auto: e.auto, keywords: e.keywords, lastRun: e.lastRun, lastError: e.lastError,
    sentToday: e.sentDay === day(Date.now()) ? e.sentToday : 0, cap: CAP_COMMENTS,
    xToday: e.costDay === day(Date.now()) ? { reads: e.xReads, posts: e.xPosts } : { reads: 0, posts: 0 },
    networks: { x: !!(conns.x && conns.x.own), facebook: !!conns.facebook, instagram: !!conns.instagram, linkedin: !!conns.linkedin },
  };
}
const biz = (c) => ({ name: (c.profile && c.profile.biz) || c.biz || 'our business', phone: (c.profile && c.profile.phone) || c.phone || '', services: [].concat((c.profile && c.profile.services) || c.services || []).join(', ') });
function template(c, it) {
  const b = biz(c), who = it.authorName ? it.authorName.split(' ')[0] : it.author || '';
  if (it.kind === 'followup') return clip(`Hi ${who}, just checking in from ${b.name}. Still happy to help with the details. Share your number or send us a message${b.phone ? ' / WhatsApp ' + b.phone : ''} and we'll get back right away.`, 270);
  if (it.kind === 'comment') return clip(`Great post${who ? ', ' + who : ''}. Thanks for sharing this.`, 270);
  if (isLead(it.text)) return clip(`Thanks ${who}! Happy to help. Please send us a message${b.phone ? ' or WhatsApp ' + b.phone : ''} with your number and we'll share the details.`, 270);
  if (isThanks(it.text)) return clip(`Thank you ${who}! 🙏`, 270);
  return clip(`Thanks for your comment${who ? ', ' + who : ''}!`, 270);
}
// AI draft (JSON) with the business details; falls back to a plain template
async function draftReply(c, it, complete) {
  const fallback = template(c, it), b = biz(c);
  if (!complete) return fallback;
  const task = it.kind === 'comment' ? `Write a short, genuine comment (max 240 characters) from ${b.name} on this ${it.network} post. Add value, no hard selling, no links, no hashtags.`
    : it.kind === 'followup' ? `Write a short polite follow-up reply (max 240 characters) to this person who asked about our services and has not shared contact details yet.`
      : `Write a short friendly reply (max 240 characters) from ${b.name} to this comment on our ${it.network} post. If they ask about price, booking or details, invite them to message us with their number${b.phone ? ' or WhatsApp ' + b.phone : ''}. Never invent prices.`;
  const prompt = `${task}\nBusiness: ${b.name}. Services: ${b.services || 'not given'}.\n${it.kind === 'comment' ? 'Post' : 'Comment'} by ${it.author || 'someone'}: "${clip(it.text, 600)}"\nAnswer with only the reply text.`;
  try {
    const r = await complete(prompt, { max: 300 }), out = String((r && typeof r === 'object' ? r.text : r) || '').trim().replace(/^["']|["']$/g, '');
    if (!out || out.length < 3 || /^\{|mock/i.test(out)) return fallback;
    return clip(out, 270);
  } catch { return fallback; }
}

// one owner: read new comments, draft replies, capture leads, queue follow-ups, auto-send what the owner allowed
export async function checkEngagement({ st, email, secret, edit, complete, socialAgent, now = Date.now(), force = false }) {
  const conns = await socialConnections(st, email).catch(() => ({}));
  const found = [], errs = [];
  let snap = null; await edit((c) => { snap = JSON.parse(JSON.stringify(E(c))); });
  if (!force && now - (snap.lastRun || 0) < EVERY - 30e3) return { skipped: true };
  const seen = new Set(snap.seen || []);
  let xReads = 0;
  if (conns.x && conns.x.own) {
    try { const r = await xMentions({ st, email, secret, sinceId: snap.xSince }); xReads += r.items.length + 1;
      for (const t of r.items) found.push({ network: 'X', kind: 'reply', cid: t.id, post: t.url, author: t.author, authorName: t.authorName, text: t.text });
      if (r.items[0]) snap.xSince = r.items.reduce((m, t) => (BigInt(t.id) > BigInt(m || '0') ? t.id : m), snap.xSince || '0');
    } catch (e) { errs.push('X: ' + e.message); }
    if (snap.keywords && (force || now - (snap.lastSearch || 0) > SEARCH_EVERY)) {
      try { const items = await xSearch({ st, email, secret, query: snap.keywords.split(',').map((k) => k.trim()).filter(Boolean).map((k) => (/\s/.test(k) ? `"${k}"` : k)).join(' OR '), max: 10 }); xReads += items.length;
        for (const t of items.slice(0, 3)) found.push({ network: 'X', kind: 'comment', cid: t.id, post: t.url, author: t.author, authorName: t.authorName, text: t.text });
        snap.lastSearch = now;
      } catch (e) { errs.push('X search: ' + e.message); }
    }
  }
  if ((conns.facebook || conns.instagram) && socialAgent && (force || now - (snap.lastMeta || 0) > META_EVERY)) {
    const nets = [conns.facebook && 'Facebook Page', conns.instagram && 'Instagram'].filter(Boolean).join(' and ');
    try {
      const out = await socialAgent({ message: `Read only, do not reply or post anything. Using the connected ${nets} tools, list the comments from the last 3 days on our 5 most recent posts (not our own comments).
Answer with only JSON, one object per line: {"network":"Facebook" or "Instagram","post":"<post link>","comment_id":"<id>","author":"<name or @handle>","text":"<comment text>"}. If there are none, answer: NONE`, allow: () => false });
      for (const line of String((out && out.answer) || '').split('\n')) {
        const j = parse(line.trim().replace(/^[-*\s]+/, '').replace(/,$/, ''), null);
        if (j && j.comment_id && j.text && /facebook|instagram/i.test(j.network || '')) found.push({ network: /insta/i.test(j.network) ? 'Instagram' : 'Facebook', kind: 'reply', cid: String(j.comment_id), post: clip(j.post, 300), author: clip(j.author, 80), authorName: clip(j.author, 80), text: clip(j.text, 1000) });
      }
      snap.lastMeta = now;
    } catch (e) { errs.push('Facebook/Instagram: ' + e.message); }
  }
  // draft outside the lock (AI can take a few seconds)
  const fresh = [];
  for (const f of found) { const key = f.network + ':' + f.cid; if (seen.has(key)) continue; seen.add(key); fresh.push({ ...f, key }); }
  let c0 = null; await edit((c) => { c0 = JSON.parse(JSON.stringify(c)); });
  for (const f of fresh) { f.lead = f.kind === 'reply' && isLead(f.text); f.phone = phoneIn(f.text); f.draft = await draftReply(c0, f, complete); }
  // follow-ups: lead replies sent a day ago where the person has not given a number yet
  const follow = [];
  for (const it of snap.items) if (it.lead && it.status === 'sent' && !it.followed && !it.phone && it.sentAt && now - it.sentAt > FOLLOW_AFTER && !snap.items.some((x) => x.network === it.network && x.author === it.author && x.phone)) follow.push(it);
  const followDrafts = [];
  for (const it of follow) followDrafts.push({ of: it.id, network: it.network, kind: 'followup', cid: it.cid, post: it.post, author: it.author, authorName: it.authorName, text: it.text, lead: true, phone: '', draft: await draftReply(c0, { ...it, kind: 'followup' }, complete), key: it.key + ':f' });
  const toSend = [];
  await edit((c) => {
    const e = E(c);
    if (e.costDay !== day(now)) { e.costDay = day(now); e.xReads = 0; e.xPosts = 0; }
    e.xReads += xReads; e.xSince = snap.xSince; e.lastSearch = snap.lastSearch; e.lastMeta = snap.lastMeta; e.lastRun = now; e.lastError = clip(errs.join(' · '), 500);
    e.seen = [...seen].slice(-800);
    for (const f of [...fresh, ...followDrafts]) {
      if (f.of) { const o = e.items.find((x) => x.id === f.of); if (!o || o.followed) continue; o.followed = true; }
      const it = { id: nid(e.items), key: f.key, network: f.network, kind: f.kind, cid: f.cid, post: f.post, author: f.author, authorName: f.authorName, text: clip(f.text, 1000), draft: f.draft, lead: !!f.lead, phone: f.phone || '', status: 'pending', result: '', at: new Date(now).toISOString() };
      // someone who asks about price/booking becomes an enquiry → lead → the normal follow-up flow
      if (it.lead && it.kind === 'reply') {
        const same = (c.enquiries || []).find((q) => q.social && q.social.network === it.network && q.social.author === it.author);
        if (same) { if (it.phone && !same.phone) same.phone = '91' + it.phone; same.message = clip(same.message + ' | ' + it.text, 1000); it.enquiryId = same.id; }
        else {
          const q = { id: nid(c.enquiries || []), name: clip(it.authorName || it.author || 'Social contact', 80), phone: it.phone ? '91' + it.phone : '', email: '', channel: it.network, message: clip(`${it.text} (comment on ${it.post || 'our post'})`, 1000), status: 'new', at: it.at, demo: false, source: 'Comments', social: { network: it.network, author: it.author, post: it.post } };
          c.enquiries = c.enquiries || []; c.enquiries.unshift(q); it.enquiryId = q.id;
        }
      }
      e.items.unshift(it);
      if (it.kind !== 'comment' && ((e.auto.thanks && isThanks(it.text) && !it.lead) || (e.auto.leads && it.lead))) toSend.push(it.id);
    }
    // a number given later in the thread fills in the enquiry
    for (const it of e.items) if (it.phone && it.enquiryId) { const q = (c.enquiries || []).find((x) => x.id === it.enquiryId); if (q && !q.phone) q.phone = '91' + it.phone; }
    e.items = e.items.slice(0, 300);
  });
  for (const id of toSend) await sendItem({ st, email, secret, edit, socialAgent, id, auto: true }).catch(() => {});
  return { found: fresh.length, followups: followDrafts.length, sent: toSend.length, errors: errs };
}

// Send one reply/comment (the owner pressed Send, or an auto rule)
export async function sendItem({ st, email, secret, edit, socialAgent, id, text, auto = false, now = Date.now() }) {
  let it = null, block = '';
  await edit((c) => {
    const e = E(c), x = e.items.find((i) => i.id === Number(id));
    if (!x) { block = 'not_found'; return; }
    if (x.status === 'sent') { block = 'Already sent.'; return; }
    if (x.status === 'sending' && now - (x.sendingAt || 0) < 5 * 60e3) { block = 'It is being sent right now.'; return; }
    if (x.kind === 'comment') { if (e.sentDay !== day(now)) { e.sentDay = day(now); e.sentToday = 0; } if (e.sentToday >= CAP_COMMENTS) { block = `Daily limit reached: ${CAP_COMMENTS} comments on other posts a day keeps the account safe from spam flags.`; return; } }
    if (text != null) { const t = clip(String(text).trim(), 1000); if (t.length < 2) { block = 'Write the reply first.'; return; } x.draft = t; }
    x.status = 'sending'; x.sendingAt = now; it = { ...x };
  });
  if (block) throw Object.assign(new Error(block === 'not_found' ? 'That item is not on file.' : block), { status: block === 'not_found' ? 404 : 409 });
  let ok = false, result = '';
  try {
    if (it.network === 'X') { const r = await xPost({ st, email, secret, text: it.draft, replyTo: it.cid }); ok = true; result = r.url; }
    else {
      if (!socialAgent) throw new Error('No AI key, so replies on ' + it.network + ' cannot be sent from here.');
      const how = it.kind === 'comment' ? `Post this comment on the ${it.network} post ${it.post}` : `Reply to comment ${it.cid} on our ${it.network} post ${it.post || ''}`;
      const out = await socialAgent({ message: `${how} with exactly this text, using the connected ${it.network} tools (never the browser). The owner approved it.\nText: ${it.draft}\nThen answer with one line: "sent <link or id>" or "failed - <exact error>".`, allow: (a) => /\b(comment|reply|respond)\b/i.test(a) && !/\b(delete|remove|dm|message|email|follow|like)\b/i.test(a) });
      const ans = String((out && out.answer) || '').trim();
      ok = /^\W*sent\b/i.test(ans) || (/\bsent\b|replied|commented|posted/i.test(ans) && !/fail|error|could not|couldn/i.test(ans)); result = clip(ans, 300);
    }
  } catch (e) { result = clip(e.message, 300); }
  await edit((c) => {
    const e = E(c), x = e.items.find((i) => i.id === it.id); if (!x) return;
    x.status = ok ? 'sent' : 'failed'; x.result = result; x.auto = auto; if (ok) x.sentAt = now;
    if (ok && x.network === 'X') { if (e.costDay !== day(now)) { e.costDay = day(now); e.xReads = 0; e.xPosts = 0; } e.xPosts++; }
    if (ok && x.kind === 'comment') { if (e.sentDay !== day(now)) { e.sentDay = day(now); e.sentToday = 0; } e.sentToday++; }
  });
  return { ok, result };
}
export async function skipItem({ edit, id }) {
  let found = false;
  await edit((c) => { const x = E(c).items.find((i) => i.id === Number(id)); if (x && x.status !== 'sent') { x.status = 'skipped'; found = true; } });
  if (!found) throw Object.assign(new Error('That item is not on file.'), { status: 404 });
}
export async function saveSettings({ edit, body }) {
  await edit((c) => {
    const e = E(c);
    if (body.auto) e.auto = { thanks: !!body.auto.thanks, leads: !!body.auto.leads };
    if (body.keywords != null) e.keywords = clip(String(body.keywords).replace(/[^\p{L}\p{N}\s,'#-]/gu, ' ').replace(/\s+/g, ' ').trim(), 200);
  });
}
// Comment on someone else's post: X (post link) or LinkedIn (post link). Drafted, then waits for Send.
export async function addComment({ edit, complete, url, text, now = Date.now() }) {
  const u = String(url || '').trim();
  const net = /^https:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/status\/(\d+)/i.test(u) || /^https:\/\/x\.com\/i\/web\/status\/\d+/i.test(u) ? 'X' : /^https:\/\/(www\.)?linkedin\.com\/(feed\/update|posts)\//i.test(u) ? 'LinkedIn' : '';
  if (!net) throw Object.assign(new Error('Paste the link of an X post (x.com/…/status/…) or a LinkedIn post (linkedin.com/feed/update/… or /posts/…). Facebook and Instagram do not allow comments on other accounts’ posts through their API.'), { status: 400 });
  const cid = net === 'X' ? u.match(/status\/(\d+)/)[1] : (u.match(/urn:li:(?:activity|share|ugcPost):\d+/) || u.match(/activity-(\d+)/) || [u])[0];
  let c0 = null; await edit((c) => { c0 = JSON.parse(JSON.stringify(c)); });
  const it0 = { network: net, kind: 'comment', cid: /^\d+$/.test(cid) ? (net === 'LinkedIn' ? 'urn:li:activity:' + cid : cid) : cid, post: u, author: '', authorName: '', text: clip(text || 'Post at ' + u, 1000) };
  const draft = await draftReply(c0, it0, complete);
  let item = null;
  await edit((c) => { const e = E(c); item = { id: nid(e.items), key: net + ':c:' + it0.cid + ':' + now, ...it0, draft, lead: false, phone: '', status: 'pending', result: '', at: new Date(now).toISOString() }; e.items.unshift(item); });
  return item;
}

// minute ticker: owners with a social connection are checked every 15 minutes
export async function registerEngage(st, email) {
  const idx = parse((await st.get('as_engage'))?.v, {}) || {};
  if (idx[email]) return; idx[email] = 1; await st.put('as_engage', JSON.stringify(idx), Date.now());
}
export async function engageDue(st, now, runOne) {
  const idx = parse((await st.get('as_engage'))?.v, {}) || {};
  let n = 0;
  for (const [email, last] of Object.entries(idx)) {
    if (typeof last === 'number' && last > 1 && now - last < EVERY) continue;
    idx[email] = now; n++;
    runOne(email).catch((e) => console.error('engage', e.message));
  }
  if (n) await st.put('as_engage', JSON.stringify(idx), Date.now());
  return n;
}
