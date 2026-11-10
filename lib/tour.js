export const DASHBOARD_TOUR = [
  { id: 'home', title: 'Dashboard', body: 'This is the whole business: money, bookings, and what needs you.' },
  { id: 'desk', title: 'Front Desk', body: 'New enquiries and appointments start here. Follow-ups and reviews sit in the same place.' },
  { id: 'social', title: 'Social Media', body: 'Drafts wait for you. Nothing is published until you approve it.' },
  { id: 'billing', title: 'Billing', body: 'Invoices, offers, and payment status live here.' },
  { id: 'approvals', title: 'Approvals', body: 'Every message that would leave the building stops here first.' },
];

export function tourState(stored, { skip = false, next = false, back = false } = {}) {
  const done = stored === 'done' || skip;
  let step = Number(stored);
  if (!Number.isFinite(step) || step < 0) step = 0;
  if (done) return { done: true, step: DASHBOARD_TOUR.length, current: null };
  if (next) step += 1;
  if (back) step -= 1;
  if (step >= DASHBOARD_TOUR.length) return { done: true, step: DASHBOARD_TOUR.length, current: null };
  if (step < 0) step = 0;
  return { done: false, step, current: DASHBOARD_TOUR[step] };
}
