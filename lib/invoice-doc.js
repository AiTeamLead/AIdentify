// The invoice as a document: one model, two renderings (an A4 PDF written by hand, and a print page).
// No external PDF library: standard Helvetica fonts, ruled table, coloured header, status stamp and a UPI QR code
// drawn as vector squares, so it prints sharp and opens in every PDF reader.
import QRCode from 'qrcode';

const INK = [0.106, 0.141, 0.188], MUTED = [0.42, 0.45, 0.5], LINE = [0.86, 0.88, 0.91], BRAND = [0.18, 0.165, 0.525], SOFT = [0.957, 0.957, 0.988];
const GREEN = [0.06, 0.48, 0.26], RED = [0.71, 0.14, 0.09], AMBER = [0.58, 0.38, 0.04];

// ---------- the numbers ----------
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
const three = (n) => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));
// Indian system: crore, lakh, thousand. 1,25,000.50 -> "One Lakh Twenty Five Thousand Rupees and Fifty Paise Only"
export function rupeesInWords(amount) {
  const v = Math.round(Math.max(0, Number(amount) || 0) * 100);
  let r = Math.floor(v / 100); const p = v % 100;
  if (!r && !p) return 'Zero Rupees Only';
  const parts = [];
  const cr = Math.floor(r / 1e7); r %= 1e7; const lk = Math.floor(r / 1e5); r %= 1e5; const th = Math.floor(r / 1000); r %= 1000;
  if (cr) parts.push((cr >= 100 ? rupeesInWords(cr).replace(/ Rupees.*$/, '') : two(cr)) + ' Crore');
  if (lk) parts.push(two(lk) + ' Lakh');
  if (th) parts.push(two(th) + ' Thousand');
  if (r) parts.push(three(r));
  return (parts.length ? parts.join(' ') + ' Rupees' : '') + (p ? (parts.length ? ' and ' : '') + two(p) + ' Paise' : '') + ' Only';
}
const inrFmt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const phoneFmt = (v) => { const d = String(v || '').replace(/\D/g, ''); if (d.length === 12 && d.startsWith('91')) return '+91 ' + d.slice(2, 7) + ' ' + d.slice(7); if (d.length === 10) return d.slice(0, 5) + ' ' + d.slice(5); return String(v || ''); };
const day = (iso) => { const t = Date.parse(iso || ''); return t ? new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : ''; };

export function invoiceModel(c, inv, { total, state, upiLink }) {
  const P = c.profile || {}, p = (c.patients || []).find((x) => x.id === inv.patientId) || {};
  const items = (inv.items || []).map((it) => ({ desc: String(it.desc || ''), qty: Number(it.qty) || 0, rate: Number(it.rate) || 0, amount: Math.round((Number(it.qty) || 0) * (Number(it.rate) || 0) * 100) / 100 }));
  const subtotal = items.reduce((s, it) => s + it.amount, 0), discount = Number(inv.discount) || 0;
  const gstPct = inv.gst == null || inv.gst === '' ? null : Number(inv.gst);
  const gstAmt = gstPct == null ? 0 : Math.round((total - Math.max(0, subtotal - discount)) * 100) / 100;
  return {
    biz: c.biz || 'Your business', address: P.address || '', city: c.city || '', phone: phoneFmt(c.phone || P.phone || ''), email: P.contactEmail || P.frontDeskEmail || '', website: P.website || '', gstin: P.gstin || '',
    number: inv.number || '', issued: day(inv.issuedAt), due: day(inv.dueAt), paidOn: day(inv.paidAt), state,
    billTo: { name: p.name || 'Customer', phone: phoneFmt(p.phone), email: p.email || '' },
    items, subtotal, discount, offer: inv.offer || '', gstPct, gstAmt, total, words: rupeesInWords(total),
    upiId: inv.upi || P.upi || '', upiLink: upiLink || '', payLink: /^https:\/\//.test(inv.payLink || '') ? inv.payLink : '', demo: !!inv.demo,
  };
}

