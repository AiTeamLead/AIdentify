// Lead workflow for every industry. One engine, one set of rules; each industry brings its own words, its own
// requirement questions and its own catalogue (the owner's flowcharts, one per industry).
//
//   Enquiry -> existing customer? (update, never duplicate) -> collect requirements -> complete? (no: ask for what
//   is missing) -> search the catalogue -> match? (no: ask to adjust) -> rank -> lead score -> Hot / Warm / Cold ->
//   send details (WhatsApp only with consent) -> interested? -> book the meeting: slot free? (no: offer other
//   slots) -> confirm + notify the right person -> meeting -> feedback -> ready? -> human handoff -> agreement ->
//   confirmed? -> won -> reports.
//
// Changes agreed with the owner (they apply to every industry):
//   1. The score decides timing: Hot = same day, Warm = every 3 days, Cold = monthly.
//   2. Follow-ups stop: 3 unanswered -> Cold nurture. A lead can close as Lost with a reason.
//   3. The meeting gets a reminder the day before, and a "did not come" branch that offers a new slot.
//   4. Won continues into invoice -> payment -> review -> referral (the app's existing steps).
//   5. Opt-out: once a customer says stop, nothing more is drafted for them.
//
// Everything here is plain data in, plain data out. Messages are returned as drafts; the caller queues them for
// the owner's approval. Nothing in this file sends anything.

import { otherWords } from './clinic-packs.js';

const T_BUY = [['immediate', 'Immediately'], ['1-3', 'In 1–3 months'], ['3-6', 'In 3–6 months'], ['6+', 'After 6 months']];
const T_START = [['immediate', 'This week'], ['1-3', 'This month'], ['3-6', 'In 2–3 months'], ['6+', 'Later / just asking']];
const g = (o) => ({ kind: 'generic', group: 'Category', groupPh: '', timelines: T_START, timelineLabel: 'When they want to start', timelineMissing: 'when they want to start', markSold: false, amount: 'Agreed amount (₹)', ...o });
// Words per industry. `meet` is the meeting the lead is invited to; `conduct` is what happens in it.
export const FLOWS = {
  realestate: { kind: 're', person: 'buyer', existing: 'customer', item: 'property', items: 'properties', group: 'Area / locality', timelines: T_BUY, timelineLabel: 'When they want to buy', timelineMissing: 'when they want to buy',
    channels: ['Website', 'WhatsApp', 'Facebook', 'Instagram', 'LinkedIn', 'Phone', 'Walk-in', 'Referral'], meet: 'site visit', conduct: 'site visit', notify: 'sales representative', send: 'shortlist', sendTitle: 'Property shortlist',
    handoffTitle: 'Sales handoff', handoffWho: 'your sales team', handoffNext: 'negotiation and documentation', handoffHead: 'With your sales team: negotiation and documents', closeYes: 'Sale confirmed: Closed Won', won: 'Closed Won', amount: 'Agreed sale amount (₹)', markSold: true,
    adjust: 'budget or location', thanks: 'congratulations on your new home', invoice: 'Create booking-amount invoice', stageNegotiation: 'With sales team', itemEx: 'Sunrise Towers 3BHK', groupEx: 'Gachibowli', priceEx: '8500000' },
  marketing: g({ person: 'client', existing: 'client', item: 'package', items: 'packages', group: 'Channels covered', groupPh: 'Instagram, Google Ads',
    channels: ['Website', 'WhatsApp', 'LinkedIn', 'Meta Ads', 'Instagram', 'Phone', 'Referral'], need: ['Goals', 'More leads from Instagram and Google'], extra: ['Channels they want', 'Instagram, Google Ads, SEO'], needMissing: 'goals',
    meet: 'discovery call', conduct: 'strategy call', notify: 'account manager', send: 'proposal', sendTitle: 'Proposal and case studies', handoffTitle: 'Sales handoff', handoffWho: 'your sales team', handoffNext: 'negotiation and contract', handoffHead: 'With your sales team: negotiation and contract',
    closeYes: 'Contract signed: Closed Won', won: 'Closed Won', amount: 'Monthly retainer or project value (₹)', adjust: 'scope or budget', thanks: 'welcome aboard', invoice: 'Create first invoice', stageNegotiation: 'With sales team', itemEx: 'Social media management', groupEx: 'Instagram, Facebook', priceEx: '25000' }),
  dental: g({ person: 'patient', existing: 'patient', item: 'treatment', items: 'treatments', group: 'Doctor', groupPh: 'Dr. Rao',
    channels: ['Phone', 'WhatsApp', 'Instagram', 'Google', 'Website', 'Walk-in', 'Referral'], need: ['Treatment needed', 'Root canal, braces, cleaning'], extra: ['Pain or problem', 'Toothache on the lower left for 3 days'], needMissing: 'the treatment they need',
    timelines: [['immediate', 'In pain / this week'], ['1-3', 'This month'], ['3-6', 'In 2–3 months'], ['6+', 'Just asking']], timelineLabel: 'Urgency', timelineMissing: 'how urgent it is',
    meet: 'appointment', conduct: 'consultation', notify: 'front desk', send: 'treatment details', sendTitle: 'Treatment info and price range', handoffTitle: 'Doctor handoff', handoffWho: 'the doctor', handoffNext: 'treatment plan, cost estimate and consent forms', handoffHead: 'With the doctor: treatment plan, cost estimate and consent',
    closeYes: 'Treatment plan accepted: Treatment Started', won: 'Treatment Started', amount: 'Treatment plan amount (₹)', adjust: 'treatment or budget', thanks: 'thank you for choosing us for your treatment', invoice: 'Create invoice', stageNegotiation: 'With the doctor', itemEx: 'Root canal treatment', groupEx: 'Dr. Rao', priceEx: '6000' }),
  aesthetic: g({ person: 'client', existing: 'client', item: 'treatment', items: 'treatments', group: 'Specialist', groupPh: 'Dr. Mehta',
    channels: ['Instagram', 'WhatsApp', 'Website', 'Walk-in', 'Phone', 'Referral'], need: ['Concern and goal', 'Acne scars, clearer skin before a wedding'], extra: ['Downtime they can take', 'No downtime / a weekend'], needMissing: 'their concern and goal',
    meet: 'consultation', conduct: 'consultation and skin analysis', notify: 'clinic coordinator', send: 'treatment options', sendTitle: 'Treatment options and results', handoffTitle: 'Specialist handoff', handoffWho: 'the specialist', handoffNext: 'package proposal, pricing and agreement', handoffHead: 'With the specialist: package proposal and pricing',
    closeYes: 'Package booked: Closed Won', won: 'Closed Won', amount: 'Package amount (₹)', adjust: 'goal or budget', thanks: 'thank you for booking your package with us', invoice: 'Create package invoice', stageNegotiation: 'With the specialist', itemEx: 'Acne scar laser (4 sessions)', groupEx: 'Dr. Mehta', priceEx: '24000' }),
  coach: g({ person: 'client', existing: 'client', item: 'program', items: 'programs', group: 'Format', groupPh: '1:1, 12 weeks',
    channels: ['LinkedIn', 'Instagram', 'Website', 'Referral', 'WhatsApp', 'Phone'], need: ['Goal', 'Move into a leadership role'], extra: ['Biggest challenge', 'No time, unclear next step'], needMissing: 'their goal',
    meet: 'discovery call', conduct: 'discovery call', notify: 'coach', send: 'program details', sendTitle: 'Program details and testimonials', handoffTitle: 'Coach handoff', handoffWho: 'the coach', handoffNext: 'proposal, negotiation and agreement', handoffHead: 'With the coach: proposal and agreement',
    closeYes: 'Agreement signed: Closed Won', won: 'Closed Won', amount: 'Program fee (₹)', adjust: 'goal or budget', thanks: 'welcome to the program', invoice: 'Create program invoice', stageNegotiation: 'With the coach', itemEx: 'Leadership coaching, 12 weeks', groupEx: '1:1 online', priceEx: '45000' }),
  studio: g({ person: 'customer', existing: 'member', item: 'plan', items: 'plans', group: 'Trainer or timing', groupPh: 'Morning batch, Trainer Arjun',
    channels: ['Instagram', 'WhatsApp', 'Walk-in', 'Google', 'Phone', 'Referral'], need: ['Goal', 'Weight loss, yoga, bridal makeup'], extra: ['Preferred schedule', 'Weekday mornings'], needMissing: 'their goal',
    meet: 'trial or visit', conduct: 'trial session or tour', notify: 'front desk', send: 'pricing and offers', sendTitle: 'Pricing and offers', handoffTitle: 'Sales handoff', handoffWho: 'your sales desk', handoffNext: 'membership offer, plan pricing and payment', handoffHead: 'At the sales desk: membership offer and payment',
    closeYes: 'Joined: Member Joined', won: 'Member Joined', amount: 'Plan amount (₹)', adjust: 'plan or budget', thanks: 'welcome to the family', invoice: 'Create membership invoice', stageNegotiation: 'Membership offer', itemEx: 'Gym membership, 3 months', groupEx: 'Morning batch', priceEx: '6000' }),
  home: g({ person: 'client', existing: 'client', item: 'package', items: 'packages', group: 'Style or designer', groupPh: 'Modern, Designer Priya',
    channels: ['Website', 'Instagram', 'Referral', 'Ads', 'WhatsApp', 'Phone'], need: ['Work needed and style', 'Modular kitchen, modern'], extra: ['Home size', '3 BHK, 1450 sq ft'], needMissing: 'the work they need',
    meet: 'site visit', conduct: 'site visit and measurement', notify: 'designer', send: 'portfolio and estimate', sendTitle: 'Portfolio and estimate', handoffTitle: 'Designer handoff', handoffWho: 'the designer', handoffNext: 'quote, negotiation and contract', handoffHead: 'With the designer: quote and contract',
    closeYes: 'Quote confirmed: Advance Paid', won: 'Advance Paid', amount: 'Confirmed quote (₹)', adjust: 'budget or scope', thanks: 'thank you for trusting us with your home', invoice: 'Create advance invoice', stageNegotiation: 'With the designer', itemEx: 'Modular kitchen, modern', groupEx: 'Designer Priya', priceEx: '250000' }),
  institute: g({ person: 'student', existing: 'student', item: 'batch', items: 'batches', group: 'Batch timing', groupPh: 'Evening 6–7 pm',
    channels: ['Website', 'WhatsApp', 'Walk-in', 'Ads', 'Phone', 'Referral'], need: ['Course', 'Maths for class 10'], extra: ['Preferred batch and goals', 'Evening, wants 90% in boards'], needMissing: 'the course they want',
    meet: 'counselling or demo', conduct: 'demo class or counselling', notify: 'counsellor', send: 'brochure and fees', sendTitle: 'Brochure and fee structure', handoffTitle: 'Counsellor handoff', handoffWho: 'the counsellor', handoffNext: 'admission offer, fee discussion and documentation', handoffHead: 'With the counsellor: admission offer and fees',
    closeYes: 'Enrolled', won: 'Enrolled', amount: 'Course fee (₹)', adjust: 'batch or budget', thanks: 'welcome, and all the best for the course', invoice: 'Create fee invoice', stageNegotiation: 'With the counsellor', itemEx: 'Maths class 10, evening batch', groupEx: 'Evening 6–7 pm', priceEx: '18000' }),
};
// "Other" businesses: the same flow in the words of what they said they are (bakery -> order, pet clinic -> appointment…).
function otherFlow(c) {
  const t = String((c.profile && c.profile.businessType) || '').trim(), w = t ? otherWords(t) : {};
  const meet = w.visit || 'visit', one = w.whoSingular || 'customer';
  return g({ person: one, existing: one, item: 'service', items: 'services', group: 'Category', groupPh: '', channels: ['Phone', 'WhatsApp', 'Website', 'Instagram', 'Facebook', 'Walk-in', 'Referral'],
    need: ['What they need', t ? 'What they want from your ' + t.toLowerCase() : 'What they want'], extra: ['Other details', 'Quantity, size, preferences'], needMissing: 'what they need',
    meet, conduct: meet, notify: 'team', send: 'details and prices', sendTitle: 'Details and prices', handoffTitle: 'Team handoff', handoffWho: 'your team', handoffNext: 'final quote and confirmation', handoffHead: 'With your team: final quote and confirmation',
    closeYes: 'Order confirmed: Closed Won', won: 'Closed Won', amount: 'Confirmed amount (₹)', adjust: 'requirement or budget', thanks: 'thank you for choosing us', invoice: 'Create invoice', stageNegotiation: 'With your team', itemEx: 'Your main service', groupEx: '', priceEx: '5000' });
}
export function cfgOf(c) { const r = c && c.role; if (!r || r === 'realestate') return FLOWS.realestate; return FLOWS[r] || otherFlow(c); }
export const hasFlow = (c) => !!(c && c.role);
const capw = (s) => String(s || '').replace(/^./, (x) => x.toUpperCase());
const andList = (a) => a.join(', ').replace(/, ([^,]*)$/, ' and $1');

