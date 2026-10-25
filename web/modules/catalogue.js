// ---- Shop ----
let shopCategory = '', shopRows = [], searchTimer = null;
function renderCategoryControls() {
  if (!$('catTiles').children.length) {
    $('catTiles').innerHTML = Object.entries(CATEGORY).map(([key, c]) =>
      `<button class="cat" onclick="setShopCategory('${key}');$('collection').scrollIntoView({behavior:'smooth'})"><span class="ic">${icon(c.icon)}</span><span><b>${c.label}</b><small>${c.blurb}</small></span></button>`).join('');
    window.Motion?.stagger('#catTiles .cat', { delay: .25 });
  }
  $('categoryChips').innerHTML = [['', 'All'], ...Object.entries(CATEGORY).map(([k, c]) => [k, c.label])].map(([key, label]) =>
    `<button class="chip ${shopCategory === key ? 'active' : ''}" role="tab" aria-selected="${shopCategory === key}" onclick="setShopCategory('${key}')">${key ? icon(CATEGORY[key].icon) : ''}${label}</button>`).join('');
}
function setShopCategory(key) { shopCategory = key; renderCategoryControls(); loadProducts(); }
async function loadProducts() {
  renderCategoryControls();
  $('products').innerHTML = Array.from({ length: 4 }, () => '<div class="skeleton"></div>').join('');
  try {
    const p = new URLSearchParams(); if (shopCategory) p.set('category', shopCategory); const q = $('search').value.trim(); if (q) p.set('q', q);
    shopRows = await api('/products?' + p); renderProducts();
  } catch (e) { $('products').innerHTML = `<div class="empty">Could not load the collection. ${esc(e.message)}</div>`; }
}
function sortedRows() {
  const rows = [...shopRows], mode = $('sort').value;
  if (mode === 'price-asc') rows.sort((a, b) => a.price - b.price);
  else if (mode === 'price-desc') rows.sort((a, b) => b.price - a.price);
  else if (mode === 'rating') rows.sort((a, b) => (b.avg_rating || 0) - (a.avg_rating || 0) || b.review_count - a.review_count);
  return rows;
}
function productCard(x) {
  const canTry = !!x.has_3d_asset;
  return `<article class="product" onclick="openProduct(${x.id})" tabindex="0" onkeydown="if(event.key==='Enter')openProduct(${x.id})" aria-label="${esc(x.name)}">
    <div class="media">${productMedia(x)}${canTry ? `<span class="badge ar">${icon('spark')}AR try-on</span>` : ''}</div>
    ${canTry ? `<div class="try"><button class="btn sm" onclick="event.stopPropagation();chooseVtoProduct(${x.id},'${x.category}')">${icon('camera')}Try on</button></div>` : ''}
    <div class="body"><span class="cat-label">${esc(CATEGORY[x.category]?.one || x.category)}</span><h3>${esc(x.name)}</h3>
      <div>${stars(x.avg_rating, x.review_count)}</div>
      <div class="row"><span class="price">${money(x.price)}</span>${canTry ? `<button class="btn soft sm" onclick="event.stopPropagation();chooseVtoProduct(${x.id},'${x.category}')" aria-label="Try ${esc(x.name)} on">${icon('camera')}</button>` : ''}</div>
    </div></article>`;
}
function renderProducts() {
  const rows = sortedRows();
  $('resultCount').textContent = rows.length ? `${rows.length} piece${rows.length === 1 ? '' : 's'}` : '';
  $('products').innerHTML = rows.map(productCard).join('') || `<div class="empty">${icon('search')}<p>No pieces match${$('search').value ? ' “' + esc($('search').value) + '”' : ''}. Try another category or search.</p></div>`;
  window.Motion?.stagger('#products .product');
}
document.addEventListener('DOMContentLoaded', () => {
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadProducts, 280); });
  $('sort').addEventListener('change', renderProducts);
});

// ---- Product details ----
async function openProduct(id) {
  const p = shopRows.find(r => r.id === id) || (await api('/products')).find(r => r.id === id); if (!p) return;
  const c = CATEGORY[p.category] || {};
  $('productBody').innerHTML = `<div class="pd">
    <div class="pd-media">${productMedia(p, { interactive: true, eager: true })}${!p.image && p.asset_url ? '<span class="hint">Drag to rotate</span>' : ''}</div>
    <div class="pd-info">
      <span class="eyebrow">${esc(c.label || p.category)}</span>
      <h2>${esc(p.name)}</h2>
      <div>${stars(p.avg_rating, p.review_count)}</div>
      <div class="pd-price">${money(p.price)}</div>
      <p class="muted">${esc(p.description) || 'A Juvia piece.'}</p>
      <div class="field" style="margin-top:6px">Size<div id="pdSizes">${sizeChips(p,'pickProductSize')}</div></div>
      <div class="pd-actions">
        ${p.has_3d_asset ? `<button class="btn primary" onclick="closeDialog('productDialog');chooseVtoProduct(${p.id},'${p.category}')">${icon('camera')}Try it on live</button>` : ''}
        <button class="btn ghost" onclick="document.getElementById('reviewForm').scrollIntoView({behavior:'smooth'})">${icon('star')}Write a review</button>
      </div>
      <ul class="pd-specs">
        <li><b>${esc(c.target || '—')}</b>Fits on</li>
        <li><b>${p.has_3d_asset ? 'Live 3D' : 'Photo only'}</b>Try-on</li>
      </ul>
      <div class="reviews"><h3>Reviews</h3><div id="reviewList"><p class="fine">Loading reviews…</p></div>
        <form id="reviewForm" class="form" style="margin-top:16px" onsubmit="event.preventDefault();submitReview(${p.id})">
          <div class="field">Your rating<div class="star-input" id="starInput">${[1,2,3,4,5].map(i => `<button type="button" data-v="${i}" aria-label="${i} star${i > 1 ? 's' : ''}" onclick="setStars(${i})">${icon('star', 'fill')}</button>`).join('')}</div></div>
          <label class="field">Your review<textarea id="reviewText" class="input" maxlength="2000" placeholder="How does it look and feel?"></textarea></label>
          <button class="btn primary">Post review</button>
        </form>
      </div>
    </div></div>`;
  openDialog('productDialog'); setStars(0); loadReviews(p.id);
  window.Motion?.stagger('#productBody .pd-info > *', { y: 10, scale: 1, each: .04, duration: .35 });
  if (user) api('/history', { method: 'POST', body: { kind: 'product_view', detail: `${p.name} (product:${p.id})` } }).catch(() => {});
}

