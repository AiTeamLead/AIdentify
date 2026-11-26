// v2.14: fixes from the Monday test round (Issues on Monday.pdf).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';
import { fakeSMTP } from './mocks.mjs';
import '../lib/onboarding-rules.js';
import { rupeesInWords, invoiceModel, invoicePdfDoc } from '../lib/invoice-doc.js';

const PW = 'Tr1ckyHorse#Blue92';
const ENV = { RATE_LIMIT: 'off', AI_PROVIDER: 'mock', AI_MOCK: 'on', SAMPLE_DATA: 'off' };
const R = globalThis.OBRules;
async function req(s, method, p, body, token) {
  const r = await fetch(s.base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('json')) return { status: r.status, body: Buffer.from(await r.arrayBuffer()), ct };
  return { status: r.status, d: await r.json().catch(() => null) };
}
async function owner(s, email, role = 'dental', extra = {}) {
  const tok = (await req(s, 'POST', '/api/auth/signup', { email, name: 'Owner', password: PW })).d.token;
  const svc = { dental: ['Root canal treatment', 'Teeth whitening'], other: ['Vaccination'], realestate: ['Apartment sales'] }[role] || ['Consultation'];
  const p = await req(s, 'POST', '/api/clinic/profile', { biz: 'Bright Smile', locations: ['Hyderabad'], services: svc, audience: ['Families'], final: true, role, ...extra }, tok);
  assert.equal(p.status, 200, JSON.stringify(p.d));
  await req(s, 'POST', '/api/clinic/role', { role }, tok);
  return tok;
}

test('#3 business phone and toll-free accept exactly 10 digits', async () => {
  assert.equal(R.phone10('9014592724').value, '9014592724');
  assert.equal(R.phone10('+91 90145 92724').value, '9014592724');
  assert.equal(R.phone10('09014592724').value, '9014592724');
  assert.equal(R.phone10('1800123456').value, '1800123456');
  for (const bad of ['901459272423', '9015744546756789', '90145927', '90145abc24', '+44 7911 123456']) assert.equal(R.phone10(bad).ok, false, bad);
  const s = await startServer(ENV);
  try {
    const tok = await owner(s, 'p@example.com');
    let r = await req(s, 'POST', '/api/clinic/profile', { phone: '+91 901459272423' }, tok);
    assert.equal(r.status, 400); assert.match(r.d.message, /Business phone must be exactly 10 digits/);
    r = await req(s, 'POST', '/api/clinic/profile', { tollFree: '9015744546756789' }, tok);
    assert.equal(r.status, 400); assert.match(r.d.message, /Toll-free number must be exactly 10 digits/);
    r = await req(s, 'POST', '/api/clinic/profile', { phone: '9014592724', tollFree: '1800123456' }, tok);
    assert.equal(r.status, 200, JSON.stringify(r.d));
    const st = (await req(s, 'GET', '/api/clinic', undefined, tok)).d;
    assert.equal(st.profile.tollFree, '1800123456');
  } finally { await s.stop(); }
});

