async function review(id) {
  if(!tok) return msg('Sign in to leave a review'); const rating=Number(prompt('Rating from 1 to 5')); if(!rating)return; const text=prompt('Your review'); if(!text)return;
  try { await api(`/products/${id}/reviews`,{method:'POST',body:{rating,text}}); msg('Review submitted'); } catch(e) { msg(e.message); }
}
async function getReviews(id) {
  const rows=await api(`/products/${id}/reviews`); $(`reviews${id}`).innerHTML=rows.map(r=>`<p><b>${esc(r.name)}</b> · ${'★'.repeat(r.rating)}<br>${esc(r.text)}</p>`).join('')||'<small>No reviews yet</small>';
}
