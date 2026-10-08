async function auth(kind) {
  try { const d = await api('/auth/' + kind, { method:'POST', body:{ email:$('email').value, password:$('password').value, name:$('name').value } }); tok=d.token; localStorage.setItem('juvia_token',tok); await boot(); }
  catch(e) { msg(e.message); }
}
async function boot() {
  if(!tok) return;
  try { user=await api('/auth/me'); $('auth').classList.add('hidden'); $('app').classList.remove('hidden'); $('out').classList.remove('hidden'); $('who').textContent=user.name+' · '+user.role; if(user.role==='admin') $('adminTab').classList.remove('hidden'); await loadProducts(); }
  catch { tok=null; localStorage.removeItem('juvia_token'); }
}
