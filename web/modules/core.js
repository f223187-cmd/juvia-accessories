const $ = id => document.getElementById(id);
let tok = localStorage.getItem('juvia_token'), user = null, stream = null;
const api = async (path, opt = {}) => {
  if (window.juviaFirebaseAuth?.currentUser) {
    tok = await window.juviaFirebaseAuth.currentUser.getIdToken();
    localStorage.setItem('juvia_token', tok);
  }
  opt.headers = { ...(opt.headers || {}), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) };
  if (opt.body && !(opt.body instanceof FormData)) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(opt.body); }
  const r = await fetch('/api' + path, opt); let data;
  try { data = await r.json(); } catch { data = {}; }
  if (!r.ok) throw Error(data.detail || 'Request failed'); return data;
};

// ---- Feedback ----
function toast(text, kind = '') {
  if (!text) return;
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = text;
  $('toasts').appendChild(el); setTimeout(() => el.remove(), 3200);
}
function msg(text) { toast(text, /fail|error|invalid|required|could not|cannot|incorrect|denied/i.test(text) ? 'bad' : ''); }

// ---- Rendering helpers ----
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const icon = (name, cls = '') => `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`;
const money = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v || 0));
const CATEGORY = {
  watches: { label: 'Watches', one: 'Watch', icon: 'watch', target: 'Wrist', blurb: 'Classic and modern timepieces' },
  bracelets: { label: 'Bracelets', one: 'Bracelet', icon: 'bracelet', target: 'Wrist', blurb: 'Bangles, cuffs and chains' },
  rings: { label: 'Rings', one: 'Ring', icon: 'ring', target: 'Ring finger', blurb: 'Solitaires and everyday bands' },
  necklaces: { label: 'Necklaces', one: 'Necklace', icon: 'necklace', target: 'Neck', blurb: 'Pendants and fine chains' },
};
// S / M / L for every piece (the geometry for each size lives in wristpose.js SIZE_CHART).
const SIZES = {
  watches: [['S', '36 mm case'], ['M', '40 mm case'], ['L', '44 mm case']],
  bracelets: [['S', '16.5 cm inside'], ['M', '18 cm inside'], ['L', '19.5 cm inside']],
  rings: [['S', 'US 6 · 16.5 mm'], ['M', 'US 8 · 18.1 mm'], ['L', 'US 10 · 19.8 mm']],
  necklaces: [['S', '16 in chain'], ['M', '18 in chain'], ['L', '20 in chain']],
};
const chosenSize = {};
const sizeOf = p => chosenSize[p?.id] || 'M';
function sizeChips(p, handler, cls = '') {
  return `<div class="sizes ${cls}" role="radiogroup" aria-label="Size">${(SIZES[p.category] || []).map(([s, detail]) =>
    `<button type="button" role="radio" aria-checked="${sizeOf(p) === s}" class="${sizeOf(p) === s ? 'active' : ''}" onclick="${handler}(${p.id},'${s}')"><b>${s}</b><small>${esc(detail)}</small></button>`).join('')}</div>`;
}
function stars(rating, count) {
  const r = Math.round(Number(rating || 0));
  return `<span class="stars" aria-label="${rating ? rating + ' out of 5' : 'No ratings yet'}">${[1,2,3,4,5].map(i => `<svg class="i fill ${i <= r ? '' : 'off'}"><use href="#i-star"/></svg>`).join('')}</span>` +
    (count != null ? ` <small class="muted">${count ? `${Number(rating).toFixed(1)} (${count})` : 'New'}</small>` : '');
}
// Product media: photo if there is one, otherwise the real 3D model as a turntable.
const ORBIT = { watches: '-10deg 80deg auto', bracelets: '40deg 62deg auto', rings: '55deg 72deg auto', necklaces: '0deg 82deg auto' };
// Rings are authored stone-forward (+Z) for try-on; stand them stone-up for product shots.
const ORIENT = { rings: '0deg -90deg 0deg' };
function productMedia(p, { interactive = false, eager = false } = {}) {
  if (p.image) return `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="${eager ? 'eager' : 'lazy'}">`;
  if (p.asset_url) return `<model-viewer src="${esc(p.asset_url)}" alt="${esc(p.name)} in 3D" camera-orbit="${ORBIT[p.category] || 'auto'}" ${ORIENT[p.category] ? `orientation="${ORIENT[p.category]}"` : ''} environment-image="neutral" exposure="1.05" shadow-intensity="0.5" interaction-prompt="none" ${interactive ? 'camera-controls auto-rotate rotation-per-second="18deg"' : 'auto-rotate rotation-per-second="12deg" disable-zoom'} loading="${eager ? 'eager' : 'lazy'}" reveal="auto"></model-viewer>`;
  return `<div style="display:grid;place-items:center;height:100%;color:var(--gold)">${icon(CATEGORY[p.category]?.icon || 'cube')}</div>`;
}

// ---- Dialogs & menus ----
function openDialog(id) { const d = $(id); if (!d.open) d.showModal(); }
function closeDialog(id) { const d = $(id); if (d.open) d.close(); }
document.addEventListener('click', e => {
  if (e.target.tagName === 'DIALOG') e.target.close(); // click on the backdrop
  if (!e.target.closest('#userMenu,#avatarBtn')) toggleMenu(false);
});
function toggleMenu(force) { const m = $('userMenu'); if (!m) return; const open = force === undefined ? m.classList.contains('hidden') : force; m.classList.toggle('hidden', !open); }

// ---- Navigation ----
const VIEWS = ['shop', 'tryon', 'assistant', 'history', 'admin'];
let currentView = '';
function show(id) {
  if (!VIEWS.includes(id)) id = 'shop';
  if (id === 'admin' && user?.role !== 'admin') { if (user) msg('Administrator access required'); else openAuth('login', 'Sign in with an administrator account.'); id = 'shop'; }
  if (currentView === 'tryon' && id !== 'tryon' && typeof stopVto === 'function') stopVto();
  VIEWS.forEach(v => $(v).classList.toggle('hidden', v !== id));
  document.querySelectorAll('[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === id));
  if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
  const changed = currentView !== id; currentView = id;
  // Hash routes share their ids with the sections, so the browser jumps to them; views always open at the top.
  if (changed) { window.scrollTo(0, 0); requestAnimationFrame(() => window.scrollTo(0, 0)); window.Motion?.page($(id)); }
  if (id === 'tryon' && typeof initTryOn === 'function') initTryOn();
  if (id === 'history') loadHistory();
  if (id === 'assistant') initChat();
  if (id === 'admin') { loadAdminProducts(); loadAssets(); loadAnalytics(); }
}
function requireAuth(reason) { if (user) return true; openAuth('login', reason); return false; }
function logout() {
  localStorage.removeItem('juvia_token'); tok = null;
  if (window.juviaFirebaseAuth?.currentUser) window.juviaFirebaseAuth.signOut().finally(() => location.reload());
  else location.reload();
}
