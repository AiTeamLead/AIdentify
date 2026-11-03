// Data deletion requests under the DPDP Act 2023. This stores the request. It does not pretend to be legal advice.
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const key = (email) => 'as_delreq:' + String(email || '').toLowerCase();

export const GRIEVANCE = {
  name: process.env.GRIEVANCE_NAME || 'Phanindra Malladi',
  phone: process.env.GRIEVANCE_PHONE || '+91 63023 81884',
  email: process.env.GRIEVANCE_EMAIL || '',
};

export async function saveDeletionRequest(st, email, { note, name }) {
  const row = { email: String(email).toLowerCase(), name: clip(name, 120), note: clip(note, 2000), at: Date.now(), status: 'received' };
  await st.put(key(email), JSON.stringify(row), Date.now());
  return { ok: true, status: 'received', at: row.at, grievance: GRIEVANCE };
}
export async function deletionRequestOf(st, email) {
  try { return JSON.parse((await st.get(key(email)))?.v || 'null'); } catch { return null; }
}
