// One journey for every industry. Labels change. The states do not.
export const STEPS = ['enquiry', 'qualified', 'booked', 'completed', 'invoiced', 'paid', 'review', 'referral', 'followup'];

const NEXT = {
  enquiry: 'qualified',
  qualified: 'booked',
  booked: 'completed',
  completed: 'invoiced',
  invoiced: 'paid',
  paid: 'review',
  review: 'referral',
  referral: 'followup',
};

export function advance(state, { external = false } = {}) {
  const cur = STEPS.includes(state) ? state : 'enquiry';
  const to = NEXT[cur];
  if (!to) return { ok: false, state: cur, error: 'This journey is already finished.' };
  return { ok: true, from: cur, state: to, event: { at: Date.now(), from: cur, to, external }, approval: external };
}