const DAY = 864e5;
export const STAGES = [
  ['new', 'New enquiry'], ['qualifying', 'Collecting requirements'], ['matched', 'Properties matched'], ['nomatch', 'No match yet'],
  ['recommended', 'Recommendations sent'], ['interested', 'Interested'], ['visit', 'Site visit booked'], ['visited', 'Visit done'],
  ['negotiation', 'With sales team'], ['won', 'Closed Won'], ['nurture', 'Long-term nurturing'], ['lost', 'Lost'],
];
export const STAGE_NAME = Object.fromEntries(STAGES);
export function stagesFor(K) {
  if (K.kind === 're') return STAGES;
  return [['new', 'New enquiry'], ['qualifying', 'Collecting requirements'], ['matched', capw(K.items) + ' matched'], ['nomatch', 'No match yet'], ['recommended', capw(K.send) + ' sent'], ['interested', 'Interested'],
    ['visit', capw(K.meet) + ' booked'], ['visited', capw(K.conduct) + ' done'], ['negotiation', K.stageNegotiation], ['won', K.won], ['nurture', 'Long-term nurturing'], ['lost', 'Lost']];
}
export const OPEN_STAGES = ['new', 'qualifying', 'matched', 'nomatch', 'recommended', 'interested', 'visit', 'visited', 'negotiation', 'nurture'];
export const TIMELINES = [['immediate', 'Immediately'], ['1-3', 'In 1–3 months'], ['3-6', 'In 3–6 months'], ['6+', 'After 6 months']];
export const LOST_REASONS = ['Budget too low', 'Location did not suit', 'Bought elsewhere', 'Not buying now', 'No response', 'Other'];
export const REQUIRED = [['budget', 'budget'], ['locations', 'preferred location'], ['bhk', 'BHK'], ['timeline', 'when they want to buy']];
export const FOLLOW_DAYS = { hot: 0, warm: 3, cold: 30 };
export const MAX_UNANSWERED = 3;
const SLOT_MIN = 60; // a site visit holds the slot for an hour either side

