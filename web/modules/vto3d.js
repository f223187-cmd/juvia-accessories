// Juvia AR renderer: draws the product GLB in true 3D over the camera feed.
// Watches and bracelets follow the wrist, rings the ring finger, necklaces the neck (poses from wristpose.js).
// Realism: lighting and colour are estimated from the live frame, the room is used as the reflection
// environment, the accessory casts a soft shadow and contact shading onto the skin, and invisible body
// "occluders" hide the parts that are behind the arm, finger or neck.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {solveWristPose,solveFingerPose,solveNeckPose,chiralityEvidence,detectForearm,OneEuro,SIZE_CHART,bangleAxes} from './wristpose.js?v=8';

const smooth=t=>t<=0?0:t>=1?1:t*t*(3-2*t);
const ramp=(v,a,b)=>smooth((v-a)/(b-a));
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const toThree=v=>new THREE.Vector3(v.x,-v.y,-v.z);
const frameSize=src=>[src?.videoWidth||src?.width||0,src?.videoHeight||src?.height||0];
const KIND_OF={watches:'watch',bracelets:'bracelet',rings:'ring',necklaces:'necklace'};
export const kindFor=category=>KIND_OF[category]||'watch';

// Alpha ramp for contact shading: dark under the band, fading to nothing a few millimetres out.
function contactTexture(){
  const c=document.createElement('canvas');c.width=4;c.height=128;const g=c.getContext('2d'),grad=g.createLinearGradient(0,0,0,128);
  grad.addColorStop(0,'#000');grad.addColorStop(.22,'#555');grad.addColorStop(.36,'#fff');grad.addColorStop(.64,'#fff');grad.addColorStop(.78,'#555');grad.addColorStop(1,'#000');
  g.fillStyle=grad;g.fillRect(0,0,4,128);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.NoColorSpace;return t;
}
function radialTexture(){
  const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),grad=g.createRadialGradient(32,32,0,32,32,32);
  grad.addColorStop(0,'#fff');grad.addColorStop(.5,'#888');grad.addColorStop(1,'#000');g.fillStyle=grad;g.fillRect(0,0,64,64);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.NoColorSpace;return t;
}

