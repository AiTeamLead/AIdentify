// Composio's app directory without an API key: read from Composio's public pages (composio.dev/toolkits and one
// markdown page per app), kept on disk so a restart doesn't refetch it.
// - The directory page gives every app's name, description, logo, categories and popularity in one request.
// - Tool / trigger counts and "managed sign-in" come from each app's page; they are filled in the background.
// COMPOSIO_SITE overrides https://composio.dev (tests use a local copy).
import fs from 'node:fs';
import path from 'node:path';

const env = (k) => (process.env[k] ?? '').toString().trim();
const SITE = () => (env('COMPOSIO_SITE') || 'https://composio.dev').replace(/\/+$/, '');
const dataDir = () => env('DATA_DIR') || path.join(process.cwd(), 'data');
const FILE = () => path.join(dataDir(), 'composio-apps.json');
const FRESH = 7 * 24 * 3600e3;
const UA = { 'user-agent': 'AaaS-apps/1.0', accept: 'text/html,text/markdown,*/*' };

// Composio's own category names → the shorter labels shown on the Apps page
const LABEL = {
  'developer tools & devops': 'Developer Tools', 'collaboration & communication': 'Communication', 'ai & machine learning': 'Artificial Intelligence',
  'document & file management': 'Content & Files', 'productivity & project management': 'Productivity & Projects', crm: 'Sales & CRM',
  'sales & customer support': 'Sales & CRM', 'analytics & data': 'Data & Analytics', 'data & analytics': 'Data & Analytics',
  'entertainment & media': 'Media', 'education & lms': 'Education', 'design & creative tools': 'Design', 'marketing & social media': 'Marketing',
  'advertising & marketing': 'Marketing', 'social media': 'Marketing', 'scheduling & booking': 'Scheduling', 'e-commerce': 'Commerce & Payments',
  'finance & accounting': 'Finance', 'hr & recruiting': 'HR & Recruiting', 'workflow automation': 'Automation',
};
const BRAND = { github: 'GitHub', linkedin: 'LinkedIn', youtube: 'YouTube', hubspot: 'HubSpot', clickup: 'ClickUp', openai: 'OpenAI', posthog: 'PostHog',
  serpapi: 'SerpApi', elevenlabs: 'ElevenLabs', peopledatalabs: 'People Data Labs', exa: 'Exa', firecrawl: 'Firecrawl', tavily: 'Tavily', sendgrid: 'SendGrid', pagerduty: 'PagerDuty', googlecalendar: 'Google Calendar', googledrive: 'Google Drive',
  googlesheets: 'Google Sheets', googledocs: 'Google Docs', googlebigquery: 'BigQuery', metaads: 'Meta Ads', google_search_console: 'Search Console' };
const pretty = (slug) => BRAND[slug] || String(slug).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const FALLBACK = ['gmail', 'googlecalendar', 'googledrive', 'outlook', 'twitter', 'googlesheets', 'slack', 'notion', 'github', 'googledocs', 'hubspot', 'linkedin',
  'linear', 'jira', 'asana', 'trello', 'clickup', 'airtable', 'dropbox', 'zoom', 'calendly', 'salesforce', 'shopify', 'stripe', 'mailchimp', 'figma',
  'discord', 'whatsapp', 'youtube', 'reddit', 'one_drive', 'microsoft_teams', 'confluence', 'zendesk', 'intercom', 'canva', 'docusign', 'quickbooks', 'xero', 'box',
  'serpapi', 'firecrawl', 'tavily', 'exa', 'elevenlabs', 'peopledatalabs'];
const firstSentence = (s = '') => { const t = String(s).replace(/\s+/g, ' ').trim(), f = t.split(/(?<=\.)\s/)[0]; return f.length <= 180 ? f : t.slice(0, 177) + '…'; };

async function get(url, ms = 20000) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) }); if (r.ok) return await r.text(); if (r.status === 404) return null; }
    catch { /* retry */ }
    await new Promise((z) => setTimeout(z, 600 * (i + 1)));
  }
  return null;
}

