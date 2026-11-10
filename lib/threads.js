// Chief threads for one account. A rolling summary replaces older turns after 8 messages.
// Retrieval is keyword overlap until a pgvector extension is configured.
const key = (email) => 'as_threads:' + String(email || '').toLowerCase();
const parse = (v) => { try { return JSON.parse(v); } catch { return []; } };
const id = () => 'th_' + Math.random().toString(16).slice(2, 10);

export async function listThreads(st, email) {
  const rows = parse((await st.get(key(email)))?.v || '[]');
  return (Array.isArray(rows) ? rows : []).map(({ id, title, summary, updatedAt }) => ({ id, title, summary, updatedAt }));
}

async function load(st, email) {
  const rows = parse((await st.get(key(email)))?.v || '[]');
  return Array.isArray(rows) ? rows : [];
}
async function save(st, email, rows) {
  await st.put(key(email), JSON.stringify(rows), Date.now());
}

export async function createThread(st, email, title) {
  const rows = await load(st, email);
  const thread = { id: id(), title: String(title || 'New chat').slice(0, 80), messages: [], summary: '', updatedAt: Date.now() };
  rows.unshift(thread);
  await save(st, email, rows);
  return thread;
}

export async function renameThread(st, email, threadId, title) {
  const rows = await load(st, email);
  const t = rows.find((x) => x.id === threadId);
  if (!t) return null;
  t.title = String(title || '').slice(0, 80) || t.title;
  t.updatedAt = Date.now();
  await save(st, email, rows);
  return t;
}

export async function deleteThread(st, email, threadId) {
  const rows = await load(st, email);
  const next = rows.filter((x) => x.id !== threadId);
  await save(st, email, next);
  return next.length !== rows.length;
}

function summarize(messages) {
  return messages.slice(0, 6).map((m) => (m.role === 'user' ? 'Owner: ' : 'Chief: ') + String(m.text || '').slice(0, 120)).join(' ');
}

export async function appendMessage(st, email, threadId, message) {
  const rows = await load(st, email);
  const t = rows.find((x) => x.id === threadId);
  if (!t) return null;
  t.messages.push({ role: message.role === 'assistant' ? 'assistant' : 'user', text: String(message.text || '').slice(0, 4000), at: Date.now() });
  if (t.messages.length > 8) {
    const old = t.messages.splice(0, t.messages.length - 6);
    t.summary = (t.summary ? t.summary + ' ' : '') + summarize(old);
    t.summary = t.summary.slice(-2000);
  }
  t.updatedAt = Date.now();
  await save(st, email, rows);
  return t;
}

export function recallFacts(thread, query) {
  const words = String(query || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const hay = ((thread && thread.summary) || '') + ' ' + ((thread && thread.messages) || []).map((m) => m.text).join(' ');
  const hits = words.filter((w) => hay.toLowerCase().includes(w));
  return { summary: (thread && thread.summary) || '', hits };
}
