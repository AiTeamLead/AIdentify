const DAY = 864e5;

export function dueFestivals(events, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const limit = new Date(now + 7 * DAY).toISOString().slice(0, 10);
  return (events || []).filter((f) => f.date >= today && f.date <= limit);
}
