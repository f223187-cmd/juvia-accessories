let vtoTasks=[],vtoIndex=0,vtoStable=0,vtoLoop=false,vtoCaptureComplete=false,vtoPoseReference=null,vtoShots=[],vtoToastTimer=null;
let handLandmarker=null,faceLandmarker=null,vtoVisionPromise=null,vtoLastTimestamp=0,vtoLastDetected='';
let vtoProducts=[],vtoSelected=null,vtoOverlayState=null;
let vtoFacingMode='user';
let vtoRunId=0;
const VTO_MODEL_BASE='https://storage.googleapis.com/mediapipe-models/';
const VTO_WASM='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';

function vtoPlan(category){
  if(category==='necklaces')return [
    {target:'neck',pose:'front',label:'Neck — front view',hint:'Face forward, keep your head and shoulders in frame, and move hair or clothing away from your neck.'},
    {target:'neck',pose:'left',label:'Neck — left angle',hint:'Keep your head and neck in frame, then turn your nose slightly toward the left edge of the screen.'},
    {target:'neck',pose:'right',label:'Neck — right angle',hint:'Keep your head and neck in frame, then turn your nose slightly toward the right edge of the screen.'}
  ];
  if(category==='rings')return [
    {target:'hand',label:'Hand — open palm',hint:'Hold your full hand close enough to see all fingertips; spread your fingers comfortably.'},
    {target:'finger',label:'Finger — ring finger',hint:'Bring the hand closer, then hold your ring finger straight and visible with the other fingers relaxed.'}
  ];
  const item=category==='watches'?'Watch':'Bracelet';
  return [
    {target:'wrist',pose:'outer',label:`Wrist — ${item.toLowerCase()} side`,hint:'Show your whole hand and wrist inside the guide with the back of your hand facing the camera.'},
    {target:'wrist',pose:'inner',label:'Wrist — inner side',hint:'Rotate your forearm until your palm faces the camera; keep your whole hand and wrist in frame.'}
  ];
}
function vtoGuideClass(task){return task.target==='neck'?'neck':task.target==='wrist'?'wrist':'hand';}
function vtoTargetName(){return $('vtoProduct').value==='necklaces'?'neck':$('vtoProduct').value==='rings'?'ring finger':'wrist';}
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
function resetVto(){stopVto();vtoTasks=[];vtoIndex=0;vtoStable=0;vtoCaptureComplete=false;vtoPoseReference=null;vtoShots=[];vtoLastDetected='';$('vtoShots').innerHTML='';$('vtoOverlay').style.display='none';$('vtoModel').style.display='none';$('vtoStep').textContent='Choose a product with an image or linked 3D model.';}
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
  vtoOverlayState=null;
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
    const runId=++vtoRunId;vtoOverlayState=null;
    stream=await openVtoCamera(vtoFacingMode);
    await loadVtoModels();
    vtoTasks=vtoPlan($('vtoProduct').value);vtoIndex=0;vtoStable=0;vtoCaptureComplete=false;vtoPoseReference=null;vtoShots=[];vtoLastDetected='';$('vtoShots').innerHTML='';
    $('vtoStart').classList.add('hidden');$('vtoRetake').classList.add('hidden');$('vtoSwitch').classList.remove('hidden');$('vtoStop').classList.remove('hidden');vtoLoop=true;
    $('cameraGuide').className='camera-guide '+vtoGuideClass(vtoTasks[0]);await vtoScan(runId);
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
  let found=false,ready=false,guidance=task.hint;
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
      if(cx<.16||cx>.84||cy<.12||cy>.9)guidance='Center your whole hand and wrist inside the guide.';
      else if(span<(task.target==='finger' ? 0.24 : 0.2))guidance='Move closer so the camera can see your hand and wrist clearly.';
      else if(span>.88)guidance='Move slightly farther back and keep your whole hand in frame.';
      else if(task.target==='finger'&&Math.hypot(rawPoints[16].x-rawPoints[14].x,rawPoints[16].y-rawPoints[14].y)<.045)guidance='Straighten and show your ring finger.';
      else{ready=true;guidance=task.target==='finger'?'Finger detected. Hold still.':task.target==='wrist'?'Wrist detected. Hold still.':'Hand detected. Hold still.';}
      landmarks=rawPoints.map(p=>({x:p.x,y:p.y,z:p.z}));
      if(task.target==='wrist'&&rawPoints.length>17){
        const points=result.worldLandmarks?.[0]?.length>17?result.worldLandmarks[0]:rawPoints;
        const a={x:points[5].x-points[0].x,y:points[5].y-points[0].y,z:points[5].z-points[0].z};
        const b={x:points[17].x-points[0].x,y:points[17].y-points[0].y,z:points[17].z-points[0].z};
        const normal={x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};
        const magnitude=Math.hypot(normal.x,normal.y,normal.z)||1;
        const palmNormal={x:normal.x/magnitude,y:normal.y/magnitude,z:normal.z/magnitude};
        if(task.pose==='inner'&&vtoPoseReference){
          const turn=palmNormal.x*vtoPoseReference.x+palmNormal.y*vtoPoseReference.y+palmNormal.z*vtoPoseReference.z;
          if(turn>.5){ready=false;guidance='Rotate your forearm farther so your palm faces the camera.';}
        }
        if(!vtoCaptureComplete)landmarks.palmNormal=palmNormal;
      }
    }
  }
  return {found,ready,guidance,landmarks};
}
function renderVtoOverlay(task,landmarks){
  const video=$('camera'),rect=video.getBoundingClientRect(),model=$('vtoModel'),useModel=model.dataset.productId===String(vtoSelected?.id)&&model.dataset.ready==='true',overlay=useModel?model:$('vtoOverlay');
  if($('vtoProduct').value==='rings'&&task.target!=='finger'){$('vtoOverlay').style.display='none';model.style.opacity='0';model.style.display='none';return;}
  if((!useModel&&(!vtoSelected?.image||!overlay.complete||!overlay.naturalWidth))||landmarks.length<2||!rect.width||!rect.height){overlay.style.display='none';vtoOverlayState=null;if(useModel){model.style.opacity='0';model.style.display='block';}return;}
  const sourceWidth=video.videoWidth||rect.width,sourceHeight=video.videoHeight||rect.height,fit=getComputedStyle(video).objectFit;
  const scale=fit==='cover'?Math.max(rect.width/sourceWidth,rect.height/sourceHeight):Math.min(rect.width/sourceWidth,rect.height/sourceHeight);
  const contentWidth=sourceWidth*scale,contentHeight=sourceHeight*scale,offsetX=(rect.width-contentWidth)/2,offsetY=(rect.height-contentHeight)/2;
  let centerX,centerY,width,angle=0;
  const displayPoint=p=>({x:offsetX+(vtoFacingMode==='user'?1-p.x:p.x)*contentWidth,y:offsetY+p.y*contentHeight});
  if(task.target==='neck'){
    const chin=displayPoint(landmarks[0]),left=displayPoint(landmarks[1]),right=displayPoint(landmarks[2]);
    centerX=(left.x+right.x)/2;const span=Math.hypot(right.x-left.x,right.y-left.y);centerY=chin.y+span*.12;width=span*1.1;angle=Math.atan2(right.y-left.y,right.x-left.x)*180/Math.PI;
  }else if(task.target==='finger'){
    const proximal=displayPoint(landmarks[13]),middle=displayPoint(landmarks[14]);
    centerX=(proximal.x+middle.x)/2;centerY=(proximal.y+middle.y)/2;width=Math.max(24,Math.hypot(middle.x-proximal.x,middle.y-proximal.y)*2.4);angle=Math.atan2(middle.y-proximal.y,middle.x-proximal.x)*180/Math.PI+90;
  }else{
    const wrist=displayPoint(landmarks[0]),index=displayPoint(landmarks[5]||landmarks[9]),pinky=displayPoint(landmarks[17]);
    const palm=displayPoint(landmarks[9]),forearmX=wrist.x-palm.x,forearmY=wrist.y-palm.y,forearmLength=Math.hypot(forearmX,forearmY)||1;
    const palmWidth=Math.hypot(index.x-pinky.x,index.y-pinky.y);
    centerX=wrist.x+forearmX/forearmLength*palmWidth*.14;centerY=wrist.y+forearmY/forearmLength*palmWidth*.14;
    width=Math.max(52,palmWidth*1.25);angle=Math.atan2(forearmY,forearmX)*180/Math.PI-90;
    if(task.target==='hand'){centerX=palm.x;centerY=palm.y;width*=1.2;}
  }
  const target={x:centerX,y:centerY,width,angle,target:task.target,productId:vtoSelected?.id};
  if(!vtoOverlayState||vtoOverlayState.target!==target.target||vtoOverlayState.productId!==target.productId)vtoOverlayState=target;
  else{
    const angleDelta=((target.angle-vtoOverlayState.angle+540)%360)-180,follow=.42;
    vtoOverlayState.x+=(target.x-vtoOverlayState.x)*follow;vtoOverlayState.y+=(target.y-vtoOverlayState.y)*follow;vtoOverlayState.width+=(target.width-vtoOverlayState.width)*follow;vtoOverlayState.angle+=angleDelta*follow;
  }
  ({x:centerX,y:centerY,width,angle}=vtoOverlayState);
  overlay.style.width=`${width}px`;if(useModel){overlay.style.height=`${width}px`;overlay.style.opacity='1';}overlay.style.left=`${centerX}px`;overlay.style.top=`${centerY}px`;overlay.style.transform=`translate(-50%,-50%) rotate(${angle}deg)`;overlay.style.display='block';if(useModel)$('vtoOverlay').style.display='none';else{model.style.opacity='0';model.style.display='block';}
}
async function vtoScan(runId){
  while(vtoLoop&&runId===vtoRunId){
    const capturing=vtoIndex<vtoTasks.length;
    const liveTask=vtoTasks.find(task=>task.target==='finger')||vtoTasks.find(task=>task.target==='wrist')||vtoTasks[0];
    const task=capturing?vtoTasks[vtoIndex]:liveTask,video=$('camera');
    if(!task)break;
    if(capturing)$('vtoStep').textContent=`Photo ${vtoIndex+1} of ${vtoTasks.length}: ${task.label}. ${task.hint}`;
    if(video.readyState<2||!video.videoWidth){await new Promise(r=>setTimeout(r,150));continue;}
    const timestamp=Math.max(performance.now(),vtoLastTimestamp+1);vtoLastTimestamp=timestamp;
    let status;
    try{status=frameStatus(task,timestamp);}catch(e){stopVto();msg('Camera detection stopped: '+e.message);return;}
    renderVtoOverlay(task,status.landmarks);
    const detectionKey=status.found?task.target:'';
    if(detectionKey&&detectionKey!==vtoLastDetected)vtoToast(task.target==='neck'?'Neck detected':task.target==='finger'?'Finger detected':'Hand detected');
    vtoLastDetected=detectionKey;
    if(capturing){
      $('vtoStep').textContent=`Photo ${vtoIndex+1} of ${vtoTasks.length}: ${task.label}. ${status.guidance}`;
      vtoStable=status.ready?vtoStable+1:0;
    }else{
      $('vtoStep').textContent=status.found?`Live try-on is tracking your ${vtoTargetName()}. Move naturally and the accessory will follow.`:`Live try-on is ready. Bring your ${vtoTargetName()} into the camera view.`;
    }
    if(capturing&&vtoStable>=3){
      const canvas=document.createElement('canvas'),scale=Math.min(1,640/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
      const context=canvas.getContext('2d');if(vtoFacingMode==='user'){context.translate(canvas.width,0);context.scale(-1,1);}context.drawImage(video,0,0,canvas.width,canvas.height);
      const photo=canvas.toDataURL('image/jpeg',.86);vtoShots.push({photo,label:task.label,target:task.target,landmarks:status.landmarks});
      if(task.target==='wrist'&&task.pose==='outer'&&status.landmarks.palmNormal)vtoPoseReference=status.landmarks.palmNormal;
      const card=document.createElement('div');card.className='shot';card.innerHTML=`<img alt="${esc(task.label)}" src="${photo}"><small>${esc(task.label)}</small>`;$('vtoShots').appendChild(card);
      vtoToast(task.target==='neck'?'Neck photo captured':task.target==='finger'?'Finger photo captured':'Hand photo captured');vtoIndex++;vtoStable=0;vtoLastDetected='';
      if(vtoIndex<vtoTasks.length)$('cameraGuide').className='camera-guide '+vtoGuideClass(vtoTasks[vtoIndex]);
      if(vtoIndex>=vtoTasks.length){
        vtoCaptureComplete=true;$('vtoRetake').classList.remove('hidden');$('vtoStep').textContent=`Guided photos captured. Live tracking is active; move your ${vtoTargetName()} to see the accessory follow.`;vtoToast('Live try-on active');
        api('/history',{method:'POST',body:{kind:'try_on',detail:`${vtoSelected.name}: ${vtoShots.length} guided photos`}}).catch(()=>{});
      }
    }
    await new Promise(r=>setTimeout(r,33));
  }
}
function retakeVto(){
  if(!vtoLoop||!stream)return;
  vtoTasks=vtoPlan($('vtoProduct').value);vtoIndex=0;vtoStable=0;vtoCaptureComplete=false;vtoPoseReference=null;vtoShots=[];$('vtoShots').innerHTML='';$('vtoRetake').classList.add('hidden');$('cameraGuide').className='camera-guide '+vtoGuideClass(vtoTasks[0]);
  $('vtoStep').textContent='Retaking guided views. Follow the prompt and keep the target in the guide.';
}
function stopCameraStream(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('camera').srcObject=null;}
function stopVto(){vtoLoop=false;vtoRunId++;vtoOverlayState=null;stopCameraStream();$('vtoOverlay').style.display='none';$('vtoModel').style.opacity='0';$('vtoModel').style.display='none';$('vtoRetake').classList.add('hidden');$('vtoSwitch').classList.add('hidden');$('vtoStop').classList.add('hidden');$('vtoStart').classList.remove('hidden');}
async function startCamera(){return startVto();}
async function capture(){return startVto();}