const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[₹,\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };
export const inr = (n) => { const v = Math.round(Number(n) || 0); if (v >= 1e7) return '₹' + (v / 1e7).toFixed(v % 1e7 ? 2 : 0).replace(/\.?0+$/, '') + ' Cr'; if (v >= 1e5) return '₹' + (v / 1e5).toFixed(v % 1e5 ? 2 : 0).replace(/\.?0+$/, '') + ' L'; return '₹' + v.toLocaleString('en-IN'); };
const nid = (rows) => (rows || []).reduce((m, x) => Math.max(m, Number(x && x.id) || 0), 0) + 1;
const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const note = (lead, text, at) => { lead.history = Array.isArray(lead.history) ? lead.history : []; lead.history.unshift({ at: at || new Date().toISOString(), text: clean(text, 300) }); lead.history = lead.history.slice(0, 40); };
const fail = (message, code = 'bad_flow', status = 400) => Object.assign(new Error(message), { status, code });

export function ensureFlow(c) {
  c.catalogue = Array.isArray(c.catalogue) ? c.catalogue : [];
  c.leads = Array.isArray(c.leads) ? c.leads : [];
  return c;
}

// ---------- inventory ----------
export function cleanProperty(b, K = FLOWS.realestate) {
  const title = clean(b.title, 80), price = num(b.price);
  if (K.kind !== 're') { // a service, treatment, plan, program, package or batch
    if (title.length < 3 || !/\p{L}/u.test(title)) throw fail(`Give the ${K.item} a name (for example “${K.itemEx}”).`);
    if (!price) throw fail('Give the price in rupees (for example ' + K.priceEx + ').');
    const status = ['available', 'hold', 'sold'].includes(String(b.status || '').toLowerCase()) ? String(b.status).toLowerCase() : 'available';
    return { title, location: clean(b.location, 60), bhk: 0, price, size: 0, status, type: 'item' };
  }
  const location = clean(b.location, 60), bhk = Math.round(num(b.bhk)), size = Math.round(num(b.size));
  if (title.length < 3 || !/\p{L}/u.test(title)) throw fail('Give the property a name (for example “Sunrise Towers 3BHK”).');
  if (location.length < 2 || !/\p{L}/u.test(location)) throw fail('Give the area or locality of the property.');
  if (!price) throw fail('Give the price in rupees (for example 8500000).');
  if (bhk > 10) throw fail('BHK must be between 0 (plot or commercial) and 10.');
  const status = ['available', 'hold', 'sold'].includes(String(b.status || '').toLowerCase()) ? String(b.status).toLowerCase() : 'available';
  const type = ['flat', 'villa', 'plot', 'commercial'].includes(String(b.type || '').toLowerCase()) ? String(b.type).toLowerCase() : (bhk ? 'flat' : 'plot');
  return { title, location, bhk, price, size, status, type };
}
export function addProperty(c, b) {
  ensureFlow(c);
  const K = cfgOf(c);
  if (c.catalogue.length >= 500) throw fail('The catalogue holds up to 500 ' + K.items + '.');
  const p = cleanProperty(b, K);
  if (c.catalogue.some((x) => x.title.toLowerCase() === p.title.toLowerCase() && String(x.location || '').toLowerCase() === p.location.toLowerCase())) throw fail(`That ${K.item} is already in the catalogue.`);
  const row = { id: nid(c.catalogue), ...p, at: new Date().toISOString() };
  c.catalogue.push(row); return row;
}
// CSV, one per line. Real estate: Title, Location, BHK, Price, Size (sq ft), Status. Everyone else: Name, Category, Price, Status.
export function importProperties(c, text) {
  ensureFlow(c); const K = cfgOf(c);
  const added = [], errors = [];
  String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 600).forEach((line, i) => {
    const cells = line.split(',').map((x) => x.trim()), [title, location] = cells;
    if (i === 0 && /^(title|name)$/i.test(title)) return;
    const row = K.kind === 're' ? { title, location, bhk: cells[2], price: cells[3], size: cells[4], status: cells[5] } : { title, location, price: cells[2], status: cells[3] };
    try { added.push(addProperty(c, row)); } catch (e) { errors.push('Line ' + (i + 1) + ': ' + e.message); }
  });
  return { added, errors };
}