// ---- Admin: inventory ----
let adminProductRows = [], editingProductId = null;
async function loadAdminProducts() {
  try {
    adminProductRows = await api('/admin/products');
    $('adminProducts').innerHTML = adminProductRows.map(p => `<tr>
      <td><div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="">` : icon(CATEGORY[p.category]?.icon || 'cube')}</div></td>
      <td><b>${esc(p.name)}</b><br><small class="muted">${esc(CATEGORY[p.category]?.label || p.category)}</small></td>
      <td>${money(p.price)}</td>
      <td>${p.published ? '<span class="badge ok">Published</span>' : '<span class="badge pending">Pending</span>'}</td>
      <td><div class="row-actions">
        <button class="icon-btn" title="Edit" aria-label="Edit ${esc(p.name)}" onclick="editProduct(${p.id})">${icon('edit')}</button>
        <button class="icon-btn" title="${p.published ? 'Unpublish' : 'Verify & publish'}" aria-label="${p.published ? 'Unpublish' : 'Publish'} ${esc(p.name)}" onclick="toggleProductPublished(${p.id})">${icon(p.published ? 'eye' : 'check')}</button>
        <button class="icon-btn" title="Delete" aria-label="Delete ${esc(p.name)}" onclick="deleteProduct(${p.id})">${icon('trash')}</button>
      </div></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No products yet.</td></tr>';
  } catch (e) { msg(e.message); }
}
function editProduct(id) {
  const product = adminProductRows.find(row => row.id === id); if (!product) return;
  editingProductId = id; $('pname').value = product.name; $('pcat').value = product.category; $('pprice').value = product.price; $('pimage').value = product.image; $('pdesc').value = product.description; $('psource').value = product.source;
  $('saveProductBtn').textContent = 'Save changes'; $('productFormTitle').textContent = 'Edit product'; $('cancelProductEdit').classList.remove('hidden');
  $('productForm').scrollIntoView({ behavior: 'smooth' });
}
function resetProductForm() {
  editingProductId = null; ['pname', 'pprice', 'pimage', 'pdesc', 'psource'].forEach(id => $(id).value = ''); $('pimagefile').value = ''; $('pcat').selectedIndex = 0;
  $('saveProductBtn').textContent = 'Add product'; $('productFormTitle').textContent = 'Add product'; $('cancelProductEdit').classList.add('hidden');
}
async function saveProduct() {
  const button = $('saveProductBtn'); button.disabled = true;
  try {
    const current = adminProductRows.find(row => row.id === editingProductId), file = $('pimagefile').files[0]; let image = $('pimage').value.trim();
    if (file) { const form = new FormData(); form.append('file', file); image = (await api('/product-images', { method: 'POST', body: form })).url; }
    const body = { name: $('pname').value, category: $('pcat').value, price: Number($('pprice').value), image, description: $('pdesc').value, source: $('psource').value, published: current ? Boolean(current.published) : true };
    await api(editingProductId ? '/products/' + editingProductId : '/products', { method: editingProductId ? 'PATCH' : 'POST', body });
    toast(editingProductId ? 'Product updated' : 'Product added'); resetProductForm(); await Promise.all([loadAdminProducts(), loadAssets(), loadAnalytics(), loadProducts()]);
  } catch (e) { msg(e.message); } finally { button.disabled = false; }
}
async function toggleProductPublished(id) {
  const product = adminProductRows.find(row => row.id === id); if (!product) return;
  try { await api('/products/' + id, { method: 'PATCH', body: { ...product, published: !product.published } }); toast(product.published ? 'Unpublished' : 'Published'); await Promise.all([loadAdminProducts(), loadProducts()]); }
  catch (e) { msg(e.message); }
}
async function deleteProduct(id) {
  if (!confirm('Delete this product and its reviews?')) return;
  try { await api('/products/' + id, { method: 'DELETE' }); if (editingProductId === id) resetProductForm(); toast('Product deleted'); await Promise.all([loadAdminProducts(), loadAssets(), loadAnalytics(), loadProducts()]); }
  catch (e) { msg(e.message); }
}
function pickProductSize(id, size) {
  chosenSize[id] = size; const p = shopRows.find(r => r.id === id); if (p) $('pdSizes').innerHTML = sizeChips(p, 'pickProductSize');
}
