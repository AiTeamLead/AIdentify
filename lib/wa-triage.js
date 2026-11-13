// WhatsApp inbox for the business number linked by QR.
// A message from a number the business already knows goes to that person's thread.
// A message from an unknown number becomes one card in Front Desk › Enquiries: Accept (add as a lead) or
// Decline (ignore this number from now on). Until the owner decides, only the sender's name and a short preview
// of the latest message are kept. After Decline, only a one-way hash of the number is kept, so the decision holds
// without storing the number or the chat.
import crypto from 'node:crypto';

const digits = (s) => String(s || '').replace(/\D/g, '');
const last10 = (s) => digits(s).slice(-10);
const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
export const declineHash = (phone) => crypto.createHash('sha256').update('aaas-wa-decline:' + last10(phone)).digest('hex').slice(0, 32);

const LIMITS = { cards: 50, threads: 200, perThread: 30, preview: 160 };
const STOP = /^(stop|stopall|unsubscribe|cancel|optout|opt-out)$/i;

function ensure(c) {
  c.waTriage = Array.isArray(c.waTriage) ? c.waTriage : [];
  c.waDeclined = Array.isArray(c.waDeclined) ? c.waDeclined : [];
  c.waThreads = c.waThreads && typeof c.waThreads === 'object' ? c.waThreads : {};
  return c;
}
// Someone the business already has: a person on file or an enquiry with that number.
export function knownContact(c, phone) {
  const k = last10(phone);
  if (k.length < 10) return null;
  const p = (c.patients || []).find((x) => last10(x.phone) === k);
  if (p) return { kind: 'person', id: p.id, name: p.name, phone: p.phone };
  const e = (c.enquiries || []).find((x) => last10(x.phone) === k);
  if (e) return { kind: 'enquiry', id: e.id, name: e.name, phone: e.phone };
  return null;
}
function addToThread(c, phone, msg) {
  const key = digits(phone);
  const t = Array.isArray(c.waThreads[key]) ? c.waThreads[key] : [];
  t.push(msg);
  c.waThreads[key] = t.slice(-LIMITS.perThread);
  const keys = Object.keys(c.waThreads);
  if (keys.length > LIMITS.threads) {
    const oldest = keys.sort((a, b) => (Date.parse((c.waThreads[a].at(-1) || {}).at) || 0) - (Date.parse((c.waThreads[b].at(-1) || {}).at) || 0));
    for (const k of oldest.slice(0, keys.length - LIMITS.threads)) delete c.waThreads[k];
  }
}
// One inbound customer message. Returns where it went: known | triage | declined | ignored.
export function triageInbound(c, { from, name, text, at, id }) {
  ensure(c);
  const phone = digits(from);
  const body = clean(text, 1000);
  if (phone.length < 10 || phone.length > 15 || !body) return { route: 'ignored' };
  if (c.waDeclined.includes(declineHash(phone))) return { route: 'declined' };
  const when = at || new Date().toISOString();
  const known = knownContact(c, phone);
  if (known) {
    if (STOP.test(body)) {
      c.waOpt = c.waOpt && typeof c.waOpt === 'object' ? c.waOpt : {};
      c.waOpt[phone] = { status: 'out', at: when };
      const p = (c.patients || []).find((x) => last10(x.phone) === last10(phone)); if (p) p.waOpt = 'out';
    }
    addToThread(c, phone, { dir: 'in', text: body, at: when, id: clean(id, 80) });
    return { route: 'known', contact: known };
  }
  let card = c.waTriage.find((x) => last10(x.phone) === last10(phone));
  if (!card) {
    if (c.waTriage.length >= LIMITS.cards) c.waTriage.shift();
    card = { id: crypto.randomBytes(6).toString('hex'), phone, name: '', preview: '', count: 0, at: when };
    c.waTriage.push(card);
  }
  card.name = clean(name, 60) || card.name;
  card.preview = body.slice(0, LIMITS.preview);
  card.count += 1;
  card.at = when;
  return { route: 'triage', card };
}
// Accept: the sender becomes an enquiry (a lead). Returns the new enquiry.
export function acceptCard(c, cardId, now = new Date()) {
  ensure(c);
  const card = c.waTriage.find((x) => x.id === cardId);
  if (!card) return null;
  c.waTriage = c.waTriage.filter((x) => x !== card);
  c.enquiries = Array.isArray(c.enquiries) ? c.enquiries : [];
  const id = c.enquiries.reduce((m, x) => Math.max(m, Number(x && x.id) || 0), 0) + 1;
  const enq = { id, name: card.name || ('WhatsApp +' + card.phone), phone: card.phone, channel: 'WhatsApp', message: card.preview, status: 'new', at: now.toISOString(), demo: false, source: 'WhatsApp' };
  c.enquiries.unshift(enq);
  addToThread(c, card.phone, { dir: 'in', text: card.preview, at: card.at });
  return enq;
}
// Decline: drop the card and remember only a hash of the number.
export function declineCard(c, cardId) {
  ensure(c);
  const card = c.waTriage.find((x) => x.id === cardId);
  if (!card) return false;
  c.waTriage = c.waTriage.filter((x) => x !== card);
  const h = declineHash(card.phone);
  if (!c.waDeclined.includes(h)) c.waDeclined.push(h);
  return true;
}
export function noteOutbound(c, phone, text, at, id) {
  ensure(c);
  addToThread(c, phone, { dir: 'out', text: clean(text, 1000), at: at || new Date().toISOString(), id: clean(id, 80) });
}
// What the Front Desk shows: open cards, and the latest message of each known contact.
export function inboxView(c) {
  ensure(c);
  const threads = Object.entries(c.waThreads).map(([phone, msgs]) => {
    const k = knownContact(c, phone);
    const lastIn = [...msgs].reverse().find((m) => m.dir === 'in');
    const last = msgs[msgs.length - 1] || {};
    return { phone, name: k ? k.name : '+' + phone, kind: k ? k.kind : '', contactId: k ? k.id : null, last: last.text || '', lastDir: last.dir || '', at: last.at || '', unanswered: !!(lastIn && last.dir === 'in'), messages: msgs.slice(-10) };
  }).sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)).slice(0, 25);
  return { triage: [...c.waTriage].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)), threads, declined: c.waDeclined.length };
}
