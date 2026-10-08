let vtoTasks=[],vtoIndex=0,vtoStable=0,vtoLoop=false,vtoShots=[],vtoToastTimer=null;
let handLandmarker=null,faceLandmarker=null,vtoVisionPromise=null,vtoLastTimestamp=0,vtoLastDetected='';
const VTO_MODEL_BASE='https://storage.googleapis.com/mediapipe-models/';
const VTO_WASM='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';

function vtoPlan(category){
  if(category==='necklaces')return [
    {target:'neck',label:'Neck — face forward',hint:'Face the camera and relax your shoulders.'},
    {target:'neck',label:'Neck — turn slightly left',hint:'Turn your head a little to your left and hold still.'},
    {target:'neck',label:'Neck — turn slightly right',hint:'Turn your head a little to your right and hold still.'}
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
function resetVto(){stopVto();vtoTasks=[];vtoIndex=0;vtoStable=0;vtoShots=[];vtoLastDetected='';$('vtoShots').innerHTML='';$('vtoStep').textContent='Choose an accessory and start. Camera images stay in this browser session.';}
async function startVto(){
  if(!navigator.mediaDevices?.getUserMedia)return msg('Camera access requires HTTPS and a current mobile browser.');
  try{
    $('vtoStart').disabled=true;$('vtoStep').textContent='Starting camera and loading on-device hand and face models…';
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'user'},width:{ideal:720},height:{ideal:960}},audio:false});
    $('camera').srcObject=stream;await $('camera').play();await loadVtoModels();
    vtoTasks=vtoPlan($('vtoProduct').value);vtoIndex=0;vtoStable=0;vtoShots=[];vtoLastDetected='';$('vtoShots').innerHTML='';
    $('vtoStart').classList.add('hidden');$('vtoStop').classList.remove('hidden');vtoLoop=true;
    $('cameraGuide').className='camera-guide '+(vtoTasks[0].target==='neck'?'':'hand');await vtoScan();
  }catch(e){stopVto();msg('Could not start on-device detection: '+e.message);}
  finally{$('vtoStart').disabled=false;}
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
      else{ready=true;guidance='Neck detected. Hold still.';}
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
async function vtoScan(){
  while(vtoLoop&&vtoIndex<vtoTasks.length){
    const task=vtoTasks[vtoIndex],video=$('camera');
    $('vtoStep').textContent=`Photo ${vtoIndex+1} of ${vtoTasks.length}: ${task.label}. ${task.hint}`;
    if(video.readyState<2||!video.videoWidth){await new Promise(r=>setTimeout(r,150));continue;}
    const timestamp=Math.max(performance.now(),vtoLastTimestamp+1);vtoLastTimestamp=timestamp;
    let status;
    try{status=frameStatus(task,timestamp);}catch(e){stopVto();msg('Camera detection stopped: '+e.message);return;}
    const detectionKey=status.found?task.target:'';
    if(detectionKey&&detectionKey!==vtoLastDetected)vtoToast(task.target==='neck'?'Neck detected':task.target==='finger'?'Finger detected':'Hand detected');
    vtoLastDetected=detectionKey;
    $('vtoStep').textContent=`Photo ${vtoIndex+1} of ${vtoTasks.length}: ${task.label}. ${status.guidance}`;
    vtoStable=status.ready?vtoStable+1:0;
    if(vtoStable>=3){
      const canvas=document.createElement('canvas'),scale=Math.min(1,640/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
      const photo=canvas.toDataURL('image/jpeg',.86);vtoShots.push({photo,label:task.label,target:task.target,landmarks:status.landmarks});
      const card=document.createElement('div');card.className='shot';card.innerHTML=`<img alt="${esc(task.label)}" src="${photo}"><small>${esc(task.label)}</small>`;$('vtoShots').appendChild(card);
      vtoToast(task.target==='neck'?'Neck photo captured':task.target==='finger'?'Finger photo captured':'Hand photo captured');vtoIndex++;vtoStable=0;vtoLastDetected='';
      if(vtoIndex<vtoTasks.length)$('cameraGuide').className='camera-guide '+(vtoTasks[vtoIndex].target==='neck'?'':'hand');
    }
    await new Promise(r=>setTimeout(r,120));
  }
  if(vtoLoop&&vtoIndex>=vtoTasks.length){vtoLoop=false;stopCameraStream();$('vtoStop').classList.add('hidden');$('vtoStart').classList.remove('hidden');$('vtoStep').textContent=`All ${vtoShots.length} guided photos captured. Review them above; retake by starting again.`;vtoToast('Capture complete');}
}
function stopCameraStream(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('camera').srcObject=null;}
function stopVto(){vtoLoop=false;stopCameraStream();$('vtoStop').classList.add('hidden');$('vtoStart').classList.remove('hidden');}
async function startCamera(){return startVto();}
async function capture(){return startVto();}
