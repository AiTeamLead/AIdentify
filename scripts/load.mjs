// About 50 concurrent clinics hitting health and the public meta route.
// Usage: node scripts/load.mjs http://127.0.0.1:3000
const base = process.argv[2] || 'http://127.0.0.1:3000';
const n = Number(process.argv[3] || 50);
const t0 = Date.now();
const jobs = Array.from({ length: n }, (_, i) => fetch(base + (i % 2 ? '/api/clinic/meta' : '/api/health')).then((r) => r.status));
const codes = await Promise.all(jobs);
const ms = Date.now() - t0;
const ok = codes.filter((c) => c === 200).length;
console.log(JSON.stringify({ base, concurrent: n, ok, ms, statuses: [...new Set(codes)] }));
if (ok !== n) process.exitCode = 1;
