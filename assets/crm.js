// CRM screen. Uses the same tokens, buttons and cards as the rest of the clinic app.
function crmPage() {
  const box = window.__crm || { loaded: false, tab: 'board' };
  window.__crm = box;
  if (!box.loaded && !box.loading) {
    box.loading = true;
    api('/api/crm').then((d) => { box.loaded = true; box.loading = false; box.d = d; box.err = ''; render(); }).catch((e) => { box.loaded = true; box.loading = false; box.err = e.message || 'Could not load CRM.'; render(); });
  }
  if (!box.loaded) return banner() + '<h1>CRM</h1><p class="sub">Loading contacts and deals…</p>';
  if (box.err) return banner() + '<h1>CRM</h1><p class="banner">' + esc(box.err) + '</p>';
  const d = box.d || {};
  const dash = d.dashboard || {};
  const stages = d.stages || [];
  const deals = box.deals || [];
  const contacts = box.contacts || [];
  if (box.loaded && !box.lists && !box.loadingLists) {
    box.loadingLists = true;
    Promise.all([api('/api/crm/contacts'), api('/api/crm/deals'), api('/api/crm/companies')]).then(([c, de, co]) => {
      box.contacts = c.items || []; box.deals = de.items || []; box.companies = co.items || []; box.lists = true; box.loadingLists = false; render();
    }).catch((e) => { box.loadingLists = false; box.err = e.message; render(); });
  }
  const q = String(box.q || '').toLowerCase();
  const vis = (list, fields) => list.filter((x) => !q || fields.some((f) => String(x[f] || '').toLowerCase().includes(q)));
  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const board = stages.map((s) => {
    const mine = vis(deals, ['title']).filter((x) => x.stage === s.id);
    return '<section class="kanban-col"><header><b>' + esc(s.name) + '</b><span class="small">' + mine.length + '</span></header>'
      + mine.map((deal) => '<article class="deal"><b>' + esc(deal.title) + '</b><div class="small">' + money(deal.value) + '</div>'
        + stages.filter((n) => n.id !== s.id).slice(0, 3).map((n) => '<button class="btn-ghost" type="button" data-crm="stage" data-id="' + esc(deal.id) + '" data-stage="' + esc(n.id) + '">' + esc(n.name) + '</button>').join(' ')
        + '</article>').join('') + '</section>';
  }).join('');
  const rows = vis(contacts, ['name', 'email', 'phone']).map((c) => '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.email || '') + '</td><td>' + esc(c.phone || '') + '</td><td>' + (c.tags || []).map((t) => '<span class="pill" style="background:' + esc(t.color || '#eef2f6') + '">' + esc(t.name) + '</span>').join(' ') + '</td></tr>').join('');
  return banner() + '<h1>CRM</h1><p class="sub">Contacts, companies and deals stay in AaaS. Nothing is synced to Salesforce or another CRM. A message still waits for your approval.</p>'
    + '<div class="kpis"><div class="tile"><div class="k">Pipeline</div><div class="v">' + money(dash.pipelineValue) + '</div></div>'
    + '<div class="tile"><div class="k">Follow-ups due</div><div class="v">' + esc(dash.followUpsDue || 0) + '</div></div>'
    + '<div class="tile"><div class="k">Contacts</div><div class="v">' + esc(dash.contacts || contacts.length) + '</div></div></div>'
    + '<div class="row-actions"><button class="btn' + (box.tab !== 'list' ? '' : '-ghost') + '" type="button" data-crm="tab" data-tab="board">Board</button>'
    + '<button class="btn' + (box.tab === 'list' ? '' : '-ghost') + '" type="button" data-crm="tab" data-tab="list">List</button>'
    + '<button class="btn-ghost" type="button" data-crm="export">Export CSV</button></div>'
    + '<form class="form" data-crm="add"><label>Contact name<input name="name" required></label><label>Phone<input name="phone"></label><label>Email<input name="email" type="email"></label><label>Tags<input name="tags" placeholder="retainer, warm"></label><div><button class="btn" type="submit">Add contact</button></div></form>'
    + '<label class="small">Search<input id="crmQ" value="' + esc(box.q || '') + '" placeholder="Name, email, phone"></label>'
    + (box.tab === 'list'
      ? '<div class="scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Tags</th></tr></thead><tbody>' + (rows || '<tr><td colspan="4">No contacts yet.</td></tr>') + '</tbody></table></div>'
      : '<div class="kanban">' + board + '</div>');
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-crm]');
  if (!b || typeof api !== 'function') return;
  const box = window.__crm || {};
  if (b.dataset.crm === 'tab') { box.tab = b.dataset.tab; window.__crm = box; render(); return; }
  if (b.dataset.crm === 'export') {
    const r = await fetch('/api/crm/export', { headers: { authorization: 'Bearer ' + (typeof token !== 'undefined' ? token : '') } });
    const text = await r.text();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = 'aaas-crm.csv';
    a.click();
    return;
  }
  if (b.dataset.crm === 'stage') {
    await api('/api/crm/deals/' + b.dataset.id, { stage: b.dataset.stage });
    box.lists = false; box.loaded = false; window.__crm = box; render();
  }
});
document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (!f || !f.dataset || f.dataset.crm !== 'add') return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(f).entries());
  await api('/api/crm/contacts', data);
  const box = window.__crm || {};
  box.lists = false; box.loaded = false; window.__crm = box; render();
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'crmQ') return;
  const box = window.__crm || {};
  box.q = e.target.value; window.__crm = box; render();
});