// The directory page is a Next.js page: its data travels as JSON strings pushed into self.__next_f.
// Join those strings, then pick out every JSON object that describes an app (has a slug and a description).
function pageData(html) {
  let out = '';
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  for (let m; (m = re.exec(html));) { try { out += JSON.parse(m[1]); } catch { /* skip */ } }
  return out || html;
}
function objectAt(text, start) { // the balanced {...} starting at text[start], or ''
  let depth = 0, str = false, esc = false;
  for (let i = start; i < text.length && i - start < 20000; i++) {
    const c = text[i];
    if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return '';
}
export function parseDirectory(html) {
  const text = pageData(html), apps = new Map(), rank = new Map();
  for (let i = text.indexOf('{"'); i >= 0; i = text.indexOf('{"', i + 2)) {
    const head = text.slice(i, i + 400);
    if (!/"slug":"[a-z0-9_-]+"/.test(head)) continue;
    const raw = objectAt(text, i); if (!raw) continue;
    let o; try { o = JSON.parse(raw); } catch { continue; }
    if (!o || typeof o.slug !== 'string' || !/^[a-z0-9_-]{2,60}$/.test(o.slug)) continue;
    if (typeof o.rank === 'number' && !rank.has(o.slug)) rank.set(o.slug, o.rank);
    if ((o.short_description || o.description) && Array.isArray(o.categories) && o.is_live !== false && !apps.has(o.slug)) apps.set(o.slug, o);
  }
  return [...apps.values()].map((o) => ({
    slug: o.slug, name: BRAND[o.slug] || o.name || pretty(o.slug), description: firstSentence(o.short_description || o.description),
    logo: o.logo_url || o.logo || 'https://logos.composio.dev/api/' + o.slug,
    categories: [...new Set((o.categories || []).map((c) => String(typeof c === 'string' ? c : c && (c.name || c.slug) || '')).filter(Boolean).map((c) => LABEL[c.toLowerCase()] || pretty(c)))].slice(0, 4),
    rank: rank.has(o.slug) ? rank.get(o.slug) : 100000, tools: 0, triggers: 0, auth: 'managed', schemes: [],
  })).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

// One app's markdown page: counts, sign-in, description, suggested prompts and tools.
const section = (md, title) => { const m = md.match(new RegExp('^##\\s+' + title + '\\s*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))', 'mi')); return m ? m[1] : ''; };
export function parseAppPage(slug, md) {
  const num = (label) => Number((md.match(new RegExp('^[-*]\\s*' + label + ':\\s*(\\d+)', 'mi')) || [])[1] || 0);
  const tools = [];
  for (const line of section(md, 'Supported Tools').split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    const s = (cells[1] || '').replace(/`/g, '');
    if (/^[A-Z0-9_]{3,120}$/.test(s)) tools.push({ slug: s, name: cells[2] || pretty(s.toLowerCase()), description: String(cells[3] || '').slice(0, 260) });
  }
  const triggers = [];
  for (const line of section(md, 'Supported Triggers').split('\n')) {
    const cells = line.split('|').map((c) => c.trim()), s = (cells[1] || '').replace(/`/g, '');
    if (/^[A-Z0-9_]{3,120}$/.test(s)) triggers.push({ slug: s, name: cells[2] || s, description: String(cells[3] || '').slice(0, 200) });
  }
  const auth = [...section(md, 'Authentication').matchAll(/^[-*]\s*\*\*(.+?)\*\*/gm)].map((m) => m[1].trim());
  const managed = /"is_composio_managed"\s*:\s*true/.test(md) || /composio[- ]managed/i.test(section(md, 'Authentication'));
  return {
    slug, name: ((md.match(/^#\s+(.+)$/m) || [])[1] || '').trim() || pretty(slug),
    description: section(md, 'Description').replace(/\s+/g, ' ').trim().slice(0, 600),
    prompts: [...section(md, 'Suggested Prompts').matchAll(/^[-*]\s+(.+)$/gm)].map((m) => m[1].replace(/^["“]|["”]$/g, '').trim()).slice(0, 6),
    toolList: tools, triggerList: triggers,
    tools: num('Tools') || tools.length, triggers: num('Triggers') || triggers.length,
    auth: !auth.length && /no auth/i.test(md) ? 'none' : managed ? 'managed' : auth.some((a) => /api key|token|basic/i.test(a)) ? 'key' : 'managed',
    schemes: auth,
  };
}

// ---------- the cached catalogue ----------
let cat = null, loading = null, filling = false;
function readFile() { try { const j = JSON.parse(fs.readFileSync(FILE(), 'utf8')); return Array.isArray(j.apps) && j.apps.length ? j : null; } catch { return null; } }
function writeFile(j) { try { fs.mkdirSync(path.dirname(FILE()), { recursive: true }); fs.writeFileSync(FILE() + '.tmp', JSON.stringify(j)); fs.renameSync(FILE() + '.tmp', FILE()); } catch { /* read-only disk: memory only */ } }

export async function publicCatalog() {
  if (cat && Date.now() - cat.at < FRESH) return cat.apps;
  const disk = readFile();
  if (disk && Date.now() - (disk.at || 0) < FRESH) { cat = disk; fillCounts(); return cat.apps; }
  loading ??= (async () => {
    const html = await get(SITE() + '/toolkits', 30000);
    const apps = html ? parseDirectory(html) : [];
    if (apps.length < 20) {
      if (disk) { cat = disk; return; }
      // offline: the best-known apps, so connecting still works; the full directory is tried again in 10 minutes
      cat = { at: Date.now() - FRESH + 10 * 60e3, offline: true, apps: FALLBACK.map((slug, i) => ({ slug, name: pretty(slug), description: '', logo: 'https://logos.composio.dev/api/' + slug, categories: [], rank: i, tools: 0, triggers: 0, auth: 'managed', schemes: [] })) };
      return;
    }
    const old = new Map(((disk && disk.apps) || []).map((a) => [a.slug, a]));
    for (const a of apps) { const o = old.get(a.slug); if (o) Object.assign(a, { tools: o.tools, triggers: o.triggers, auth: o.auth, counted: o.counted }); }
    cat = { at: Date.now(), apps }; writeFile(cat); fillCounts();
  })().finally(() => { loading = null; });
  await loading;
  return cat.apps;
}
// tool / trigger counts, a few pages at a time, saved as they come in
function fillCounts() {
  if (filling || !cat || env('COMPOSIO_CATALOG_COUNTS') === 'off') return;
  const todo = cat.apps.filter((a) => !a.counted);
  if (!todo.length) return;
  filling = true;
  (async () => {
    let n = 0;
    const work = async () => {
      for (let a; (a = todo.shift());) {
        const md = await get(SITE() + '/toolkits/' + a.slug + '.md', 15000);
        if (md) { const d = parseAppPage(a.slug, md); Object.assign(a, { tools: d.tools, triggers: d.triggers, auth: d.auth }); details.set(a.slug, { at: Date.now(), v: d }); }
        a.counted = true;
        if (++n % 50 === 0) writeFile(cat);
      }
    };
    await Promise.all(Array.from({ length: 6 }, work));
    writeFile(cat);
  })().catch(() => {}).finally(() => { filling = false; });
}

const details = new Map();
export async function publicAppInfo(slug) {
  if (!/^[a-z0-9_-]{2,60}$/.test(String(slug || ''))) throw Object.assign(new Error('Unknown app.'), { status: 400 });
  const hit = details.get(slug);
  let v = hit && Date.now() - hit.at < 24 * 3600e3 ? hit.v : null;
  if (!v) {
    const md = await get(SITE() + '/toolkits/' + slug + '.md', 15000);
    if (!md) throw Object.assign(new Error('Couldn’t load this app’s details from composio.dev.'), { status: 502 });
    v = parseAppPage(slug, md);
    details.set(slug, { at: Date.now(), v });
  }
  const base = cat && cat.apps.find((a) => a.slug === slug);
  if (base) Object.assign(base, { tools: v.tools, triggers: v.triggers, auth: v.auth, counted: true });
  // the directory's name, logo and categories are the better ones
  return { ...v, logo: (base && base.logo) || 'https://logos.composio.dev/api/' + slug, categories: (base && base.categories) || [], name: (base && base.name) || v.name, description: v.description || (base && base.description) || '' };
}
export const _forTests = { reset: () => { cat = null; loading = null; details.clear(); } };
