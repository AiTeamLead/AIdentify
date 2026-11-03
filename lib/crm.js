// Native CRM. Contacts, companies, deals, tags, timeline and tasks live on this account only.
// Nothing here calls Salesforce, HubSpot or any other external CRM. A message to a person is a draft
// until the owner approves it. Records are one key each so two edits cannot wipe each other.
import crypto from 'node:crypto';

export const EXTERNAL_CRM = new Set(['salesforce', 'hubspot', 'zoho', 'pipedrive', 'close', 'freshsales', 'dynamics', 'dynamics365', 'msdynamics']);
export function externalCrmSlug(slug) {
  const s = String(slug || '').toLowerCase().replace(/^cx:/, '').replace(/[^a-z0-9_]/g, '');
  return EXTERNAL_CRM.has(s);
}
export const CRM_BLOCK = 'Customer records stay in AaaS. Salesforce, HubSpot and other external CRMs are not connected.';

const COLORS = ['#2f2a86', '#0e8f62', '#8a5a00', '#b42318', '#1d4e89', '#6d28d9'];
const DEFAULT_STAGES = [
  { id: 'new', name: 'New', color: '#5b8def' },
  { id: 'qualified', name: 'Qualified', color: '#0e8f62' },
  { id: 'proposal', name: 'Proposal', color: '#8a5a00' },
  { id: 'won', name: 'Won', color: '#0e8f62' },
  { id: 'lost', name: 'Lost', color: '#b42318' },
];
const KINDS = new Set(['contact', 'company', 'deal', 'activity', 'task']);
const ACT = new Set(['note', 'whatsapp', 'email', 'call', 'task']);

const parse = (v, d) => { try { return v == null || v === '' ? d : (JSON.parse(v) ?? d); } catch { return d; } };
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const id = () => 'c' + crypto.randomBytes(5).toString('hex');
const key = (email, kind, itemId) => 'as_crm:' + kind + ':' + email + ':' + itemId;
const metaKey = (email) => 'as_crmmeta:' + email;
const prefix = (email, kind) => 'as_crm:' + kind + ':' + email + ':';

function bad(message) { const e = new Error(message); e.status = 400; e.code = 'bad_crm'; throw e; }

async function rows(st, email, kind) {
  if (typeof st.listPrefix !== 'function') return [];
  const list = await st.listPrefix(prefix(email, kind));
  return list.map((r) => parse(r.v, null)).filter((x) => x && x.id);
}
async function putItem(st, email, kind, item) {
  await st.put(key(email, kind, item.id), JSON.stringify(item), Date.now());
  return item;
}
async function getItem(st, email, kind, itemId) {
  const row = await st.get(key(email, kind, itemId));
  return parse(row && row.v, null);
}

export async function pipelineOf(st, email) {
  const meta = parse((await st.get(metaKey(email)))?.v, null) || {};
  const stages = Array.isArray(meta.stages) && meta.stages.length ? meta.stages : DEFAULT_STAGES.map((s) => ({ ...s }));
  return { stages, tags: Array.isArray(meta.tags) ? meta.tags : [] };
}
async function saveMeta(st, email, meta) {
  await st.put(metaKey(email), JSON.stringify(meta), Date.now());
  return meta;
}

function cleanTags(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(',');
  const out = [];
  for (const raw of list) {
    const name = clip(typeof raw === 'object' ? raw.name : raw, 32);
    if (!name) continue;
    const color = typeof raw === 'object' && /^#[0-9a-fA-F]{6}$/.test(raw.color || '') ? raw.color : COLORS[out.length % COLORS.length];
    if (!out.some((t) => t.name.toLowerCase() === name.toLowerCase())) out.push({ name, color });
    if (out.length >= 12) break;
  }
  return out;
}

