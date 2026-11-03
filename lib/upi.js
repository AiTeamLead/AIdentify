// AaaS plan payment is UPI only. The owner scans a QR and messages us. An admin marks the account active.
// Defaults are the owner’s PhonePe ID. Env overrides them. Razorpay is not used for these plans.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_UPI_ID = '6302381884-w772@ibl';
export const DEFAULT_UPI_NAME = 'MALLADI PHANINDRA';
export const DEFAULT_PHONE_DISPLAY = '+91 63023 81884';
export const DEFAULT_PHONE_DIGITS = '916302381884';
export const DEFAULT_QR_PATH = '/assets/upi-qr.png';

function readEnv(src, k, d = '') {
  const v = src[k];
  return v == null || String(v).trim() === '' ? d : String(v).trim();
}

export function upiPublic(src = process.env) {
  const id = readEnv(src, 'UPI_ID', DEFAULT_UPI_ID);
  const name = readEnv(src, 'UPI_PAYEE', DEFAULT_UPI_NAME);
  const phone = readEnv(src, 'ONBOARD_WHATSAPP', DEFAULT_PHONE_DIGITS).replace(/\D/g, '') || DEFAULT_PHONE_DIGITS;
  const display = readEnv(src, 'ONBOARD_PHONE_DISPLAY', DEFAULT_PHONE_DISPLAY);
  const email = readEnv(src, 'ONBOARD_EMAIL', '');
  const qr = readEnv(src, 'UPI_QR_PATH', DEFAULT_QR_PATH);
  const pa = encodeURIComponent(id);
  const pn = encodeURIComponent(name);
  return {
    provider: 'upi',
    razorpay: false,
    upiId: id,
    payee: name,
    qr,
    link: 'upi://pay?pa=' + pa + '&pn=' + pn + '&cu=INR',
    phone,
    phoneDisplay: display,
    whatsapp: 'https://wa.me/' + phone + '?text=' + encodeURIComponent('I have paid for AaaS. Please onboard this account.'),
    email,
    paidNote: 'I have paid. Message us on WhatsApp or email and we will mark the account active.',
    plansNote: 'Self-hosted is ₹2,999 a month plus ₹9,999 setup, waived on an annual plan. Hosted is ₹4,999 a month. Pay by UPI. AaaS does not take a card.',
  };
}

export function upiQrFile() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.join(here, '..');
  const rel = upiPublic().qr.replace(/^\//, '');
  const candidates = [path.join(root, 'assets', 'upi-qr.png'), path.join(root, rel), path.join(root, 'public', rel)];
  return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || candidates[0];
}

const subKey = (email) => 'as_sub:' + String(email || '').toLowerCase();
export async function subscriptionOf(st, email) {
  const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };
  return parse((await st.get(subKey(email)))?.v) || { status: 'trial', plan: '', at: 0 };
}
export async function markSubscription(st, email, { plan, by, note }) {
  const row = { status: 'active', plan: plan === 'hosted' ? 'hosted' : 'self', at: Date.now(), by: String(by || '').slice(0, 120), note: String(note || '').slice(0, 300), via: 'upi' };
  await st.put(subKey(email), JSON.stringify(row), Date.now());
  return row;
}