// Shadow receiver whose opacity falls off toward grazing angles (the body's silhouette).
function facingShadowMaterial(opacity){
  const m=new THREE.ShadowMaterial({opacity,depthWrite:false});
  m.onBeforeCompile=shader=>{
    shader.vertexShader='varying float vFacing;\n'+shader.vertexShader.replace('#include <defaultnormal_vertex>','#include <defaultnormal_vertex>\n\tvFacing=normalize(transformedNormal).z;');
    shader.fragmentShader='varying float vFacing;\n'+shader.fragmentShader.replace('opacity * ( 1.0 - getShadowMask() )','opacity * ( 1.0 - getShadowMask() ) * smoothstep( 0.12, 0.55, vFacing )');
  };
  return m;
}
// Contact shading (ambient occlusion where the band meets the skin), also fading at the silhouette.
function contactMaterial(map,opacity){
  return new THREE.ShaderMaterial({transparent:true,depthWrite:false,
    uniforms:{map:{value:map},opacity:{value:opacity},color:{value:new THREE.Color(0x140c08)}},
    vertexShader:'varying vec2 vUv;varying float vFacing;void main(){vUv=uv;vFacing=normalize(normalMatrix*normal).z;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'uniform sampler2D map;uniform float opacity;uniform vec3 color;varying vec2 vUv;varying float vFacing;void main(){gl_FragColor=vec4(color,texture2D(map,vUv).g*opacity*smoothstep(0.1,0.6,vFacing));}'});
}

export class AccessoryAR{
  constructor(canvas){
    this.canvas=canvas;
    this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:false});
    this.renderer.setClearColor(0x000000,0);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.scene=new THREE.Scene();
    this.pmrem=new THREE.PMREMGenerator(this.renderer);
    this.roomEnv=this.pmrem.fromScene(new RoomEnvironment(),.04).texture;this.scene.environment=this.roomEnv;this.cameraEnv=null;
    this.hemi=new THREE.HemisphereLight(0xffffff,0x3a3330,.55);this.scene.add(this.hemi);
    this.key=new THREE.DirectionalLight(0xffffff,1.5);this.key.castShadow=true;
    this.key.shadow.mapSize.set(1024,1024);this.key.shadow.radius=6;this.key.shadow.bias=-.0004;
    this.scene.add(this.key,this.key.target);
    this.camera=new THREE.OrthographicCamera(0,1,0,-1,1,100000);this.camera.position.set(0,0,50000);
    this.anchor=new THREE.Group();this.anchor.visible=false;this.scene.add(this.anchor);
    this.contactMap=contactTexture();this.blobMap=radialTexture();
    this.kind='watch';this.variant=null;this.neck=null;this.hang=null;this.content=null;this.model=null;this.strap=null;this.loop=null;this.fitKey='';this.body=null;this.extraOccluders=[];
    this.state='empty';this.error='';this.url='';
    this.fx=new OneEuro(1.6,.012);this.fy=new OneEuro(1.6,.012);this.fs=new OneEuro(1,.6);
    this.q=new THREE.Quaternion();this.hasPose=false;this.lastSeen=0;this.videoW=1;this.videoH=1;this.lastPose=null;
    // Back-of-hand side, accumulated over frames so one ambiguous (flat-hand) frame cannot flip the accessory.
    this.chirality=0;
    // Small copy of the frame: forearm detection, light estimation and the reflection environment.
    this.sample=document.createElement('canvas');this.sampleCtx=null;this.frameNo=0;this.sampleAt=0;
    this.forearm=null;this.forearmSeen=0;this.fa=new OneEuro(1.2,.02);this.fcx=new OneEuro(1.4,.01);this.fcy=new OneEuro(1.4,.01);this.fw=new OneEuro(.6,.002);
    this.light={k:1,r:1,g:1,b:1};this.envAt=0;this.envCanvas=document.createElement('canvas');this.envCanvas.width=128;this.envCanvas.height=64;
  }
  get ready(){return this.state==='ready';}
  async load(url,kind='watch'){
    if(this.url===url&&this.kind===kind&&(this.state==='ready'||this.state==='loading'))return this.loading;
    this.url=url;this.kind=kind;this.state='loading';this.error='';this.clearModel();
    const token=Symbol();this.token=token;
    this.loading=new GLTFLoader().loadAsync(url).then(gltf=>{
      if(this.token!==token)return;
      this.prepare(gltf.scene);this.state='ready';
    }).catch(e=>{if(this.token===token){this.state='error';this.error=e?.message||'GLB load failed';}throw e;});
    return this.loading;
  }
  clearModel(){
    if(this.content){this.anchor.remove(this.content);this.content.traverse(o=>{o.geometry?.dispose();});}
    this.content=null;this.model=null;this.strap=null;this.loop=null;this.fitKey='';this.body=null;this.neck=null;this.hang=null;this.extraOccluders=[];this.anchor.visible=false;
  }
  // Bake every node transform into its geometry so the whole model lives in one metric space.
  bake(root){
    root.updateMatrixWorld(true);
    const meshes=[];root.traverse(o=>{if(o.isMesh)meshes.push(o);});
    const model=new THREE.Group();
    let unit=1;const size=new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()),maxDim=Math.max(size.x,size.y,size.z);
    const expected={watch:.08,bracelet:.08,ring:.025,necklace:.16}[this.kind];
    if(maxDim>1)unit=expected/maxDim; // authored in cm/mm: normalise to a plausible real size
    for(const m of meshes){
      const g=m.geometry.clone();g.applyMatrix4(m.matrixWorld);if(unit!==1)g.scale(unit,unit,unit);
      const mesh=new THREE.Mesh(g,m.material);mesh.name=m.name||m.parent?.name||'';
      for(const mat of [].concat(m.material)){if(mat){mat.envMapIntensity=1;if(mat.transparent)mat.depthWrite=false;}}
      mesh.renderOrder=1;mesh.castShadow=true;model.add(mesh);
    }
    return model;
  }
  // Loop accessories (bracelets, rings) from other sources: put the band axis on X and the stone (heaviest side) on +Z.
  orientLoop(model,stoneSide){
    const box=new THREE.Box3().setFromObject(model),s=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3());
    model.children.forEach(m=>m.geometry.translate(-c.x,-c.y,-c.z));
    const axis=s.x<=s.y&&s.x<=s.z?'x':s.y<=s.z?'y':'z';
    const rot=new THREE.Matrix4();
    if(axis==='y')rot.makeRotationZ(Math.PI/2);else if(axis==='z')rot.makeRotationY(Math.PI/2);
    if(axis!=='x')model.children.forEach(m=>m.geometry.applyMatrix4(rot));
    if(stoneSide){
      let y=0,z=0,n=0;
      model.children.forEach(m=>{const p=m.geometry.attributes.position;for(let i=0;i<p.count;i+=3){y+=p.getY(i);z+=p.getZ(i);n++;}});
      if(Math.hypot(y,z)/n>1e-4){const angle=Math.atan2(y/n,z/n);model.children.forEach(m=>m.geometry.rotateX(angle));}
      // Centre on the finger hole, not the bounding box (the stone shifts the box toward +Z).
      const b=new THREE.Box3().setFromObject(model),outer=(b.max.y-b.min.y)/2;
      model.children.forEach(m=>m.geometry.translate(0,0,-(b.min.z+outer)));
    }
  }
  innerRadius(model){
    let r=Infinity;
    model.children.forEach(m=>{const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i))<.004)r=Math.min(r,Math.hypot(p.getY(i),p.getZ(i)));});
    return Number.isFinite(r)&&r>.003?r:.0085;
  }
  shadowCatcher(material){const m=new THREE.Mesh(new THREE.CylinderGeometry(1,1,1,64,1,true),material);m.geometry.rotateZ(Math.PI/2);return m;}
  prepare(root){
    const model=this.bake(root),content=new THREE.Group();content.add(model);
    this.model=model;this.content=content;
    // Invisible body stand-in (depth only) + soft shadow receiver + contact shading band.
    const occMat=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:true});
    const body=new THREE.Mesh(new THREE.CylinderGeometry(1,1,1,64,1,false),occMat);body.geometry.rotateZ(Math.PI/2);body.renderOrder=-1;
    const shadow=this.shadowCatcher(facingShadowMaterial(.34));shadow.receiveShadow=true;shadow.renderOrder=2;
    const contact=this.shadowCatcher(contactMaterial(this.contactMap,.4));contact.renderOrder=2;
    this.body={occluder:body,shadow,contact};
    if(this.kind==='necklace'){
      // Neck column (vertical) hides the back of the chain; a soft blob under the pendant grounds it on the chest.
      body.geometry.rotateZ(-Math.PI/2);shadow.visible=false;contact.visible=false;
      const low=new THREE.Box3().setFromObject(model),pend=new THREE.Vector3((low.min.x+low.max.x)/2,low.min.y+.012,low.max.z-.012);
      const blob=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:0x140c08,transparent:true,opacity:.28,alphaMap:this.blobMap,depthWrite:false}));
      blob.scale.set(.03,.036,1);blob.position.set(pend.x,pend.y-.002,pend.z-.006);blob.renderOrder=2;content.add(blob);
      const pendant=model.children.find(c=>/pendant|stone|gem/i.test(c.name))||null,pb=pendant&&new THREE.Box3().setFromObject(pendant);
      this.neck={meshes:model.children.map(mesh=>({mesh,base:Float32Array.from(mesh.geometry.attributes.position.array)})),pendant,
        pendantTop:pb?pb.max.y+.004:low.min.y+.02,depth:Math.max(.05,pb?-(pb.max.y+.004):-low.min.y),blob,blobY:blob.position.y};
      body.scale.set(.058,.16,.052);body.position.set(0,.055,0);
    }else if(this.kind==='ring'||this.kind==='bracelet'){
      if(!/juvia-(ring|bracelet)\.glb/i.test(this.url))this.orientLoop(model,this.kind==='ring');
      this.loop={inner:this.innerRadius(model),box:new THREE.Box3().setFromObject(model)};
    }else this.prepareWatch(model);
    content.add(body,shadow,contact);
    for(let i=0;i<3;i++){const o=new THREE.Mesh(new THREE.CylinderGeometry(1,1,1,24,1,false),occMat);o.renderOrder=-1;o.visible=false;content.add(o);this.extraOccluders.push(o);}
    this.anchor.add(content);
  }
  prepareWatch(model){
    const strapMesh=model.children.find(c=>/strap|band|bracelet|belt/i.test(c.name));
    const caseMeshes=model.children.filter(c=>c!==strapMesh);
    let loop;
    if(strapMesh){
      const p=strapMesh.geometry.attributes.position,sb=new THREE.Box3().setFromBufferAttribute(p);
      const cy=(sb.min.y+sb.max.y)/2;let top=0;
      if(caseMeshes.length){const cb=new THREE.Box3();caseMeshes.forEach(c=>cb.union(new THREE.Box3().setFromObject(c)));top=cb.min.z;}
      let innerLeft=sb.min.y,innerRight=sb.max.y,innerBottom=sb.min.z;const zMid=(top+sb.min.z)/2;
      for(let i=0;i<p.count;i++){
        const y=p.getY(i),z=p.getZ(i),x=p.getX(i);if(Math.abs(x)>.006)continue;
        if(Math.abs(z-zMid)<.006){if(y<cy)innerLeft=Math.max(innerLeft,y);else innerRight=Math.min(innerRight,y);}
        if(Math.abs(y-cy)<.006&&z<zMid)innerBottom=Math.max(innerBottom,z);
      }
      loop={cy,top,A:Math.max(.015,(innerRight-innerLeft)/2),B:Math.max(.012,(top-innerBottom)/2),bandWidth:sb.max.x-sb.min.x};
      this.strap={mesh:strapMesh,base:Float32Array.from(p.array)};
    }else{
      const all=new THREE.Box3().setFromObject(model),s=all.getSize(new THREE.Vector3());
      loop={cy:(all.min.y+all.max.y)/2,top:all.max.z-s.z*.15,A:s.y/2*.9,B:s.z/2*.85,bandWidth:Math.min(.024,s.x*.6)};
    }
    this.loop=loop;
  }
  // Re-shape the accessory for this body part (only when the size changes noticeably).
  // Chosen product size (S/M/L). Re-fits on the next frame.
  setSize(category,size){this.variant=SIZE_CHART[category]?.sizes[size]?{category,size,value:SIZE_CHART[category].sizes[size]}:null;this.fitKey='';}
  // Shape the accessory for this body part and the chosen size (only when either changes noticeably).
  fit(size){
    if(!this.loop&&this.kind!=='necklace')return;
    const v=this.variant?.value;
    const key=JSON.stringify([...Object.values(size).map(n=>Math.round(n*2000)),v]);if(key===this.fitKey)return;this.fitKey=key;
    const {occluder,shadow,contact}=this.body;
    if(this.kind==='necklace'){this.fitNecklace(v?(v-SIZE_CHART.necklaces.base)/2:0);return;}
    if(this.kind==='ring'){
      // The ring's inner diameter is the chosen size; the finger keeps its own size. A larger ring rests on the
      // back of the finger (gravity on a raised hand), so the gap shows on the palm side and at the edges.
      const r=size.diameter/2,ri=Math.max(v?v/2:r+.0002,r+.0001),k=ri/this.loop.inner;
      this.model.scale.setScalar(clamp(k,.6,1.6));this.model.position.set(0,0,0);this.content.position.set(0,0,0);
      this.hang={a:ri,b:ri,w:r,t:r*.92};
      occluder.scale.set(.05,r,r*.92);occluder.position.set(0,0,0);
      const band=(this.loop.box.max.x-this.loop.box.min.x)*this.model.scale.x,tight=ri-r<.0006;
      shadow.scale.set(.03,r+.00025,r*.92+.00025);contact.scale.set(band+.004,r+.0003,r*.92+.0003);contact.visible=tight;
      return;
    }
    if(this.kind==='bracelet'){
      const W=size.width/2,T=size.thickness/2,b=this.loop.box,ay=(b.max.y-b.min.y)/2,az=(b.max.z-b.min.z)/2,tube=b.max.x-b.min.x;
      // Inner oval from the chosen inner circumference (never smaller than the wrist itself). A loose bangle
      // rests on the back of the wrist, so the extra room hangs toward the palm side.
      let {a,b:bb}=v?bangleAxes(v):{a:W+.003,b:T+.003};a=Math.max(a,W+.0008);bb=Math.max(bb,T+.0008);
      this.model.scale.set(1,clamp((a+tube)/ay,.6,1.8),clamp((bb+tube)/az,.6,1.8));this.model.position.set(0,0,0);this.content.position.set(0,0,0);
      this.hang={a,b:bb,w:W+.0008,t:T+.0008};
      occluder.scale.set(.12,W,T);occluder.position.set(0,0,0);
      const touching=bb-T<.004;
      shadow.scale.set(.06,W+.0003,T+.0003);contact.scale.set(tube+.008,W+.00035,T+.00035);contact.material.uniforms.opacity.value=touching?.3:.12;
      return;
    }
    this.hang=null;
    // Watch: the case grows or shrinks with the chosen size; the strap is always re-shaped to hug this wrist.
    const k=v?v/SIZE_CHART.watches.base:1;
    const {cy,top,A,B,bandWidth}=this.loop,gap=.0008,A2=(size.width/2+gap)/k,B2=(size.thickness/2+gap)/k;
    const sy=clamp(A2/A,.5,1.6),sz=clamp(B2/B,.5,1.6);
    if(this.strap){
      const pos=this.strap.mesh.geometry.attributes.position,base=this.strap.base;
      for(let i=0;i<pos.count;i++){
        const x=base[i*3],y=base[i*3+1],z=base[i*3+2],dy=Math.abs(y-cy);
        const w=Math.max(ramp(top-z,.003,.015),ramp(dy,A*.62,A*.9));
        pos.setXYZ(i,x,cy+(y-cy)*(1+(sy-1)*w),top+(z-top)*(1+(sz-1)*w));
      }
      pos.needsUpdate=true;this.strap.mesh.geometry.computeBoundingSphere();this.strap.mesh.geometry.computeVertexNormals();
    }
    const fittedB=this.strap?B*sz:B;
    // Wrist centre → group origin (model scaled by the case size).
    this.model.scale.setScalar(k);this.model.position.set(0,-cy*k,-(top-fittedB)*k);
    const W=size.width/2,T=size.thickness/2;
    // Forearm stand-in, centred on the watch: the crown may face either the hand or the elbow.
    occluder.scale.set(.12,W,T);occluder.position.set(0,0,0);
    shadow.scale.set(.09,W+.0004,T+.0004);contact.scale.set(bandWidth*k+.008,W+.00045,T+.00045);
  }
  // Chain length: the extra (or missing) length lowers (or raises) the front drop; the pendant moves rigidly.
  fitNecklace(drop){
    const n=this.neck;if(!n)return;
    for(const {mesh,base} of n.meshes){
      const pos=mesh.geometry.attributes.position;
      for(let i=0;i<pos.count;i++){
        const y=base[i*3+1],t=smooth((n.pendantTop-y)/.012),scaled=y<0?y*(1+drop/n.depth):y;
        pos.setY(i,mesh===n.pendant?y-drop:scaled*(1-t)+(y-drop)*t);
      }
      pos.needsUpdate=true;mesh.geometry.computeBoundingSphere();
    }
    n.blob.position.y=n.blobY-drop;
  }
  resize(displayW,displayH,videoW,videoH){
    const dpr=Math.min(2,window.devicePixelRatio||1),w=Math.max(1,Math.round(displayW*dpr)),h=Math.max(1,Math.round(displayH*dpr));
    if(this.canvas.width!==w||this.canvas.height!==h)this.renderer.setSize(w,h,false);
    if(this.videoW!==videoW||this.videoH!==videoH){
      this.videoW=videoW;this.videoH=videoH;
      Object.assign(this.camera,{left:0,right:videoW,top:0,bottom:-videoH});this.camera.updateProjectionMatrix();
    }
  }
  // One small frame grab per two frames feeds forearm detection, light estimation and reflections.
  // src: the camera frame (a video element, or the canvas the frame was copied to for display).
  grab(src,now){
    const [vw,vh]=frameSize(src);if(!vw||!vh)return null;
    if(this.sampleAt&&now-this.sampleAt<45)return this.sampleData;
    const w=160,h=Math.max(16,Math.round(w*vh/vw));
    if(this.sample.width!==w||this.sample.height!==h){this.sample.width=w;this.sample.height=h;this.sampleCtx=null;}
    this.sampleCtx??=this.sample.getContext('2d',{willReadFrequently:true});
    try{this.sampleCtx.drawImage(src,0,0,w,h);this.sampleData={pix:this.sampleCtx.getImageData(0,0,w,h).data,w,h};this.sampleAt=now;}
    catch{this.sampleData=null;}
    return this.sampleData;
  }
  // Ambient light level and colour near the accessory, smoothed; drives exposure, lights and reflections.
  estimateLight(frame,cx,cy,now){
    if(!frame)return;
    const {pix,w,h}=frame,x0=Math.round(cx*w),y0=Math.round(cy*h),R=Math.round(w*.18);
    let lr=0,lg=0,lb=0,n=0,gl=0,gn=0;
    for(let y=0;y<h;y+=3)for(let x=0;x<w;x+=3){
      const i=(y*w+x)*4,l=.2126*pix[i]+.7152*pix[i+1]+.0722*pix[i+2];gl+=l;gn++;
      if(Math.abs(x-x0)<R&&Math.abs(y-y0)<R){lr+=pix[i];lg+=pix[i+1];lb+=pix[i+2];n++;}
    }
    if(!n)return;
    const local=(.2126*lr+.7152*lg+.0722*lb)/n,global=gl/gn,m=Math.max(lr,lg,lb)/n||1;
    // Metal stays recognisably metal in dim rooms: darkening is capped and the room colour only lightly tints it.
    const k=clamp(Math.pow((.65*local+.35*global)/135,.8),.45,1.4),a=.12;
    const L=this.light;L.k+=(k-L.k)*a;L.r+=(clamp(lr/n/m,.55,1)-L.r)*a;L.g+=(clamp(lg/n/m,.55,1)-L.g)*a;L.b+=(clamp(lb/n/m,.55,1)-L.b)*a;
    const tint=new THREE.Color(.85+.15*L.r,.85+.15*L.g,.85+.15*L.b);
    this.hemi.color.copy(tint);this.hemi.intensity=.5*L.k;
    this.key.color.copy(tint);this.key.intensity=1.55*L.k;
    this.scene.environmentIntensity=.35+.75*L.k;
    this.renderer.toneMappingExposure=.82+.25*L.k;
    if(now-this.envAt>1400)this.updateEnvironment(now);
  }
  // The room itself (blurred) becomes the reflection map, so metal and glass pick up real colours.
  updateEnvironment(now){
    this.envAt=now;
    try{
      const g=this.envCanvas.getContext('2d');g.filter='blur(3px) saturate(.45)';g.drawImage(this.sample,0,0,128,64);g.filter='none';
      const tex=new THREE.CanvasTexture(this.envCanvas);tex.mapping=THREE.EquirectangularReflectionMapping;tex.colorSpace=THREE.SRGBColorSpace;
      const env=this.pmrem.fromEquirectangular(tex).texture;tex.dispose();
      this.cameraEnv?.dispose();this.cameraEnv=env;this.scene.environment=env;
    }catch{}
  }
  // The forearm direction is kept relative to the hand axis: if a frame's skin scan misses, the last
  // relative angle still holds (wrist bend changes slowly), so the watch never snaps to the hand's angle.
  readForearm(frame,image,now){
    const W={x:image[0].x*this.videoW,y:image[0].y*this.videoH};
    const K={x:(image[5].x+image[9].x+image[13].x+image[17].x)/4*this.videoW,y:(image[5].y+image[9].y+image[13].y+image[17].y)/4*this.videoH};
    const hand=Math.atan2(K.y-W.y,K.x-W.x),wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
    if(frame&&this.frameNo++%2===0){
      let found=detectForearm(frame.pix,frame.w,frame.h,image);
      // Temporal gate: a forearm angle is used only if it agrees with the current estimate (within 15°) or a
      // second detection confirms it within 0.7 s, so a one-frame outlier can never tilt the watch.
      let rel=found&&wrap(Math.atan2(found.dir.y,found.dir.x)-hand);
      if(found){
        const agrees=(a,b)=>Math.abs(wrap(a-b))<.26,current=this.forearm&&now-this.forearmSeen<2000?this.forearm.rel:null;
        if(current==null||!agrees(rel,current)){
          const pending=this.forearmPending;this.forearmPending={rel,at:now};
          if(!(pending&&now-pending.at<700&&agrees(rel,pending.rel)))found=null;
        }
      }
      if(found){
        this.forearmPending=null;
        if(now-this.forearmSeen>2000){this.forearm=null;this.fa.reset();this.fcx.reset();this.fcy.reset();this.fw.reset();}
        if(this.forearm)rel=this.forearm.rel+wrap(rel-this.forearm.rel);
        const next={...(this.forearm||{}),rel:this.fa.filter(rel,now)};
        if(found.centre){
          // Centre tracked relative to the wrist landmark so it moves with the hand between detections.
          next.dx=this.fcx.filter(found.centre.x*this.videoW-W.x,now);next.dy=this.fcy.filter(found.centre.y*this.videoH-W.y,now);
          next.widthPx=this.fw.filter(found.widthPx*this.videoW/found.frameW,now);next.centreSeen=now;
        }
        this.forearm=next;this.forearmSeen=now;
      }
    }
    if(!this.forearm||now-this.forearmSeen>2000){this.forearm=null;return null;}
    const f=this.forearm,angle=hand+f.rel,out={dir:{x:Math.cos(angle),y:Math.sin(angle)}};
    if(f.widthPx&&now-f.centreSeen<1200){out.centre={x:(W.x+f.dx)/this.videoW,y:(W.y+f.dy)/this.videoH};out.widthPx=f.widthPx;out.frameW=this.videoW;}
    return out;
  }
  // input: {video,width,height, image,world,handedness (hands) | shoulders,shouldersWorld,chin (neck), tapeInches}
  update(input,now=performance.now()){
    if(!this.ready||!this.content)return null;
    const frame=this.grab(input.video,now);
    let pose=null;
    if(this.kind==='necklace')pose=solveNeckPose(input);
    else{
      if(input.world?.length!==21){this.miss(now);return null;}
      if(now-this.lastSeen>1500)this.chirality=0;
      this.chirality=clamp(this.chirality*.9+chiralityEvidence(input.world,input.handedness),-12,12);
      const right=this.chirality>=0;
      if(this.kind==='ring')pose=solveFingerPose({...input,right});
      else{
        const forearm=this.readForearm(frame,input.image,now);
        pose=solveWristPose({...input,right,forearm,offset:this.kind==='bracelet'?.012:.022});
      }
    }
    if(!pose){this.miss(now);return null;}
    this.fit(pose.size);
    const {X,Y,Z}=pose.axes;
    const target=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(toThree(X),toThree(Y),toThree(Z)));
    if(!this.hasPose||now-this.lastSeen>400){this.fx.reset();this.fy.reset();this.fs.reset();this.q.copy(target);}
    else{const angle=this.q.angleTo(target);this.q.slerp(target,Math.min(.92,.3+angle*1.6));}
    const x=this.fx.filter(pose.x,now),y=this.fy.filter(pose.y,now),s=Math.exp(this.fs.filter(Math.log(pose.scale),now));
    this.anchor.position.set(x,-y,0);this.anchor.quaternion.copy(this.q);this.anchor.scale.setScalar(s);
    this.placeOccluders(pose.occluders);
    this.applyHang();
    this.placeLight(s);
    this.estimateLight(frame,x/this.videoW,y/this.videoH,now);
    this.anchor.visible=true;this.hasPose=true;this.lastSeen=now;this.lastPose={...pose,x,y,scale:s};
    this.render();return this.lastPose;
  }
  // A bangle or ring larger than the body part hangs under gravity: its inner surface rests on the upper side
  // of the wrist/finger and the spare room shows below. With the phone upright, gravity is "down" in the image.
  applyHang(){
    const h=this.hang;if(!h||!this.model)return;
    const g=new THREE.Vector3(0,-1,0).applyQuaternion(this.q.clone().invert()),m=Math.hypot(g.y,g.z);
    const uy=m>.25?g.y/m:0,uz=m>.25?g.z/m:-1;
    // Ellipse support functions: shift so the inner oval touches the body on the side opposite gravity.
    const d=Math.hypot(h.a*uy,h.b*uz)-Math.hypot(h.w*uy,h.t*uz),ty=uy*Math.max(0,d),tz=uz*Math.max(0,d);
    const p=this.model.position;p.y+=(ty-p.y)*.35;p.z+=(tz-p.z)*.35;
  }
  // Extra depth-only cylinders (e.g. neighbouring fingers) given in camera-aligned metres around the anchor.
  placeOccluders(list=[]){
    const inv=this.q.clone().invert(),up=new THREE.Vector3(0,1,0);
    this.extraOccluders.forEach((o,i)=>{
      const c=list[i];if(!c){o.visible=false;return;}
      const a=toThree(c.a).applyQuaternion(inv),b=toThree(c.b).applyQuaternion(inv),d=b.clone().sub(a),l=d.length();
      if(l<1e-4){o.visible=false;return;}
      o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(up,d.normalize());o.scale.set(c.r,l,c.r);o.visible=true;
    });
  }
  // Key light from above and slightly toward the camera, so shadows fall onto the skin below the accessory.
  placeLight(s){
    const p=this.anchor.position,size=.11*s;
    this.key.target.position.copy(p);this.key.position.set(p.x+.22*s,p.y+.9*s,p.z+.75*s);
    const cam=this.key.shadow.camera;Object.assign(cam,{left:-size,right:size,top:size,bottom:-size,near:.05*s,far:2.5*s});cam.updateProjectionMatrix();
    this.key.shadow.normalBias=.0004*s;
  }
  miss(now=performance.now()){if(this.anchor.visible&&now-this.lastSeen>320){this.anchor.visible=false;this.render();}}
  hide(){this.anchor.visible=false;this.hasPose=false;this.render();}
  render(){this.renderer.render(this.scene,this.camera);}
  // Composite of the camera frame and the rendered accessory at video resolution (for captures).
  composite(src,mirror,crop){
    const [vw,vh]=frameSize(src);if(!vw||!vh)return null;
    const [sx,sy,sw,sh]=crop||[0,0,vw,vh],scale=Math.min(1,1280/Math.max(sw,sh));
    const out=document.createElement('canvas');out.width=Math.round(sw*scale);out.height=Math.round(sh*scale);
    const g=out.getContext('2d');
    if(mirror){g.translate(out.width,0);g.scale(-1,1);}
    g.drawImage(src,sx,sy,sw,sh,0,0,out.width,out.height);
    if(this.anchor.visible){
      this.render();const k=this.canvas.width/vw;
      g.drawImage(this.canvas,sx*k,sy*k,sw*k,sh*k,0,0,out.width,out.height);
    }
    return out;
  }
}
// Back-compat name used by earlier builds.
export {AccessoryAR as WristAR};
