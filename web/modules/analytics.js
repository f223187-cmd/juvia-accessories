async function loadAnalytics() {
  try { const d=await api('/analytics'); $('analytics').textContent=`${d.users} users · ${d.products} products · ${d.reviews} reviews · Products by category: ${JSON.stringify(d.products_by_category)} · Activity: ${JSON.stringify(d.interactions)}`; }
  catch(e) { msg(e.message); }
}