// ---------- requirements, matching, scoring ----------
export function cleanReq(b, K = FLOWS.realestate) {
  if (K.kind !== 're') { const tl = K.timelines.some(([k]) => k === b.timeline) ? b.timeline : ''; return { budget: num(b.budget), locations: [], bhk: null, size: 0, timeline: tl, need: clean(b.need, 200), extra: clean(b.extra, 200) }; }
  const locations = (Array.isArray(b.locations) ? b.locations : String(b.locations || '').split(',')).map((x) => clean(x, 40)).filter((x) => x.length >= 2 && /\p{L}/u.test(x)).slice(0, 6);
  const bhkRaw = String(b.bhk == null ? '' : b.bhk).trim();
  const timeline = TIMELINES.some(([k]) => k === b.timeline) ? b.timeline : '';
  return { budget: num(b.budget), locations, bhk: bhkRaw === '' ? null : Math.min(10, Math.round(num(bhkRaw))), size: Math.round(num(b.size)), timeline };
}
export function missing(req, K = FLOWS.realestate) {
  const r = req || {};
  if (K.kind !== 're') return [!r.need || r.need.length < 3 ? K.needMissing : '', !r.budget ? 'budget' : '', !r.timeline ? K.timelineMissing : ''].filter(Boolean);
  return REQUIRED.filter(([k]) => (k === 'locations' ? !(r.locations || []).length : k === 'bhk' ? r.bhk == null : !r[k])).map(([, label]) => label);
}
// Available properties that fit: price up to 10% over budget, in a wanted location, the right BHK, big enough.
const STOP = new Set(['and', 'the', 'for', 'with', 'from', 'want', 'wants', 'need', 'needs', 'more', 'some', 'any', 'new', 'our', 'his', 'her', 'their', 'into', 'before', 'after', 'class', 'months', 'month', 'weeks', 'week', 'sessions', 'session']);
const words = (t) => String(t || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w));
// Everyone except real estate: what they need is matched by words against the catalogue, then by budget.
function matchItems(c, req, K) {
  const want = words(req.need + ' ' + (req.extra || ''));
  const avail = (c.catalogue || []).filter((p) => p.status === 'available');
  const hit = (p) => { const hay = words(p.title + ' ' + (p.location || '')); return want.filter((w) => hay.some((h) => h === w || (w.length >= 4 && (h.startsWith(w) || w.startsWith(h))))).length; };
  const onNeed = avail.map((p) => ({ p, n: hit(p) })).filter((x) => x.n > 0);
  const fits = onNeed.filter((x) => x.p.price <= req.budget * 1.1);
  const ranked = fits.map((x) => ({ ...x, over: x.p.price > req.budget, gap: Math.abs(req.budget - x.p.price) })).sort((a, b) => (b.n - a.n) || (a.over - b.over) || (a.gap - b.gap)).map((x) => x.p);
  let why = '';
  if (!ranked.length) {
    if (!avail.length) why = `There are no available ${K.items} in your catalogue yet.`;
    else if (onNeed.length) why = `The ${K.items} for “${req.need}” start at ${inr(Math.min(...onNeed.map((x) => x.p.price)))}, above the budget of ${inr(req.budget)}.`;
    else why = `Nothing in the catalogue matches “${req.need}”. Available: ${avail.slice(0, 4).map((p) => p.title).join(', ')}.`;
  }
  return { ranked: ranked.slice(0, 5), why };
}
export function matchProperties(c, req, K = cfgOf(c)) {
  if (K.kind !== 're') return matchItems(c, req, K);
  const want = (req.locations || []).map((x) => x.toLowerCase());
  const inLoc = (p) => !want.length || want.some((w) => p.location.toLowerCase().includes(w) || w.includes(p.location.toLowerCase()));
  const avail = (c.catalogue || []).filter((p) => p.status === 'available');
  const fits = avail.filter((p) => p.price <= req.budget * 1.1 && inLoc(p) && (req.bhk == null || p.bhk === req.bhk) && (!req.size || !p.size || p.size >= req.size));
  // rank: inside budget first, then closest to the budget, then larger
  const ranked = fits.map((p) => ({ p, over: p.price > req.budget, gap: Math.abs(req.budget - p.price) })).sort((a, b) => (a.over - b.over) || (a.gap - b.gap) || (b.p.size - a.p.size)).map((x) => x.p);
  // when nothing fits, say which wish blocks it, so the owner knows what to ask the buyer to relax
  let why = '';
  if (!ranked.length) {
    const noBudget = avail.filter((p) => inLoc(p) && (req.bhk == null || p.bhk === req.bhk));
    const noLoc = avail.filter((p) => p.price <= req.budget * 1.1 && (req.bhk == null || p.bhk === req.bhk));
    const noBhk = avail.filter((p) => p.price <= req.budget * 1.1 && inLoc(p));
    if (!avail.length) why = 'There are no available properties in your catalogue yet.';
    else if (noBudget.length) why = `Nothing in ${req.locations.join(' or ')} fits ${inr(req.budget)}. The nearest starts at ${inr(Math.min(...noBudget.map((p) => p.price)))}.`;
    else if (noLoc.length) why = `Nothing in ${req.locations.join(' or ') || 'that area'} right now. Similar homes are available in ${[...new Set(noLoc.map((p) => p.location))].slice(0, 3).join(', ')}.`;
    else if (noBhk.length) why = `No ${req.bhk} BHK fits. Available there: ${[...new Set(noBhk.map((p) => p.bhk + ' BHK'))].join(', ')}.`;
    else why = 'Nothing available fits this budget, location and size together.';
  }
  return { ranked: ranked.slice(0, 5), why };
}
// 0–100. Money fit and urgency carry most of it; engagement and a warm source add the rest.
export function scoreLead(lead, matches, K = FLOWS.realestate) {
  const r = lead.req || {}; let s = 0; const why = [];
  const add = (n, t) => { s += n; why.push('+' + n + ' ' + t); };
  if (matches.length) add(30, K.items + ' fit the budget'); else if (r.budget) add(5, 'budget known');
  if (matches[0] && matches[0].price <= r.budget) add(10, 'best match is inside budget');
  const tl = (k) => ((K.timelines.find(([x]) => x === k) || [])[1] || '').toLowerCase();
  const t = K.kind === 're' ? { immediate: [30, 'wants to buy now'], '1-3': [20, 'buying in 1–3 months'], '3-6': [10, 'buying in 3–6 months'] }[r.timeline] : { immediate: [30, tl('immediate')], '1-3': [20, tl('1-3')], '3-6': [10, tl('3-6')] }[r.timeline]; if (t) add(t[0], t[1]);
  if (!missing(r, K).length) add(10, 'all details given');
  if (lead.waConsent) add(5, 'agreed to WhatsApp');
  if (lead.interested === true) add(15, 'said they are interested');
  if (/referral|walk-in/i.test(lead.channel || '')) add(10, 'came by ' + String(lead.channel).toLowerCase());
  s -= Math.min(20, (lead.unanswered || 0) * 10); if (lead.unanswered) why.push('-' + Math.min(20, lead.unanswered * 10) + ' unanswered follow-ups');
  s = Math.max(0, Math.min(100, s));
  return { score: s, category: s >= 70 ? 'hot' : s >= 40 ? 'warm' : 'cold', why };
}
function rescore(c, lead) {
  const K = cfgOf(c);
  const { ranked, why } = lead.req && !missing(lead.req, K).length ? matchProperties(c, lead.req, K) : { ranked: [], why: '' };
  lead.matches = ranked.map((p) => p.id); lead.noMatchWhy = why;
  const sc = scoreLead(lead, ranked, K);
  lead.score = sc.score; lead.category = sc.category; lead.scoreWhy = sc.why;
  return ranked;
}
const planFollow = (lead, now) => { lead.nextFollowAt = new Date(now + FOLLOW_DAYS[lead.category || 'cold'] * DAY).toISOString(); };

// ---------- capture ----------
// A new enquiry. The same phone again updates the existing lead instead of creating a second one.
export function captureLead(c, { name, phone, email, channel, message, enquiryId }, now = Date.now()) {
  ensureFlow(c);
  const key = last10(phone);
  let lead = key.length === 10 ? c.leads.find((l) => last10(l.phone) === key) : null;
  const at = new Date(now).toISOString();
  if (lead) {
    if (message) lead.message = clean(message, 300);
    if (['lost', 'nurture'].includes(lead.stage)) { lead.stage = missing(lead.req, cfgOf(c)).length ? 'qualifying' : 'matched'; lead.lostReason = ''; lead.unanswered = 0; }
    note(lead, 'Enquired again by ' + (channel || 'phone') + (message ? ': “' + clean(message, 120) + '”' : ''), at);
    rescore(c, lead);
    return { lead, existing: true };
  }
  lead = { id: nid(c.leads), name: clean(name, 80) || 'Unknown', phone: String(phone || '').replace(/\D/g, ''), email: clean(email, 120), channel: clean(channel, 40) || 'Phone', message: clean(message, 300),
    stage: 'new', req: { budget: 0, locations: [], bhk: null, size: 0, timeline: '', need: '', extra: '' }, matches: [], score: 0, category: 'cold', scoreWhy: [], waConsent: false, optOut: false, interested: null,
    unanswered: 0, nextFollowAt: at, visit: null, feedback: '', lostReason: '', saleAmount: 0, enquiryId: enquiryId || null, patientId: null, at, history: [] };
  note(lead, 'Enquiry by ' + lead.channel + (lead.message ? ': “' + clean(lead.message, 120) + '”' : ''), at);
  c.leads.unshift(lead);
  return { lead, existing: false };
}

