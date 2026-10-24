// Juvia wrist pose solver (no dependencies, unit-testable).
// Turns MediaPipe hand landmarks (plus a small RGBA copy of the frame) into a metric 3D wrist pose.
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
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

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

// Which side of the palm is the back of the hand?
// MediaPipe's world landmarks follow its own handedness guess (which is unreliable on fists and
// side views, and flips with mirroring), so the label cannot be trusted on its own. Fingers and
// the thumb can only curl toward the palm, so their offset from the knuckle plane reveals the palm
// side directly from the 3D points. Returns evidence > 0 when the points form a right hand, i.e.
// when cross(middle − wrist, index − pinky) is the back-of-hand normal.
export function chiralityEvidence(world,label){
  if(world?.length!==21)return 0;
  const W=world[0],M=world[9],I=world[5],P=world[17];
  const n=norm(cross(sub(M,W),sub(I,P))),hand=len(sub(M,W));if(!n||hand<1e-4)return 0;
  let flex=0;
  for(const [m,p,d,t] of [[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]])
    flex+=(dot(sub(world[p],world[m]),n)+dot(sub(world[d],world[m]),n)+dot(sub(world[t],world[m]),n))/3;
  const thumb=(dot(sub(world[3],W),n)+dot(sub(world[4],W),n))/2;
  // Curl toward +n means +n is the palm, i.e. a left hand.
  const geometric=-(flex/hand+thumb/hand*.6);
  // MediaPipe builds the world points to match its own label (unmirrored input: 'Right' = the points
  // form a right hand), so the label decides flat, open hands; a clear curl (|geometric| ≈ 1–2.5) wins.
  const prior=label==='Right'?.5:label==='Left'?-.5:0;
  return clamp(geometric,-3,3)+prior;
}

export function wristFrame(world,anatomicalRight){
  const W=world[0],I=world[5],M=world[9],R=world[13],P=world[17];
  const knuckles=avg(I,M,R,P);
  const X=norm(sub(knuckles,W));if(!X)return null;                       // toward the fingers
  let n=cross(sub(M,W),sub(I,P));if(!anatomicalRight)n=mul(n,-1);        // back-of-hand normal
  n=sub(n,mul(X,dot(n,X)));const Z=norm(n);if(!Z)return null;
  const Y=cross(Z,X);                                                    // 12 o'clock
  return {X,Y,Z,W,palmWidth:len(sub(I,P)),handLength:len(sub(knuckles,W))};
}

export function wristSize(frame,tapeInches,measuredWidth){
  let width;
  if(Number.isFinite(tapeInches)&&tapeInches>3&&tapeInches<12)width=tapeInches*.0254/2.67; // ellipse w × 0.72w ≈ 2.67w perimeter
  else{
    const fromPalm=Math.min(.07,Math.max(.048,frame.palmWidth*.9));
    // Skin edges are lost in shadow more often than they overshoot, so a measurement may only widen
    // the strap; a strap narrower than the arm would sink into it.
    width=Number.isFinite(measuredWidth)?clamp(measuredWidth,fromPalm,Math.min(.078,fromPalm*1.3)):fromPalm;
  }
  return {width,thickness:width*.72};
}

// ---------- Forearm from the camera image ----------
// MediaPipe tracks the hand, not the forearm. When the wrist bends, the hand axis can be 60°+ away
// from the forearm the watch actually sits on. The forearm is found from skin colour sampled on the
// hand itself: the direction from the wrist with the most skin, then the forearm's two edges.

function hull(points){
  const p=points.slice().sort((a,b)=>a.x-b.x||a.y-b.y),c=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lo=[],hi=[];
  for(const q of p){while(lo.length>1&&c(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop();lo.push(q);}
  for(const q of p.reverse()){while(hi.length>1&&c(hi[hi.length-2],hi[hi.length-1],q)<=0)hi.pop();hi.push(q);}
  return lo.slice(0,-1).concat(hi.slice(0,-1));
}
function insideConvex(poly,q){
  let sign=0;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],c=(b.x-a.x)*(q.y-a.y)-(b.y-a.y)*(q.x-a.x);
    if(c!==0){if(sign===0)sign=Math.sign(c);else if(Math.sign(c)!==sign)return false;}
  }
  return true;
}
const yuv=(r,g,b)=>({y:.299*r+.587*g+.114*b,cb:128-.168736*r-.331264*g+.5*b,cr:128+.5*r-.418688*g-.081312*b});
const median=a=>{const s=a.slice().sort((x,y)=>x-y);return s[s.length>>1];};

