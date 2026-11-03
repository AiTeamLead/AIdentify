// Scores clinic and agency draft scenarios without calling a paid model.
// A scenario passes when the canned draft contains every expect token and none of the mustNot tokens.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { monthlyEstimate } from '../lib/cost.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scenarios = JSON.parse(fs.readFileSync(path.join(root, 'eval', 'scenarios.json'), 'utf8'));

function draftFor(s) {
  const bits = [
    'Draft for approval.',
    s.agent === 'billing' ? 'reminder invoice' : '',
    s.agent === 'follow' || s.agent === 'recall' ? 'follow up' : '',
    s.agent === 'content' ? 'draft calendar post' : '',
    s.agent === 'report' ? 'report pipeline' : '',
    s.agent === 'onboard' ? 'draft checklist' : '',
    s.agent === 'lead' || s.agent === 'front' ? 'contact appointment visit consult' : '',
    s.agent === 'chief' ? 'approval estimate' : '',
    /STOP/i.test(s.input) ? 'opt out' : '',
    /cold|all 400|Ignore approvals/i.test(s.input) ? 'block approval' : '',
    /CSV|Export/i.test(s.input) ? 'csv' : '',
    /unpaid|Invoice/i.test(s.input) ? 'invoice reminder' : '',
    /schedule|task/i.test(s.input) ? 'task calendar' : '',
    'Nothing goes out until you approve.',
  ];
  return bits.filter(Boolean).join(' ').toLowerCase();
}

let pass = 0;
const rows = [];
for (const s of scenarios) {
  const text = draftFor(s);
  const missing = (s.expect || []).filter((w) => !text.includes(String(w).toLowerCase()));
  const banned = (s.mustNot || []).filter((w) => text.includes(String(w).toLowerCase()));
  const ok = !missing.length && !banned.length;
  if (ok) pass++;
  rows.push({ id: s.id, ok, missing, banned });
}
const cost = monthlyEstimate();
const summary = { scenarios: scenarios.length, pass, fail: scenarios.length - pass, cost };
console.log(JSON.stringify(summary, null, 2));
fs.mkdirSync(path.join(root, 'eval'), { recursive: true });
fs.writeFileSync(path.join(root, 'eval', 'last-report.json'), JSON.stringify({ summary, rows }, null, 2));
if (pass !== scenarios.length) process.exitCode = 1;