// ---------- messages (returned as drafts; the owner approves them) ----------
const first = (lead) => String(lead.name || '').split(' ')[0] || 'there';
const itemLine = (p) => `• ${p.title}${p.location ? ' (' + p.location + ')' : ''}: ${inr(p.price)}`;
const wantText = (lead, K) => (K.kind === 're' ? `${lead.req.bhk} BHK, ${lead.req.locations.join(' / ')}, around ${inr(lead.req.budget)}` : `${lead.req.need}, around ${inr(lead.req.budget)}`);
const propLine = (p) => `• ${p.title}, ${p.location}: ${p.bhk ? p.bhk + ' BHK' : p.type}${p.size ? ', ' + p.size.toLocaleString('en-IN') + ' sq ft' : ''}, ${inr(p.price)}`;
function draft(lead, kind, title, body, opts = {}) {
  if (lead.optOut && !opts.internal) return null; // change 5: nothing more goes to someone who said stop
  return { kind, title, body, internal: !!opts.internal, to: opts.internal ? '' : (lead.waConsent ? lead.phone : ''), channel: opts.internal ? 'internal' : (lead.waConsent ? 'whatsapp' : 'call-or-email') };
}
const viaNote = (lead) => (lead.waConsent ? '' : '\n\n(No WhatsApp consent on file: read this out on a call or send it by email.)');

// ---------- the steps ----------
const find = (c, id) => { ensureFlow(c); const l = c.leads.find((x) => x.id === Number(id)); if (!l) throw fail('That lead is not on file.', 'not_found', 404); return l; };
const guardOpen = (lead) => { if (['won', 'lost'].includes(lead.stage)) throw fail('This lead is closed. Reopen it by adding a new enquiry from the same number.'); };

