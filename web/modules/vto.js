let vtoTasks=[],vtoIndex=0,vtoStable=0,vtoLoop=false,vtoShots=[],vtoToastTimer=null;
let handLandmarker=null,faceLandmarker=null,vtoVisionPromise=null,vtoLastTimestamp=0,vtoLastDetected='';
let vtoProducts=[],vtoSelected=null;
let vtoFacingMode='user';
const VTO_MODEL_BASE='https://storage.googleapis.com/mediapipe-models/';
const VTO_WASM='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';

function vtoPlan(category){
  if(category==='necklaces')return [
    {target:'neck',pose:'front',label:'Neck — front view',hint:'Face the camera and relax your shoulders.'},
    {target:'neck',pose:'left',label:'Neck — left angle',hint:'Turn your nose slightly toward the left edge of the screen.'},
    {target:'neck',pose:'right',label:'Neck — right angle',hint:'Turn your nose slightly toward the right edge of the screen.'}
  ];
  if(category==='rings')return [
    {target:'hand',label:'Hand — open palm',hint:'Hold one hand forward with fingers comfortably spread.'},
    {target:'finger',label:'Finger — ring finger',hint:'Bring the hand closer and keep your ring finger extended and visible.'}
  ];
  const item=category==='watches'?'Watch':'Bracelet';
  return [
    {target:'wrist',label:`Wrist — ${item.toLowerCase()} side`,hint:'Extend your arm with your palm facing down.'},
    {target:'wrist',label:'Wrist — inner side',hint:'Turn your palm toward the camera and center your wrist.'}
  ];
}
async function loadVtoModels(){
  if(vtoVisionPromise)return vtoVisionPromise;
  vtoVisionPromise=(async()=>{
    const vision=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs');
    const files=await vision.FilesetResolver.forVisionTasks(VTO_WASM);
    const handUrl=VTO_MODEL_BASE+'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
    const faceUrl=VTO_MODEL_BASE+'face_landmarker/face_landmarker/float16/1/face_landmarker.task';
    async function create(delegate){
      const hand=await vision.HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:handUrl,delegate},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.55,minHandPresenceConfidence:.55});
      try{const face=await vision.FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:faceUrl,delegate},runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:.55,minFacePresenceConfidence:.55});return {hand,face};}
      catch(e){hand.close();throw e;}
    }
    try{return await create('GPU');}catch{return await create('CPU');}
  })();
  try{const models=await vtoVisionPromise;handLandmarker=models.hand;faceLandmarker=models.face;return models;}
  catch(e){vtoVisionPromise=null;throw e;}
}
function vtoToast(text){const el=$('vtoToast');el.textContent=text;el.classList.remove('hidden');clearTimeout(vtoToastTimer);vtoToastTimer=setTimeout(()=>el.classList.add('hidden'),2400);}
function resetVto(){stopVto();vtoTasks=[];vtoIndex=0;vtoStable=0;vtoShots=[];vtoLastDetected='';$('vtoShots').innerHTML='';$('vtoOverlay').style.display='none';$('vtoModel').style.display='none';$('vtoStep').textContent='Choose a product with an image to preview it on camera.';}
async function loadVtoProducts(){
  const category=$('vtoProduct').value,select=$('vtoItem');
  try{
    vtoProducts=await api('/products?category='+encodeURIComponent(category));
    select.innerHTML='<option value="">Choose a product</option>'+vtoProducts.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
    vtoSelected=null;$('vtoOverlay').removeAttribute('src');$('vtoOverlay').style.display='none';$('vtoModel').removeAttribute('src');$('vtoModel').style.display='none';
    if(!vtoProducts.length)$('vtoStep').textContent='No products in this category yet.';
  }catch(e){msg(e.message);}
}
async function setVtoItem(){
  const id=Number($('vtoItem').value);vtoSelected=vtoProducts.find(p=>p.id===id)||null;
  const overlay=$('vtoOverlay'),model=$('vtoModel');overlay.style.display='none';model.style.display='none';model.style.opacity='0';model.removeAttribute('src');model.dataset.ready='false';model.dataset.productId='';
  if(!vtoSelected){overlay.removeAttribute('src');$('vtoStep').textContent='Choose a product with an image or linked 3D model.';return;}
  if(vtoSelected.image)overlay.src=vtoSelected.image;
  $('vtoStep').textContent='Product selected. Start guided capture to preview it on camera.';
  try{
    const productId=vtoSelected.id,asset=await api('/products/'+productId+'/asset');
    if(vtoSelected?.id!==productId)return;
    model.dataset.productId=String(productId);model.addEventListener('load',()=>{if(vtoSelected?.id===productId){model.dataset.ready='true';overlay.style.display='none';}},{once:true});model.addEventListener('error',event=>{if(vtoSelected?.id===productId){model.dataset.error=event.detail?.type||'load';model.style.display='none';$('vtoStep').textContent='This 3D model could not be loaded. Check that the file is a valid GLB.';}},{once:true});model.style.display='block';model.style.opacity='0';model.style.width='180px';model.style.height='180px';model.setAttribute('src',asset.url);
  }catch{}
}
async function chooseVtoProduct(id,category){
  $('vtoProduct').value=category;
  if(!vtoProducts.some(p=>p.category===category))await loadVtoProducts();
  $('vtoItem').value=String(id);await setVtoItem();show('tryon');
  api('/history',{method:'POST',body:{kind:'product_view',detail:`try-on product:${id}`}}).catch(()=>{});
}
async function hasVtoPreview(product){
  if(product?.image)return true;
  if(!product)return false;
  try{await api('/products/'+product.id+'/asset');return true;}catch{return false;}
}
async function startVto(){
  if(!vtoProducts.length)await loadVtoProducts();
  if(!await hasVtoPreview(vtoSelected))return msg('Choose a product with an image or upload a linked GLB model first.');
  if(!navigator.mediaDevices?.getUserMedia)return msg('Camera access requires HTTPS and a current mobile browser.');
  try{
    $('vtoStart').disabled=true;$('vtoStep').textContent='Starting camera and loading on-device hand and face models…';
    stream=await openVtoCamera(vtoFacingMode);
    await loadVtoModels();
    vtoTasks=vtoPlan($('vtoProduct').value);vtoIndex=0;vtoStable=0;vtoShots=[];vtoLastDetected='';$('vtoShots').innerHTML='';
    $('vtoStart').classList.add('hidden');$('vtoSwitch').classList.remove('hidden');$('vtoStop').classList.remove('hidden');vtoLoop=true;
    $('cameraGuide').className='camera-guide '+(vtoTasks[0].target==='neck'?'':'hand');await vtoScan();
  }catch(e){stopVto();msg('Could not start on-device detection: '+e.message);}
  finally{$('vtoStart').disabled=false;}
}
async function openVtoCamera(mode,exact=false){
  const facingMode=exact?{exact:mode}:{ideal:mode};
  const nextStream=await navigator.mediaDevices.getUserMedia({video:{facingMode,width:{ideal:720},height:{ideal:960}},audio:false});
  const video=$('camera');video.srcObject=nextStream;
  try{await video.play();}catch(e){nextStream.getTracks().forEach(track=>track.stop());video.srcObject=null;throw e;}
  vtoFacingMode=mode;video.classList.toggle('rear-camera',mode==='environment');
  return nextStream;
}
async function switchVtoCamera(){
  if(!vtoLoop||!stream)return;
  const previous=vtoFacingMode,next=previous==='user'?'environment':'user',button=$('vtoSwitch');
  button.disabled=true;vtoStable=0;$('vtoStep').textContent='Switching camera…';stopCameraStream();
  try{stream=await openVtoCamera(next,true);vtoLastTimestamp=0;vtoToast(next==='user'?'Front camera':'Back camera');}
  catch(e){
    try{stream=await openVtoCamera(previous);$('vtoStep').textContent='That camera is unavailable; continuing with the previous camera.';}
    catch{stopVto();msg('Could not switch cameras: '+e.message);}
  }finally{button.disabled=false;}
}
function frameStatus(task,timestamp){
  let found=false,ready=false,guidance=task.target==='neck'?'Place your face and neck inside the guide.':'Place one hand inside the guide.';
  let rawPoints=[],landmarks=[];
  if(task.target==='neck'){
    const result=faceLandmarker.detectForVideo($('camera'),timestamp);rawPoints=result.faceLandmarks?.[0]||[];
    if(rawPoints.length){
      found=true;const xs=rawPoints.map(p=>p.x),ys=rawPoints.map(p=>p.y);const width=Math.max(...xs)-Math.min(...xs),cx=(Math.max(...xs)+Math.min(...xs))/2,cy=(Math.max(...ys)+Math.min(...ys))/2;
      if(cx<.18||cx>.82||cy<.12||cy>.82)guidance='Center your face and neck inside the guide.';
      else if(width<.24)guidance='Move a little closer to the camera.';
      else if(width>.85)guidance='Move slightly farther from the camera.';
      else{
        const cheekMid=(rawPoints[234].x+rawPoints[454].x)/2;
        const faceWidth=Math.max(.01,Math.abs(rawPoints[454].x-rawPoints[234].x));
        const screenYaw=(cheekMid-rawPoints[1].x)/faceWidth;
        if(task.pose==='front'&&Math.abs(screenYaw)>.045)guidance='Look straight at the camera.';
        else if(task.pose==='left'&&screenYaw>-.055)guidance='Turn your nose slightly toward the left edge of the screen.';
        else if(task.pose==='right'&&screenYaw<.055)guidance='Turn your nose slightly toward the right edge of the screen.';
        else{ready=true;guidance='Neck detected. Hold still.';}
      }
      landmarks=[152,234,454].map(i=>({x:rawPoints[i].x,y:Math.min(1,rawPoints[i].y+.14),z:rawPoints[i].z}));
    }
  }else{
    const result=handLandmarker.detectForVideo($('camera'),timestamp);rawPoints=result.landmarks?.[0]||[];
    if(rawPoints.length){
      found=true;const xs=rawPoints.map(p=>p.x),ys=rawPoints.map(p=>p.y);const span=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)),cx=(Math.max(...xs)+Math.min(...xs))/2,cy=(Math.max(...ys)+Math.min(...ys))/2;
      if(cx<.16||cx>.84||cy<.12||cy>.9)guidance='Center your hand inside the guide.';
      else if(span<(task.target==='finger' ? 0.24 : 0.2))guidance='Move your hand a little closer.';
      else if(span>.88)guidance='Move your hand slightly farther away.';
      else if(task.target==='finger'&&Math.hypot(rawPoints[16].x-rawPoints[14].x,rawPoints[16].y-rawPoints[14].y)<.045)guidance='Straighten and show your ring finger.';
      else{ready=true;guidance=task.target==='finger'?'Finger detected. Hold still.':task.target==='wrist'?'Wrist detected. Hold still.':'Hand detected. Hold still.';}
      landmarks=rawPoints.map(p=>({x:p.x,y:p.y,z:p.z}));
    }
  }
  return {found,ready,guidance,landmarks};
}
function renderVtoOverlay(task,landmarks){
  const video=$('camera'),rect=video.getBoundingClientRect(),model=$('vtoModel'),useModel=model.dataset.productId===String(vtoSelected?.id)&&model.dataset.ready==='true',overlay=useModel?model:$('vtoOverlay');
  if($('vtoProduct').value==='rings'&&task.target!=='finger'){$('vtoOverlay').style.display='none';model.style.opacity='0';model.style.display='block';return;}
  if((!useModel&&(!vtoSelected?.image||!overlay.complete||!overlay.naturalWidth))||landmarks.length<2||!rect.width||!rect.height){overlay.style.display='none';return;}
  let centerX,centerY,width,angle=0;
  const displayPoint=p=>({x:(vtoFacingMode==='user'?1-p.x:p.x)*rect.width,y:p.y*rect.height});
  if(task.target==='neck'){
    const chin=displayPoint(landmarks[0]),left=displayPoint(landmarks[1]),right=displayPoint(landmarks[2]);
    centerX=(left.x+right.x)/2;const span=Math.hypot(right.x-left.x,right.y-left.y);centerY=chin.y+span*.12;width=span*1.1;angle=Math.atan2(right.y-left.y,right.x-left.x)*180/Math.PI;
  }else if(task.target==='finger'){
    const proximal=displayPoint(landmarks[13]),middle=displayPoint(landmarks[14]);
    centerX=(proximal.x+middle.x)/2;centerY=(proximal.y+middle.y)/2;width=Math.max(24,Math.hypot(middle.x-proximal.x,middle.y-proximal.y)*2.4);angle=Math.atan2(middle.y-proximal.y,middle.x-proximal.x)*180/Math.PI+90;
  }else{
    const wrist=displayPoint(landmarks[0]),index=displayPoint(landmarks[5]||landmarks[9]),pinky=displayPoint(landmarks[17]);
    centerX=wrist.x;centerY=wrist.y;width=Math.max(36,Math.hypot(index.x-pinky.x,index.y-pinky.y)*.62);angle=Math.atan2(index.y-pinky.y,index.x-pinky.x)*180/Math.PI;
    if(task.target==='hand'){centerX=displayPoint(landmarks[9]).x;centerY=displayPoint(landmarks[9]).y;width*=1.2;}
  }
  overlay.style.width=`${width}px`;if(useModel){overlay.style.height=`${width}px`;overlay.style.opacity='1';}overlay.style.left=`${centerX}px`;overlay.style.top=`${centerY}px`;overlay.style.transform=`translate(-50%,-50%) rotate(${angle}deg)`;overlay.style.display='block';if(useModel)$('vtoOverlay').style.display='none';else{model.style.opacity='0';model.style.display='block';}
}
async function vtoScan(){
  while(vtoLoop&&vtoIndex<vtoTasks.length){
    const task=vtoTasks[vtoIndex],video=$('camera');
    $('vtoStep').textContent=`Photo ${vtoIndex+1} of ${vtoTasks.length}: ${task.label}. ${task.hint}`;
    if(video.readyState<2||!video.videoWidth){await new Promise(r=>setTimeout(r,150));continue;}
    const timestamp=Math.max(performance.now(),vtoLastTimestamp+1);vtoLastTimestamp=timestamp;
    let status;
    try{status=frameStatus(task,timestamp);}catch(e){stopVto();msg('Camera detection stopped: '+e.message);return;}
    renderVtoOverlay(task,status.landmarks);
    const detectionKey=status.found?task.target:'';
    if(detectionKey&&detectionKey!==vtoLastDetected)vtoToast(task.target==='neck'?'Neck detected':task.target==='finger'?'Finger detected':'Hand detected');
    vtoLastDetected=detectionKey;
    $('vtoStep').textContent=`Photo ${vtoIndex+1} of ${vtoTasks.length}: ${task.label}. ${status.guidance}`;
    vtoStable=status.ready?vtoStable+1:0;
    if(vtoStable>=3){
      const canvas=document.createElement('canvas'),scale=Math.min(1,640/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
      const context=canvas.getContext('2d');if(vtoFacingMode==='user'){context.translate(canvas.width,0);context.scale(-1,1);}context.drawImage(video,0,0,canvas.width,canvas.height);
      const photo=canvas.toDataURL('image/jpeg',.86);vtoShots.push({photo,label:task.label,target:task.target,landmarks:status.landmarks});
      const card=document.createElement('div');card.className='shot';card.innerHTML=`<img alt="${esc(task.label)}" src="${photo}"><small>${esc(task.label)}</small>`;$('vtoShots').appendChild(card);
      vtoToast(task.target==='neck'?'Neck photo captured':task.target==='finger'?'Finger photo captured':'Hand photo captured');vtoIndex++;vtoStable=0;vtoLastDetected='';
      if(vtoIndex<vtoTasks.length)$('cameraGuide').className='camera-guide '+(vtoTasks[vtoIndex].target==='neck'?'':'hand');
    }
    await new Promise(r=>setTimeout(r,120));
  }
  if(vtoLoop&&vtoIndex>=vtoTasks.length){vtoLoop=false;stopCameraStream();$('vtoSwitch').classList.add('hidden');$('vtoStop').classList.add('hidden');$('vtoStart').classList.remove('hidden');$('vtoStep').textContent=`All ${vtoShots.length} guided photos captured. Review them above; retake by starting again.`;vtoToast('Capture complete');api('/history',{method:'POST',body:{kind:'try_on',detail:`${vtoSelected.name}: ${vtoShots.length} guided photos`}}).catch(()=>{});}
}
function stopCameraStream(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('camera').srcObject=null;}
function stopVto(){vtoLoop=false;stopCameraStream();$('vtoOverlay').style.display='none';$('vtoModel').style.opacity='0';$('vtoModel').style.display='block';$('vtoSwitch').classList.add('hidden');$('vtoStop').classList.add('hidden');$('vtoStart').classList.remove('hidden');}
async function startCamera(){return startVto();}
async function capture(){return startVto();}
