let authMode = 'login';
function openAuth(mode = 'login', reason = '') {
  setAuthMode(mode);
  $('authReason').textContent = reason || 'Sign in to save reviews, chats and your try-on activity.';
  $('authError').textContent = ''; openDialog('authDialog'); setTimeout(() => $('email').focus(), 50);
}
function setAuthMode(mode) {
  authMode = mode;
  $('tabLogin').classList.toggle('active', mode === 'login'); $('tabRegister').classList.toggle('active', mode === 'register');
  $('nameField').classList.toggle('hidden', mode !== 'register');
  $('authTitle').textContent = mode === 'login' ? 'Welcome back' : 'Create your account';
  $('authSubmit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  $('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
}
async function submitAuth(kind = authMode) {
  const button = $('authSubmit'); button.disabled = true; $('authError').textContent = '';
  try {
    const email = $('email').value.trim().toLowerCase(), password = $('password').value, name = $('name').value.trim();
    if (window.juviaFirebaseAuth) {
      try {
        const credential = kind === 'register' ? await window.juviaFirebaseAuth.createUserWithEmailAndPassword(email, password) : await window.juviaFirebaseAuth.signInWithEmailAndPassword(email, password);
        if (kind === 'register') await credential.user.updateProfile({ displayName: name || email.split('@')[0] });
        tok = await credential.user.getIdToken(true);
      } catch (e) {
        if (e.code !== 'auth/unauthorized-domain') throw e;
        const d = await api('/auth/' + kind, { method: 'POST', body: { email, password, name } }); tok = d.token;
      }
    } else {
      const d = await api('/auth/' + kind, { method: 'POST', body: { email, password, name } }); tok = d.token;
    }
    localStorage.setItem('juvia_token', tok); await boot();
    closeDialog('authDialog'); toast(kind === 'register' ? 'Welcome to Juvia' : 'Signed in');
  } catch (e) {
    $('authError').textContent = friendlyAuthError(e);
  } finally { button.disabled = false; }
}
function friendlyAuthError(e) {
  const code = e?.code || '';
  if (/wrong-password|invalid-credential|user-not-found|invalid-login/.test(code)) return 'Email or password is incorrect.';
  if (/email-already-in-use/.test(code)) return 'An account with this email already exists. Sign in instead.';
  if (/weak-password/.test(code)) return 'Choose a password with at least 8 characters.';
  if (/invalid-email/.test(code)) return 'Enter a valid email address.';
  if (/too-many-requests/.test(code)) return 'Too many attempts. Wait a moment and try again.';
  return e?.message || 'Something went wrong. Please try again.';
}
function renderUser() {
  const signedIn = !!user;
  $('signInBtn').classList.toggle('hidden', signedIn); $('avatarBtn').classList.toggle('hidden', !signedIn);
  if (signedIn) {
    const initials = (user.name || user.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
    $('avatarBtn').textContent = initials || 'J'; $('who').textContent = user.name + (user.role === 'admin' ? ' · Admin' : ''); $('whoEmail').textContent = user.email;
  }
  const admin = user?.role === 'admin';
  document.querySelectorAll('.admin-link').forEach(el => el.classList.toggle('hidden', !admin));
  $('tabbar').classList.toggle('admin', admin);
}
async function boot() {
  if (!tok) { renderUser(); return; }
  try { user = await api('/auth/me'); }
  catch { user = null; tok = null; localStorage.removeItem('juvia_token'); }
  renderUser();
  if (currentView === 'history') loadHistory();
  if (location.hash === '#admin' && user?.role === 'admin') show('admin');
}
if (window.juviaFirebaseAuth) window.juviaFirebaseAuth.onIdTokenChanged(async firebaseUser => {
  if (!firebaseUser) return;
  tok = await firebaseUser.getIdToken(); localStorage.setItem('juvia_token', tok);
  if (!user || user.email !== firebaseUser.email) await boot();
});
