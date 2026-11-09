/* Home page ("/"): theme toggle, industry tabs, mobile menu. */
const $ = (s, r = document) => r.querySelector(s);
const SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>';

function paintTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const btn = $('#themeBtn');
  if (btn) {
    btn.innerHTML = dark ? SUN : MOON;
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#17182b' : '#f5f6fb';
}
paintTheme();
const themeBtn = $('#themeBtn');
if (themeBtn) themeBtn.onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('as_theme', next); } catch (e) { /* private mode */ }
  paintTheme();
};

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;
    const panel = document.getElementById(t.getAttribute('aria-controls'));
    if (panel) panel.hidden = !on;
  });
  tab.focus();
}
tabs.forEach((tab, i) => {
  tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : e.key === 'Home' ? tabs[0] : tabs[tabs.length - 1];
    selectTab(next);
  });
});

document.querySelectorAll('.mob a').forEach((a) => a.addEventListener('click', () => { const d = a.closest('details'); if (d) d.open = false; }));

const setupGallery = $('.setup-gallery');
if (setupGallery) {
  const image = $('.setup-slide-image', setupGallery);
  const caption = $('.setup-slide-caption', setupGallery);
  const captionStep = $('span', caption);
  const captionTitle = $('b', caption);
  const steps = [...setupGallery.querySelectorAll('[data-setup-step]')];
  let current = 0;
  const showStep = (index) => {
    current = (index + steps.length) % steps.length;
    const step = steps[current];
    image.src = step.dataset.src;
    image.width = Number(step.dataset.width);
    image.height = Number(step.dataset.height);
    image.alt = step.dataset.alt;
    captionStep.textContent = step.dataset.caption;
    captionTitle.textContent = step.dataset.title;
    steps.forEach((button, i) => {
      if (i === current) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
  };
  steps.forEach((button, index) => button.addEventListener('click', () => showStep(index)));
  $('[data-setup-prev]', setupGallery).addEventListener('click', () => showStep(current - 1));
  $('[data-setup-next]', setupGallery).addEventListener('click', () => showStep(current + 1));
  setupGallery.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); showStep(current - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); showStep(current + 1); }
  });
}
