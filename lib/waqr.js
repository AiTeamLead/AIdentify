// WhatsApp QR (Baileys) — the free, default way for a business to connect its own WhatsApp number.
// - The owner's own chat (message yourself) talks to Chief.
// - A customer's 1:1 message goes to the Front Desk inbox: known people to their thread, unknown numbers to an
//   Accept / Decline card (lib/wa-triage.js).
// - Outbound to a customer only after the owner approved that exact message, one person at a time, under a hard
//   send cap. Never groups, never broadcasts. Bulk marketing goes through the official API (lib/clinic-whatsapp.js).
// On by default on a server that stays running. WHATSAPP_QR=off turns it off. A serverless host (Vercel) never opens a socket.
// Sessions are encrypted in the account's channel credentials. Nothing here is written to the log.
import QRCode from 'qrcode';
import pino from 'pino';
import { redactSecrets } from './channels.js';

export const WAQR_LIMITS = { perHour: 20, perDay: 100, gapMs: 4000 };
export const WAQR_WARNING = 'Free and unofficial: this links your WhatsApp the same way WhatsApp Web does. It is not the paid Meta WhatsApp Cloud API. WhatsApp can restrict a number that sends too much, so AIdentify only sends messages you approve, one person at a time, at most ' + WAQR_LIMITS.perHour + ' an hour and ' + WAQR_LIMITS.perDay + ' a day. It never sends to groups and never broadcasts. For bulk marketing use the official API. It needs a server that stays running, so it does not run on Vercel or other serverless hosts.';

const sessions = new Map();
const silent = pino({ level: 'silent' });
let ownerHandler = null;
let customerHandler = null;
const sendLog = new Map(); // email -> timestamps of customer sends (the cap)

export function setWaqrOwnerHandler(fn) { ownerHandler = fn; }
export function setWaqrCustomerHandler(fn) { customerHandler = fn; }

export function waqrRuntime() {
  const enabled = !['0', 'off', 'false', 'no'].includes(String(process.env.WHATSAPP_QR || 'on').toLowerCase());
  const serverless = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
  return {
    enabled, beta: true, persistent: !serverless, available: enabled && !serverless,
    warning: WAQR_WARNING,
    reason: !enabled ? 'flag_off' : serverless ? 'serverless' : '',
  };
}

const digits = (s) => String(s || '').replace(/\D/g, '');

export function waqrMaySend(to, owner) {
  const dest = String(to || '');
  if (/@g\.us|broadcast/i.test(dest)) return false;
  const a = digits(dest), b = digits(owner);
  return !!b && !!a && a === b;
}

// A customer may be messaged only 1:1 on a normal phone number. Groups and broadcast lists never.
export function waqrMaySendCustomer(to) {
  const dest = String(to || '');
  if (/@g\.us|broadcast|@newsletter/i.test(dest)) return false;
  const d = digits(dest);
  return d.length >= 10 && d.length <= 15;
}
// The owner's own chat goes to Chief. Any other 1:1 sender is a customer (Front Desk inbox). Groups are dropped.
export function routeWaqrSender(from, owner) {
  if (waqrMaySend(from, owner)) return 'chief';
  if (waqrMaySendCustomer(from)) return 'customer';
  return 'drop';
}
// The send cap: per account, rolling hour and day. Returns '' when a send is allowed, or the reason it is not.
export function waqrQuota(email, now = Date.now()) {
  const list = (sendLog.get(email) || []).filter((t) => now - t < 864e5);
  sendLog.set(email, list);
  if (list.filter((t) => now - t < 36e5).length >= WAQR_LIMITS.perHour) return 'WhatsApp send limit reached: ' + WAQR_LIMITS.perHour + ' messages an hour protects your number. It sends again within the hour.';
  if (list.length >= WAQR_LIMITS.perDay) return 'WhatsApp send limit reached: ' + WAQR_LIMITS.perDay + ' messages a day protects your number. Use the official API for bulk messages.';
  return '';
}
function noteSend(email, now = Date.now()) { const l = sendLog.get(email) || []; l.push(now); sendLog.set(email, l); }
export function waqrLinked(email) { const live = sessions.get(email); return !!(live && live.status === 'linked' && (live.sock || live.mock)); }
// Tests and demos (CHANNELS_MOCK=on): mark a number as linked without opening a socket.
export function markMockLinked(email, owner) { sessions.set(email, { gen: Date.now(), sock: null, mock: true, qr: '', status: 'linked', owner: digits(owner), sent: new Set(), echo: new Set(), saveCreds: async () => {} }); }
// Send one approved message to one customer. The caller has already checked approval and opt-out.
export async function sendToCustomer(email, to, text) {
  const live = sessions.get(email);
  if (!live || live.status !== 'linked' || (!live.sock && !live.mock)) throw fail(400, 'not_connected', 'Your WhatsApp is not linked on this server right now. Nothing was sent. Reconnect it in Settings › Integrations.');
  if (!waqrMaySendCustomer(to)) throw fail(400, 'no_groups', 'WhatsApp by QR sends only to one person’s number. Groups and broadcasts are not allowed.');
  const why = waqrQuota(email); if (why) throw fail(429, 'wa_limit', why);
  const body = String(text || '').trim().slice(0, 3500);
  if (!body) throw fail(400, 'empty', 'The message is empty.');
  const last = (sendLog.get(email) || []).at(-1) || 0;
  const wait = WAQR_LIMITS.gapMs - (Date.now() - last);
  if (wait > 0 && !live.mock) await new Promise((r) => setTimeout(r, wait)); // spaced out, never a burst
  let id;
  if (live.mock) id = 'qr.mock' + Buffer.from(digits(to) + ':' + body).toString('base64url').slice(0, 16);
  else {
    const sent = await live.sock.sendMessage(digits(to) + '@s.whatsapp.net', { text: body });
    id = sent && sent.key && sent.key.id;
    if (!id) throw fail(502, 'wa_failed', 'WhatsApp did not confirm the message. It may not have been sent.');
    live.sent.add(id);
  }
  noteSend(email);
  return { sent: true, id: String(id), provider: 'qr' };
}

