async function loadAssets(){
  try{
    const [rows,products]=await Promise.all([api('/assets'),api('/admin/products')]);
    let select=$('assetProduct');
    if(!select){
      const label=document.createElement('label');label.htmlFor='assetProduct';label.textContent='Attach to product';
      select=document.createElement('select');select.id='assetProduct';$('assetfile').before(label,select);
    }
    select.innerHTML='<option value="">No product link</option>'+products.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
    $('assets').innerHTML=rows.map(asset=>{
      const product=products.find(p=>p.id===asset.product_id),url='/uploads/'+encodeURIComponent(asset.path);
      return `<article class="card"><b>${esc(asset.filename)}</b><p class="muted">${product?'Linked to '+esc(product.name):'Not linked to a product'}</p>${/\.glb$/i.test(asset.filename)?`<model-viewer src="${url}" camera-controls style="width:100%;height:280px"></model-viewer>`:''}</article>`;
    }).join('')||'<p>No 3D assets uploaded.</p>';
  }catch(e){msg(e.message);}
}
async function uploadAsset(){
  const f=$('assetfile').files[0];if(!f)return msg('Choose a 3D asset');const fd=new FormData();fd.append('file',f);
  const productId=$('assetProduct')?.value,url='/assets'+(productId?'?product_id='+encodeURIComponent(productId):'');
  try{await api(url,{method:'POST',body:fd});msg('3D asset uploaded');await loadAssets();}
  catch(e){msg(e.message);}
}
