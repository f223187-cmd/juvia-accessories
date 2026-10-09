async function loadProducts() {
  show('shop');
  try {
    const p=new URLSearchParams(); if($('category').value)p.set('category',$('category').value); if($('search').value)p.set('q',$('search').value);
    const rows=await api('/products?'+p);
    $('products').innerHTML=rows.map(x=>`<article class="card">${x.image?`<img src="${esc(x.image)}" alt="${esc(x.name)}">`:''}<h3>${esc(x.name)}</h3><p class="muted">${esc(x.category)} · ${esc(x.description)}</p><div class="price">$${Number(x.price).toFixed(2)}</div>${x.image||x.has_3d_asset?`<button class="secondary" onclick="chooseVtoProduct(${x.id},'${x.category}')">Try this on</button>`:''}<button class="secondary" onclick="review(${x.id})">Rate this item</button><div id="reviews${x.id}"></div><button class="secondary" onclick="getReviews(${x.id})">Reviews</button></article>`).join('')||'<p>No products yet.</p>';
  } catch(e) { msg(e.message); }
}
let adminProductRows=[],editingProductId=null;
function ensureAdminProductControls(){
  let list=$('adminProducts');
  if(!list){
    list=document.createElement('div');list.id='adminProducts';list.className='grid';list.style.margin='14px 0';
    const heading=[...document.querySelectorAll('#admin h3')].find(el=>el.textContent==='Product catalogue');heading.after(list);
  }
  if(!$('psource')){const source=document.createElement('input');source.id='psource';source.placeholder='Source URL';$('pdesc').after(source);}
  if(!$('pimagefile')){const image=document.createElement('input');image.id='pimagefile';image.type='file';image.accept='image/jpeg,image/png,image/webp';image.setAttribute('aria-label','Product image file');$('pimage').after(image);}
  if(!$('cancelProductEdit')){const button=$('pname').parentElement.querySelector('button'),cancel=document.createElement('button');cancel.id='cancelProductEdit';cancel.className='secondary hidden';cancel.textContent='Cancel';cancel.onclick=resetProductForm;button.after(cancel);}
  return list;
}
async function loadAdminProducts(){
  try{
    adminProductRows=await api('/admin/products');const list=ensureAdminProductControls();
    list.innerHTML=adminProductRows.map(p=>`<article class="card">${p.image?`<img src="${esc(p.image)}" alt="">`:''}<h4>${esc(p.name)}</h4><p class="muted">${esc(p.category)} · $${Number(p.price).toFixed(2)} · ${p.published?'Published':'Pending verification'}</p><div class="row"><button class="secondary" onclick="editProduct(${p.id})">Edit</button><button class="secondary" onclick="toggleProductPublished(${p.id})">${p.published?'Unpublish':'Verify & publish'}</button><button class="secondary" onclick="deleteProduct(${p.id})">Delete</button></div></article>`).join('')||'<p>No products in inventory.</p>';
  }catch(e){msg(e.message);}
}
function editProduct(id){
  const product=adminProductRows.find(row=>row.id===id);if(!product)return;
  editingProductId=id;$('pname').value=product.name;$('pcat').value=product.category;$('pprice').value=product.price;$('pimage').value=product.image;$('pdesc').value=product.description;$('psource').value=product.source;
  $('pname').parentElement.querySelector('button').textContent='Save changes';$('cancelProductEdit').classList.remove('hidden');
}
function resetProductForm(){
  editingProductId=null;['pname','pprice','pimage','pdesc','psource'].forEach(id=>$(id).value='');$('pimagefile').value='';$('pcat').selectedIndex=0;
  $('pname').parentElement.querySelector('button').textContent='Add product';$('cancelProductEdit').classList.add('hidden');
}
async function saveProduct(){
  try{
    const current=adminProductRows.find(row=>row.id===editingProductId),file=$('pimagefile').files[0];let image=$('pimage').value.trim();
    if(file){const form=new FormData();form.append('file',file);image=(await api('/product-images',{method:'POST',body:form})).url;}
    const body={name:$('pname').value,category:$('pcat').value,price:Number($('pprice').value),image,description:$('pdesc').value,source:$('psource').value,published:current?Boolean(current.published):true};
    await api(editingProductId?'/products/'+editingProductId:'/products',{method:editingProductId?'PATCH':'POST',body});
    msg(editingProductId?'Product updated':'Product added');resetProductForm();await loadAdminProducts();await loadAssets();await loadAnalytics();
  }catch(e){msg(e.message);}
}
async function toggleProductPublished(id){
  const product=adminProductRows.find(row=>row.id===id);if(!product)return;
  try{await api('/products/'+id,{method:'PATCH',body:{...product,published:!product.published}});await loadAdminProducts();}
  catch(e){msg(e.message);}
}
async function deleteProduct(id){
  if(!confirm('Delete this product and its reviews?'))return;
  try{await api('/products/'+id,{method:'DELETE'});if(editingProductId===id)resetProductForm();msg('Product deleted');await loadAdminProducts();await loadAssets();await loadAnalytics();}
  catch(e){msg(e.message);}
}
