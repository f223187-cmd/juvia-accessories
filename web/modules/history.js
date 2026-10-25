const ACTIVITY = { product_view: ['eye', 'Viewed a piece'], try_on: ['camera', 'Live try-on'], review: ['star', 'Posted a review'], chat: ['chat', 'Asked the stylist'] };
async function loadHistory() {
  if (!user) {
    $('historylist').innerHTML = `<div class="gate"><span class="eyebrow">Your activity</span><h2>Keep track of your favourites</h2><p class="muted">Sign in to see the pieces you've viewed, tried on and reviewed.</p><button class="btn primary" onclick="openAuth('login')">Sign in</button></div>`;
    return;
  }
  $('historylist').innerHTML = '<p class="fine">Loading…</p>';
  try {
    const rows = await api('/history');
    $('historylist').innerHTML = rows.map(x => {
      const [ic, label] = ACTIVITY[x.kind] || ['clock', x.kind];
      return `<div class="tl"><span class="ic">${icon(ic)}</span><div><b>${label}</b><span class="muted">${esc(x.detail.replace(/\s*\((?:product|try-on product):\d+\)|^try-on product:\d+$/g, ''))}</span><div class="fine">${new Date(x.created).toLocaleString()}</div></div></div>`;
    }).join('') || `<div class="gate"><h2>Nothing here yet</h2><p class="muted">Browse the collection or start a live try-on and your activity will show up here.</p><a class="btn primary" href="#tryon">Start live try-on</a></div>`;
  } catch (e) { msg(e.message); }
  window.Motion?.stagger('#historylist > *', { y: 12, scale: .98, each: .05 });
}
