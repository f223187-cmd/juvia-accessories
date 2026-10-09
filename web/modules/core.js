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
function msg(text) { $('notice').textContent = text; setTimeout(() => { $('notice').textContent = ''; }, 4000); }
function show(id) {
  if (id === 'admin' && user?.role !== 'admin') { msg('Administrator access required'); id = 'shop'; }
  ['shop','assistant','history','tryon','admin'].forEach(x => $(x).classList.toggle('hidden', x !== id));
  if (id === 'admin') { loadAdminProducts(); loadAssets(); }
  if (id === 'tryon' && !vtoProducts.some(p => p.category === $('vtoProduct').value)) loadVtoProducts();
}
function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function logout() {
  localStorage.removeItem('juvia_token');tok=null;
  if(window.juviaFirebaseAuth?.currentUser)window.juviaFirebaseAuth.signOut().finally(()=>location.reload());
  else location.reload();
}
