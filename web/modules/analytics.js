function bars(entries, labels = {}) {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return entries.map(([k, n]) => `<div class="bar"><span>${esc(labels[k] || k)}</span><span class="track"><i style="width:${Math.round(n / max * 100)}%"></i></span><b>${n}</b></div>`).join('') || '<p class="fine">No data yet.</p>';
}
async function loadAnalytics() {
  try {
    const d = await api('/analytics'), act = d.interactions || {};
    $('analytics').innerHTML = [['Customers', d.users], ['Products', d.products], ['Reviews', d.reviews], ['Try-on sessions', act.try_on || 0]]
      .map(([label, n]) => `<div class="stat"><small>${label}</small><b>${n}</b></div>`).join('');
    $('catBars').innerHTML = bars(Object.entries(d.products_by_category || {}), Object.fromEntries(Object.entries(CATEGORY).map(([k, c]) => [k, c.label])));
    $('actBars').innerHTML = bars(Object.entries(act), Object.fromEntries(Object.entries(ACTIVITY).map(([k, v]) => [k, v[1]])));
  } catch (e) { msg(e.message); }
}
