async function loadAssets() {
  try {
    const [rows, products] = await Promise.all([api('/assets'), api('/admin/products')]);
    const select = $('assetProduct'), keep = select.value;
    select.innerHTML = '<option value="">No product link</option>' + products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    select.value = keep;
    $('assets').innerHTML = rows.map(asset => {
      const product = products.find(p => p.id === asset.product_id), url = '/uploads/' + encodeURIComponent(asset.path.split('/').pop());
      return `<div class="asset">${/\.glb$/i.test(asset.filename) ? `<model-viewer src="${url}" camera-controls auto-rotate interaction-prompt="none" environment-image="neutral" loading="lazy"></model-viewer>` : ''}<div><b>${esc(asset.filename)}</b><br><span class="muted">${product ? esc(product.name) : 'Not linked'}</span></div></div>`;
    }).join('') || '<p class="fine">No 3D models uploaded yet.</p>';
  } catch (e) { msg(e.message); }
}
async function uploadAsset(file = $('assetfile').files[0]) {
  if (!file) return msg('Choose a GLB file');
  const fd = new FormData(); fd.append('file', file);
  const productId = $('assetProduct').value, url = '/assets' + (productId ? '?product_id=' + encodeURIComponent(productId) : '');
  try { toast('Uploading ' + file.name + '…'); await api(url, { method: 'POST', body: fd }); toast('3D model uploaded'); $('assetfile').value = ''; await Promise.all([loadAssets(), loadProducts()]); }
  catch (e) { msg(e.message); }
}
document.addEventListener('DOMContentLoaded', () => {
  const drop = $('assetDrop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) uploadAsset(f); });
});