export function dashboard(contacts, deals, tasks, stages, now = Date.now()) {
  const byStage = stages.map((s) => {
    const mine = deals.filter((d) => d.stage === s.id && d.stage !== 'lost');
    const value = mine.reduce((n, d) => n + (Number(d.value) || 0), 0);
    return { id: s.id, name: s.name, color: s.color, count: deals.filter((d) => d.stage === s.id).length, value };
  });
  const open = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
  const due = tasks.filter((t) => !t.done && t.due && Date.parse(t.due) <= now + 864e5);
  return {
    contacts: contacts.length,
    companies: null,
    deals: deals.length,
    pipelineValue: open.reduce((n, d) => n + (Number(d.value) || 0), 0),
    wonValue: deals.filter((d) => d.stage === 'won').reduce((n, d) => n + (Number(d.value) || 0), 0),
    byStage,
    followUpsDue: due.length,
    followUps: due.slice(0, 12).map((t) => ({ id: t.id, title: t.title, due: t.due, contactId: t.contactId || '' })),
  };
}

function match(q, parts) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return true;
  return parts.some((p) => String(p || '').toLowerCase().includes(s));
}

export async function crmRoutes({ method, pathname, query, json, st, email, HttpError }) {
  if (!pathname.startsWith('/api/crm')) return undefined;
  const q = (name) => String(query && query.get ? (query.get(name) || '') : '');
  const body = () => (json && json()) || {};
  const own = (kind, itemId) => getItem(st, email, kind, itemId);

  if (pathname === '/api/crm' && method === 'GET') {
    const meta = await pipelineOf(st, email);
    const [contacts, companies, deals, tasks] = await Promise.all(['contact', 'company', 'deal', 'task'].map((k) => rows(st, email, k)));
    const dash = dashboard(contacts, deals, tasks, meta.stages);
    dash.companies = companies.length;
    return { stages: meta.stages, tags: meta.tags, dashboard: dash, native: true, externalCrm: false };
  }
  if (pathname === '/api/crm/pipeline' && method === 'POST') {
    const b = body();
    const stages = (Array.isArray(b.stages) ? b.stages : []).map((s, i) => {
      const name = clip(s.name, 40);
      if (!name) bad('Every stage needs a name.');
      const idv = String(s.id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || ('s' + i);
      const color = /^#[0-9a-fA-F]{6}$/.test(s.color || '') ? s.color : COLORS[i % COLORS.length];
      return { id: idv, name, color };
    }).slice(0, 12);
    if (stages.length < 2) bad('Keep at least two stages.');
    const meta = await pipelineOf(st, email);
    meta.stages = stages;
    await saveMeta(st, email, meta);
    return { stages };
  }

  const one = pathname.match(/^\/api\/crm\/(contacts|companies|deals|activities|tasks)(?:\/([A-Za-z0-9]+))?$/);
  if (one) {
    const kind = { contacts: 'contact', companies: 'company', deals: 'deal', activities: 'activity', tasks: 'task' }[one[1]];
    const itemId = one[2] || '';
    if (method === 'GET' && !itemId) {
      let list = await rows(st, email, kind);
      const tag = q('tag').toLowerCase();
      const stage = q('stage');
      const companyId = q('companyId');
      const contactId = q('contactId');
      const text = q('q');
      list = list.filter((x) => (!tag || (x.tags || []).some((t) => String(t.name || t).toLowerCase() === tag))
        && (!stage || x.stage === stage)
        && (!companyId || x.companyId === companyId)
        && (!contactId || x.contactId === contactId)
        && match(text, [x.name, x.title, x.email, x.phone, x.website, x.body, ...(x.tags || []).map((t) => t.name || t)]));
      list.sort((a, b) => (b.updatedAt || b.at || 0) - (a.updatedAt || a.at || 0));
      return { items: list.slice(0, 500), total: list.length };
    }
    if (method === 'GET' && itemId) {
      const item = await own(kind, itemId);
      if (!item) throw new HttpError(404, 'not_found', 'That record is not on this account.');
      const extra = {};
      if (kind === 'contact') extra.activities = (await rows(st, email, 'activity')).filter((a) => a.contactId === itemId).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 100);
      return { item, ...extra };
    }
    if (method === 'POST' && !itemId) {
      const b = body();
      const now = Date.now();
      let item;
      if (kind === 'contact') {
        const name = clip(b.name, 120);
        if (name.length < 2) bad('Give the contact a name.');
        item = { id: id(), name, email: clip(b.email, 200).toLowerCase(), phone: clip(b.phone, 24), companyId: clip(b.companyId, 40), tags: cleanTags(b.tags), source: clip(b.source, 60) || 'Manual', notes: clip(b.notes, 2000), at: now, updatedAt: now };
      } else if (kind === 'company') {
        const name = clip(b.name, 160);
        if (name.length < 2) bad('Give the company a name.');
        item = { id: id(), name, website: clip(b.website, 200), tags: cleanTags(b.tags), notes: clip(b.notes, 2000), at: now, updatedAt: now };
      } else if (kind === 'deal') {
        const title = clip(b.title || b.name, 160);
        if (title.length < 2) bad('Give the deal a title.');
        const meta = await pipelineOf(st, email);
        const stage = meta.stages.some((s) => s.id === b.stage) ? b.stage : meta.stages[0].id;
        item = { id: id(), title, value: Math.max(0, Number(b.value) || 0), stage, contactId: clip(b.contactId, 40), companyId: clip(b.companyId, 40), tags: cleanTags(b.tags), at: now, updatedAt: now };
      } else if (kind === 'activity') {
        const contactId = clip(b.contactId, 40);
        if (!contactId || !(await own('contact', contactId))) bad('Attach the note to a contact on this account.');
        const act = ACT.has(b.kind) ? b.kind : 'note';
        item = { id: id(), contactId, dealId: clip(b.dealId, 40), kind: act, body: clip(b.body, 4000), at: now, status: act === 'whatsapp' || act === 'email' ? 'draft' : 'logged' };
        if (item.status === 'draft') item.needsApproval = true;
      } else {
        const title = clip(b.title, 160);
        if (title.length < 2) bad('Give the task a title.');
        const due = b.due ? new Date(b.due).toISOString() : '';
        if (b.due && !Date.parse(b.due)) bad('Due date is not valid.');
        item = { id: id(), title, contactId: clip(b.contactId, 40), due, done: false, note: clip(b.note, 1000), at: now, updatedAt: now };
      }
      await putItem(st, email, kind, item);
      return { item };
    }
    if ((method === 'PATCH' || method === 'POST') && itemId && method !== 'GET') {
      const cur = await own(kind, itemId);
      if (!cur) throw new HttpError(404, 'not_found', 'That record is not on this account.');
      const b = body();
      if (kind === 'deal' && b.stage) {
        const meta = await pipelineOf(st, email);
        if (!meta.stages.some((s) => s.id === b.stage)) bad('That stage is not on this pipeline.');
        cur.stage = b.stage;
      }
      if (b.name != null && kind !== 'deal') cur.name = clip(b.name, 160);
      if (b.title != null) cur.title = clip(b.title, 160);
      if (b.value != null && kind === 'deal') cur.value = Math.max(0, Number(b.value) || 0);
      if (b.tags != null) cur.tags = cleanTags(b.tags);
      if (b.notes != null) cur.notes = clip(b.notes, 2000);
      if (b.email != null && kind === 'contact') cur.email = clip(b.email, 200).toLowerCase();
      if (b.phone != null && kind === 'contact') cur.phone = clip(b.phone, 24);
      if (b.companyId != null) cur.companyId = clip(b.companyId, 40);
      if (b.done != null && kind === 'task') cur.done = !!b.done;
      if (b.body != null && kind === 'activity') cur.body = clip(b.body, 4000);
      cur.updatedAt = Date.now();
      await putItem(st, email, kind, cur);
      return { item: cur };
    }
    if (method === 'DELETE' && itemId) {
      const cur = await own(kind, itemId);
      if (!cur) throw new HttpError(404, 'not_found', 'That record is not on this account.');
      if (st.del) await st.del(key(email, kind, itemId));
      else await st.put(key(email, kind, itemId), null, Date.now());
      return { ok: true, deleted: itemId };
    }
  }

  if (pathname === '/api/crm/export' && method === 'GET') {
    const [contacts, companies, deals] = await Promise.all(['contact', 'company', 'deal'].map((k) => rows(st, email, k)));
    const lines = ['type,name,email,phone,company,website,title,value,stage,tags,notes'];
    const cell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    for (const c of companies) lines.push(['company', c.name, '', '', '', c.website, '', '', '', (c.tags || []).map((t) => t.name).join('|'), c.notes].map(cell).join(','));
    for (const c of contacts) lines.push(['contact', c.name, c.email, c.phone, c.companyId, '', '', '', '', (c.tags || []).map((t) => t.name).join('|'), c.notes].map(cell).join(','));
    for (const d of deals) lines.push(['deal', '', '', '', d.companyId, '', d.title, d.value, d.stage, (d.tags || []).map((t) => t.name).join('|'), ''].map(cell).join(','));
    return { __text: lines.join('\n') + '\n', __name: 'aaas-crm.csv' };
  }
  if (pathname === '/api/crm/import' && method === 'POST') {
    const text = String(body().csv || body().text || '');
    if (!text.trim()) bad('Paste a CSV.');
    if (text.length > 500000) bad('CSV is too large.');
    const imported = await importCsv(st, email, text);
    return imported;
  }
  if (pathname === '/api/crm/agent/ingest' && method === 'POST') {
    const b = body();
    const item = await ingestEnquiry(st, email, { name: b.name, phone: b.phone, email: b.email, note: b.note, source: b.source || 'Agent', channel: b.channel || 'agent' });
    return { contact: item, sent: false };
  }
  if (pathname === '/api/crm/agent/remind' && method === 'POST') {
    const b = body();
    const contact = await own('contact', clip(b.contactId, 40));
    if (!contact) throw new HttpError(404, 'not_found', 'That contact is not on this account.');
    const due = b.due && Date.parse(b.due) ? new Date(b.due).toISOString() : new Date(Date.now() + 864e5).toISOString();
    const task = await putItem(st, email, 'task', { id: id(), title: clip(b.title, 160) || ('Follow up with ' + contact.name), contactId: contact.id, due, done: false, note: clip(b.message, 1000), at: Date.now(), updatedAt: Date.now() });
    const activity = await putItem(st, email, 'activity', { id: id(), contactId: contact.id, kind: 'task', body: task.title, at: Date.now(), status: 'logged' });
    return { task, activity, sent: false, approval: 'A message still has to be approved before anything is sent.' };
  }
  throw new HttpError(404, 'not_found');
}