// ---------- print page (HTML) ----------
const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export async function invoiceHtml(m) {
  let qr = '';
  if (m.upiLink && m.state !== 'paid') { try { qr = await QRCode.toDataURL(m.upiLink, { margin: 1, width: 300 }); } catch { qr = ''; } }
  const stamp = { paid: ['PAID', '#0f7a43'], overdue: ['OVERDUE', '#b42318'], unpaid: ['DUE', '#93600a'] }[m.state] || ['DUE', '#93600a'];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${h(m.number)} · ${h(m.biz)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1b2430;margin:0;background:#eef0f4}
.page{max-width:820px;margin:24px auto;background:#fff;box-shadow:0 2px 16px rgba(0,0,0,.08);border-radius:10px;overflow:hidden}
.top{background:#2e2a86;color:#fff;padding:28px 36px;display:flex;justify-content:space-between;gap:24px}.top h1{margin:0;font-size:22px}.top .sm{opacity:.85;font-size:12.5px}
.top .ttl{text-align:right}.top .ttl b{display:block;font-size:26px;letter-spacing:.06em}
.body{padding:28px 36px}.row{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}.lab{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:4px}
.stamp{display:inline-block;border:2px solid ${stamp[1]};color:${stamp[1]};font-weight:800;letter-spacing:.12em;padding:4px 12px;border-radius:6px;transform:rotate(-4deg)}
table{width:100%;border-collapse:collapse;margin:22px 0 10px}th{background:#f4f4fc;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#4b5563;padding:10px}td{padding:10px;border-bottom:1px solid #e5e7eb}.r{text-align:right}
.tot{margin-left:auto;width:320px}.tot div{display:flex;justify-content:space-between;padding:5px 0}.tot .g{border-top:2px solid #1b2430;margin-top:6px;padding-top:10px;font-size:18px;font-weight:700}
.words{background:#f4f4fc;border-radius:8px;padding:10px 14px;margin:16px 0;font-size:13px}.pay{display:flex;gap:20px;align-items:center;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-top:14px}
.pay img{width:120px;height:120px}.foot{color:#6b7280;font-size:12px;padding:16px 36px 28px;border-top:1px solid #e5e7eb}
.bar{max-width:820px;margin:16px auto 0;display:flex;gap:8px}.bar button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #c7c9d9;background:#fff;cursor:pointer}.bar button.p{background:#2e2a86;color:#fff;border-color:#2e2a86}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;border-radius:0}.bar{display:none}}
</style></head><body>
<div class="bar"><button class="p" onclick="print()">Print or save as PDF</button></div>
<div class="page"><div class="top"><div><h1>${h(m.biz)}</h1><div class="sm">${[m.address, m.city].filter(Boolean).map(h).join(', ')}</div><div class="sm">${[m.phone, m.email, m.website].filter(Boolean).map(h).join(' · ')}</div>${m.gstin ? `<div class="sm">GSTIN ${h(m.gstin)}</div>` : ''}</div>
<div class="ttl"><b>${m.gstPct != null && m.gstin ? 'TAX INVOICE' : 'INVOICE'}</b><div class="sm">${h(m.number)}</div></div></div>
<div class="body"><div class="row"><div><div class="lab">Bill to</div><b>${h(m.billTo.name)}</b><div>${[m.billTo.phone, m.billTo.email].filter(Boolean).map(h).join(' · ')}</div></div>
<div><div class="lab">Invoice date</div>${h(m.issued)}<div class="lab" style="margin-top:8px">${m.state === 'paid' ? 'Paid on' : 'Due date'}</div>${h(m.state === 'paid' ? m.paidOn : m.due)}</div>
<div style="align-self:center"><span class="stamp">${stamp[0]}</span></div></div>
<table><thead><tr><th style="width:40px">#</th><th>Description</th><th class="r">Qty</th><th class="r">Rate (₹)</th><th class="r">Amount (₹)</th></tr></thead><tbody>
${m.items.map((it, i) => `<tr><td>${i + 1}</td><td>${h(it.desc)}</td><td class="r">${it.qty}</td><td class="r">${inrFmt(it.rate)}</td><td class="r">${inrFmt(it.amount)}</td></tr>`).join('')}
</tbody></table>
<div class="tot"><div><span>Subtotal</span><span>₹${inrFmt(m.subtotal)}</span></div>${m.discount ? `<div><span>Discount${m.offer ? ' (' + h(m.offer) + ')' : ''}</span><span>− ₹${inrFmt(m.discount)}</span></div>` : ''}
${m.gstPct != null ? `<div><span>CGST ${m.gstPct / 2}%</span><span>₹${inrFmt(m.gstAmt / 2)}</span></div><div><span>SGST ${m.gstPct / 2}%</span><span>₹${inrFmt(m.gstAmt / 2)}</span></div>` : ''}
<div class="g"><span>Total</span><span>₹${inrFmt(m.total)}</span></div></div>
<div class="words"><b>Amount in words:</b> ${h(m.words)}</div>
${m.state !== 'paid' && (m.upiId || m.payLink) ? `<div class="pay">${qr ? `<img src="${qr}" alt="UPI QR code">` : ''}<div><b>Pay by UPI${m.payLink ? ' or online' : ''}</b>${m.upiId ? `<div>UPI ID: <b>${h(m.upiId)}</b></div><div class="lab" style="margin-top:6px">Scan with Google Pay, PhonePe, Paytm or any UPI app. Amount and invoice number are filled in.</div>` : ''}${m.payLink ? `<div>Pay online: <a href="${h(m.payLink)}">${h(m.payLink)}</a></div>` : ''}</div></div>` : ''}
</div><div class="foot">Thank you for your business.${m.gstPct == null ? ' GST not applied.' : ''} This is a computer-generated invoice and needs no signature.${m.demo ? ' <b>SAMPLE invoice — not a real bill.</b>' : ''}</div></div></body></html>`;
}

// ---------- PDF (A4, hand-written) ----------
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const latin = (s) => String(s == null ? '' : s).replace(/₹/g, 'Rs.').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/·/g, '-').replace(/[^\x20-\x7e]/g, '?');
const width = (s, size, bold) => latin(s).split('').reduce((w, ch) => w + (HELV[ch.charCodeAt(0) - 32] || 556), 0) * size / 1000 * (bold ? 1.06 : 1);
const pesc = (s) => latin(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
function fit(s, size, max, bold) { let t = latin(s); if (width(t, size, bold) <= max) return t; while (t.length > 1 && width(t + '...', size, bold) > max) t = t.slice(0, -1); return t + '...'; }
function wrap(s, size, max) { const out = []; let line = ''; for (const w of latin(s).split(/\s+/)) { const tryL = line ? line + ' ' + w : w; if (width(tryL, size) > max && line) { out.push(line); line = w; } else line = tryL; } if (line) out.push(line); return out; }

export function invoicePdfDoc(m) {
  const W = 595, H = 842, L = 44, Rr = W - 44; const ops = [];
  const col = (c) => c.map((x) => x.toFixed(3)).join(' ');
  const rect = (x, y, w, hh, fill) => ops.push(`${col(fill)} rg ${x} ${y} ${w} ${hh} re f`);
  const line = (x1, y1, x2, y2, c = LINE, wd = 0.8) => ops.push(`${col(c)} RG ${wd} w ${x1} ${y1} m ${x2} ${y2} l S`);
  const text = (s, x, y, { size = 10, bold = false, color = INK, align = 'left' } = {}) => { const t = latin(s); const xx = align === 'right' ? x - width(t, size, bold) : align === 'center' ? x - width(t, size, bold) / 2 : x; ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${col(color)} rg ${xx.toFixed(2)} ${y.toFixed(2)} Td (${pesc(t)}) Tj ET`); };
  // header band
  rect(0, H - 118, W, 118, BRAND);
  text(fit(m.biz, 20, 330, true), L, H - 50, { size: 20, bold: true, color: [1, 1, 1] });
  let hy = H - 68; for (const s of [[m.address, m.city].filter(Boolean).join(', '), [m.phone, m.email].filter(Boolean).join('  -  '), m.gstin ? 'GSTIN ' + m.gstin : ''].filter(Boolean)) { text(fit(s, 9, 330), L, hy, { size: 9, color: [0.88, 0.88, 0.97] }); hy -= 13; }
  text(m.gstPct != null && m.gstin ? 'TAX INVOICE' : 'INVOICE', Rr, H - 52, { size: 22, bold: true, color: [1, 1, 1], align: 'right' });
  text(m.number, Rr, H - 72, { size: 11, color: [0.88, 0.88, 0.97], align: 'right' });
  // bill to / dates / stamp
  let y = H - 152;
  text('BILL TO', L, y, { size: 8, bold: true, color: MUTED }); text('INVOICE DATE', 300, y, { size: 8, bold: true, color: MUTED }); text(m.state === 'paid' ? 'PAID ON' : 'DUE DATE', 400, y, { size: 8, bold: true, color: MUTED });
  y -= 16; text(fit(m.billTo.name, 12, 240, true), L, y, { size: 12, bold: true }); text(m.issued, 300, y, { size: 10 }); text(m.state === 'paid' ? m.paidOn : m.due, 400, y, { size: 10 });
  y -= 14; const contact = [m.billTo.phone, m.billTo.email].filter(Boolean).join('  -  '); if (contact) text(fit(contact, 9, 240), L, y, { size: 9, color: MUTED });
  const st = { paid: ['PAID', GREEN], overdue: ['OVERDUE', RED], unpaid: ['DUE', AMBER] }[m.state] || ['DUE', AMBER];
  const sw = width(st[0], 13, true) + 22; ops.push(`q ${col(st[1])} RG 1.6 w ${Rr - sw} ${y - 4} ${sw} 26 re S Q`); text(st[0], Rr - sw / 2, y + 4, { size: 13, bold: true, color: st[1], align: 'center' });
  // items table
  y -= 34; const cx = { n: L + 8, d: L + 34, q: 360, r: 450, a: Rr - 8 };
  rect(L, y - 8, Rr - L, 24, SOFT);
  text('#', cx.n, y, { size: 8.5, bold: true, color: MUTED }); text('DESCRIPTION', cx.d, y, { size: 8.5, bold: true, color: MUTED }); text('QTY', cx.q, y, { size: 8.5, bold: true, color: MUTED, align: 'right' }); text('RATE (RS.)', cx.r, y, { size: 8.5, bold: true, color: MUTED, align: 'right' }); text('AMOUNT (RS.)', cx.a, y, { size: 8.5, bold: true, color: MUTED, align: 'right' });
  y -= 26;
  for (const [i, it] of m.items.entries()) {
    const ls = wrap(it.desc, 10, cx.q - cx.d - 40).slice(0, 3);
    text(String(i + 1), cx.n, y, { size: 10, color: MUTED });
    ls.forEach((t, k) => text(t, cx.d, y - k * 12, { size: 10 }));
    text(String(it.qty), cx.q, y, { size: 10, align: 'right' }); text(inrFmt(it.rate), cx.r, y, { size: 10, align: 'right' }); text(inrFmt(it.amount), cx.a, y, { size: 10, align: 'right' });
    y -= 12 * ls.length + 8; line(L, y + 6, Rr, y + 6);
    y -= 6;
    if (y < 300) break; // a long invoice keeps to one page; up to 12 lines fit
  }
  // totals
  y -= 8; const tx = 360;
  const row = (k, v, o = {}) => { text(k, tx, y, { size: o.size || 10, bold: !!o.bold, color: o.color || INK }); text(v, Rr, y, { size: o.size || 10, bold: !!o.bold, color: o.color || INK, align: 'right' }); y -= o.gap || 16; };
  row('Subtotal', 'Rs. ' + inrFmt(m.subtotal));
  if (m.discount) row(fit('Discount' + (m.offer ? ' (' + m.offer + ')' : ''), 10, 120), '- Rs. ' + inrFmt(m.discount), { color: GREEN });
  if (m.gstPct != null) { row('CGST ' + m.gstPct / 2 + '%', 'Rs. ' + inrFmt(m.gstAmt / 2)); row('SGST ' + m.gstPct / 2 + '%', 'Rs. ' + inrFmt(m.gstAmt / 2)); }
  line(tx, y + 8, Rr, y + 8, INK, 1.4); y -= 8;
  row('TOTAL', 'Rs. ' + inrFmt(m.total), { size: 14, bold: true, gap: 26 });
  // amount in words
  const wl = wrap('Amount in words: ' + m.words, 9.5, Rr - L - 24);
  rect(L, y - 10 - (wl.length - 1) * 12, Rr - L, 20 + (wl.length - 1) * 12, SOFT);
  wl.forEach((t, k) => text(t, L + 12, y - k * 12, { size: 9.5 })); y -= 30 + (wl.length - 1) * 12;
  // pay box with a UPI QR drawn as squares
  if (m.state !== 'paid' && (m.upiId || m.payLink)) {
    const box = 128; ops.push(`q ${col(LINE)} RG 0.8 w ${L} ${y - box} ${Rr - L} ${box} re S Q`);
    let qx = L + 12;
    if (m.upiLink) {
      try {
        const q = QRCode.create(m.upiLink, { errorCorrectionLevel: 'M' }), n = q.modules.size, cell = 108 / n, top = y - 10;
        for (let r = 0; r < n; r++) for (let cI = 0; cI < n; cI++) if (q.modules.get(r, cI)) ops.push(`0 0 0 rg ${(L + 10 + cI * cell).toFixed(2)} ${(top - (r + 1) * cell).toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f`);
        qx = L + 132;
      } catch { qx = L + 12; }
    }
    text('Pay by UPI' + (m.payLink ? ' or online' : ''), qx, y - 24, { size: 12, bold: true });
    let py = y - 42;
    if (m.upiId) { text('UPI ID: ' + m.upiId, qx, py, { size: 10.5 }); py -= 15; text('Scan with Google Pay, PhonePe, Paytm or any UPI app.', qx, py, { size: 9, color: MUTED }); py -= 12; text('The amount and invoice number are filled in.', qx, py, { size: 9, color: MUTED }); py -= 15; }
    if (m.payLink) text(fit('Pay online: ' + m.payLink, 9.5, Rr - qx - 10), qx, py, { size: 9.5, color: BRAND });
    y -= box + 10;
  }
  // footer
  line(L, 64, Rr, 64);
  text('Thank you for your business.' + (m.gstPct == null ? ' GST not applied.' : '') + ' This is a computer-generated invoice and needs no signature.', L, 48, { size: 8.5, color: MUTED });
  if (m.demo) text('SAMPLE invoice - not a real bill.', L, 36, { size: 8.5, bold: true, color: RED });
  text(fit(m.biz + ' - ' + m.number, 8.5, 200), Rr, 36, { size: 8.5, color: MUTED, align: 'right' });

  const content = ops.join('\n');
  const objects = [];
  const add = (s) => { objects.push(s); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Count 1 /Kids [3 0 R] >>');
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>');
  add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R /Info << /Title (${pesc(m.number + ' - ' + m.biz)}) /Producer (AIdentify) >> >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
