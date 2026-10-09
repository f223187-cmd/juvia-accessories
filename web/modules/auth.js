async function submitAuth(kind) {
  try {
    const email=$('email').value.trim().toLowerCase(),password=$('password').value;
    if(window.juviaFirebaseAuth){
      try{
        const credential=kind==='register'?await window.juviaFirebaseAuth.createUserWithEmailAndPassword(email,password):await window.juviaFirebaseAuth.signInWithEmailAndPassword(email,password);
        if(kind==='register')await credential.user.updateProfile({displayName:$('name').value.trim()||email.split('@')[0]});
        tok=await credential.user.getIdToken(true);
      }catch(e){
        if(e.code!=='auth/unauthorized-domain')throw e;
        const d=await api('/auth/'+kind,{method:'POST',body:{email,password,name:$('name').value}});tok=d.token;
      }
    }else{
      const d=await api('/auth/'+kind,{method:'POST',body:{email,password,name:$('name').value}});tok=d.token;
    }
    localStorage.setItem('juvia_token',tok);await boot();
  }
  catch(e) { msg(e.message); }
}
async function boot() {
  if(!tok) return;
  try { user=await api('/auth/me'); $('auth').classList.add('hidden'); $('app').classList.remove('hidden'); $('out').classList.remove('hidden'); $('who').textContent=user.name+' · '+user.role; if(user.role==='admin') $('adminTab').classList.remove('hidden'); await loadProducts(); }
  catch { tok=null; localStorage.removeItem('juvia_token'); }
}
if(window.juviaFirebaseAuth)window.juviaFirebaseAuth.onIdTokenChanged(async firebaseUser=>{
  if(!firebaseUser)return;
  tok=await firebaseUser.getIdToken();localStorage.setItem('juvia_token',tok);
  if(!user||user.email!==firebaseUser.email)await boot();
});