export async function ingestEnquiry(st, email, { name, phone, email: mail, note, source, channel }) {
  const now = Date.now();
  const list = await rows(st, email, 'contact');
  const digits = String(phone || '').replace(/\D/g, '');
  const found = list.find((c) => (mail && c.email && c.email === String(mail).toLowerCase()) || (digits && String(c.phone || '').replace(/\D/g, '') === digits));
  if (found) {
    if (note) await putItem(st, email, 'activity', { id: id(), contactId: found.id, kind: channel === 'whatsapp' ? 'whatsapp' : 'note', body: clip(note, 2000), at: now, status: 'logged' });
    return found;
  }
  const who = clip(name, 120);
  if (who.length < 2) return null;
  const item = { id: id(), name: who, email: clip(mail, 200).toLowerCase(), phone: clip(phone, 24), companyId: '', tags: cleanTags(source || ''), source: clip(source, 60) || 'Enquiry', notes: '', at: now, updatedAt: now };
  await putItem(st, email, 'contact', item);
  if (note) await putItem(st, email, 'activity', { id: id(), contactId: item.id, kind: channel === 'whatsapp' ? 'whatsapp' : 'note', body: clip(note, 2000), at: now, status: 'logged' });
  const meta = await pipelineOf(st, email);
  await putItem(st, email, 'deal', { id: id(), title: who, value: 0, stage: meta.stages[0].id, contactId: item.id, companyId: '', tags: [], at: now, updatedAt: now });
  return item;
}

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
export async function importCsv(st, email, text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) bad('CSV is empty.');
  const head = splitCsv(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (n) => head.indexOf(n);
  let contacts = 0, companies = 0, deals = 0;
  for (const line of lines.slice(1, 2001)) {
    const c = splitCsv(line);
    const get = (n) => (idx(n) >= 0 ? c[idx(n)] || '' : '').trim();
    const type = (get('type') || 'contact').toLowerCase();
    if (type === 'company') {
      if (get('name').length < 2) continue;
      await putItem(st, email, 'company', { id: id(), name: clip(get('name'), 160), website: clip(get('website'), 200), tags: cleanTags(get('tags').split('|')), notes: clip(get('notes'), 2000), at: Date.now(), updatedAt: Date.now() });
      companies++;
    } else if (type === 'deal') {
      const meta = await pipelineOf(st, email);
      const stage = meta.stages.some((s) => s.id === get('stage')) ? get('stage') : meta.stages[0].id;
      const title = clip(get('title') || get('name'), 160);
      if (title.length < 2) continue;
      await putItem(st, email, 'deal', { id: id(), title, value: Math.max(0, Number(get('value')) || 0), stage, contactId: '', companyId: clip(get('company'), 40), tags: cleanTags(get('tags').split('|')), at: Date.now(), updatedAt: Date.now() });
      deals++;
    } else {
      const name = clip(get('name'), 120);
      if (name.length < 2) continue;
      await putItem(st, email, 'contact', { id: id(), name, email: clip(get('email'), 200).toLowerCase(), phone: clip(get('phone'), 24), companyId: '', tags: cleanTags(get('tags').split('|')), source: 'CSV', notes: clip(get('notes'), 2000), at: Date.now(), updatedAt: Date.now() });
      contacts++;
    }
  }
  return { contacts, companies, deals };
}