// pix: RGBA bytes of a w×h downscaled frame; image: 21 normalised MediaPipe landmarks.
// Returns {dir, centre, width, score} in normalised image units (dir points from elbow toward hand), or null.
export function detectForearm(pix,w,h,image,offsetFraction=.32){
  if(!pix||image?.length!==21||w<16||h<16)return null;
  const P=image.map(p=>({x:p.x*w,y:p.y*h}));
  const W=P[0],K={x:(P[5].x+P[9].x+P[13].x+P[17].x)/4,y:(P[5].y+P[9].y+P[13].y+P[17].y)/4};
  const L=Math.hypot(K.x-W.x,K.y-W.y);if(L<8)return null;
  const at=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=w||y>=h)return null;const i=(y*w+x)*4;return yuv(pix[i],pix[i+1],pix[i+2]);};
  // Skin model from the back of the hand / palm between wrist and knuckles.
  const cb=[],cr=[],ly=[];
  for(const k of [5,9,13,17,1])for(const t of [.25,.45,.65])for(const [dx,dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){
    const s=at(W.x+(P[k].x-W.x)*t+dx,W.y+(P[k].y-W.y)*t+dy);if(s){cb.push(s.cb);cr.push(s.cr);ly.push(s.y);}
  }
  if(cb.length<20)return null;
  const mcb=median(cb),mcr=median(cr),my=median(ly);
  const mad=(a,m)=>median(a.map(v=>Math.abs(v-m)));
  const tcb=clamp(3*mad(cb,mcb),5,16),tcr=clamp(3*mad(cr,mcr),5,16);
  const skin=s=>!!s&&Math.abs(s.cb-mcb)<=tcb&&Math.abs(s.cr-mcr)<=tcr&&s.y>my*.35&&s.y<my*1.6+30;
  const handPoly=hull(P);
  const ax={x:(K.x-W.x)/L,y:(K.y-W.y)/L},base=Math.atan2(-ax.y,-ax.x);
  const scoreDir=phi=>{
    const d={x:Math.cos(phi),y:Math.sin(phi)},p={x:-d.y,y:d.x};let n=0,hit=0,total=0;
    for(let r=.45;r<=1.65;r+=.15)for(let o=-.3;o<=.3001;o+=.15){
      total++;const q={x:W.x+(d.x*r+p.x*o)*L,y:W.y+(d.y*r+p.y*o)*L};
      if(insideConvex(handPoly,q))continue;const s=at(q.x,q.y);if(!s)continue;n++;if(skin(s))hit++;
    }
    if(n<total*.5)return -1;
    const dev=Math.abs(Math.atan2(Math.sin(phi-base),Math.cos(phi-base)))/(Math.PI/2);
    return hit/n-.12*dev*dev;
  };
  let best=-1,bestPhi=base;
  for(let a=-100;a<=100;a+=5){const phi=base+a*Math.PI/180,s=scoreDir(phi);if(s>best){best=s;bestPhi=phi;}}
  for(let a=-4;a<=4;a+=1){const phi=bestPhi+a*Math.PI/180,s=scoreDir(phi);if(s>best+1e-9){best=s;bestPhi=phi;}}
  if(best<.62)return null;
  const d={x:Math.cos(bestPhi),y:Math.sin(bestPhi)},p={x:-d.y,y:d.x};
  // Cross-sections around the watch position: walk out from the axis to the first non-skin run.
  const widths=[],centres=[];
  for(const r of [offsetFraction-.08,offsetFraction,offsetFraction+.08,offsetFraction+.16]){
    const c={x:W.x+d.x*r*L,y:W.y+d.y*r*L},edge=sgn=>{
      let miss=0;for(let o=0;o<=1.4*L;o+=1){const s=at(c.x+p.x*o*sgn,c.y+p.y*o*sgn);if(!s)return null;if(skin(s))miss=0;else if(++miss>=3)return o-2.5;}
      return null;
    };
    const a=edge(1),b=edge(-1);
    if(a!=null&&b!=null&&a+b>.35*L&&a+b<1.7*L){widths.push(a+b);centres.push({x:c.x+p.x*(a-b)/2,y:c.y+p.y*(a-b)/2});}
  }
  // Downscaled pixels keep the video's aspect ratio, so this is also the direction in video pixels.
  const out={dir:{x:-d.x,y:-d.y},score:best};
  if(widths.length>=2){
    const mw=median(widths),keep=widths.map((v,i)=>[v,centres[i]]).filter(([v])=>Math.abs(v-mw)<.2*mw);
    const c=keep.reduce((s,[,q])=>({x:s.x+q.x/keep.length,y:s.y+q.y/keep.length}),{x:0,y:0});
    // Normalised units: centre in [0,1] image coordinates, width in pixels of the downscaled frame / w.
    out.centre={x:c.x/w,y:c.y/h};out.widthPx=mw;out.frameW=w;out.frameH=h;
  }
  return out;
}

