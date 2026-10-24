let reviewStars = 0;
function setStars(v) {
  reviewStars = v;
  document.querySelectorAll('#starInput button').forEach(b => b.classList.toggle('on', Number(b.dataset.v) <= v));
}
async function loadReviews(id) {
  try {
    const rows = await api(`/products/${id}/reviews`);
    $('reviewList').innerHTML = rows.map(r => `<div class="review"><div class="review-head"><b>${esc(r.name)}</b>${stars(r.rating)}</div><p style="margin:6px 0 0">${esc(r.text)}</p><small class="fine">${new Date(r.created).toLocaleDateString()}</small></div>`).join('') || '<p class="fine">No reviews yet. Be the first to share how it looks.</p>';
  } catch { $('reviewList').innerHTML = '<p class="fine">Reviews are unavailable right now.</p>'; }
}
async function submitReview(id) {
  if (!requireAuth('Sign in to post a review.')) return;
  const text = $('reviewText').value.trim();
  if (!reviewStars) return msg('Choose a star rating first.');
  if (!text) return msg('Write a few words about the piece.');
  try {
    await api(`/products/${id}/reviews`, { method: 'POST', body: { rating: reviewStars, text } });
    toast('Thanks, your review is live'); $('reviewText').value = ''; setStars(0); await loadReviews(id); loadProducts();
  } catch (e) { msg(e.message); }
}
