let vtoTasks=[],vtoIndex=0,vtoStable=0,vtoLoop=false,vtoShots=[],vtoToastTimer=null;

function vtoPlan(category){
  if(category==='necklaces')return [
    {target:'neck',label:'Neck — face forward',hint:'Face the camera and keep your shoulders relaxed.'},
    {target:'neck',label:'Neck — turn slightly left',hint:'Turn your head a little to your left and hold still.'},
    {target:'neck',label:'Neck — turn slightly right',hint:'Turn your head a little to your right and hold still.'}
  ];
  if(category==='rings')return [
    {target:'hand',label:'Hand — open palm',hint:'Hold one hand forward with fingers comfortably spread.'},
    {target:'finger',label:'Finger — ring finger',hint:'Bring your hand a little closer; keep your ring finger visible.'}
  ];
  const item=category==='watches'?'Watch':'Bracelet';
  return [
    {target:'wrist',label:`Wrist — ${item.toLowerCase()} side`,hint:'Extend your arm with your palm facing down.'},
    {target:'wrist',label:'Wrist — inner side',hint:'Turn your palm toward the camera and keep your wrist centered.'}
  ];
}
function vtoToast(text){
  const el=$('vtoToast'); el.textContent=text; el.classList.remove('hidden');
  clearTimeout(vtoToastTimer); vtoToastTimer=setTimeout(()=>el.classList.add('hidden'),2400);
}
function resetVto(){
  stopVto(); vtoTasks=[];vtoIndex=0;vtoStable=0;vtoShots=[];$('vtoShots').innerHTML='';
  $('vtoStep').textContent='Choose an accessory and start. Camera images stay in this browser session.';
}
async function startVto(){
  if(!tok)return msg('Sign in before starting a try-on capture.');
  if(!navigator.mediaDevices?.getUserMedia)return msg('This browser does not provide camera access. Open the site over HTTPS on your phone.');
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'user'},width:{ideal:720},height:{ideal:960}},audio:false});
    $('camera').srcObject=stream; await $('camera').play();
    vtoTasks=vtoPlan($('vtoProduct').value);vtoIndex=0;vtoStable=0;vtoShots=[];$('vtoShots').innerHTML='';
    $('vtoStart').classList.add('hidden');$('vtoStop').classList.remove('hidden');vtoLoop=true;
    $('cameraGuide').className='camera-guide '+(vtoTasks[0].target==='neck'?'':'hand');
    await vtoScan();
  }catch(e){stopVto();msg('Camera could not start: '+e.message);}
}
async function vtoScan(){
  while(vtoLoop&&vtoIndex<vtoTasks.length){
    const task=vtoTasks[vtoIndex];
    $('vtoStep').textContent=`Photo ${vtoIndex+1} of ${vtoTasks.length}: ${task.label}. ${task.hint}`;
    const video=$('camera');
    if(video.readyState<2||!video.videoWidth){await new Promise(r=>setTimeout(r,350));continue;}
    const canvas=document.createElement('canvas'); const scale=Math.min(1,640/video.videoWidth); canvas.width=Math.round(video.videoWidth*scale); canvas.height=Math.round(video.videoHeight*scale);
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.78));
    if(!blob){await new Promise(r=>setTimeout(r,450));continue;}
    const form=new FormData();form.append('file',blob,'vto-frame.jpg');
    try{
      const status=await api('/vto/landmarks?target='+task.target,{method:'POST',body:form});
      if(status.detected&&vtoStable===0){vtoToast(task.target==='neck'?'Neck detected':task.target==='finger'?'Finger detected':'Hand detected');}
      $('vtoStep').textContent=`Photo ${vtoIndex+1} of ${vtoTasks.length}: ${task.label}. ${status.guidance}`;
      if(status.ready)vtoStable++;else vtoStable=0;
      if(vtoStable>=3){
        const photo=canvas.toDataURL('image/jpeg',.86);vtoShots.push({photo,label:task.label,landmarks:status});
        const card=document.createElement('div');card.className='shot';card.innerHTML=`<img alt="${esc(task.label)}" src="${photo}"><small>${esc(task.label)}</small>`;$('vtoShots').appendChild(card);
        vtoToast(task.target==='neck'?'Neck photo captured':task.target==='finger'?'Finger photo captured':'Hand photo captured');
        vtoIndex++;vtoStable=0;
      }
    }catch(e){$('vtoStep').textContent='Capture check paused: '+e.message;await new Promise(r=>setTimeout(r,1200));}
    await new Promise(r=>setTimeout(r,350));
  }
  if(vtoLoop&&vtoIndex>=vtoTasks.length){
    vtoLoop=false;stopCameraStream();$('vtoStop').classList.add('hidden');$('vtoStart').classList.remove('hidden');$('vtoStep').textContent=`All ${vtoShots.length} guided photos captured. Review them above; retake by starting again.`;vtoToast('Capture complete');
  }
}
function stopCameraStream(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('camera').srcObject=null;}
function stopVto(){vtoLoop=false;stopCameraStream();$('vtoStop').classList.add('hidden');$('vtoStart').classList.remove('hidden');}
async function startCamera(){return startVto();}
async function capture(){return startVto();}