test('#9 #20 #21 delete clears approvals; invoices edit and stay sane; duplicate mobile is warned', async () => {
  const s = await startServer(ENV);
  try {
    const tok = await owner(s, 'd@example.com');
    const e1 = await req(s, 'POST', '/api/clinic/enquiries', { name: 'Ravi Kumar', phone: '9876543210', channel: 'Phone', message: 'Toothache' }, tok);
    assert.equal(e1.status, 200);
    const dup = await req(s, 'POST', '/api/clinic/enquiries', { name: 'Ravi', phone: '+91 98765 43210', channel: 'WhatsApp' }, tok);
    assert.equal(dup.status, 409); assert.equal(dup.d.error, 'duplicate_phone'); assert.match(dup.d.message, /This mobile number already exists: Ravi Kumar/);
    assert.equal((await req(s, 'POST', '/api/clinic/enquiries', { name: 'Ravi', phone: '9876543210', channel: 'WhatsApp', addToExisting: true }, tok)).status, 200);
    // invoices: limits, edit, UPI QR
    await req(s, 'POST', '/api/clinic/import', { csv: 'Customer Name,Mobile Number,Email ID\nAsha Rao,9876500001,asha@example.com' }, tok);
    let st = (await req(s, 'GET', '/api/clinic', undefined, tok)).d;
    const asha = st.patients.find((p) => p.name === 'Asha Rao'); assert.ok(asha, 'CSV with everyday column names lands in CRM');
    assert.equal((await req(s, 'POST', '/api/clinic/invoices', { patientId: asha.id, items: [{ desc: 'Crown', qty: 1, rate: 1200000000000 }] }, tok)).status, 400);
    assert.equal((await req(s, 'POST', '/api/clinic/invoices', { patientId: asha.id, items: [{ desc: 'Crown', qty: 5000, rate: 10 }] }, tok)).status, 400);
    const inv = (await req(s, 'POST', '/api/clinic/invoices', { patientId: asha.id, items: [{ desc: 'Root canal treatment', qty: 1, rate: 6000 }], upi: 'bright@okhdfcbank' }, tok)).d.invoice;
    const ed = await req(s, 'POST', '/api/clinic/invoices/edit', { id: inv.id, items: [{ desc: 'Root canal treatment', qty: 1, rate: 6500 }, { desc: 'X-ray', qty: 2, rate: 300 }], gst: 18, upi: 'bright@okhdfcbank' }, tok);
    assert.equal(ed.status, 200, JSON.stringify(ed.d)); assert.equal(ed.d.invoice.number, inv.number); assert.equal(ed.d.invoice.total, 8378);
    st = (await req(s, 'GET', '/api/clinic', undefined, tok)).d; assert.equal(st.invoices.length, 1, 'edit replaces, never duplicates');
    const pay = await req(s, 'GET', '/api/clinic/invoices/' + inv.id + '/pay', undefined, tok);
    assert.match(pay.d.upi, /^upi:\/\/pay\?pa=bright%40okhdfcbank&.*am=8378\.00&cu=INR&tn=INV-/); assert.match(pay.d.qr, /^data:image\/png;base64,/); assert.match(pay.d.wa, /^https:\/\/wa\.me\/919876500001/);
    const pdf = await req(s, 'GET', '/api/clinic/invoices/' + inv.id + '/pdf', undefined, tok);
    assert.equal(pdf.ct, 'application/pdf'); assert.match(pdf.body.toString('latin1', 0, 8), /^%PDF-1\.4/); assert.ok(pdf.body.toString('latin1').includes('TOTAL'));
    await req(s, 'POST', '/api/clinic/invoices/update', { id: inv.id, status: 'paid' }, tok);
    assert.equal((await req(s, 'POST', '/api/clinic/invoices/edit', { id: inv.id, items: [{ desc: 'X', qty: 1, rate: 1 }] }, tok)).status, 400, 'a paid invoice is not edited');
    // delete: records and their waiting approvals go
    await req(s, 'POST', '/api/clinic/recall/draft', { patientId: asha.id }, tok);
    assert.ok((await req(s, 'GET', '/api/agents/approvals', undefined, tok)).d.items.some((a) => a.status === 'pending'));
    assert.equal((await req(s, 'POST', '/api/clinic/data/delete', { confirm: 'delete my data' }, tok)).status, 200);
    assert.equal((await req(s, 'GET', '/api/agents/approvals', undefined, tok)).d.items.filter((a) => a.app === 'clinic').length, 0);
  } finally { await s.stop(); }
});

test('#10 approving a draft sends it by email from the owner’s Gmail, and says so plainly when it cannot', async () => {
  const smtp = await fakeSMTP();
  const s = await startServer({ ...ENV, SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_SECURE: 'false', SMTP_IGNORE_TLS: 'true' });
  try {
    const tok = await owner(s, 'm@example.com');
    await req(s, 'POST', '/api/clinic/import', { csv: 'name,phone,email\nAsha Rao,9876500001,asha@example.com\nNo Mail,9876500002,' }, tok);
    let st = (await req(s, 'GET', '/api/clinic', undefined, tok)).d;
    const asha = st.patients.find((p) => p.name === 'Asha Rao'), nm = st.patients.find((p) => p.name === 'No Mail');
    // not connected: approve tells the owner exactly why nothing went out
    const d0 = (await req(s, 'POST', '/api/clinic/message/draft', { patientId: nm.id, text: 'Hi, your next check-up is due. Shall we book it?' }, tok)).d.draft;
    st = (await req(s, 'GET', '/api/clinic', undefined, tok)).d;
    assert.equal(st.drafts.find((d) => d.id === d0.id).dest.channel, 'manual');
    const r0 = await req(s, 'POST', '/api/clinic/decide', { id: d0.approvalId, decision: 'approve' }, tok);
    assert.match(r0.d.approval.result, /Nothing was sent automatically.*connect your WhatsApp/);
    // Gmail by app password (works on localhost): the approved draft is emailed to the customer
    assert.equal((await req(s, 'POST', '/api/connectors/key', { c: 'gmail', fields: { user: 'owner@gmail.com', pass: 'abcd efgh ijkl mnop' } }, tok)).status, 200);
    const d1 = (await req(s, 'POST', '/api/clinic/message/draft', { patientId: asha.id, text: 'Hi Asha, your cleaning is due this month. Reply to book a slot.' }, tok)).d.draft;
    st = (await req(s, 'GET', '/api/clinic', undefined, tok)).d;
    assert.equal(st.gmailConnected, true);
    assert.deepEqual(st.drafts.find((d) => d.id === d1.id).dest.channel, 'email');
    const r1 = await req(s, 'POST', '/api/clinic/decide', { id: d1.approvalId, decision: 'approve' }, tok);
    assert.match(r1.d.approval.result, /^Sent by email to asha@example\.com/);
    assert.equal(smtp.mails.length, 1); assert.deepEqual(smtp.mails[0].to, ['asha@example.com']); assert.match(smtp.mails[0].data, /your cleaning is due/);
    st = (await req(s, 'GET', '/api/clinic', undefined, tok)).d;
    assert.equal(st.drafts.find((d) => d.id === d1.id).delivery.status, 'sent');
  } finally { await s.stop(); await smtp.close(); }
});

