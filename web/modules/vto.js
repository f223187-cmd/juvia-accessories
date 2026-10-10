let vtoTasks=[],vtoStable=0,vtoLoop=false,vtoCapturePaused=false,vtoLiveReady=false,vtoShots=[],vtoToastTimer=null;
let vtoLastViewSignature=null,vtoLastViewCapture=0,vtoMeasurements={},vtoOcclusionLastDraw=0;
let handLandmarker=null,faceLandmarker=null,poseLandmarker=null,vtoVisionPromise=null,vtoVisionCategory='',vtoLastTimestamp=0,vtoLastDetected='';
let vtoProducts=[],vtoSelected=null,vtoOverlayState=null;
let vtoFacingMode='user';
let vtoRunId=0;
let vtoFrameWaitSince=0;
const VTO_MODEL_BASE='https://storage.googleapis.com/mediapipe-models/';
const VTO_WASM='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';

function vtoPlan(category){
  if(category==='necklaces')return [{target:'neck',label:'Neck and collar area',hint:'Frame your jaw, neck, and both shoulders. Keep hair away from your neck, then turn slowly; Juvia saves each clear new angle.'}];
  if(category==='rings')return [{target:'finger',label:'Ring finger',hint:'Bring the ring finger close and keep its base, joints, and tip visible. Move slowly to show a few angles; Juvia saves clear new views.'}];
  const item=category==='watches'?'watch':'bracelet';
  return [{target:'wrist',label:'Wrist and lower forearm',hint:`Place your wrist, lower forearm, and hand in the guide; keep your face outside it. Tracking starts as soon as the wrist is steady. Slowly roll your wrist to save clear ${item} views.`}];
}
function vtoGuideClass(task){return task.target==='neck'?'neck':task.target==='wrist'?'wrist':'hand';}
function vtoProductKind(){return $('vtoProduct').value==='necklaces'?'neck':$('vtoProduct').value==='rings'?'finger':'wrist';}
function vtoTargetName(){return $('vtoProduct').value==='necklaces'?'neck':$('vtoProduct').value==='rings'?'ring finger':'wrist';}
function vtoTargetLabel(){return $('vtoProduct').value==='necklaces'?'Neck':$('vtoProduct').value==='rings'?'Ring finger':'Wrist';}
function vtoMeasurementLabel(){return $('vtoProduct').value==='necklaces'?'Neck circumference':$('vtoProduct').value==='rings'?'Ring finger circumference':'Wrist circumference';}
function setVtoGuideValidity(valid){const guide=$('cameraGuide');guide.classList.toggle('is-valid',!!valid);guide.classList.toggle('is-invalid',!valid);guide.dataset.poseState=valid?'valid':'invalid';}
function updateVtoMeasurement(){
  const category=$('vtoProduct').value,label=vtoMeasurementLabel();
  $('vtoMeasureLabel').textContent=label+' (inches, soft-tape reading)';
  $('vtoMeasurement').value=vtoMeasurements[category]??'';
  $('vtoMeasurementResult').textContent=vtoMeasurements[category]==null?'No tape reading saved for this session.':'Your '+label.toLowerCase()+' tape reading: '+vtoMeasurements[category]+' in.';
}
function saveVtoMeasurement(){
  const input=$('vtoMeasurement'),value=Number(input.value),category=$('vtoProduct').value;
  if(!Number.isFinite(value)||value<=0||value>60){msg('Enter a valid soft-tape reading in inches.');return;}
  vtoMeasurements[category]=Math.round(value*10)/10;updateVtoMeasurement();
  $('vtoStep').textContent=vtoLiveReady?`${vtoTargetLabel()} tracked. Live try-on is following the landmarks. ${$('vtoMeasurementResult').textContent}`:'Tape reading saved for this browser session. Start try-on to track the '+vtoTargetName()+'.';
}
function clearVtoViews(){
  vtoShots=[];vtoLastViewSignature=null;vtoLastViewCapture=0;
  $('vtoShots').replaceChildren();$('vtoViewCount').textContent='0 clear views';$('vtoRetake').classList.add('hidden');$('vtoFinish').classList.add('hidden');$('vtoFinish').disabled=false;
}
function clearVtoOcclusion(){const canvas=$('vtoOcclusion');if(!canvas)return;const context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);vtoOcclusionLastDraw=0;}
function renderVtoOcclusion(landmarks,timestamp){
  const canvas=$('vtoOcclusion'),video=$('camera');if(!canvas||!video.videoWidth||landmarks?.length!==21){clearVtoOcclusion();return;}
  if(timestamp-vtoOcclusionLastDraw<55)return;vtoOcclusionLastDraw=timestamp;
  const width=Math.min(960,video.videoWidth),height=Math.round(width*video.videoHeight/video.videoWidth);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const context=canvas.getContext('2d');context.clearRect(0,0,width,height);context.save();
  if(vtoFacingMode==='user'){context.translate(width,0);context.scale(-1,1);}
  const contour=[0,1,2,3,4,8,12,16,20,19,18,17],points=contour.map(index=>({x:landmarks[index].x*width,y:landmarks[index].y*height}));
  const center=points.reduce((sum,p)=>({x:sum.x+p.x/points.length,y:sum.y+p.y/points.length}),{x:0,y:0}),pad=Math.max(3,Math.hypot(points[5].x-points[0].x,points[5].y-points[0].y)*.035);
  context.beginPath();points.forEach((p,index)=>{const x=center.x+(p.x-center.x)*(1+pad/Math.max(1,Math.hypot(p.x-center.x,p.y-center.y))),y=center.y+(p.y-center.y)*(1+pad/Math.max(1,Math.hypot(p.x-center.x,p.y-center.y)));if(index===0)context.moveTo(x,y);else context.lineTo(x,y);});context.closePath();context.clip();context.drawImage(video,0,0,width,height);context.restore();
}
function toggleVtoCapture(){
  if(vtoShots.length>=8){msg('Clear the saved views before collecting a new set.');return;}
  vtoCapturePaused=!vtoCapturePaused;$('vtoFinish').textContent=vtoCapturePaused?'Capture more views':'Finish view capture';
  $('vtoStep').textContent=vtoLiveReady?`${vtoTargetLabel()} tracked. Live try-on continues. ${vtoCapturePaused?'Automatic view capture is paused.':'Slowly turn to collect clear new angles.'}`:'Move the target into the guide; tracking starts when the pose is valid.';
}
function captureTargetPhoto(task,landmarks){
  const video=$('camera'),w=video.videoWidth,h=video.videoHeight;
  if(!landmarks?.length||!w||!h)return null;
  let x1,y1,x2,y2;
  if(task.target==='neck'){
    const [chin,left,right]=landmarks,faceWidth=Math.max(.08,Math.abs(right.x-left.x)),cx=(left.x+right.x)/2;
    x1=cx-faceWidth*.62;x2=cx+faceWidth*.62;y1=chin.y-faceWidth*.05;y2=chin.y+faceWidth*.72;
  }else{
    const used=task.target==='finger'?landmarks.slice(13,17):landmarks;
    const xs=used.map(p=>p.x),ys=used.map(p=>p.y),span=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));
    const padding=span*(task.target==='finger'?.7:.22);
    x1=Math.min(...xs)-padding;x2=Math.max(...xs)+padding;y1=Math.min(...ys)-padding;y2=Math.max(...ys)+padding;
  }
  x1=Math.max(0,Math.min(w-1,Math.floor(x1*w)));x2=Math.max(x1+1,Math.min(w,Math.ceil(x2*w)));
  y1=Math.max(0,Math.min(h-1,Math.floor(y1*h)));y2=Math.max(y1+1,Math.min(h,Math.ceil(y2*h)));
  const scale=Math.min(1,720/(x2-x1),720/(y2-y1)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round((x2-x1)*scale));canvas.height=Math.max(1,Math.round((y2-y1)*scale));
  const context=canvas.getContext('2d');if(vtoFacingMode==='user'){context.translate(canvas.width,0);context.scale(-1,1);}
  context.drawImage(video,x1,y1,x2-x1,y2-y1,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',.88);
}
function vtoIsNewView(signature){
  if(!signature)return !vtoShots.length;
  if(!vtoLastViewSignature)return true;
  if(signature.type==='normal'&&vtoLastViewSignature.type==='normal'){
    const a=signature,b=vtoLastViewSignature,dot=Math.max(-1,Math.min(1,a.x*b.x+a.y*b.y+a.z*b.z));
    return Math.acos(dot)>Math.PI/7;
  }
  if(signature.type==='angle'&&vtoLastViewSignature.type==='angle'){
    const delta=Math.abs(((signature.value-vtoLastViewSignature.value+Math.PI*3)%(Math.PI*2))-Math.PI);
    return delta>Math.PI/8;
  }
  return false;
}
function solveThree(matrix,vector){
  const rows=matrix.map((row,index)=>[...row,vector[index]]);
  for(let col=0;col<3;col++){
    let pivot=col;for(let row=col+1;row<3;row++)if(Math.abs(rows[row][col])>Math.abs(rows[pivot][col]))pivot=row;
    if(Math.abs(rows[pivot][col])<1e-10)return null;
    [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
    const divisor=rows[col][col];for(let k=col;k<4;k++)rows[col][k]/=divisor;
    for(let row=0;row<3;row++)if(row!==col){const factor=rows[row][col];for(let k=col;k<4;k++)rows[row][k]-=factor*rows[col][k];}
  }
  return rows.map(row=>row[3]);
}
function estimateHandProjection(imagePoints,worldPoints,sourceWidth,sourceHeight){
  if(imagePoints?.length!==21||worldPoints?.length!==21||!sourceWidth||!sourceHeight)return null;
  const worldMean=[0,0,0],imageMean=[0,0];
  for(let i=0;i<21;i++){worldMean[0]+=worldPoints[i].x/21;worldMean[1]+=worldPoints[i].y/21;worldMean[2]+=worldPoints[i].z/21;imageMean[0]+=imagePoints[i].x*sourceWidth/21;imageMean[1]+=imagePoints[i].y*sourceHeight/21;}
  const covariance=[[0,0,0],[0,0,0],[0,0,0]],crossU=[0,0,0],crossV=[0,0,0];
  for(let i=0;i<21;i++){
    const d=[worldPoints[i].x-worldMean[0],worldPoints[i].y-worldMean[1],worldPoints[i].z-worldMean[2]],u=imagePoints[i].x*sourceWidth-imageMean[0],v=imagePoints[i].y*sourceHeight-imageMean[1];
    for(let row=0;row<3;row++){crossU[row]+=d[row]*u;crossV[row]+=d[row]*v;for(let col=0;col<3;col++)covariance[row][col]+=d[row]*d[col];}
  }
  const trace=covariance[0][0]+covariance[1][1]+covariance[2][2],regularization=Math.max(trace*1e-5,1e-12);
  for(let axis=0;axis<3;axis++)covariance[axis][axis]+=regularization;
  const u=solveThree(covariance,crossU),v=solveThree(covariance,crossV);if(!u||!v)return null;
  const pixelsPerWorld=(Math.hypot(...u)+Math.hypot(...v))/2;
  if(!Number.isFinite(pixelsPerWorld)||pixelsPerWorld<1||pixelsPerWorld>100000)return null;
  return {worldMean,imageMean,u,v,pixelsPerWorld,project(point){const d=[point.x-worldMean[0],point.y-worldMean[1],point.z-worldMean[2]];return {x:imageMean[0]+u[0]*d[0]+u[1]*d[1]+u[2]*d[2],y:imageMean[1]+v[0]*d[0]+v[1]*d[1]+v[2]*d[2]};}};
}
function distance3(a,b){return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);}
async function loadVtoModels(){
  const category=$('vtoProduct').value,needsNeck=category==='necklaces';
  if(vtoVisionPromise&&vtoVisionCategory===category)return vtoVisionPromise;
  if(vtoVisionPromise)try{await vtoVisionPromise;}catch{}
  for(const model of [handLandmarker,faceLandmarker,poseLandmarker])model?.close();
  handLandmarker=faceLandmarker=poseLandmarker=null;
  const load=(async()=>{
    const vision=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs');
    const files=await vision.FilesetResolver.forVisionTasks(VTO_WASM);
    const handUrl=VTO_MODEL_BASE+'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
    const faceUrl=VTO_MODEL_BASE+'face_landmarker/face_landmarker/float16/1/face_landmarker.task';
    const poseUrl=VTO_MODEL_BASE+'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
    async function create(delegate){
      const models={};
      try{
        if(needsNeck){
          models.face=await vision.FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:faceUrl,delegate},runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:.55,minFacePresenceConfidence:.55});
          models.pose=await vision.PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:poseUrl,delegate},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5});
        }else models.hand=await vision.HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:handUrl,delegate},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.6,minHandPresenceConfidence:.6,minTrackingConfidence:.6});
        return models;
      }catch(e){Object.values(models).forEach(model=>model.close());throw e;}
    }
    try{return await create('GPU');}catch{return await create('CPU');}
  })();
  vtoVisionCategory=category;vtoVisionPromise=load;
  try{const models=await load;if(vtoVisionPromise===load){handLandmarker=models.hand||null;faceLandmarker=models.face||null;poseLandmarker=models.pose||null;}return models;}
  catch(e){if(vtoVisionPromise===load){vtoVisionPromise=null;vtoVisionCategory='';}throw e;}
}
async function loadVtoModelsWithTimeout(){
  let timer;
  try{return await Promise.race([loadVtoModels(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The target-tracking model did not load within 45 seconds. Check your connection and tap Start live try-on to retry.')),45000);})]);}
  catch(e){if(e.message.includes('45 seconds')){vtoVisionPromise=null;vtoVisionCategory='';}throw e;}
  finally{clearTimeout(timer);}
}
function vtoToast(text){const el=$('vtoToast');el.textContent=text;el.classList.remove('hidden');clearTimeout(vtoToastTimer);vtoToastTimer=setTimeout(()=>el.classList.add('hidden'),2400);}
function resetVto(){stopVto();vtoTasks=[];vtoStable=0;vtoCapturePaused=false;vtoLiveReady=false;vtoLastDetected='';clearVtoViews();updateVtoMeasurement();$('vtoOverlay').style.display='none';$('vtoModel').style.display='none';$('vtoStep').textContent='Choose a product with an image or linked 3D model.';}
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
  const overlay=$('vtoOverlay'),model=$('vtoModel');overlay.style.display='none';model.style.display='none';model.style.opacity='0';model.removeAttribute('src');model.dataset.ready='false';model.dataset.error='';model.dataset.productId='';clearVtoOcclusion();
  if(!vtoSelected){overlay.removeAttribute('src');$('vtoStep').textContent='Choose a product with an image or linked 3D model.';return;}
  if(vtoSelected.image)overlay.src=vtoSelected.image;
  $('vtoStep').textContent='Product selected. Start live try-on to locate the '+vtoTargetName()+'.';
  try{
    const productId=vtoSelected.id,asset=await api('/products/'+productId+'/asset');
    if(vtoSelected?.id!==productId)return;
    model.dataset.productId=String(productId);model.addEventListener('load',()=>{if(vtoSelected?.id===productId){model.dataset.ready='true';model.dataset.error='';overlay.style.display='none';if(!vtoLoop)model.style.display='none';}},{once:true});model.addEventListener('error',event=>{if(vtoSelected?.id===productId){model.dataset.error=event.detail?.type||'load';model.dataset.ready='false';model.style.display='none';clearVtoOcclusion();$('vtoStep').textContent='This 3D model could not be loaded. Check that the file is a valid GLB.';}},{once:true});model.style.display='block';model.style.opacity='0';model.style.width='180px';model.style.height='180px';model.setAttribute('src',asset.url);
  }catch{}
}
async function chooseVtoProduct(id,category){
  $('vtoProduct').value=category;
  if(!vtoProducts.some(p=>p.category===category))await loadVtoProducts();
  $('vtoItem').value=String(id);await setVtoItem();show('tryon');
  api('/history',{method:'POST',body:{kind:'product_view',detail:`try-on product:${id}`}}).catch(()=>{});
}
async function hasVtoPreview(product){
  if(!product)return false;
  try{await api('/products/'+product.id+'/asset');return true;}catch{return false;}
}
async function startVto(){
  const runId=++vtoRunId;
  let permissionTimer;
  try{
    $('vtoStart').disabled=true;$('vtoStart').classList.add('hidden');$('vtoStop').classList.remove('hidden');$('vtoStep').textContent='Checking the selected product and preparing your camera…';
    vtoLoop=false;vtoOverlayState=null;vtoFrameWaitSince=0;stopCameraStream();setVtoGuideValidity(false);
    if(!vtoProducts.length)await loadVtoProducts();
    if(runId!==vtoRunId)return;
    if(!await hasVtoPreview(vtoSelected))throw new Error('Live AR needs a linked 3D GLB model. A flat catalogue image cannot follow or rotate with your wrist.');
    if(runId!==vtoRunId)return;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access requires HTTPS and a current mobile browser.');
    vtoTasks=vtoPlan($('vtoProduct').value);vtoStable=0;vtoCapturePaused=false;vtoLiveReady=false;vtoLastDetected='';clearVtoViews();$('vtoFinish').textContent='Finish view capture';$('cameraGuide').className='camera-guide '+vtoGuideClass(vtoTasks[0])+' is-invalid';updateVtoMeasurement();
    $('vtoStep').textContent='Allow camera access when your browser asks. Your camera preview will appear here.';
    permissionTimer=setTimeout(()=>{if(runId===vtoRunId&&!stream)$('vtoStep').textContent='Still waiting for camera permission. Choose Allow in your browser, or tap Stop camera to cancel.';},8000);
    const openedStream=await openVtoCamera(vtoFacingMode);
    clearTimeout(permissionTimer);permissionTimer=null;
    if(runId!==vtoRunId){openedStream.getTracks().forEach(track=>track.stop());if($('camera').srcObject===openedStream)$('camera').srcObject=null;return;}
    stream=openedStream;$('vtoSwitch').classList.remove('hidden');$('vtoStep').textContent='Camera is on. Loading the '+(vtoProductKind()==='neck'?'neck and shoulder':'hand')+' tracking model on this device.';
    await loadVtoModelsWithTimeout();
    if(runId!==vtoRunId)return;
    vtoTasks=vtoPlan($('vtoProduct').value);vtoStable=0;vtoLiveReady=false;vtoLastDetected='';clearVtoViews();vtoLoop=true;
    $('cameraGuide').className='camera-guide '+vtoGuideClass(vtoTasks[0])+' is-invalid';await vtoScan(runId);
  }catch(e){if(runId===vtoRunId){stopVto();$('vtoStep').textContent='Try-on could not start: '+e.message;msg(e.message);}}
  finally{clearTimeout(permissionTimer);if(runId===vtoRunId)$('vtoStart').disabled=false;}
}
async function openVtoCamera(mode,exact=false){
  const facingMode=exact?{exact:mode}:{ideal:mode};
  const nextStream=await navigator.mediaDevices.getUserMedia({video:{facingMode,width:{ideal:720},height:{ideal:960}},audio:false});
  const video=$('camera');video.srcObject=nextStream;
  try{await video.play();}catch(e){nextStream.getTracks().forEach(track=>track.stop());video.srcObject=null;throw e;}
  const fitCameraFrame=()=>{if(video.videoWidth&&video.videoHeight)video.parentElement.style.aspectRatio=video.videoWidth+' / '+video.videoHeight;};
  video.addEventListener('loadedmetadata',fitCameraFrame,{once:true});fitCameraFrame();
  vtoFacingMode=mode;video.classList.toggle('rear-camera',mode==='environment');
  return nextStream;
}
async function switchVtoCamera(){
  if(!vtoLoop||!stream)return;
  const previous=vtoFacingMode,next=previous==='user'?'environment':'user',button=$('vtoSwitch');
  button.disabled=true;vtoStable=0;vtoFrameWaitSince=0;setVtoGuideValidity(false);$('vtoStep').textContent='Switching camera…';stopCameraStream();
  try{stream=await openVtoCamera(next,true);vtoLastTimestamp=0;vtoToast(next==='user'?'Front camera':'Back camera');}
  catch(e){
    try{stream=await openVtoCamera(previous);$('vtoStep').textContent='That camera is unavailable; continuing with the previous camera.';}
    catch{stopVto();msg('Could not switch cameras: '+e.message);}
  }finally{button.disabled=false;}
}
function frameStatus(task,timestamp){
  let found=false,ready=false,guidance=task.hint,rawPoints=[],landmarks=[],signature=null;
  if(task.target==='neck'){
    const face=faceLandmarker.detectForVideo($('camera'),timestamp).faceLandmarks?.[0]||[];
    const pose=poseLandmarker.detectForVideo($('camera'),timestamp).landmarks?.[0]||[];
    if(!face.length)guidance='Frame your head above the neck guide; a face alone will not count as a neck view.';
    else{
      found=true;const faceWidth=Math.abs(face[454].x-face[234].x),faceCenter=(face[454].x+face[234].x)/2,chin=face[152];
      const left=pose[11],right=pose[12],visibility=p=>p?(p.visibility??p.presence??0):0;
      if(faceCenter<.18||faceCenter>.82||chin.y<.08||chin.y>.72)guidance='Center your head above the neck guide.';
      else if(faceWidth<.16)guidance='Move back until your neck and both shoulders fit in the frame.';
      else if(faceWidth>.62)guidance='Move slightly farther from the camera.';
      else if(!left||!right||visibility(left)<.35||visibility(right)<.35)guidance='Move back until both shoulders are visible; a face alone does not count as a neck view.';
      else{
        const shoulderMid={x:(left.x+right.x)/2,y:(left.y+right.y)/2};
        if(shoulderMid.y<chin.y+.07)guidance='Keep the full neck between your jaw and shoulders in view.';
        else if(Math.abs(left.x-right.x)<faceWidth*1.15)guidance='Face the camera and include both shoulders.';
        else{ready=true;guidance='Neck and both shoulders detected. Live tracking is ready; turn slowly for more views.';}
        const yaw=Math.atan2((face[234].x+face[454].x)/2-face[1].x,Math.max(.01,faceWidth*.5));
        signature={type:'angle',value:yaw};
        landmarks=[{x:chin.x,y:chin.y,z:chin.z},{x:left.x,y:left.y,z:left.z},{x:right.x,y:right.y,z:right.z}];
      }
    }
  }else{
    const result=handLandmarker.detectForVideo($('camera'),timestamp);rawPoints=result.landmarks?.[0]||[];
    if(rawPoints.length===21){
      found=true;const xs=rawPoints.map(p=>p.x),ys=rawPoints.map(p=>p.y),span=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));
      if(task.target==='finger'){
        const ring=rawPoints.slice(13,17),ringLength=Math.hypot(ring[3].x-ring[0].x,ring[3].y-ring[0].y),cx=ring.reduce((sum,p)=>sum+p.x,0)/ring.length,cy=ring.reduce((sum,p)=>sum+p.y,0)/ring.length;
        if(cx<.12||cx>.88||cy<.12||cy>.9)guidance='Move the ring finger into the guide.';
        else if(ringLength<.12)guidance='Move closer and keep the ring finger base, joints, and tip visible.';
        else if(span>.94)guidance='Move slightly farther back so the ring finger stays in frame.';
        else{ready=true;guidance='Ring finger landmarks detected. Live tracking is ready; rotate slowly for more views.';}
        signature={type:'angle',value:Math.atan2(ring[3].y-ring[0].y,ring[3].x-ring[0].x)};
      }else{
        const wrist=rawPoints[0],palm={x:(rawPoints[5].x+rawPoints[17].x)/2,y:(rawPoints[5].y+rawPoints[17].y)/2},cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
        if(cx<.14||cx>.86||cy<.12||cy>.9||wrist.x<.08||wrist.x>.92||wrist.y<.08||wrist.y>.94)guidance='Move your wrist, lower forearm, and hand into the guide; keep your face outside it.';
        else if(span<.2)guidance='Move your hand closer so Juvia can see the wrist landmarks clearly.';
        else if(span>.88)guidance='Move slightly farther back and keep your hand in frame.';
        else if(Math.hypot(wrist.x-palm.x,wrist.y-palm.y)<.1)guidance='Show the wrist joint and the base of your palm together.';
        else{ready=true;guidance='Wrist landmarks detected. Live tracking is ready; roll your wrist slowly for more views.';}
      }
      landmarks=rawPoints.map(p=>({x:p.x,y:p.y,z:p.z}));
      if(task.target==='wrist'){
        const worldPoints=result.worldLandmarks?.[0]?.length===21?result.worldLandmarks[0]:null,points=worldPoints||rawPoints;
        const a={x:points[5].x-points[0].x,y:points[5].y-points[0].y,z:points[5].z-points[0].z},b={x:points[17].x-points[0].x,y:points[17].y-points[0].y,z:points[17].z-points[0].z};
        const normal={x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x},length=Math.hypot(normal.x,normal.y,normal.z)||1;
        const palmNormal={x:normal.x/length,y:normal.y/length,z:normal.z/length};landmarks.palmNormal=palmNormal;signature={type:'normal',...palmNormal};
        if(worldPoints){landmarks.worldPoints=worldPoints;landmarks.worldProjection=estimateHandProjection(rawPoints,worldPoints,$('camera').videoWidth,$('camera').videoHeight);}
      }
      landmarks.signature=signature;
    }
  }
  if(task.target==='neck'&&landmarks.length)landmarks.signature=signature;
  return {found,ready,guidance,landmarks,signature};
}
function renderVtoOverlay(task,landmarks){
  const video=$('camera'),rect=video.getBoundingClientRect(),model=$('vtoModel'),useModel=model.dataset.productId===String(vtoSelected?.id)&&model.dataset.ready==='true',overlay=model;
  if(!useModel||landmarks.length<2||!rect.width||!rect.height){$('vtoOverlay').style.display='none';model.style.opacity='0';model.style.display='none';vtoOverlayState=null;return;}
  const sourceWidth=video.videoWidth||rect.width,sourceHeight=video.videoHeight||rect.height,fit=getComputedStyle(video).objectFit;
  const scale=fit==='cover'?Math.max(rect.width/sourceWidth,rect.height/sourceHeight):Math.min(rect.width/sourceWidth,rect.height/sourceHeight),contentWidth=sourceWidth*scale,contentHeight=sourceHeight*scale,offsetX=(rect.width-contentWidth)/2,offsetY=(rect.height-contentHeight)/2;
  let centerX,centerY,width,angle=0;
  const displayPoint=p=>({x:offsetX+(vtoFacingMode==='user'?1-p.x:p.x)*contentWidth,y:offsetY+p.y*contentHeight});
  if(task.target==='neck'){
    const chin=displayPoint(landmarks[0]),left=displayPoint(landmarks[1]),right=displayPoint(landmarks[2]),shoulderY=(left.y+right.y)/2,span=Math.hypot(right.x-left.x,right.y-left.y);
    centerX=(left.x+right.x)/2;centerY=chin.y+(shoulderY-chin.y)*.62;width=span*.58;angle=Math.atan2(right.y-left.y,right.x-left.x)*180/Math.PI;
  }else if(task.target==='finger'){
    const proximal=displayPoint(landmarks[13]),middle=displayPoint(landmarks[14]);
    centerX=proximal.x+(middle.x-proximal.x)*.42;centerY=proximal.y+(middle.y-proximal.y)*.42;width=Math.max(22,Math.hypot(middle.x-proximal.x,middle.y-proximal.y)*.9);angle=Math.atan2(middle.y-proximal.y,middle.x-proximal.x)*180/Math.PI+90;
  }else{
    const wrist=displayPoint(landmarks[0]),palm=displayPoint(landmarks[9]),forearmX=wrist.x-palm.x,forearmY=wrist.y-palm.y;
    angle=Math.atan2(forearmY,forearmX)*180/Math.PI-90;
    const world=landmarks.worldPoints,projection=landmarks.worldProjection;
    if(world?.length===21&&projection){
      const hand={x:(world[5].x+world[9].x+world[17].x)/3-world[0].x,y:(world[5].y+world[9].y+world[17].y)/3-world[0].y,z:(world[5].z+world[9].z+world[17].z)/3-world[0].z},handLength=Math.hypot(hand.x,hand.y,hand.z)||1;
      const anchor={x:world[0].x-hand.x/handLength*handLength*.24,y:world[0].y-hand.y/handLength*handLength*.24,z:world[0].z-hand.z/handLength*handLength*.24};
      const projected=projection.project(anchor),target=displayPoint({x:projected.x/sourceWidth,y:projected.y/sourceHeight});centerX=target.x;centerY=target.y;
      const measured=vtoMeasurements[$('vtoProduct').value],wristBreadth=measured?Number(measured)*.0254/3.35:distance3(world[5],world[17])*.70,caseWidth=wristBreadth*.80,pixelsPerWorld=projection.pixelsPerWorld*scale;
      let faceFraction=.52;try{const d=model.getDimensions?.();if(d&&[d.x,d.y,d.z].every(n=>Number.isFinite(n)&&n>0))faceFraction=Math.max(.28,Math.min(.78,Math.min(d.x,d.y)/Math.max(d.x,d.y,d.z)));}catch{}
      width=Math.max(58,Math.min(rect.width*.92,caseWidth*pixelsPerWorld/faceFraction));
    }else{
      const index=displayPoint(landmarks[5]),pinky=displayPoint(landmarks[17]),palmWidth=Math.hypot(index.x-pinky.x,index.y-pinky.y);
      centerX=wrist.x+forearmX/(Math.hypot(forearmX,forearmY)||1)*palmWidth*.10;centerY=wrist.y+forearmY/(Math.hypot(forearmX,forearmY)||1)*palmWidth*.10;width=Math.max(58,palmWidth*1.12);
    }
  }
  const normal=landmarks.palmNormal||{x:0,y:0,z:1},pitch=Math.max(-80,Math.min(80,Math.asin(Math.max(-1,Math.min(1,-normal.y)))*180/Math.PI)),yaw=Math.max(-180,Math.min(180,Math.atan2(normal.x,normal.z)*180/Math.PI));
  const target={x:centerX,y:centerY,width,angle,pitch,yaw,target:task.target,productId:vtoSelected?.id};
  if(!vtoOverlayState||vtoOverlayState.target!==target.target||vtoOverlayState.productId!==target.productId)vtoOverlayState=target;
  else{
    const angleDelta=((target.angle-vtoOverlayState.angle+540)%360)-180,follow=.62;
    vtoOverlayState.x+=(target.x-vtoOverlayState.x)*follow;vtoOverlayState.y+=(target.y-vtoOverlayState.y)*follow;vtoOverlayState.width+=(target.width-vtoOverlayState.width)*follow;vtoOverlayState.angle+=angleDelta*follow;vtoOverlayState.pitch+=(target.pitch-vtoOverlayState.pitch)*follow;
  }
  const yawDelta=((target.yaw-vtoOverlayState.yaw+540)%360)-180;vtoOverlayState.yaw+=yawDelta*.62;
  ({x:centerX,y:centerY,width,angle}=vtoOverlayState);
  if(useModel&&task.target==='wrist'){
    const snap=value=>Math.round(value/2)*2,orientation='0deg '+snap(vtoOverlayState.pitch)+'deg '+snap(vtoOverlayState.yaw)+'deg';
    if(overlay.getAttribute('orientation')!==orientation)overlay.setAttribute('orientation',orientation);
  }
  overlay.style.width=width+'px';if(useModel){overlay.style.height=width+'px';overlay.style.opacity='1';}overlay.style.left=centerX+'px';overlay.style.top=centerY+'px';overlay.style.transform='translate(-50%,-50%) rotate('+angle+'deg)';overlay.style.display='block';if(useModel)$('vtoOverlay').style.display='none';else{model.style.opacity='0';model.style.display='block';}
}
async function vtoScan(runId){
  while(vtoLoop&&runId===vtoRunId){
    const task=vtoTasks[0],video=$('camera');if(!task)break;
    if(video.readyState<2||!video.videoWidth){
      if(!vtoFrameWaitSince){vtoFrameWaitSince=performance.now();$('vtoStep').textContent='Waiting for a live camera preview. Keep Juvia open while the camera starts.';}
      else if(performance.now()-vtoFrameWaitSince>12000){stopVto();$('vtoStep').textContent='The camera opened but sent no video frames. Check site camera permission, then tap Start live try-on again.';return;}
      await new Promise(resolve=>setTimeout(resolve,150));continue;
    }
    vtoFrameWaitSince=0;const timestamp=Math.max(performance.now(),vtoLastTimestamp+1);vtoLastTimestamp=timestamp;
    let status;try{status=frameStatus(task,timestamp);}catch(e){stopVto();$('vtoStep').textContent='Landmark tracking stopped: '+e.message;return;}
    if(status.found){renderVtoOverlay(task,status.landmarks);if(task.target==='wrist'&&$('vtoModel').dataset.ready==='true')renderVtoOcclusion(status.landmarks,timestamp);else clearVtoOcclusion();}else{const model=$('vtoModel');model.style.opacity='0';model.style.display='none';$('vtoOverlay').style.display='none';clearVtoOcclusion();}
    const detectionKey=status.ready?task.target:'';
    if(detectionKey&&detectionKey!==vtoLastDetected)vtoToast(vtoTargetLabel()+' detected');vtoLastDetected=detectionKey;
    vtoStable=status.ready?Math.min(vtoStable+1,30):0;
    setVtoGuideValidity(vtoStable>=3);
    if(status.ready&&vtoStable>=8)vtoLiveReady=true;
    if(!status.ready&&vtoStable===0)vtoLiveReady=false;
    if(status.ready){
      const modelReady=$('vtoModel').dataset.productId===String(vtoSelected?.id)&&$('vtoModel').dataset.ready==='true';
      const modelError=$('vtoModel').dataset.error,liveText=task.target==='wrist'&&modelError?'Wrist detected, but the 3D model failed to load. Check this product’s GLB asset. ':task.target==='wrist'&&!modelReady?'Wrist tracking is active. Loading the linked 3D model… ':vtoLiveReady?'Live tracking your '+vtoTargetName()+'. Move naturally; the accessory follows. ':'Hold this pose briefly to lock live tracking. ';
      const viewText=vtoCapturePaused?'Automatic view capture is paused. ':vtoShots.length+' clear '+vtoTargetName()+' view'+(vtoShots.length===1?'':'s')+' saved. Turn slowly for a new angle. ';
      const measurement=vtoMeasurements[$('vtoProduct').value];
      $('vtoStep').textContent=liveText+viewText+(measurement?'Soft-tape reading: '+measurement+' in.':'For a true circumference, enter a soft-tape reading below.');
    }else $('vtoStep').textContent=status.guidance;
    if(vtoLiveReady&&!vtoCapturePaused&&vtoShots.length<8&&vtoStable>=12&&timestamp-vtoLastViewCapture>1200&&vtoIsNewView(status.signature)){
      const photo=captureTargetPhoto(task,status.landmarks);
      if(photo){
        const number=vtoShots.length+1,label=vtoTargetLabel()+' view '+number;vtoShots.push({photo,label,target:task.target,signature:status.signature});vtoLastViewSignature=status.signature;vtoLastViewCapture=timestamp;
        const card=document.createElement('div');card.className='shot';card.innerHTML='<img alt="'+esc(label)+'" src="'+photo+'"><small>'+esc(label)+'</small>';$('vtoShots').appendChild(card);
        $('vtoViewCount').textContent=number+' clear view'+(number===1?'':'s');$('vtoRetake').classList.remove('hidden');$('vtoFinish').classList.remove('hidden');vtoToast('Clear '+vtoTargetName()+' view saved');
        if(number===1)api('/history',{method:'POST',body:{kind:'try_on',detail:vtoSelected.name+': adaptive '+vtoTargetName()+' views'}}).catch(()=>{});
        if(number>=8){vtoCapturePaused=true;$('vtoFinish').textContent='8-view limit reached';$('vtoFinish').disabled=true;$('vtoStep').textContent='Eight clear views saved. Live tracking continues; clear views to collect a new set.';}
      }
    }
    await new Promise(resolve=>setTimeout(resolve,33));
  }
}
function retakeVto(){
  if(!vtoLoop||!stream)return;
  clearVtoViews();vtoStable=0;vtoLiveReady=false;vtoCapturePaused=false;$('vtoFinish').textContent='Finish view capture';
  $('vtoStep').textContent='View collection restarted. Keep the '+vtoTargetName()+' in the guide; live tracking continues.';
}
function stopCameraStream(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('camera').srcObject=null;}
function stopVto(){vtoLoop=false;vtoRunId++;vtoOverlayState=null;vtoFrameWaitSince=0;stopCameraStream();clearVtoOcclusion();$('vtoOverlay').style.display='none';$('vtoModel').style.opacity='0';$('vtoModel').style.display='none';$('vtoRetake').classList.add('hidden');$('vtoFinish').classList.add('hidden');$('vtoFinish').disabled=false;$('vtoSwitch').classList.add('hidden');$('vtoStop').classList.add('hidden');$('vtoStart').classList.remove('hidden');$('vtoStart').disabled=false;setVtoGuideValidity(false);}
async function startCamera(){return startVto();}
async function capture(){return startVto();}