// Save what the buyer wants. Incomplete -> ask for the rest. Complete -> search, rank, score.
export function saveRequirements(c, id, b, biz, now = Date.now()) {
  const lead = find(c, id); guardOpen(lead); const K = cfgOf(c), re = K.kind === 're';
  lead.req = cleanReq(b, K);
  if (b.waConsent !== undefined) lead.waConsent = b.waConsent === true || b.waConsent === 'on' || b.waConsent === 'true';
  const miss = missing(lead.req, K); const drafts = [];
  if (miss.length) {
    lead.stage = 'qualifying'; rescore(c, lead);
    note(lead, 'Requirements saved. Still needed: ' + miss.join(', '));
    const d = draft(lead, 'ask-details', 'Ask ' + lead.name + ' for missing details', re ? `Hi ${first(lead)}, thank you for contacting ${biz}. To shortlist the right homes for you, could you share your ${miss.join(', ').replace(/, ([^,]*)$/, ' and $1')}?` : `Hi ${first(lead)}, thank you for contacting ${biz}. To suggest the right ${K.item} for you, could you tell me ${andList(miss)}?` + viaNote(lead));
    if (d) drafts.push(d);
    return { lead, drafts, missing: miss };
  }
  const ranked = rescore(c, lead); planFollow(lead, now);
  if (!ranked.length) {
    lead.stage = 'nomatch'; note(lead, `No matching ${K.item}. ` + lead.noMatchWhy);
    const d = draft(lead, 'adjust', 'Ask ' + lead.name + ' to adjust preferences', (re ? `Hi ${first(lead)}, I checked everything we have for ${lead.req.bhk} BHK in ${lead.req.locations.join(' / ')} around ${inr(lead.req.budget)}. ${lead.noMatchWhy} Would you like me to widen the search a little on budget or location?` : `Hi ${first(lead)}, I looked at what we offer for “${lead.req.need}” around ${inr(lead.req.budget)}, and I don’t have an exact fit right now. Would you be open to adjusting the ${K.adjust}? I can suggest the closest option. – ${biz}`) + viaNote(lead));
    if (d) drafts.push(d);
  } else { lead.stage = 'matched'; note(lead, `${ranked.length} matching ${ranked.length === 1 ? K.item : K.items} found. Score ${lead.score} (${lead.category}).`); }
  return { lead, drafts, missing: [] };
}
// Send the shortlist. Hot today, Warm in 3 days, Cold in 30 (change 1).
export function sendRecommendations(c, id, biz, now = Date.now()) {
  const lead = find(c, id); guardOpen(lead); const K = cfgOf(c), re = K.kind === 're';
  const ranked = rescore(c, lead);
  if (!ranked.length) throw fail(`There is no matching ${K.item} to send yet. Save the requirements, or add ${K.items} to the catalogue.`);
  if (lead.optOut) throw fail('This customer asked not to be contacted. Nothing was drafted.');
  const d = draft(lead, 'recommend', K.sendTitle + ' for ' + lead.name, !re ? `Hi ${first(lead)}, based on what you told us (${wantText(lead, K)}), here ${ranked.length === 1 ? 'is what I recommend' : 'are ' + ranked.length + ' options that fit'}:\n${ranked.map(itemLine).join('\n')}\n\nWould you like to book a ${K.meet}? – ${biz}` + viaNote(lead) : `Hi ${first(lead)}, based on what you told us (${lead.req.bhk} BHK, ${lead.req.locations.join(' / ')}, around ${inr(lead.req.budget)}), here ${ranked.length === 1 ? 'is a home' : 'are ' + ranked.length + ' homes'} that fit:\n${ranked.map(propLine).join('\n')}\n\nWould you like to visit ${ranked.length === 1 ? 'it' : 'any of these'} this week? – ${biz}` + viaNote(lead));
  lead.stage = 'recommended'; lead.recommendedAt = new Date(now).toISOString(); planFollow(lead, now);
  note(lead, `${capw(K.send)} with ${ranked.length} ${ranked.length === 1 ? K.item : K.items} drafted (${lead.waConsent ? 'WhatsApp' : 'call or email, no WhatsApp consent'}).`);
  return { lead, drafts: [d] };
}
// Customer interested? No -> record why and plan the next follow-up. Yes -> ask for a site visit.
export function setInterest(c, id, { interested, feedback }, biz, now = Date.now()) {
  const lead = find(c, id); guardOpen(lead); const K = cfgOf(c), re = K.kind === 're';
  lead.interested = !!interested; lead.unanswered = 0; if (feedback) lead.feedback = clean(feedback, 300);
  const drafts = [];
  if (lead.interested) {
    lead.stage = 'interested'; rescore(c, lead); planFollow(lead, now); note(lead, 'Customer is interested.' + (feedback ? ' ' + clean(feedback, 200) : ''));
    const d = draft(lead, 'ask-visit', 'Offer ' + lead.name + ' a ' + K.meet, (re ? `Hi ${first(lead)}, glad you liked the options. Would you like to see the property in person? Tell me a day and time that suits you and I will arrange the visit. – ${biz}` : `Hi ${first(lead)}, glad you liked the options. Shall I book your ${K.meet}? Tell me a day and time that suits you. – ${biz}`) + viaNote(lead));
    if (d) drafts.push(d);
  } else { rescore(c, lead); planFollow(lead, now); note(lead, 'Not interested in what was sent.' + (feedback ? ' ' + clean(feedback, 200) : '') + ' Next follow-up planned.'); }
  return { lead, drafts };
}
// Other free slots near the asked time: same day later, then the next two days at the same hour.
export function slotFree(c, at, exceptAppt) {
  return !(c.appointments || []).some((a) => a.status === 'booked' && a.id !== exceptAppt && Math.abs(Date.parse(a.at) - at) < SLOT_MIN * 60000);
}
export function alternatives(c, at) {
  const out = [];
  for (const step of [2, 4, 24, 26, 48]) { const t = at + step * 3600e3; const h = new Date(t + 5.5 * 3600e3).getUTCHours(); if (h >= 9 && h < 19 && slotFree(c, t)) out.push(new Date(t).toISOString()); if (out.length >= 3) break; }
  return out;
}
// Book the site visit. Slot taken -> offer alternatives. Free -> confirm and notify the sales rep.
// The reminder is drafted separately the day before (remindVisit), so approving it sends it at the right time.
export function bookVisit(c, id, { at, propertyId }, biz, now = Date.now()) {
  const lead = find(c, id); guardOpen(lead); const K = cfgOf(c), re = K.kind === 're';
  const when = Date.parse(at || ''); if (!when) throw fail('Pick a date and time for the ' + K.meet + '.');
  if (when < now - 10 * 60000) throw fail('That date and time has already passed. Pick today or a later date.');
  const prop = (c.catalogue || []).find((p) => p.id === Number(propertyId)) || (c.catalogue || []).find((p) => p.id === (lead.matches || [])[0]);
  if (!prop && re) throw fail('Choose which property they will visit.');
  if (prop && prop.status !== 'available') throw fail(prop.title + ' is no longer available. Pick another ' + K.item + '.');
  const about = prop ? (re ? `${prop.title}, ${prop.location}` : prop.title) : '';
  if (!slotFree(c, when, lead.visit && lead.visit.status === 'booked' ? lead.visit.appointmentId : undefined)) {
    const alt = alternatives(c, when);
    const d = draft(lead, 'alt-slots', 'Offer ' + lead.name + ' other times', `Hi ${first(lead)}, that time is already taken. I can do ${alt.map(fmt).join(', or ') || 'another day this week'}. Which works for you? – ${biz}` + viaNote(lead));
    note(lead, 'Asked for ' + fmt(at) + ': slot taken. Alternatives offered.');
    return { lead, drafts: d ? [d] : [], slotTaken: true, alternatives: alt };
  }
  // the buyer becomes a person on file, and the visit sits in the normal bookings list
  c.patients = Array.isArray(c.patients) ? c.patients : []; c.appointments = Array.isArray(c.appointments) ? c.appointments : [];
  let person = c.patients.find((p) => last10(p.phone) === last10(lead.phone));
  if (!person) { person = { id: nid(c.patients), name: lead.name, phone: lead.phone, email: lead.email || '', lastVisit: '', value: 0, createdAt: new Date(now).toISOString(), demo: false, source: 'Lead' }; c.patients.unshift(person); }
  lead.patientId = person.id;
  if (lead.visit && lead.visit.appointmentId) { const old = c.appointments.find((a) => a.id === lead.visit.appointmentId && a.status === 'booked'); if (old) old.status = 'cancelled'; }
  const appt = { id: nid(c.appointments), patientId: person.id, at: new Date(when).toISOString(), service: capw(K.meet) + (prop ? ': ' + prop.title : ''), fee: 0, status: 'booked', demo: false, leadId: lead.id, reminder: null };
  c.appointments.unshift(appt);
  const enq = (c.enquiries || []).find((e) => e.id === lead.enquiryId); if (enq) enq.status = 'booked';
  lead.visit = { at: appt.at, propertyId: prop ? prop.id : null, appointmentId: appt.id, status: 'booked' }; lead.stage = 'visit';
  note(lead, capw(K.meet) + ' booked for ' + fmt(appt.at) + (prop ? (re ? ' at ' : ' about ') + prop.title : '') + '.');
  const drafts = [
    draft(lead, 'confirm-visit', 'Confirm ' + K.meet + ' with ' + lead.name, (re ? `Hi ${first(lead)}, your site visit to ${prop.title}, ${prop.location} is confirmed for ${fmt(appt.at)}. Our representative will meet you there. Reply here if you need to change the time. – ${biz}` : `Hi ${first(lead)}, your ${K.meet}${about ? ' for ' + about : ''} is confirmed for ${fmt(appt.at)}. Reply here if you need to change the time. – ${biz}`) + viaNote(lead)),
    draft(lead, 'notify-rep', 'Notify ' + K.notify + ': ' + (re ? 'visit' : K.meet) + ' with ' + lead.name, re ? `Site visit: ${lead.name} (${lead.phone}) at ${prop.title}, ${prop.location} on ${fmt(appt.at)}.\nWants: ${lead.req.bhk} BHK, ${lead.req.locations.join(' / ')}, budget ${inr(lead.req.budget)}, buying ${timelineText(lead.req.timeline)}.\nLead score ${lead.score} (${lead.category}).` : `${capw(K.meet)}: ${lead.name} (${lead.phone}) on ${fmt(appt.at)}${about ? ', about ' + about : ''}.\n${K.need[0]}: ${lead.req.need}${lead.req.extra ? '\n' + K.extra[0] + ': ' + lead.req.extra : ''}\nBudget ${inr(lead.req.budget)}, ${K.timelineLabel.toLowerCase()}: ${timelineText(lead.req.timeline, K)}.\nLead score ${lead.score} (${lead.category}).`, { internal: true }),
  ].filter(Boolean);
  return { lead, drafts, appointment: appt };
}
// Change 3: the day-before reminder. The pipeline shows "Reminder due" from 36 hours before the visit.
export function remindVisit(c, id, biz) {
  const lead = find(c, id); guardOpen(lead);
  const K = cfgOf(c), re = K.kind === 're';
  if (!lead.visit || lead.visit.status !== 'booked') throw fail('There is no booked ' + K.meet + ' on this lead.');
  if (lead.optOut) throw fail('This customer asked not to be contacted. Nothing was drafted.');
  const prop = (c.catalogue || []).find((p) => p.id === lead.visit.propertyId) || { title: 'the property' };
  lead.visit.reminded = true; note(lead, capw(K.meet) + ' reminder drafted.');
  return { lead, drafts: [draft(lead, 'remind-visit', capw(K.meet) + ' reminder for ' + lead.name, (re ? `Hi ${first(lead)}, a reminder of your site visit to ${prop.title} on ${fmt(lead.visit.at)}. See you there. Reply here if you need to change the time. – ${biz}` : `Hi ${first(lead)}, a reminder of your ${K.meet} on ${fmt(lead.visit.at)}. See you then. Reply here if you need to change the time. – ${biz}`) + viaNote(lead))] };
}
// The quick path: a lead booked straight from its row (no requirements yet) still moves to its booked stage.
export function linkBooking(c, enquiryId, appt, personId) {
  syncLeads(c); const K = cfgOf(c);
  const lead = c.leads.find((l) => l.enquiryId === enquiryId); if (!lead || ['won', 'lost', 'negotiation'].includes(lead.stage)) return null;
  if (lead.visit && lead.visit.status === 'booked' && lead.visit.appointmentId !== appt.id) { const old = (c.appointments || []).find((a) => a.id === lead.visit.appointmentId && a.status === 'booked'); if (old) old.status = 'cancelled'; }
  lead.visit = { at: appt.at, propertyId: null, appointmentId: appt.id, status: 'booked' }; lead.stage = 'visit'; lead.patientId = personId; lead.interested = true; lead.unanswered = 0; appt.leadId = lead.id;
  rescore(c, lead); note(lead, capw(K.meet) + ' booked for ' + fmt(appt.at) + (appt.service ? ' (' + appt.service + ')' : '') + '.');
  return lead;
}
// Every enquiry is a lead, however it arrived (desk, booking form, WhatsApp). Safe to call any number of times.
export function syncLeads(c, now = Date.now()) {
  ensureFlow(c);
  const have = new Set(c.leads.map((l) => l.enquiryId).filter(Boolean));
  for (const e of [...(c.enquiries || [])].reverse()) {
    if (have.has(e.id) || e.leadId) continue;
    const { lead, existing } = captureLead(c, { name: e.name, phone: e.phone, email: e.email, channel: e.channel, message: e.message, enquiryId: e.id }, Date.parse(e.at) || now);
    e.leadId = lead.id; if (!existing) lead.demo = !!e.demo;
  }
  return c;
}
// After the visit: came (feedback, ready or not) or did not come (offer a new slot).
export function visitResult(c, id, { came, feedback, ready }, biz, now = Date.now()) {
  const lead = find(c, id); guardOpen(lead); const K = cfgOf(c), re = K.kind === 're';
  if (!lead.visit || lead.visit.status !== 'booked') throw fail('There is no booked ' + K.meet + ' on this lead.');
  const appt = (c.appointments || []).find((a) => a.id === lead.visit.appointmentId);
  const drafts = [];
  if (!came) {
    lead.visit.status = 'noshow'; if (appt) appt.status = 'noshow'; lead.stage = 'interested'; lead.unanswered = (lead.unanswered || 0) + 1; rescore(c, lead); planFollow(lead, now);
    note(lead, 'Did not come to the ' + K.meet + '. New slot offered.');
    const d = draft(lead, 'reschedule', 'Offer ' + lead.name + ' a new time', `Hi ${first(lead)}, we missed you at the ${re ? 'site visit' : K.meet} today. No problem at all. Would another day this week suit you? – ${biz}` + viaNote(lead));
    if (d) drafts.push(d);
    return { lead, drafts };
  }
  lead.visit.status = 'done'; if (appt) appt.status = 'completed';
  const person = (c.patients || []).find((p) => p.id === lead.patientId); if (person) person.lastVisit = new Date(now).toISOString();
  lead.feedback = clean(feedback, 300); lead.interested = true; lead.unanswered = 0;
  if (ready) {
    lead.stage = 'negotiation'; rescore(c, lead); note(lead, capw(K.conduct) + ' done. Ready to proceed: handed to ' + K.handoffWho.replace(/^your /, 'the ') + '.' + (lead.feedback ? ' Feedback: ' + lead.feedback : ''));
    const prop = (c.catalogue || []).find((p) => p.id === lead.visit.propertyId) || {};
    drafts.push(draft(lead, 'handoff', K.handoffTitle + ': ' + lead.name, re ? `Ready to proceed after the site visit.\nBuyer: ${lead.name}, ${lead.phone}${lead.email ? ', ' + lead.email : ''}\nProperty: ${prop.title || 'see lead'}, ${prop.location || ''}, ${inr(prop.price)}\nBudget ${inr(lead.req.budget)}, buying ${timelineText(lead.req.timeline)}.\nFeedback: ${lead.feedback || 'none recorded'}\nNext: negotiation and documentation by the sales team.` : `Ready to proceed after the ${K.conduct}.\n${capw(K.person)}: ${lead.name}, ${lead.phone}${lead.email ? ', ' + lead.email : ''}\n${K.need[0]}: ${lead.req.need}${lead.req.extra ? '\n' + K.extra[0] + ': ' + lead.req.extra : ''}${prop.title ? '\n' + capw(K.item) + ': ' + prop.title + ', ' + inr(prop.price) : ''}\nBudget ${inr(lead.req.budget)}, ${K.timelineLabel.toLowerCase()}: ${timelineText(lead.req.timeline, K)}.\nFeedback: ${lead.feedback || 'none recorded'}\nNext: ${K.handoffNext}.`, { internal: true }));
  } else { lead.stage = 'visited'; rescore(c, lead); planFollow(lead, now); note(lead, capw(K.conduct) + ' done. Not ready yet: follow-up planned.' + (lead.feedback ? ' Feedback: ' + lead.feedback : '')); }
  return { lead, drafts };
}
// Sale confirmed? Yes -> Closed Won, the property is marked sold, and the thank-you is drafted. No -> keep following up.
export function saleResult(c, id, { confirmed, amount }, biz, now = Date.now()) {
  const lead = find(c, id); const K = cfgOf(c), re = K.kind === 're';
  if (lead.stage !== 'negotiation') throw fail(re ? 'A sale is recorded after the lead is handed to the sales team.' : 'This is recorded after the lead is handed to ' + K.handoffWho + '.');
  const drafts = [];
  if (!confirmed) { lead.stage = 'visited'; rescore(c, lead); planFollow(lead, now); note(lead, 'Not confirmed yet. Follow-up continues.'); return { lead, drafts }; }
  const prop = (c.catalogue || []).find((p) => p.id === (lead.visit || {}).propertyId);
  lead.saleAmount = num(amount) || (prop ? prop.price : 0);
  if (!lead.saleAmount) throw fail('Enter the agreed amount.');
  lead.stage = 'won'; lead.wonAt = new Date(now).toISOString(); lead.nextFollowAt = '';
  if (prop && K.markSold) prop.status = 'sold';
  const person = (c.patients || []).find((p) => p.id === lead.patientId); if (person) person.value = (Number(person.value) || 0) + lead.saleAmount;
  note(lead, K.won + ' at ' + inr(lead.saleAmount) + (prop ? ' for ' + prop.title : '') + '.');
  const d = draft(lead, 'won', 'Thank ' + lead.name + ' and ask for a review', (re ? `Hi ${first(lead)}, congratulations on your new home${prop ? ' at ' + prop.title : ''}! Thank you for trusting ${biz}. If you were happy with us, a short Google review would mean a lot, and if a friend or relative is looking for a home, we would love to help them too.` : `Hi ${first(lead)}, ${K.thanks}! Thank you for trusting ${biz}. If you are happy with us so far, a short Google review would mean a lot, and if a friend or relative needs the same, we would love to help them too.`) + viaNote(lead));
  if (d) drafts.push(d);
  return { lead, drafts, property: prop || null };
}
// A follow-up was made. Answered resets the count; 3 unanswered moves the lead to long-term nurturing (change 2).
export function followUp(c, id, { answered }, biz, now = Date.now()) {
  const lead = find(c, id); guardOpen(lead); const K = cfgOf(c), re = K.kind === 're';
  const drafts = [];
  if (answered) { lead.unanswered = 0; if (lead.stage === 'nurture') lead.stage = missing(lead.req, K).length ? 'qualifying' : 'recommended'; rescore(c, lead); planFollow(lead, now); note(lead, 'Follow-up answered.'); return { lead, drafts }; }
  lead.unanswered = (lead.unanswered || 0) + 1; rescore(c, lead);
  if (lead.unanswered >= MAX_UNANSWERED) { lead.stage = 'nurture'; lead.category = 'cold'; lead.nextFollowAt = new Date(now + FOLLOW_DAYS.cold * DAY).toISOString(); note(lead, MAX_UNANSWERED + ' follow-ups without an answer: moved to long-term nurturing (monthly).'); return { lead, drafts }; }
  planFollow(lead, now); note(lead, `Follow-up ${lead.unanswered} of ${MAX_UNANSWERED} not answered. Next one planned.`);
  const d = draft(lead, 'follow-up', 'Follow up with ' + lead.name, !re ? `Hi ${first(lead)}, just checking in${lead.req.need ? ' about ' + lead.req.need : ''}. ${lead.matches.length ? 'The options I shared are still open.' : 'Happy to help whenever you are ready.'} Shall I book a ${K.meet}, or is there something you would like changed? – ${biz}` + viaNote(lead) : `Hi ${first(lead)}, just checking in on your home search${lead.req.locations.length ? ' in ' + lead.req.locations.join(' / ') : ''}. ${lead.matches.length ? 'The options I shared are still available.' : 'New options come in every week.'} Shall I set up a visit, or is there something you would like changed? – ${biz}` + viaNote(lead));
  if (d) drafts.push(d);
  return { lead, drafts };
}
export function markLost(c, id, { reason }) {
  const lead = find(c, id); if (lead.stage === 'won') throw fail('A won lead cannot be marked lost.');
  lead.lostReason = LOST_REASONS.includes(reason) ? reason : 'Other'; lead.stage = 'lost'; lead.nextFollowAt = '';
  if (lead.visit && lead.visit.status === 'booked') { const a = (c.appointments || []).find((x) => x.id === lead.visit.appointmentId); if (a) a.status = 'cancelled'; lead.visit.status = 'cancelled'; }
  note(lead, 'Closed as Lost: ' + lead.lostReason + '.'); return { lead, drafts: [] };
}
export function setOptOut(c, id, { optOut }) {
  const lead = find(c, id); lead.optOut = !!optOut; if (lead.optOut) lead.waConsent = false;
  note(lead, lead.optOut ? 'Customer asked not to be contacted. No more messages are drafted.' : 'Contact allowed again.'); return { lead, drafts: [] };
}