function fail(status, code, message) {
  const e = new Error(message);
  e.status = status; e.code = code; return e;
}

export function assertWaqrAvailable() {
  const rt = waqrRuntime();
  if (!rt.enabled) throw fail(403, 'waqr_off', 'WhatsApp QR is turned off on this server (WHATSAPP_QR=off). ' + WAQR_WARNING);
  if (!rt.persistent) throw fail(503, 'waqr_serverless', 'WhatsApp QR needs a persistent server. It does not run on Vercel or other serverless hosts. ' + WAQR_WARNING);
  return rt;
}

export async function attachWaqrHint(hint, email) {
  const out = { ...(hint || {}), beta: true, warning: (hint && hint.warning) || WAQR_WARNING, limits: WAQR_LIMITS };
  delete out.session;
  const live = sessions.get(email);
  if (live && live.qr) {
    out.status = 'qr';
    try { out.qr_image = await QRCode.toDataURL(live.qr, { margin: 1, width: 260 }); }
    catch { /* the owner can refresh; the QR string itself is not logged */ }
  } else if (live && live.status) out.status = live.status;
  return out;
}

async function saveWaqr(st, email, secret, patch) {
  const { withCreds } = await import('./channels.js');
  return withCreds(st, email, secret, async ({ creds, idx }) => {
    const prev = { ...(creds.waqr || {}) };
    const waqr = { ...prev, ...patch };
    if (patch.session === null) delete waqr.session;
    const next = { ...creds, waqr };
    const linked = !!waqr.owner_phone;
    return { creds: next, idx: { ...idx, waqr: linked }, public: { linked, hint: waqr.owner_phone ? String(waqr.owner_phone).slice(-4) : '' } };
  });
}

function messageText(m) {
  const msg = m && m.message;
  if (!msg) return '';
  if (typeof msg.conversation === 'string') return msg.conversation;
  if (msg.extendedTextMessage && typeof msg.extendedTextMessage.text === 'string') return msg.extendedTextMessage.text;
  return '';
}

