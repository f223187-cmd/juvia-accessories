const $ = id => document.getElementById(id);
let tok = localStorage.getItem('juvia_token'), user = null, stream = null;
const api = async (path, opt = {}) => {
  opt.headers = { ...(opt.headers || {}), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) };
  if (opt.body && !(opt.body instanceof FormData)) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(opt.body); }
  const r = await fetch('/api' + path, opt); let data;
  try { data = await r.json(); } catch { data = {}; }
  if (!r.ok) throw Error(data.detail || 'Request failed'); return data;
};
function msg(text) { $('notice').textContent = text; setTimeout(() => { $('notice').textContent = ''; }, 4000); }
function show(id) { ['shop','assistant','history','tryon','admin'].forEach(x => $(x).classList.toggle('hidden', x !== id)); }
function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function logout() { localStorage.removeItem('juvia_token'); tok = null; location.reload(); }
