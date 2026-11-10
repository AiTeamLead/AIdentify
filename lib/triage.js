const key = (email) => 'as_triage:' + String(email || '').toLowerCase();
const parse = (v) => { try { return JSON.parse(v); } catch { return {}; } };

export async function decideContact(st, email, phone, decision) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return { ok: false, error: 'Enter a valid phone number.' };
  const cur = parse((await st.get(key(email)))?.v || '{}');
  const choice = decision === 'accept' ? 'accept' : 'decline';
  cur[digits] = { decision: choice, at: Date.now() };
  await st.put(key(email), JSON.stringify(cur), Date.now());
  return { ok: true, phone: digits, decision: choice, askAgain: false };
}

export async function triageOf(st, email, phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const cur = parse((await st.get(key(email)))?.v || '{}');
  return cur[digits] || null;
}
