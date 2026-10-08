async function loadProducts() {
  show('shop');
  try {
    const p=new URLSearchParams(); if($('category').value)p.set('category',$('category').value); if($('search').value)p.set('q',$('search').value);
    const rows=await api('/products?'+p);
    $('products').innerHTML=rows.map(x=>`<article class="card">${x.image?`<img src="${esc(x.image)}" alt="">`:''}<h3>${esc(x.name)}</h3><p class="muted">${esc(x.category)} · ${esc(x.description)}</p><div class="price">$${Number(x.price).toFixed(2)}</div><button class="secondary" onclick="review(${x.id})">Rate this item</button><div id="reviews${x.id}"></div><button class="secondary" onclick="getReviews(${x.id})">Reviews</button></article>`).join('')||'<p>No products yet.</p>';
  } catch(e) { msg(e.message); }
}
async function saveProduct() {
  try { await api('/products',{method:'POST',body:{name:$('pname').value,category:$('pcat').value,price:Number($('pprice').value),image:$('pimage').value,description:$('pdesc').value}}); msg('Product added'); await loadProducts(); loadAnalytics(); }
  catch(e) { msg(e.message); }
}
