// One field-rule module for onboarding. The clinic page imports this file in the browser.
// The API imports it too and rejects anything the page accepted by mistake.
const LETTER = /\p{L}/u;
const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_CHARS = /^[\p{L}\p{N}&. ,'\-()]+$/u;

export const LIMITS = { name: 60, service: 40, audience: 60, services: 20, audiences: 10, locations: 100 };

export function tidy(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function validateBusinessName(value) {
  const v = tidy(value);
  if (v.length < 2 || v.length > LIMITS.name || !LETTER.test(v) || EMAILISH.test(v) || !NAME_CHARS.test(v)) {
    return { ok: false, error: 'Enter a valid business name (2–60 characters, must include letters).' };
  }
  return { ok: true, value: v };
}

export function validateService(value) {
  const v = tidy(value);
  if (v.length < 2 || v.length > LIMITS.service || !LETTER.test(v) || EMAILISH.test(v)) {
    return { ok: false, error: 'Enter a valid service name.' };
  }
  return { ok: true, value: v };
}

export function validateAudience(value) {
  const v = tidy(value);
  if (v.length < 2 || v.length > LIMITS.audience || !LETTER.test(v) || EMAILISH.test(v)) {
    return { ok: false, error: 'Describe a valid target audience.' };
  }
  return { ok: true, value: v };
}

const CITIES = ['Hyderabad', 'Bengaluru', 'Mumbai', 'Delhi', 'Chennai', 'Pune', 'Kolkata', 'Ahmedabad'];

export function validateLocation(value, { places = [], cities = CITIES } = {}) {
  const v = tidy(value);
  if (!v || !LETTER.test(v) || EMAILISH.test(v) || /^\d+$/.test(v)) {
    return { ok: false, error: 'Pick a valid city or area from the list.' };
  }
  const known = [...cities, ...places].some((c) => tidy(c).toLowerCase() === v.toLowerCase());
  if (!known) return { ok: false, error: 'Pick a valid city or area from the list.' };
  const canonical = [...cities, ...places].find((c) => tidy(c).toLowerCase() === v.toLowerCase()) || v;
  return { ok: true, value: tidy(canonical) };
}

export function addChip(list, value, kind, max) {
  const check = kind === 'service' ? validateService(value) : validateAudience(value);
  if (!check.ok) return { ok: false, error: check.error, list: list.slice() };
  const next = list.slice();
  if (next.some((x) => tidy(x).toLowerCase() === check.value.toLowerCase())) {
    return { ok: false, error: kind === 'service' ? 'Already added.' : 'Describe a valid target audience.', list: next };
  }
  if (next.length >= max) return { ok: false, error: kind === 'service' ? 'Enter a valid service name.' : 'Describe a valid target audience.', list: next };
  next.push(check.value);
  return { ok: true, value: check.value, list: next };
}

// Default region IN. Accepts +91XXXXXXXXXX, 91XXXXXXXXXX, 0XXXXXXXXXX and a 10-digit mobile.
export function validatePhone(value, region = 'IN') {
  const raw = String(value ?? '').trim();
  if (EMAILISH.test(raw) || /[a-z]/i.test(raw.replace(/^\+/, ''))) {
    return { ok: false, error: 'Enter a valid phone number.' };
  }
  let d = raw.replace(/[^\d+]/g, '');
  if (region === 'IN') {
    if (d.startsWith('+')) d = d.slice(1);
    if (d.startsWith('0') && d.length === 11) d = '91' + d.slice(1);
    if (d.length === 10) d = '91' + d;
    if (!/^91[6-9]\d{9}$/.test(d)) return { ok: false, error: 'Enter a valid phone number.' };
    return { ok: true, value: '+' + d };
  }
  if (!/^\+?[1-9]\d{7,14}$/.test(raw.replace(/[^\d+]/g, ''))) return { ok: false, error: 'Enter a valid phone number.' };
  const n = raw.replace(/[^\d]/g, '');
  return { ok: true, value: '+' + n };
}

export function validateEmail(value) {
  const v = tidy(value).toLowerCase();
  if (!EMAILISH.test(v) || v.length > 254) return { ok: false, error: 'Enter a valid email.' };
  return { ok: true, value: v };
}

export const SUGGESTED_CITIES = CITIES;
