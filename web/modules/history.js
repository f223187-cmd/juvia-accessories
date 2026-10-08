async function loadHistory() {
  try { const rows=await api('/history'); $('historylist').innerHTML=rows.map(x=>`<p><b>${esc(x.kind)}</b> · ${new Date(x.created).toLocaleString()}<br>${esc(x.detail)}</p>`).join('')||'No activity yet.'; }
  catch(e) { msg(e.message); }
}