export async function scheduleFollowUp(st, email, { contactId, title, due, message }) {
  const contact = await getItem(st, email, 'contact', String(contactId || ''));
  if (!contact) return null;
  const when = due && Date.parse(due) ? new Date(due).toISOString() : new Date(Date.now() + 864e5).toISOString();
  const task = await putItem(st, email, 'task', { id: id(), title: clip(title, 160) || ('Follow up with ' + contact.name), contactId: contact.id, due: when, done: false, note: clip(message, 1000), at: Date.now(), updatedAt: Date.now() });
  return { task, sent: false };
}
export async function crmSummary(st, email) {
  const meta = await pipelineOf(st, email);
  const [contacts, companies, deals, tasks] = await Promise.all(['contact', 'company', 'deal', 'task'].map((k) => rows(st, email, k)));
  const dash = dashboard(contacts, deals, tasks, meta.stages);
  dash.companies = companies.length;
  return dash;
}
const DEMO_CONTACTS = [
  { name: 'Asha Rao', phone: '919800010011', email: 'asha@client.example', tags: 'retainer', source: 'Instagram', value: 25000, stage: 'proposal' },
  { name: 'Rohan Mehta', phone: '919800010012', email: 'rohan@client.example', tags: 'ads', source: 'Website', value: 15000, stage: 'qualified' },
  { name: 'Meera Shah', phone: '919800010013', email: 'meera@client.example', tags: 'content', source: 'Referral', value: 8000, stage: 'new' },
];
export async function seedDemoCrm(st, email) {
  const have = await rows(st, email, 'contact');
  if (have.length) return { seeded: false };
  const meta = await pipelineOf(st, email);
  for (const row of DEMO_CONTACTS) {
    const contact = await ingestEnquiry(st, email, row);
    if (!contact) continue;
    const deals = await rows(st, email, 'deal');
    const deal = deals.find((d) => d.contactId === contact.id);
    if (deal) {
      deal.value = row.value;
      deal.stage = meta.stages.some((s) => s.id === row.stage) ? row.stage : deal.stage;
      deal.updatedAt = Date.now();
      await putItem(st, email, 'deal', deal);
    }
  }
  return { seeded: true, contacts: DEMO_CONTACTS.length };
}
export const _test = { DEFAULT_STAGES, KINDS };