async function loadAuth(st, email, secret, baileys) {
  const { loadChannelCreds } = await import('./channels.js');
  const creds = await loadChannelCreds(st, email, secret);
  const raw = creds && creds.waqr && typeof creds.waqr.session === 'string' ? creds.waqr.session : '';
  let stored = null;
  if (raw) { try { stored = JSON.parse(raw, baileys.BufferJSON.reviver); } catch { stored = null; } }
  const state = {
    creds: (stored && stored.creds) || baileys.initAuthCreds(),
    keys: (stored && stored.keys) || {},
  };
  const persist = async () => {
    const session = JSON.stringify({ creds: state.creds, keys: state.keys }, baileys.BufferJSON.replacer);
    await saveWaqr(st, email, secret, { session });
  };
  return {
    state: {
      creds: state.creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = state.keys[type + ':' + id];
            if (type === 'app-state-sync-key' && value) {
              try { value = baileys.proto.Message.AppStateSyncKeyData.fromObject(value); } catch { /* keep the stored value */ }
            }
            if (value) data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          for (const category of Object.keys(data || {})) {
            for (const id of Object.keys(data[category] || {})) {
              const value = data[category][id];
              const key = category + ':' + id;
              if (value) state.keys[key] = value;
              else delete state.keys[key];
            }
          }
          await persist();
        },
      },
    },
    saveCreds: persist,
  };
}

export async function sendToLinkedOwner(email, text) {
  const live = sessions.get(email);
  if (!live || !live.sock || !live.owner) {
    const e = new Error('WhatsApp QR is not linked on this server. Nothing was sent.');
    e.status = 400; e.code = 'not_connected'; throw e;
  }
  if (!waqrMaySend(live.owner, live.owner)) throw fail(400, 'owner_only', 'WhatsApp QR can only message the linked owner.');
  const jid = digits(live.owner) + '@s.whatsapp.net';
  const sent = await live.sock.sendMessage(jid, { text: String(text || '').slice(0, 3500) });
  const id = sent && sent.key && sent.key.id;
  if (id) live.sent.add(id);
  live.echo.add(String(text || '').slice(0, 500));
  if (live.echo.size > 30) live.echo.delete(live.echo.values().next().value);
  return { id: id || 'sent' };
}

function watchSocket(sock, live, st, email, secret) {
  sock.ev.on('creds.update', () => { live.saveCreds().catch((e) => console.error('WhatsApp QR: session save failed', redactSecrets(e && e.message))); });
  sock.ev.on('connection.update', (update) => {
    const qr = update && update.qr, connection = update && update.connection;
    if (qr && live.gen === sessions.get(email)?.gen) { live.qr = qr; live.status = 'qr'; }
    if (connection === 'open') {
      live.qr = '';
      live.status = 'linked';
      live.tries = 0;
      const jid = (sock.user && sock.user.id) || '';
      const owner = digits(String(jid).split('@')[0].split(':')[0]);
      if (owner) {
        live.owner = owner;
        saveWaqr(st, email, secret, { owner_phone: owner, status: 'linked' }).catch((e) => console.error('WhatsApp QR: could not store the linked number', redactSecrets(e && e.message)));
      }
      console.log('WhatsApp QR: owner linked');
    }
    if (connection === 'close') {
      live.status = 'closed';
      const code = update.lastDisconnect && update.lastDisconnect.error && update.lastDisconnect.error.output && update.lastDisconnect.error.output.statusCode;
      console.log('WhatsApp QR: connection closed (' + (code || 'unknown') + ')');
      if (sessions.get(email) !== live) return;
      sessions.delete(email);
      if (code === 401) { // logged out from the phone: forget the session, the owner scans again
        stopWaqr(st, email, secret, { wipe: true }).catch(() => {});
        return;
      }
      if (live.stopped) return;
      // anything else (network, server restart on WhatsApp's side): reconnect with backoff, up to 10 tries
      const tries = (live.tries || 0) + 1;
      if (tries > 10) { console.log('WhatsApp QR: gave up reconnecting after 10 tries'); return; }
      const delay = Math.min(60000, 3000 * 2 ** (tries - 1));
      setTimeout(() => { if (!sessions.has(email)) startWaqr(st, email, secret, { tries }).catch((e) => console.error('WhatsApp QR: reconnect failed', redactSecrets(e && e.message))); }, delay).unref?.();
    }
  });
  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const m of messages || []) {
      if (!m || !m.key) continue;
      if (live.sent.has(m.key.id)) continue;
      const jid = String(m.key.remoteJid || '');
      if (/@g\.us|broadcast/i.test(jid)) { console.log('WhatsApp QR: ignored a group or broadcast'); continue; }
      const from = digits(jid.split('@')[0].split(':')[0]);
      const owner = digits(live.owner);
      if (m.key.fromMe && from !== owner) continue; // the owner typing to a customer from the phone
      if (!owner || from !== owner) {
        const text = String(messageText(m) || '').trim();
        if (!text || typeof customerHandler !== 'function' || !/@s\.whatsapp\.net$/.test(jid)) continue;
        customerHandler({ st, email, secret, from, name: String(m.pushName || ''), text, id: String(m.key.id || '') }).catch((e) => console.error('WhatsApp QR: customer message not filed', redactSecrets(e && e.message)));
        continue;
      }
      const text = String(messageText(m) || '').trim();
      if (!text || live.echo.has(text)) continue;
      if (typeof ownerHandler !== 'function') continue;
      ownerHandler({ st, email, secret, from, text, id: String(m.key.id || '') }).catch((e) => console.error('WhatsApp QR: chief reply failed', redactSecrets(e && e.message)));
    }
  });
}