// ---------- what the screens show ----------
function fmt(iso) { return new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }); }
function timelineText(t, K = FLOWS.realestate) { return (K.timelines.find(([k]) => k === t) || ['', 'not said'])[1].toLowerCase(); }
// The one thing to do next on a lead.
export function nextStep(lead, K = FLOWS.realestate) {
  if (K.kind !== 're' && !(lead.optOut && !['negotiation', 'visit'].includes(lead.stage))) {
    return ({ new: { action: 'req', label: 'Collect requirements' }, qualifying: { action: 'req', label: 'Complete requirements' }, nomatch: { action: 'req', label: 'Adjust requirements' },
      matched: { action: 'recommend', label: 'Send ' + K.send }, recommended: { action: 'interest', label: 'Record their answer' }, interested: { action: 'visit', label: 'Book ' + K.meet },
      visit: { action: 'visit-result', label: 'Record ' + K.meet }, visited: { action: 'follow', label: 'Follow up' }, negotiation: { action: 'sale', label: 'Record outcome' },
      nurture: { action: 'follow', label: 'Monthly check-in' }, won: { action: 'invoice', label: 'Create invoice' }, lost: { action: 'none', label: 'Closed' } })[lead.stage] || { action: 'none', label: '' };
  }
  if (lead.optOut && !['negotiation', 'visit'].includes(lead.stage)) return { action: 'none', label: 'Do not contact' };
  return ({ new: { action: 'req', label: 'Collect requirements' }, qualifying: { action: 'req', label: 'Complete requirements' }, nomatch: { action: 'req', label: 'Adjust preferences' },
    matched: { action: 'recommend', label: 'Send shortlist' }, recommended: { action: 'interest', label: 'Record their answer' }, interested: { action: 'visit', label: 'Book site visit' },
    visit: { action: 'visit-result', label: 'Record visit' }, visited: { action: 'follow', label: 'Follow up' }, negotiation: { action: 'sale', label: 'Record sale' },
    nurture: { action: 'follow', label: 'Monthly check-in' }, won: { action: 'invoice', label: 'Create invoice' }, lost: { action: 'none', label: 'Closed' } })[lead.stage] || { action: 'none', label: '' };
}
export function flowView(c, now = Date.now()) {
  ensureFlow(c); const K = cfgOf(c), SN = Object.fromEntries(stagesFor(K));
  const leads = c.leads.map((l) => ({ ...l, req: { need: '', extra: '', ...(l.req || {}) }, stageName: SN[l.stage] || l.stage, next: nextStep(l, K), remindDue: !!(l.visit && l.visit.status === 'booked' && !l.visit.reminded && Date.parse(l.visit.at) - now < 36 * 3600e3 && Date.parse(l.visit.at) > now), due: !!(l.nextFollowAt && OPEN_STAGES.includes(l.stage) && Date.parse(l.nextFollowAt) <= now), missing: missing(l.req, K) }));
  const count = (f) => leads.filter(f).length;
  const open = leads.filter((l) => OPEN_STAGES.includes(l.stage));
  const won = leads.filter((l) => l.stage === 'won'), lost = leads.filter((l) => l.stage === 'lost');
  const reasons = {}; for (const l of lost) reasons[l.lostReason || 'Other'] = (reasons[l.lostReason || 'Other'] || 0) + 1;
  const reached = (stages) => count((l) => stages.includes(l.stage));
  const funnel = [
    ['Enquiries', leads.length], ['Qualified', reached(['matched', 'recommended', 'interested', 'visit', 'visited', 'negotiation', 'won']) + count((l) => ['nurture', 'lost'].includes(l.stage) && !missing(l.req, K).length)],
    [K.kind === 're' ? 'Shortlist sent' : capw(K.send) + ' sent', count((l) => !!l.recommendedAt)], [K.kind === 're' ? 'Site visits' : capw(K.meet), count((l) => !!l.visit)], [K.stageNegotiation, reached(['negotiation', 'won'])], [K.won, won.length],
  ];
  return {
    stages: stagesFor(K), timelines: K.timelines, lostReasons: LOST_REASONS, leads, catalogue: c.catalogue,
    words: { kind: K.kind, person: K.person, existing: K.existing, item: K.item, items: K.items, group: K.group, groupPh: K.groupPh || '', need: K.need || null, extra: K.extra || null, timelineLabel: K.timelineLabel, channels: K.channels, meet: K.meet, conduct: K.conduct, notify: K.notify, send: K.send, handoffWho: K.handoffWho, handoffHead: K.handoffHead, handoffNext: K.handoffNext, closeYes: K.closeYes, won: K.won, amount: K.amount, invoice: K.invoice, itemEx: K.itemEx, groupEx: K.groupEx, priceEx: K.priceEx, markSold: !!K.markSold },
    report: { total: leads.length, open: open.length, hot: count((l) => l.category === 'hot' && OPEN_STAGES.includes(l.stage)), warm: count((l) => l.category === 'warm' && OPEN_STAGES.includes(l.stage)), cold: count((l) => l.category === 'cold' && OPEN_STAGES.includes(l.stage)),
      dueToday: count((l) => l.due), won: won.length, wonValue: won.reduce((s, l) => s + (l.saleAmount || 0), 0), lost: lost.length, lostReasons: reasons,
      conversion: leads.length ? Math.round((won.length / leads.length) * 100) : 0, funnel, available: c.catalogue.filter((p) => p.status === 'available').length },
  };
}
