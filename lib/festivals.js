// Festival calendar for the Social Media screen.
// Source, in order:
//   1. Google's public "Holidays in India" calendar through the Google Calendar API with a server API key
//      (GOOGLE_CALENDAR_API_KEY, or GOOGLE_API_KEY). FESTIVAL_CALENDAR_ID picks another public calendar.
//   2. The same Google calendar read with the owner's connected Google Calendar (Plugins → Connectors).
//   3. A built-in list of Indian festivals (dates checked against published 2026 / 2027 holiday lists).
// Reading the calendar never posts or sends anything.
import { connectorCredentials } from './connectors.js';

const env = (k) => (process.env[k] ?? '').toString().trim();
export const DEFAULT_CALENDAR = 'en.indian#holiday@group.v.calendar.google.com';
const calendarId = () => env('FESTIVAL_CALENDAR_ID') || DEFAULT_CALENDAR;

// [date, name, kind] kind: 'public' (gazetted / widely closed) or 'festival' (observance)
const BUILTIN = [
  ['2026-01-01', "New Year's Day", 'festival'], ['2026-01-14', 'Makar Sankranti / Pongal', 'festival'], ['2026-01-23', 'Vasant Panchami', 'festival'],
  ['2026-01-26', 'Republic Day', 'public'], ['2026-02-15', 'Maha Shivaratri', 'festival'], ['2026-03-03', 'Holika Dahana', 'festival'],
  ['2026-03-04', 'Holi', 'public'], ['2026-03-19', 'Ugadi / Gudi Padwa', 'festival'], ['2026-03-21', 'Eid ul-Fitr', 'public'],
  ['2026-03-26', 'Ram Navami', 'public'], ['2026-03-31', 'Mahavir Jayanti', 'public'], ['2026-04-03', 'Good Friday', 'public'],
  ['2026-04-05', 'Easter', 'festival'], ['2026-04-14', 'Ambedkar Jayanti / Vaisakhi', 'public'], ['2026-05-01', 'Buddha Purnima', 'public'],
  ['2026-05-27', 'Bakrid / Eid ul-Adha', 'public'], ['2026-06-26', 'Muharram', 'public'], ['2026-07-16', 'Rath Yatra', 'festival'],
  ['2026-08-15', 'Independence Day', 'public'], ['2026-08-26', 'Onam / Milad un-Nabi', 'public'], ['2026-08-28', 'Raksha Bandhan', 'festival'],
  ['2026-09-04', 'Janmashtami', 'public'], ['2026-09-14', 'Ganesh Chaturthi', 'festival'], ['2026-10-02', 'Gandhi Jayanti', 'public'],
  ['2026-10-11', 'Navratri begins', 'festival'], ['2026-10-20', 'Dussehra', 'public'], ['2026-10-29', 'Karva Chauth', 'festival'],
  ['2026-11-08', 'Diwali', 'public'], ['2026-11-09', 'Govardhan Puja', 'festival'], ['2026-11-11', 'Bhai Dooj', 'festival'],
  ['2026-11-14', "Children's Day", 'festival'], ['2026-11-15', 'Chhath Puja', 'festival'], ['2026-11-24', 'Guru Nanak Jayanti', 'public'],
  ['2026-12-24', 'Christmas Eve', 'festival'], ['2026-12-25', 'Christmas', 'public'], ['2026-12-31', "New Year's Eve", 'festival'],
  ['2027-01-01', "New Year's Day", 'festival'], ['2027-01-14', 'Makar Sankranti / Pongal', 'festival'], ['2027-01-26', 'Republic Day', 'public'],
  ['2027-03-06', 'Maha Shivaratri', 'festival'], ['2027-03-10', 'Eid ul-Fitr', 'public'], ['2027-03-22', 'Holi', 'public'],
  ['2027-03-26', 'Good Friday', 'public'], ['2027-04-08', 'Ugadi / Gudi Padwa', 'festival'], ['2027-04-15', 'Ram Navami', 'public'],
  ['2027-05-17', 'Bakrid / Eid ul-Adha', 'public'], ['2027-05-20', 'Buddha Purnima', 'public'], ['2027-06-15', 'Muharram', 'public'],
  ['2027-07-05', 'Rath Yatra', 'festival'], ['2027-08-15', 'Independence Day', 'public'], ['2027-08-17', 'Raksha Bandhan', 'festival'],
  ['2027-08-25', 'Janmashtami', 'public'], ['2027-09-04', 'Ganesh Chaturthi', 'festival'], ['2027-09-11', 'Onam', 'festival'],
  ['2027-10-02', 'Gandhi Jayanti', 'public'], ['2027-10-10', 'Dussehra', 'public'], ['2027-10-29', 'Diwali', 'public'],
  ['2027-11-14', "Guru Nanak Jayanti / Children's Day", 'public'], ['2027-12-25', 'Christmas', 'public'],
].map(([date, name, kind]) => ({ date, name, kind }));