// Rotate the hand frame (minimal flexion + deviation) so its forearm axis matches the 2D forearm direction.
function alignToForearm(X,Y,Z,dir){
  let best=null;
  const evalAt=(f,v)=>{
    const cf=Math.cos(f),sf=Math.sin(f),cv=Math.cos(v),sv=Math.sin(v);
    const F=add(add(mul(X,cv*cf),mul(Y,sv)),mul(Z,cv*sf));
    const m=Math.hypot(F.x,F.y);if(m<1e-6)return null;
    const along=(F.x*dir.x+F.y*dir.y)/m,perp=(F.x*dir.y-F.y*dir.x)/m;
    // The forearm's tilt toward the camera is invisible in 2D; people film a watch with the forearm
    // roughly across the frame, so prefer an in-plane forearm over keeping a bent hand's tilt.
    const cost=(along<0?4:0)+perp*perp*Math.min(1,m/.35)*4+(f/1.25)**2*.08+(v/.45)**2*.08+F.z*F.z*.35;
    return {F,cost,f,v};
  };
  for(let f=-1.4;f<=1.4001;f+=.05)for(let v=-.6;v<=.6001;v+=.05){const r=evalAt(f,v);if(r&&(!best||r.cost<best.cost))best=r;}
  if(!best)return null;
  const Xn=norm(best.F),Zn=norm(sub(Z,mul(Xn,dot(Z,Xn))));if(!Xn||!Zn)return null;
  return {X:Xn,Y:cross(Zn,Xn),Z:Zn,flexion:best.f,deviation:best.v};
}

// Full pose: everything the renderer needs, in video pixels.
// right: anatomical chirality decided by the caller (see chiralityEvidence).
// forearm: optional detectForearm() result (smoothed by the caller).
export function solveWristPose({image,world,width,height,right,handedness,forearm,tapeInches,offset=.022}){
  const cam=fitCamera(image,world,width,height);if(!cam)return null;
  if(typeof right!=='boolean')right=chiralityEvidence(world,handedness)>=0;
  const f=wristFrame(world,right);if(!f)return null;
  let X=cam.toCamera(f.X),Y=cam.toCamera(f.Y),Z=cam.toCamera(f.Z),aligned=false,flexion=0;
  if(forearm?.dir){const a=alignToForearm(X,Y,Z,forearm.dir);if(a){({X,Y,Z}=a);aligned=true;flexion=a.flexion;}}
  // Measured forearm width (orthographic silhouette of an elliptical wrist, 0.72 thickness ratio).
  let measuredWidth;
  if(forearm?.widthPx&&aligned){
    const m=Math.hypot(X.x,X.y),p={x:-X.y/m,y:X.x/m},py=Y.x*p.x+Y.y*p.y,pz=Z.x*p.x+Z.y*p.y;
    const pxWidth=forearm.widthPx*width/forearm.frameW,k=Math.sqrt(py*py+(.72*pz)**2);
    if(k>.3)measuredWidth=pxWidth/cam.scale/k;
  }
  const size=wristSize(f,tapeInches,measuredWidth);
  // Watch sits ~2 cm up the forearm from the wrist crease, centred in the wrist's cross-section.
  const w0=cam.project(f.W);
  let x=w0.x-X.x*offset*cam.scale,y=w0.y-X.y*offset*cam.scale;
  if(aligned&&forearm.centre&&measuredWidth>=size.width*.85){
    const cx=forearm.centre.x*width,cy=forearm.centre.y*height,shift=Math.hypot(cx-x,cy-y);
    if(shift<f.palmWidth*cam.scale*.6){x=cx;y=cy;}
  }
  // A watch is worn to read upright for its wearer: 12 o'clock points to the little-finger side on
  // either wrist (so on a right wrist the crown faces the elbow). Landmark identity gives that side
  // without trusting left/right labels.
  const pinkySide=cam.toCamera(sub(world[17],world[5]));
  const toElbow=dot(Y,pinkySide)<0;
  if(toElbow){X=mul(X,-1);Y=mul(Y,-1);}
  return {x,y,scale:cam.scale,axes:{X,Y,Z},size,crownToElbow:toElbow,anatomicalRight:right,residual:cam.residual,aligned,flexion,measuredWidth,
    // > 0 when the back of the wrist (watch dial) faces the camera.
    dialFacing:-Z.z,
    forearm:toElbow?{x:X.x,y:X.y}:{x:-X.x,y:-X.y}};
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
