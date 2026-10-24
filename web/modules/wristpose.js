// Juvia wrist pose solver (no dependencies, unit-testable).
// Turns MediaPipe hand landmarks into a metric 3D wrist pose in camera space.
//
// Camera space follows the video frame: x → right, y → down, z → into the scene (pixels for x/y).
// Watch model space (glTF, metres): +X = crown / 3 o'clock (toward the fingers),
// +Y = 12 o'clock (across the wrist), +Z = out of the dial (back of the hand).

const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const add=(a,b)=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const mul=(a,s)=>({x:a.x*s,y:a.y*s,z:a.z*s});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const len=a=>Math.hypot(a.x,a.y,a.z);
const norm=a=>{const l=len(a);return l>1e-9?mul(a,1/l):null;};
const avg=(...p)=>mul(p.reduce(add,{x:0,y:0,z:0}),1/p.length);

function solve3(m,v){
  const r=m.map((row,i)=>[...row,v[i]]);
  for(let c=0;c<3;c++){
    let p=c;for(let k=c+1;k<3;k++)if(Math.abs(r[k][c])>Math.abs(r[p][c]))p=k;
    if(Math.abs(r[p][c])<1e-12)return null;[r[c],r[p]]=[r[p],r[c]];
    const d=r[c][c];for(let k=c;k<4;k++)r[c][k]/=d;
    for(let k=0;k<3;k++)if(k!==c){const f=r[k][c];for(let q=c;q<4;q++)r[k][q]-=f*r[c][q];}
  }
  return r.map(row=>row[3]);
}

// Least-squares affine camera (weak perspective) mapping metric world landmarks to video pixels,
// then projected onto the nearest scaled rotation so the watch is never sheared.
export function fitCamera(image,world,width,height){
  if(image?.length!==21||world?.length!==21||!width||!height)return null;
  const wm={x:0,y:0,z:0},im={x:0,y:0};
  for(let i=0;i<21;i++){wm.x+=world[i].x/21;wm.y+=world[i].y/21;wm.z+=world[i].z/21;im.x+=image[i].x*width/21;im.y+=image[i].y*height/21;}
  const C=[[0,0,0],[0,0,0],[0,0,0]],U=[0,0,0],V=[0,0,0];
  for(let i=0;i<21;i++){
    const d=[world[i].x-wm.x,world[i].y-wm.y,world[i].z-wm.z],u=image[i].x*width-im.x,v=image[i].y*height-im.y;
    for(let r=0;r<3;r++){U[r]+=d[r]*u;V[r]+=d[r]*v;for(let c=0;c<3;c++)C[r][c]+=d[r]*d[c];}
  }
  const tr=C[0][0]+C[1][1]+C[2][2];for(let k=0;k<3;k++)C[k][k]+=Math.max(tr*1e-6,1e-12);
  const u=solve3(C,U),v=solve3(C,V);
  const uu=u&&{x:u[0],y:u[1],z:u[2]},vv=v&&{x:v[0],y:v[1],z:v[2]},su=uu?len(uu):0,sv=vv?len(vv):0;
  let r1,r2,r3,scale,fitted=false;
  if(su>1&&sv>1&&Math.min(su,sv)/Math.max(su,sv)>.65){
    // Symmetric orthonormalisation of the two image-axis rows.
    const a=mul(uu,1/su),b=mul(vv,1/sv),c=norm(add(a,b)),d=norm(sub(a,b));
    if(c&&d){r1=mul(add(c,d),Math.SQRT1_2);r2=mul(sub(c,d),Math.SQRT1_2);r3=cross(r1,r2);scale=(su+sv)/2;fitted=true;}
  }
  if(!fitted){
    // Degenerate view (hand seen edge-on): MediaPipe world landmarks are already camera-aligned,
    // so keep their axes and recover only the pixel scale.
    r1={x:1,y:0,z:0};r2={x:0,y:1,z:0};r3={x:0,y:0,z:1};let num=0,den=0;
    for(let i=0;i<21;i++){num+=(image[i].x*width-im.x)**2+(image[i].y*height-im.y)**2;den+=(world[i].x-wm.x)**2+(world[i].y-wm.y)**2;}
    scale=Math.sqrt(num/Math.max(den,1e-12));
  }
  if(!Number.isFinite(scale)||scale<50||scale>200000)return null;
  // Residual in pixels: how well a rigid weak-perspective camera explains the landmarks.
  let err=0;for(let i=0;i<21;i++){const d=sub(world[i],wm);const px=im.x+scale*dot(r1,d),py=im.y+scale*dot(r2,d);err+=Math.hypot(px-image[i].x*width,py-image[i].y*height);}
  return {worldMean:wm,imageMean:im,r1,r2,r3,scale,fitted,residual:err/21,
    project(p){const d=sub(p,wm);return {x:im.x+scale*dot(r1,d),y:im.y+scale*dot(r2,d),z:scale*dot(r3,d)};},
    toCamera(vec){return {x:dot(r1,vec),y:dot(r2,vec),z:dot(r3,vec)};}};
}

