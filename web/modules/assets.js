async function uploadAsset() {
  const f=$('assetfile').files[0]; if(!f)return msg('Choose a 3D asset'); const fd=new FormData(); fd.append('file',f);
  try { const d=await api('/assets',{method:'POST',body:fd}); $('assets').innerHTML=`<p>Uploaded ${esc(d.filename)}</p>${d.url.endsWith('.glb')||d.url.endsWith('.gltf')?`<model-viewer src="${d.url}" camera-controls style="width:100%;height:300px"></model-viewer>`:''}`; msg('3D asset uploaded'); }
  catch(e) { msg(e.message); }
}
