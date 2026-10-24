// Juvia wrist AR renderer: draws the product GLB in true 3D over the camera feed.
// The watch is posed from MediaPipe hand landmarks (see wristpose.js), its strap is fitted
// around an elliptical wrist, and an invisible wrist "occluder" hides the parts of the
// strap and case that are behind the arm, exactly like a real watch.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {solveWristPose,chiralityEvidence,detectForearm,OneEuro} from './wristpose.js?v=3';

const smooth=t=>t<=0?0:t>=1?1:t*t*(3-2*t);
const ramp=(v,a,b)=>smooth((v-a)/(b-a));

export class WristAR{
  constructor(canvas){
    this.canvas=canvas;
    this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:false});
    this.renderer.setClearColor(0x000000,0);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
    this.scene=new THREE.Scene();
    const pmrem=new THREE.PMREMGenerator(this.renderer);
    this.scene.environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x444444,.6));
    const key=new THREE.DirectionalLight(0xffffff,1.4);key.position.set(.3,1,1.2);this.scene.add(key);
    this.camera=new THREE.OrthographicCamera(0,1,0,-1,1,100000);this.camera.position.set(0,0,50000);
    this.anchor=new THREE.Group();this.anchor.visible=false;this.scene.add(this.anchor);
    this.content=null;this.strap=null;this.occluder=null;this.loop=null;this.fitKey='';
    this.state='empty';this.error='';this.url='';
    this.fx=new OneEuro(1.6,.012);this.fy=new OneEuro(1.6,.012);this.fs=new OneEuro(1,.6);
    this.q=new THREE.Quaternion();this.hasPose=false;this.lastSeen=0;this.videoW=1;this.videoH=1;
    this.lastPose=null;
    // Back-of-hand side, accumulated over frames so one ambiguous (flat-hand) frame cannot flip the watch.
    this.chirality=0;
    // Forearm found from skin colour in a small copy of the frame.
    this.sample=document.createElement('canvas');this.sampleCtx=null;this.frameNo=0;
    this.forearm=null;this.forearmSeen=0;this.fa=new OneEuro(1.2,.02);this.fcx=new OneEuro(1.4,.01);this.fcy=new OneEuro(1.4,.01);this.fw=new OneEuro(.6,.002);
  }
  get ready(){return this.state==='ready';}
  async load(url){
    if(this.url===url&&(this.state==='ready'||this.state==='loading'))return this.loading;
    this.url=url;this.state='loading';this.error='';this.clearModel();
    const token=Symbol();this.token=token;
    this.loading=new GLTFLoader().loadAsync(url).then(gltf=>{
      if(this.token!==token)return;
      this.prepare(gltf.scene);this.state='ready';
    }).catch(e=>{if(this.token===token){this.state='error';this.error=e?.message||'GLB load failed';}throw e;});
    return this.loading;
  }
  clearModel(){
    if(this.content){this.anchor.remove(this.content);this.content.traverse(o=>{o.geometry?.dispose();});}
    this.content=null;this.strap=null;this.occluder=null;this.loop=null;this.fitKey='';this.anchor.visible=false;
  }
  // Bake every node transform into its geometry so the whole model lives in one metric space.
  prepare(root){
    root.updateMatrixWorld(true);
    const meshes=[];root.traverse(o=>{if(o.isMesh)meshes.push(o);});
    const content=new THREE.Group();
    let unit=1;const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3());
    const maxDim=Math.max(size.x,size.y,size.z);if(maxDim>1)unit=.08/maxDim; // authored in cm/mm: normalise to ~8 cm
    for(const m of meshes){
      const g=m.geometry.clone();g.applyMatrix4(m.matrixWorld);if(unit!==1)g.scale(unit,unit,unit);
      const mesh=new THREE.Mesh(g,m.material);mesh.name=m.name||m.parent?.name||'';
      for(const mat of [].concat(m.material)){if(mat){mat.envMapIntensity=1.1;if(mat.transparent)mat.depthWrite=false;}}
      mesh.renderOrder=1;content.add(mesh);
    }
    const strapMesh=content.children.find(c=>/strap|band|bracelet|belt/i.test(c.name));
    const caseMeshes=content.children.filter(c=>c!==strapMesh);
    const all=new THREE.Box3().setFromObject(content);
    // Loop interior: measured from the strap; falls back to the overall bounding box.
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
      loop={cy,top,A:Math.max(.015,(innerRight-innerLeft)/2),B:Math.max(.012,(top-innerBottom)/2)};
      this.strap={mesh:strapMesh,base:Float32Array.from(p.array)};
    }else{
      const s=all.getSize(new THREE.Vector3());
      loop={cy:(all.min.y+all.max.y)/2,top:all.max.z-s.z*.15,A:s.y/2*.9,B:s.z/2*.85};
    }
    this.loop=loop;
    const occ=new THREE.Mesh(new THREE.CylinderGeometry(1,1,1,48,1,false),new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:true}));
    occ.geometry.rotateZ(Math.PI/2);occ.renderOrder=-1;occ.name='wrist-occluder';this.occluder=occ;
    content.add(occ);this.content=content;this.anchor.add(content);
  }
  // Re-shape the strap for this wrist (only when the size changes noticeably).
  fit(size){
    if(!this.loop)return;
    const key=Math.round(size.width*400)+':'+Math.round(size.thickness*400);if(key===this.fitKey)return;this.fitKey=key;
    const {cy,top,A,B}=this.loop,gap=.0015,A2=size.width/2+gap,B2=size.thickness/2+gap;
    const sy=Math.min(1.35,Math.max(.65,A2/A)),sz=Math.min(1.35,Math.max(.65,B2/B));
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
    // Wrist centre → group origin.
    this.content.position.set(0,-cy,-(top-fittedB));
    // Forearm stand-in, centred on the watch: the crown may face either the hand or the elbow.
    this.occluder.scale.set(.12,size.width/2,size.thickness/2);
    this.occluder.position.set(0,cy,top-fittedB);
  }
  resize(displayW,displayH,videoW,videoH){
    const dpr=Math.min(2,window.devicePixelRatio||1),w=Math.max(1,Math.round(displayW*dpr)),h=Math.max(1,Math.round(displayH*dpr));
    if(this.canvas.width!==w||this.canvas.height!==h)this.renderer.setSize(w,h,false);
    if(this.videoW!==videoW||this.videoH!==videoH){
      this.videoW=videoW;this.videoH=videoH;
      Object.assign(this.camera,{left:0,right:videoW,top:0,bottom:-videoH});this.camera.updateProjectionMatrix();
    }
  }
  readForearm(video,image,now){
    if(!video?.videoWidth)return null;
    if(this.frameNo++%2===0){
      const w=160,h=Math.max(16,Math.round(w*video.videoHeight/video.videoWidth));
      if(this.sample.width!==w||this.sample.height!==h){this.sample.width=w;this.sample.height=h;this.sampleCtx=null;}
      this.sampleCtx??=this.sample.getContext('2d',{willReadFrequently:true});
      let found=null;
      try{this.sampleCtx.drawImage(video,0,0,w,h);found=detectForearm(this.sampleCtx.getImageData(0,0,w,h).data,w,h,image);}catch{}
      if(found){
        const W={x:image[0].x*video.videoWidth,y:image[0].y*video.videoHeight};
        if(now-this.forearmSeen>500){this.fa.reset();this.fcx.reset();this.fcy.reset();this.fw.reset();}
        let angle=Math.atan2(found.dir.y,found.dir.x);
        if(this.forearm){const prev=this.forearm.angle;angle=prev+Math.atan2(Math.sin(angle-prev),Math.cos(angle-prev));}
        const next={angle:this.fa.filter(angle,now)};
        if(found.centre){
          // Track the centre relative to the wrist landmark so it moves with the hand between detections.
          next.dx=this.fcx.filter(found.centre.x*video.videoWidth-W.x,now);next.dy=this.fcy.filter(found.centre.y*video.videoHeight-W.y,now);
          next.widthPx=this.fw.filter(found.widthPx*video.videoWidth/found.frameW,now);
        }
        this.forearm=next;this.forearmSeen=now;
      }
    }
    if(!this.forearm||now-this.forearmSeen>450){this.forearm=null;return null;}
    const f=this.forearm,W={x:image[0].x*video.videoWidth,y:image[0].y*video.videoHeight},out={dir:{x:Math.cos(f.angle),y:Math.sin(f.angle)}};
    if(f.widthPx){out.centre={x:(W.x+f.dx)/video.videoWidth,y:(W.y+f.dy)/video.videoHeight};out.widthPx=f.widthPx;out.frameW=video.videoWidth;}
    return out;
  }
  update(input,now=performance.now()){
    if(!this.ready||!this.content)return null;
    if(now-this.lastSeen>1500)this.chirality=0;
    this.chirality=Math.max(-12,Math.min(12,this.chirality*.9+chiralityEvidence(input.world,input.handedness)));
    const forearm=this.readForearm(input.video,input.image,now);
    const pose=solveWristPose({...input,right:this.chirality>=0,forearm});
    if(!pose){this.miss(now);return null;}
    this.fit(pose.size);
    const {X,Y,Z}=pose.axes,toThree=v=>new THREE.Vector3(v.x,-v.y,-v.z);
    const target=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(toThree(X),toThree(Y),toThree(Z)));
    if(!this.hasPose||now-this.lastSeen>400){this.fx.reset();this.fy.reset();this.fs.reset();this.q.copy(target);}
    else{const angle=this.q.angleTo(target);this.q.slerp(target,Math.min(.92,.3+angle*1.6));}
    const x=this.fx.filter(pose.x,now),y=this.fy.filter(pose.y,now),s=Math.exp(this.fs.filter(Math.log(pose.scale),now));
    this.anchor.position.set(x,-y,0);this.anchor.quaternion.copy(this.q);this.anchor.scale.setScalar(s);
    this.anchor.visible=true;this.hasPose=true;this.lastSeen=now;this.lastPose={...pose,x,y,scale:s};
    this.render();return this.lastPose;
  }
  miss(now=performance.now()){if(this.anchor.visible&&now-this.lastSeen>180){this.anchor.visible=false;this.render();}}
  hide(){this.anchor.visible=false;this.hasPose=false;this.render();}
  render(){this.renderer.render(this.scene,this.camera);}
}