// MediaPipe labels handedness assuming a mirrored (selfie) input. Juvia feeds raw, un-mirrored
// camera frames, so the anatomical hand is the opposite of the label.
export function isAnatomicalRight(label){return label==='Left';}

export function wristFrame(world,anatomicalRight){
  const W=world[0],I=world[5],M=world[9],R=world[13],P=world[17];
  const knuckles=avg(I,M,R,P);
  const X=norm(sub(knuckles,W));if(!X)return null;                       // toward the fingers
  let n=cross(sub(M,W),sub(I,P));if(!anatomicalRight)n=mul(n,-1);        // back-of-hand normal
  n=sub(n,mul(X,dot(n,X)));const Z=norm(n);if(!Z)return null;
  const Y=cross(Z,X);                                                    // 12 o'clock
  return {X,Y,Z,W,palmWidth:len(sub(I,P)),handLength:len(sub(knuckles,W))};
}

export function wristSize(frame,tapeInches){
  let width;
  if(Number.isFinite(tapeInches)&&tapeInches>3&&tapeInches<12)width=tapeInches*.0254/2.67; // ellipse w × 0.72w ≈ 2.67w perimeter
  else width=Math.min(.07,Math.max(.048,frame.palmWidth*.9));
  return {width,thickness:width*.72};
}

// Full pose: everything the renderer needs, in video pixels.
export function solveWristPose({image,world,width,height,handedness,tapeInches,offset=.022}){
  const cam=fitCamera(image,world,width,height);if(!cam)return null;
  const right=isAnatomicalRight(handedness),f=wristFrame(world,right);if(!f)return null;
  const size=wristSize(f,tapeInches);
  // Watch sits ~2 cm up the forearm from the wrist crease, centred in the wrist's cross-section.
  const centre=sub(f.W,mul(f.X,offset));
  const p=cam.project(centre);
  const X=cam.toCamera(f.X),Y=cam.toCamera(f.Y),Z=cam.toCamera(f.Z);
  return {x:p.x,y:p.y,scale:cam.scale,axes:{X,Y,Z},size,anatomicalRight:right,residual:cam.residual,
    // > 0 when the back of the wrist (watch dial) faces the camera.
    dialFacing:-Z.z,
    forearm:{x:-X.x,y:-X.y}};
}

export class OneEuro{
  constructor(minCutoff=1.2,beta=.008,dCutoff=1){this.minCutoff=minCutoff;this.beta=beta;this.dCutoff=dCutoff;this.x=null;this.dx=0;this.t=0;}
  static alpha(cutoff,dt){const tau=1/(2*Math.PI*cutoff);return 1/(1+tau/dt);}
  reset(){this.x=null;this.dx=0;}
  filter(x,t){
    if(this.x===null||t<=this.t){this.x=x;this.t=t;return x;}
    const dt=Math.min(.25,(t-this.t)/1000);this.t=t;
    const dx=(x-this.x)/dt;this.dx+=OneEuro.alpha(this.dCutoff,dt)*(dx-this.dx);
    const cutoff=this.minCutoff+this.beta*Math.abs(this.dx);
    this.x+=OneEuro.alpha(cutoff,dt)*(x-this.x);return this.x;
  }
}