const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;
export function monthBounds(month) {
  if (!monthRe.test(month || '')) throw Object.assign(new Error('bad month'), { code: 'bad_month' });
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`, to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); // exclusive
  return { from, to };
}
export function builtinFestivals(month) {
  const { from, to } = monthBounds(month);
  return BUILTIN.filter((f) => f.date >= from && f.date < to);
}

const cache = new Map(); // `${calendar}|${auth}|${month}` -> { at, events }
const TTL = 12 * 3600e3;

async function googleEvents(month, auth) {
  const { from, to } = monthBounds(month);
  const q = new URLSearchParams({ timeMin: from + 'T00:00:00+05:30', timeMax: to + 'T00:00:00+05:30', singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
  if (auth.key) q.set('key', auth.key);
  const url = `${env('GOOGLE_CALENDAR_BASE_URL') || 'https://www.googleapis.com/calendar/v3'}/calendars/${encodeURIComponent(calendarId())}/events?` + q;
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(url, { headers: auth.token ? { Authorization: 'Bearer ' + auth.token } : {}, signal: ac.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || 'Google Calendar answered ' + r.status), { status: r.status });
    return (j.items || []).map((e) => {
      const date = (e.start && (e.start.date || String(e.start.dateTime || '').slice(0, 10))) || '';
      const name = String(e.summary || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const kind = /public holiday/i.test(e.description || '') ? 'public' : 'festival';
      return { date, name, kind };
    }).filter((e) => e.date >= from && e.date < to && e.name);
  } finally { clearTimeout(timer); }
}

// { month, source: 'google' | 'google-connected' | 'builtin', calendar, events: [{date,name,kind}], note }
export async function festivalsFor({ st, email, secret, month }) {
  monthBounds(month);
  const key = env('GOOGLE_CALENDAR_API_KEY') || env('GOOGLE_API_KEY');
  let token = '';
  if (!key && st && email) {
    try { const cr = await connectorCredentials(st, email, 'gcal', secret); token = (cr && cr.access_token) || ''; } catch { token = ''; }
  }
  if (key || token) {
    const ck = `${calendarId()}|${key ? 'k' : 't:' + email}|${month}`;
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < TTL) return { month, source: key ? 'google' : 'google-connected', calendar: calendarId(), events: hit.events };
    try {
      const events = await googleEvents(month, key ? { key } : { token });
      cache.set(ck, { at: Date.now(), events });
      return { month, source: key ? 'google' : 'google-connected', calendar: calendarId(), events };
    } catch (e) {
      return { month, source: 'builtin', calendar: 'builtin', events: builtinFestivals(month), note: 'Google Calendar could not be read (' + String(e.message || e).slice(0, 120) + '). Showing the built-in festival list.' };
    }
  }
  return { month, source: 'builtin', calendar: 'builtin', events: builtinFestivals(month), note: 'Built-in festival list. Add GOOGLE_CALENDAR_API_KEY on the server, or connect Google Calendar, to use Google’s festival calendar.' };
}
