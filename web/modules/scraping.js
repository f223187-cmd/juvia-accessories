async function scrape() {
  try { const d=await api('/scrape',{method:'POST',body:{urls:[$('surl').value],category:$('scat').value}}); msg(`Imported ${d.count} product(s)`); await loadProducts(); }
  catch(e) { msg(e.message); }
}
