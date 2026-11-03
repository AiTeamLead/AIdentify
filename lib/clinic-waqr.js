// Clinic WhatsApp over a QR link (Baileys). Inbound messages become CRM notes and agent drafts.
// Outbound waits for an approval. Groups, broadcasts and cold blasts are refused.
// The socket itself lives in lib/waqr.js and only on a long-running worker, not on Vercel.
import crypto from 'node:crypto';

export const CLINIC_WAQR_WARNING = 'Unofficial WhatsApp link. This is not the Meta Cloud API. WhatsApp can restrict or ban this number. Messages to customers go out only after you approve each one. Bulk and cold broadcasts are blocked. The QR session needs a small worker that stays running. Vercel cannot hold that socket. The official Cloud API remains an optional upgrade when CLINIC_WA_PROVIDER is set.';

const digits = (s) => String(s || '').replace(/\D/g, '');
const hits = new Map();

export function routeClinicQr({ from, owner, broadcast = false }) {
  if (broadcast || /@g\.us|broadcast/i.test(String(from || ''))) return 'drop';
  const a = digits(from), b = digits(owner);
  if (!a) return 'drop';
  if (b && a === b) return 'chief';
  return 'agent';
}

export function waqrOutboundAllowed({ to, approved = false, count = 1 }) {
  const dest = String(to || '');
  if (/@g\.us|broadcast/i.test(dest)) return { ok: false, reason: 'broadcast' };
  if (!digits(dest)) return { ok: false, reason: 'no_destination' };
  if (count > 1) return { ok: false, reason: 'bulk' };
  if (!approved) return { ok: false, reason: 'needs_approval' };
  return { ok: true, reason: 'approved' };
}

export function humanDelayMs(rand = Math.random) {
  const n = Number(rand());
  const x = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
  return 800 + Math.round(x * 3700);
}

export function waqrRateOk(owner, now = Date.now(), limit = 20) {
  const key = digits(owner) || 'none';
  const list = (hits.get(key) || []).filter((t) => now - t < 60 * 60e3);
  if (list.length >= limit) return false;
  list.push(now);
  hits.set(key, list);
  return true;
}

export function qrSessionPlan({ enabled, serverless, linked, status }) {
  if (!enabled) return { run: false, reason: 'flag_off' };
  if (serverless) return { run: false, reason: 'serverless', hint: 'Run worker.js or the Docker worker. Vercel cannot keep the WhatsApp socket.' };
  if (status === 'needs_rescan' || status === 'logged_out') return { run: true, reason: 'rescan' };
  return { run: true, reason: linked ? 'linked' : 'show_qr' };
}

export async function clinicWaqrRoutes({ method, pathname, json, st, email, HttpError }) {
  if (!pathname.startsWith('/api/clinic/waqr')) return undefined;
  if (pathname === '/api/clinic/waqr' && method === 'GET') {
    const { waqrRuntime } = await import('./waqr.js');
    const rt = waqrRuntime();
    return {
      warning: CLINIC_WAQR_WARNING,
      officialUpgrade: !!(process.env.CLINIC_WA_PROVIDER && process.env.CLINIC_WA_PROVIDER !== 'off'),
      ...qrSessionPlan({ enabled: rt.enabled, serverless: !rt.persistent, linked: false, status: rt.reason === 'serverless' ? 'serverless' : '' }),
      worker: 'node worker.js',
    };
  }
  if (pathname === '/api/clinic/waqr/inbound' && method === 'POST') {
    const b = json() || {};
    const route = routeClinicQr({ from: b.from, owner: b.owner, broadcast: !!b.broadcast });
    if (route === 'drop') return { route, stored: false };
    if (route === 'agent') {
      const { ingestEnquiry } = await import('./crm.js');
      const contact = await ingestEnquiry(st, email, { name: b.name || 'WhatsApp', phone: b.from, note: b.body, source: 'WhatsApp', channel: 'whatsapp' });
      return { route, stored: !!contact, contactId: contact && contact.id, sent: false };
    }
    return { route, stored: false, sent: false };
  }
  if (pathname === '/api/clinic/waqr/send' && method === 'POST') {
    const b = json() || {};
    const gate = waqrOutboundAllowed({ to: b.to, approved: b.approved === true, count: Number(b.count) || 1 });
    if (!gate.ok) throw new HttpError(400, gate.reason, gate.reason === 'needs_approval' ? 'Approve the draft before it can be sent.' : 'WhatsApp QR will not send a broadcast or a bulk list.');
    if (!waqrRateOk(b.owner || email)) throw new HttpError(429, 'rate_limited', 'This number has sent enough messages for now.');
    return { ok: true, delayedMs: humanDelayMs(), sent: false, reason: 'queued_for_worker' };
  }
  throw new HttpError(404, 'not_found');
}

export function newHookSecret() { return crypto.randomBytes(24).toString('base64url'); }
