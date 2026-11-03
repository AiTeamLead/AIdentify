// k6 load script: 50 virtual users reading public clinic meta.
//   k6 run scripts/k6-clinics.js -e BASE=https://YOUR-PREVIEW.vercel.app
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { vus: 50, duration: '30s' };
const base = __ENV.BASE || 'http://127.0.0.1:3000';

export default function () {
  const res = http.get(base + '/api/clinic/meta');
  check(res, { 'meta 200': (r) => r.status === 200 });
  sleep(0.2);
}