test('#16 #17 new enquiries reach Follow-ups with a Draft message; Chief answers enquiries, drafts and unpaid invoices', async () => {
  const s = await startServer(ENV);
  try {
    const tok = await owner(s, 'f@example.com');
    await req(s, 'POST', '/api/clinic/enquiries', { name: 'Kiran Rao', phone: '9876511111', channel: 'Instagram', message: 'Braces cost?' }, tok);
    const st = (await req(s, 'GET', '/api/clinic', undefined, tok)).d;
    const lead = st.flow.leads.find((l) => l.name === 'Kiran Rao'); assert.ok(lead);
    const m = await req(s, 'POST', '/api/clinic/message/draft', { leadId: lead.id, text: 'Hi Kiran, braces start at ₹45,000. Would you like a consultation this week?' }, tok);
    assert.equal(m.status, 200); assert.equal(m.d.draft.kind, 'message'); assert.equal(m.d.draft.to, '919876511111');
    assert.equal((await req(s, 'POST', '/api/clinic/message/draft', { leadId: lead.id, text: 'x' }, tok)).status, 400);
    const ask = async (q) => (await req(s, 'POST', '/api/workplace/chat', { message: q }, tok)).d.answer;
    assert.match(await ask('show my enquiries'), /1 open enquiry:[\s\S]*Kiran Rao/);
    assert.match(await ask('which drafts are waiting for approval'), /waiting for your approval:[\s\S]*Message to Kiran Rao/);
    assert.match(await ask('unpaid invoices'), /No unpaid invoices|unpaid invoice/);
  } finally { await s.stop(); }
});

test('#13 #2 an Other business gets services that fit what it typed', () => {
  assert.equal(R.kitFor('Pet clinic').label, 'pet clinic');
  assert.ok(R.kitFor('Pet clinic').services.includes('Vaccination'));
  assert.ok(R.kitFor('Bakery').services.includes('Birthday cakes'));
  assert.equal(R.kitFor('CA office').label, 'accounting firm');
  assert.equal(R.kitFor('Laptop repair').label, 'IT services business');
  assert.equal(R.kitFor('Smart home gadgets').label, 'business');
  assert.equal(R.kitFor('').label, 'business');
});

test('#15 invoice document: amount in words and a one-page A4 PDF', () => {
  assert.equal(rupeesInWords(17346), 'Seventeen Thousand Three Hundred Forty Six Rupees Only');
  assert.equal(rupeesInWords(125000.5), 'One Lakh Twenty Five Thousand Rupees and Fifty Paise Only');
  assert.equal(rupeesInWords(32500000), 'Three Crore Twenty Five Lakh Rupees Only');
  const c = { biz: 'Bright Smile', city: 'Hyderabad', phone: '+919876543210', profile: { gstin: '36ABCDE1234F1Z5', upi: 'b@okhdfcbank' }, patients: [{ id: 1, name: 'Asha', phone: '9876500001' }] };
  const m = invoiceModel(c, { number: 'INV-1001', patientId: 1, items: [{ desc: 'Root canal', qty: 1, rate: 6000 }], gst: 18, issuedAt: '2026-11-17T05:00:00Z', dueAt: '2026-11-24T05:00:00Z' }, { total: 7080, state: 'unpaid', upiLink: 'upi://pay?pa=b@okhdfcbank&am=7080.00' });
  assert.equal(m.gstAmt, 1080); assert.equal(m.phone, '+91 98765 43210');
  const pdf = invoicePdfDoc(m).toString('latin1');
  assert.match(pdf, /^%PDF-1\.4/); assert.match(pdf, /TAX INVOICE/); assert.match(pdf, /CGST 9%/); assert.match(pdf, /Seventeen|Seven Thousand Eighty/);
});
