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

export function locationSummary(cities) {
  const list = [];
  for (const c of cities) {
    const v = tidy(c);
    if (v && !list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v);
  }
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  return list[0] + ' +' + (list.length - 1);
}

export function normalizeLocations(raw, opts = {}) {
  const rows = Array.isArray(raw) ? raw : [];
  if (rows.length > LIMITS.locations) return { ok: false, error: 'Pick a valid city or area from the list.' };
  const locations = [];
  for (const row of rows) {
    const city = validateLocation(typeof row === 'string' ? row : row && row.city, opts);
    if (!city.ok) return city;
    const branches = [];
    for (const b of (row && row.branches) || []) {
      const name = tidy(b && b.name);
      const area = tidy(b && b.area);
      if (name && !LETTER.test(name)) return { ok: false, error: 'Enter a valid branch name.' };
      let phone = '';
      if (b && tidy(b.phone)) {
        const p = validatePhone(b.phone);
        if (!p.ok) return p;
        phone = p.value;
      }
      if (name || area || phone) branches.push({ name: name.slice(0, 60), area: area.slice(0, 60), phone });
    }
    const prev = locations.find((l) => l.city.toLowerCase() === city.value.toLowerCase());
    if (prev) prev.branches.push(...branches);
    else locations.push({ city: city.value, branches });
  }
  const cities = locations.map((l) => l.city);
  return { ok: true, locations, city: cities[0] || '', summary: locationSummary(cities) };
}

export function parseBranchCsv(text, opts = {}) {
  const grouped = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.split(',').map((s) => s.trim());
    if (!parts.filter(Boolean).length) continue;
    const [city, name, area, phone] = parts;
    grouped.push({ city, branches: name || area || phone ? [{ name, area, phone }] : [] });
  }
  return normalizeLocations(grouped, opts);
}

const OFFER_TEMPLATES = {
  marketing: [
    { title: 'Free 30-minute audit call', type: 'flat', value: 0, validityDays: 30, services: [] },
    { title: '10% off the first month', type: 'percent', value: 10, validityDays: 30, services: [] },
  ],
  dental: [
    { title: '10% off first visit', type: 'percent', value: 10, validityDays: 30, services: ['Check-up'] },
    { title: 'Refer a friend – ₹500 off', type: 'flat', value: 500, validityDays: 60, services: [] },
  ],
  aesthetic: [
    { title: '10% off first consult', type: 'percent', value: 10, validityDays: 30, services: [] },
    { title: 'Refer a friend – ₹500 off', type: 'flat', value: 500, validityDays: 60, services: [] },
  ],
};

export function offerTemplates(industry) {
  return (OFFER_TEMPLATES[industry] || OFFER_TEMPLATES.dental).map((o, i) => ({ ...o, id: industry + '-' + (i + 1) }));
}

export function normalizeOffers(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const offers = [];
  for (const row of list.slice(0, 20)) {
    const title = tidy(row && row.title);
    const type = row && row.type === 'flat' ? 'flat' : row && row.type === 'percent' ? 'percent' : '';
    const value = Number(row && row.value);
    if (!title || !LETTER.test(title) || !type || !Number.isFinite(value) || value < 0) {
      return { ok: false, error: 'Enter a valid offer.' };
    }
    if (type === 'percent' && value > 100) return { ok: false, error: 'Enter a valid offer.' };
    offers.push({
      id: tidy(row.id || '').slice(0, 40) || 'offer-' + (offers.length + 1),
      title: title.slice(0, 80),
      type,
      value,
      validityDays: Math.max(0, Math.min(365, Number(row.validityDays) || 30)),
      services: Array.isArray(row.services) ? row.services.map(tidy).filter(Boolean).slice(0, 20) : [],
    });
  }
  return { ok: true, offers };
}

const AUDIENCE_SEEDS = {
  marketing: ['Local business owners', 'Founders who want a steady pipeline', 'Clinics that need more bookings', 'Coaches selling a retainer', 'Shops within 5 km', 'Agencies looking for a white-label partner'],
  dental: ['Families within 5 km', 'Parents booking a first visit', 'Adults due for a cleaning', 'People comparing clinics nearby', 'Patients who skipped a recall'],
  default: ['Families nearby', 'Working professionals', 'Students', 'People within 5 km', 'Customers who have not visited in 6 months'],
};

export function predictAudiences({ industry, services } = {}) {
  const base = AUDIENCE_SEEDS[industry] || AUDIENCE_SEEDS.default;
  const extra = String(services || '').split(',').map(tidy).filter((s) => LETTER.test(s)).slice(0, 2)
    .map((s) => 'People looking for ' + s.toLowerCase());
  const all = [];
  for (const a of [...base, ...extra]) {
    const v = validateAudience(a);
    if (v.ok && !all.some((x) => x.toLowerCase() === v.value.toLowerCase())) all.push(v.value);
  }
  const audiences = all.slice(0, 8);
  return { audiences, selected: audiences.slice(0, 3), source: 'rules' };
}