export async function startWaqr(st, email, secret, { tries = 0 } = {}) {
  assertWaqrAvailable();
  const existing = sessions.get(email);
  if (existing && (existing.status === 'qr' || existing.status === 'linked' || existing.status === 'starting')) {
    return { status: existing.status, linked: existing.status === 'linked', beta: true, warning: WAQR_WARNING };
  }
  let baileys;
  try { baileys = await import('@whiskeysockets/baileys'); }
  catch (e) {
    console.error('WhatsApp QR: connector unavailable', redactSecrets(e && e.message));
    throw fail(503, 'waqr_unavailable', 'WhatsApp QR could not start on this server. ' + WAQR_WARNING);
  }
  const makeWASocket = baileys.default;
  const auth = await loadAuth(st, email, secret, baileys);
  const live = { gen: Date.now(), sock: null, qr: '', status: 'starting', owner: '', sent: new Set(), echo: new Set(), saveCreds: auth.saveCreds, tries };
  const { loadChannelCreds } = await import('./channels.js');
  const creds = await loadChannelCreds(st, email, secret);
  if (creds && creds.waqr && creds.waqr.owner_phone) live.owner = digits(creds.waqr.owner_phone);
  sessions.set(email, live);
  try {
    const sock = makeWASocket({
      auth: auth.state,
      logger: silent,
      printQRInTerminal: false,
      browser: baileys.Browsers.ubuntu('AaaS'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    live.sock = sock;
    watchSocket(sock, live, st, email, secret);
  } catch (e) {
    sessions.delete(email);
    console.error('WhatsApp QR: connector unavailable', redactSecrets(e && e.message));
    throw fail(503, 'waqr_unavailable', 'WhatsApp QR could not start on this server. ' + WAQR_WARNING);
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && live.status === 'starting') await new Promise((r) => setTimeout(r, 200));
  return { status: live.status, linked: live.status === 'linked', beta: true, warning: WAQR_WARNING };
}

export async function stopWaqr(st, email, secret, { wipe = true } = {}) {
  const live = sessions.get(email);
  if (live) {
    live.stopped = true;
    sessions.delete(email);
    try { live.sock && live.sock.end(undefined); } catch { /* already closed */ }
  }
  if (wipe && st && email && secret) {
    const { withCreds } = await import('./channels.js');
    await withCreds(st, email, secret, async ({ creds, idx }) => {
      const next = { ...creds };
      delete next.waqr;
      const i = { ...idx };
      delete i.waqr;
      return { creds: next, idx: i, public: { ok: true } };
    });
  }
  return { ok: true };
}

export async function stopAllWaqr() {
  for (const email of [...sessions.keys()]) {
    const live = sessions.get(email);
    sessions.delete(email);
    try { live && live.sock && live.sock.end(undefined); } catch { /* shutting down */ }
  }
}

export async function resumeLinkedSessions(st, secret) {
  const rt = waqrRuntime();
  if (!rt.available || !st) return { skipped: rt.reason || 'off' };
  let rows = [];
  try { rows = typeof st.listPrefix === 'function' ? await st.listPrefix('as_chidx:') : []; }
  catch (e) { console.error('WhatsApp QR: could not look for linked owners', redactSecrets(e && e.message)); return { skipped: 'list' }; }
  let n = 0;
  for (const row of rows) {
    let idx = null;
    try { idx = JSON.parse(row.v); } catch { idx = null; }
    if (!idx || !idx.waqr) continue;
    const email = String(row.k || '').slice('as_chidx:'.length);
    if (!email) continue;
    try { await startWaqr(st, email, secret); n++; }
    catch (e) { console.error('WhatsApp QR: could not resume a linked owner', redactSecrets(e && e.message)); }
  }
  return { resumed: n };
}
