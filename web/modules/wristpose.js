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

// Pixels per real metre. MediaPipe's world landmarks have the right shape but not a reliable size (a
// fist can come out at half its real width), so the scale comes from image spans of hand bones whose real
// length varies little between adults, each corrected for foreshortening with the fitted 3D orientation.
const HAND_SPANS=[[5,17,.066],[0,9,.088],[0,5,.083],[0,17,.074]];
export function handScale(image,world,cam,width,height){
  let sum=0,weight=0;
  for(const [a,b,real] of HAND_SPANS){
    const u=norm(sub(world[b],world[a]));if(!u)continue;
    const d=cam.toCamera(u),f=Math.hypot(d.x,d.y);if(f<.5)continue;
    const px=Math.hypot((image[a].x-image[b].x)*width,(image[a].y-image[b].y)*height);
    sum+=f*f*Math.log(px/(real*f));weight+=f*f;
  }
  return weight?Math.exp(sum/weight):cam.scale;
}

// Wrist cross-section (metres): a soft-tape reading wins, then the measured forearm silhouette, then an
// adult average. Thickness (back of wrist to palm side) is ~0.72 of the side-to-side width.
// Because the scale already comes from the user's own hand, the hand-based width is close (within ~10%) on
// real frames; a silhouette that disagrees by more than -20%/+25% has picked up background (a skin-coloured
// curtain, door or floor) and is ignored rather than clamped, so it can never balloon the strap.
const WRIST_WIDTH=.056,WRIST_PERIMETER=2.72; // perimeter of a w × 0.72w ellipse ≈ 2.72 w
export function wristSize(tapeInches,measuredWidth){
  let width=WRIST_WIDTH;
  if(Number.isFinite(tapeInches)&&tapeInches>3&&tapeInches<12)width=tapeInches*.0254/WRIST_PERIMETER;
  else if(Number.isFinite(measuredWidth)){const r=measuredWidth/WRIST_WIDTH;if(r>.8&&r<1.25)width=WRIST_WIDTH*clamp(r,.88,1.15);}
  return {width,thickness:width*.72,circumference:width*WRIST_PERIMETER};
}

// ---------- Product sizes (S / M / L) ----------
// Each size changes the real geometry of the piece; fitFor() compares it with the body part so the try-on
// can show and say how it fits. Units: metres (case diameter, inner circumference, inner diameter, chain length).
export const SIZE_CHART={
  watches:{base:.040,sizes:{S:.036,M:.040,L:.044}},      // case diameter; the strap is adjustable and always fitted
  bracelets:{sizes:{S:.165,M:.180,L:.195}},             // bangle inner circumference
  rings:{sizes:{S:.01653,M:.01814,L:.01976}},          // inner diameter: US 6, 8, 10
  necklaces:{base:.4572,sizes:{S:.4064,M:.4572,L:.508}},// chain length: 16, 18, 20 inches
};
// Bangle inner oval with a 0.8 height/width ratio and the given perimeter: semi-axes along the wrist's width / thickness.
export function bangleAxes(circumference){const a=circumference/(Math.PI*(3*1.8-Math.sqrt(3.8*3.4)));return {a,b:.8*a};}
export function fitFor(category,size,body={}){
  const v=SIZE_CHART[category]?.sizes[size];if(!v)return null;
  if(category==='watches'){
    const wrist=body.wristWidth||WRIST_WIDTH,ratio=v/wrist;
    return {fit:'fits',ratio,label:ratio>.8?'Bold on your wrist':ratio<.66?'Petite on your wrist':'Classic fit'};
  }
  if(category==='bracelets'){
    // A bangle must pass over the hand: ~2 cm more than the wrist is a comfortable, close fit.
    const room=v-(body.wristCircumference||WRIST_WIDTH*WRIST_PERIMETER);
    return {fit:room<.01?'tight':room>.035?'loose':'fits',room,label:room<.01?'Too small to slip over your hand':room>.035?'Loose, slides on your wrist':'Comfortable fit'};
  }
  if(category==='rings'){
    const gap=v-(body.fingerDiameter||.0173);
    return {fit:gap<-.0004?'tight':gap>.0009?'loose':'fits',gap,label:gap<-.0004?'Too small for your finger':gap>.0009?'Loose, may spin':'Snug fit'};
  }
  if(category==='necklaces'){
    const drop=(v-SIZE_CHART.necklaces.base)/2;
    return {fit:'fits',drop,label:v<.43?'Sits at the base of the neck':v>.48?'Falls to the upper chest':'Rests on the collarbone'};
  }
  return null;
}

// ---------- Forearm from the camera image ----------
// MediaPipe tracks the hand, not the forearm. When the wrist bends, the hand axis can be 60°+ away from
// the forearm the watch sits on. The forearm is found as a pair of roughly parallel edges (colour or
// brightness steps) enclosing skin-coloured pixels, measured on several cross-sections up the arm. Using
// both edges keeps shadow on the underside or a skin-coloured background from biasing centre or angle.
const yuv=(r,g,b)=>({y:.299*r+.587*g+.114*b,cb:128-.168736*r-.331264*g+.5*b,cr:128+.5*r-.418688*g-.081312*b});
const median=a=>{const s=a.slice().sort((x,y)=>x-y);return s[s.length>>1];};

// pix: RGBA bytes of a w×h downscaled frame; image: 21 normalised MediaPipe hand landmarks.
// Returns {dir (elbow → hand, unit, pixels), centre (normalised, at the watch position), widthPx (sample px),
// frameW, score, stations} or null when the arm's edges are not clear.
export function detectForearm(pix,w,h,image,watchAt=.3){
  if(!pix||image?.length!==21||w<16||h<16)return null;
  const P=image.map(p=>({x:p.x*w,y:p.y*h}));
  const W=P[0],K={x:(P[5].x+P[9].x+P[13].x+P[17].x)/4,y:(P[5].y+P[9].y+P[13].y+P[17].y)/4};
  const L=Math.hypot(K.x-W.x,K.y-W.y);if(L<8)return null;
  const E=.86*Math.max(Math.hypot(P[5].x-P[17].x,P[5].y-P[17].y),.72*L); // expected silhouette width
  const px=(x,y)=>{
    if(x<0||y<0||x>w-1.001||y>h-1.001)return null;
    const x0=x|0,y0=y|0,fx=x-x0,fy=y-y0,i=(y0*w+x0)*4,j=i+w*4,c=[0,0,0];
    for(let k=0;k<3;k++)c[k]=(pix[i+k]*(1-fx)+pix[i+4+k]*fx)*(1-fy)+(pix[j+k]*(1-fx)+pix[j+4+k]*fx)*fy;
    return yuv(c[0],c[1],c[2]);
  };
  // Skin chroma from the back of the hand / palm between wrist and knuckles (brightness is ignored).
  const cb=[],cr=[],ly=[];
  for(const k of [5,9,13,17,1])for(const t of [.25,.45,.65]){const q=px(W.x+(P[k].x-W.x)*t,W.y+(P[k].y-W.y)*t);if(q){cb.push(q.cb);cr.push(q.cr);ly.push(q.y);}}
  if(cb.length<8)return null;
  const mcb=median(cb),mcr=median(cr),my=Math.max(20,median(ly)),mad=(a,m)=>median(a.map(v=>Math.abs(v-m)));
  const tcb=clamp(2*mad(cb,mcb),3.5,9),tcr=clamp(2*mad(cr,mcr),3.5,9);
  // Chroma decides skin; brightness far below the hand's (dark wood, deep shade) only counts partly, so a
  // skin-coloured background is not mistaken for the arm while a shaded underside still mostly counts.
  const skin=q=>{
    if(!q||q.y<10)return 0;const dc=Math.hypot((q.cb-mcb)/tcb,(q.cr-mcr)/tcr),c=dc<1.4?1:dc<2.3?(2.3-dc)/.9:0,r=q.y/my;
    return c*(r>.55&&r<1.9?1:r<=.55?clamp((r-.25)/.3,0,1):clamp((2.6-r)/.7,0,1));
  };
  const STEP=.75,HALF=1.5*E,N=Math.floor(2*HALF/STEP)+1;
  // One cross-section: the best edge pair perpendicular to direction theta at distance r from the wrist.
  const station=(theta,r)=>{
    const d={x:Math.cos(theta),y:Math.sin(theta)},n={x:-d.y,y:d.x},C={x:W.x+d.x*r,y:W.y+d.y*r};
    const Y=new Float32Array(N),B=new Float32Array(N),R=new Float32Array(N),S=new Float32Array(N);let missing=0;
    for(let i=0;i<N;i++){const t=-HALF+i*STEP,q=px(C.x+n.x*t,C.y+n.y*t);if(!q){missing++;S[i]=-1;continue;}Y[i]=q.y;B[i]=q.cb;R[i]=q.cr;S[i]=skin(q);}
    if(missing>N*.2)return null;
    const g=new Float32Array(N);let gmax=1;
    for(let i=2;i<N-2;i++){if(S[i-2]<0||S[i+2]<0)continue;g[i]=.5*Math.abs(Y[i+2]-Y[i-2])+.9*(Math.abs(B[i+2]-B[i-2])+Math.abs(R[i+2]-R[i-2]));gmax=Math.max(gmax,g[i]);}
    const peaks=[];
    for(let i=3;i<N-3;i++)if(g[i]>4&&g[i]>=g[i-1]&&g[i]>=g[i+1])peaks.push(i);
    peaks.sort((a,b)=>g[b]-g[a]);peaks.length=Math.min(peaks.length,10);
    // A real arm edge runs along the arm: the local image gradient there points across the scan line.
    // Diagonal cuts through a single edge (or stripes in the background) fail this test.
    const align=new Map();
    for(const i of peaks){
      const t=-HALF+i*STEP,x=C.x+n.x*t,y=C.y+n.y*t;let jxx=0,jyy=0,jxy=0;
      const a=px(x-1.5,y),b=px(x+1.5,y),c=px(x,y-1.5),e=px(x,y+1.5);
      if(a&&b&&c&&e)for(const k of ['y','cb','cr']){const wgt=k==='y'?1:2.5,gx=(b[k]-a[k])*wgt,gy=(e[k]-c[k])*wgt;jxx+=gx*gx;jyy+=gy*gy;jxy+=gx*gy;}
      const phi=.5*Math.atan2(2*jxy,jxx-jyy);align.set(i,jxx+jyy>1e-6?Math.abs(Math.cos(phi)*n.x+Math.sin(phi)*n.y):0);
    }
    const mean=(a,b)=>{let s=0,c=0;for(let i=Math.max(0,a);i<=Math.min(N-1,b);i++)if(S[i]>=0){s+=S[i];c++;}return c?s/c:.5;};
    let best=null;
    for(let a=0;a<peaks.length;a++)for(let b=0;b<peaks.length;b++){
      const p=peaks[a],q=peaks[b];if(q<=p)continue;
      const width=(q-p)*STEP;if(width<.55*E||width>1.6*E)continue;
      const inside=mean(p+3,q-3);if(inside<.45)continue;
      const al=Math.min(align.get(p),align.get(q));if(al<.6)continue;
      const outside=(mean(p-8,p-3)+mean(q+3,q+8))/2;
      const score=(g[p]+g[q])/(2*gmax)+1.4*inside-.8*outside-.6*Math.abs(width/E-1)+.8*(al-.85);
      if(!best||score>best.score)best={score,offset:-HALF+(p+q)/2*STEP,width};
    }
    return best&&{...best,r};
  };
  // A direction is good when its cross-sections agree: centres on a straight line, similar widths.
  const evalDir=theta=>{
    const st=[.35,.6,.85,1.1].map(f=>station(theta,f*L)).filter(Boolean);
    if(st.length<3)return null;
    const n=st.length,mr=st.reduce((s,q)=>s+q.r,0)/n,mo=st.reduce((s,q)=>s+q.offset,0)/n;
    let sxx=0,sxy=0;st.forEach(q=>{sxx+=(q.r-mr)**2;sxy+=(q.r-mr)*(q.offset-mo);});
    const m=sxy/(sxx||1),resid=Math.sqrt(st.reduce((s,q)=>s+(q.offset-(mo+m*(q.r-mr)))**2,0)/n);
    const widths=st.map(q=>q.width),mw=median(widths),cv=Math.sqrt(widths.reduce((s,v)=>s+(v-mw)**2,0)/n)/mw;
    // The arm's centre line must pass through the wrist: its offset at the wrist landmark (r = 0) should be small.
    const c0=mo-m*mr;
    const score=st.reduce((s,q)=>s+q.score,0)/4-.8*Math.abs(m)-1.2*cv-.6*resid/E-1.5*(c0/E)**2;
    return {theta,score,m,mo,mr,mw,n,c0};
  };
  const base=Math.atan2(W.y-K.y,W.x-K.x);let best=null;
  for(let a=-36;a<=36;a+=9){const r=evalDir(base+a*Math.PI/180);if(r){r.score-=.5*(a/36)**2;if(!best||r.score>best.score)best=r;}}
  if(!best)return null;
  // Refine: a sloping line of centres means the scan direction is off by atan(slope).
  for(let k=0;k<2;k++){const r=evalDir(best.theta+Math.atan(best.m));if(r&&r.score>best.score-.05)best=r;else break;}
  if(best.score<1.2)return null;
  const theta=best.theta+Math.atan(best.m),d={x:Math.cos(best.theta),y:Math.sin(best.theta)},nrm={x:-d.y,y:d.x};
  const rw=watchAt*L,off=best.mo+best.m*(rw-best.mr),C={x:W.x+d.x*rw+nrm.x*off,y:W.y+d.y*rw+nrm.y*off};
  // Downscaled pixels keep the video's aspect ratio, so this direction is also valid in video pixels.
  return {dir:{x:-Math.cos(theta),y:-Math.sin(theta)},centre:{x:C.x/w,y:C.y/h},widthPx:best.mw*Math.cos(Math.atan(best.m)),frameW:w,frameH:h,score:best.score,stations:best.n};
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
  const scale=handScale(image,world,cam,width,height);
  let X=cam.toCamera(f.X),Y=cam.toCamera(f.Y),Z=cam.toCamera(f.Z),aligned=false,flexion=0;
  if(forearm?.dir){const a=alignToForearm(X,Y,Z,forearm.dir);if(a){({X,Y,Z}=a);aligned=true;flexion=a.flexion;}}
  // Measured forearm width (orthographic silhouette of an elliptical wrist, 0.72 thickness ratio).
  let measuredWidth;
  if(forearm?.widthPx&&aligned){
    const m=Math.hypot(X.x,X.y),p={x:-X.y/m,y:X.x/m},py=Y.x*p.x+Y.y*p.y,pz=Z.x*p.x+Z.y*p.y;
    const pxWidth=forearm.widthPx*width/forearm.frameW,k=Math.sqrt(py*py+(.72*pz)**2);
    if(k>.3)measuredWidth=pxWidth/scale/k;
  }
  const size=wristSize(tapeInches,measuredWidth);
  // Watch sits ~2 cm up the forearm from the wrist crease, centred in the wrist's cross-section: when the
  // arm's edges were found, slide sideways onto the measured centre line.
  const w0=cam.project(f.W);
  let x=w0.x-X.x*offset*scale,y=w0.y-X.y*offset*scale;
  if(aligned&&forearm.centre){
    const m=Math.hypot(forearm.dir.x,forearm.dir.y)||1,nx=-forearm.dir.y/m,ny=forearm.dir.x/m;
    const across=(x-forearm.centre.x*width)*nx+(y-forearm.centre.y*height)*ny;
    if(Math.abs(across)<size.width*scale){x-=nx*across;y-=ny*across;}
  }
  // A watch is worn to read upright for its wearer: 12 o'clock points to the little-finger side on
  // either wrist (so on a right wrist the crown faces the elbow). Landmark identity gives that side
  // without trusting left/right labels.
  const pinkySide=cam.toCamera(sub(world[17],world[5]));
  const toElbow=dot(Y,pinkySide)<0;
  if(toElbow){X=mul(X,-1);Y=mul(Y,-1);}
  return {x,y,scale,axes:{X,Y,Z},size,crownToElbow:toElbow,anatomicalRight:right,residual:cam.residual,aligned,flexion,measuredWidth,
    // > 0 when the back of the wrist (watch dial) faces the camera.
    dialFacing:-Z.z,
    forearm:toElbow?{x:X.x,y:X.y}:{x:-X.x,y:-X.y}};
}

// Ring on the ring finger's proximal phalanx (landmarks 13 → 14).
// Ring model frame: +X along the finger toward the tip, +Z out of the back of the finger (stone side).
export function solveFingerPose({image,world,width,height,right,handedness,tapeInches}){
  const cam=fitCamera(image,world,width,height);if(!cam)return null;
  if(typeof right!=='boolean')right=chiralityEvidence(world,handedness)>=0;
  const f=wristFrame(world,right);if(!f)return null;
  const mcp=world[13],pip=world[14],Xw=norm(sub(pip,mcp));if(!Xw)return null;
  const Zw=norm(sub(f.Z,mul(Xw,dot(f.Z,Xw))));if(!Zw)return null;
  // Ring size: a soft-tape circumference wins; otherwise an average ring finger (US 7, 17.3 mm).
  const diameter=Number.isFinite(tapeInches)&&tapeInches>1.2&&tapeInches<3.8?tapeInches*.0254/Math.PI:.0173;
  const centre=add(mcp,mul(sub(pip,mcp),.36)),p=cam.project(centre);
  const X=cam.toCamera(Xw),Z=cam.toCamera(Zw),Y=cross(Z,X);
  // True scale from the hand's image size; k converts MediaPipe world units into real metres.
  const scale=handScale(image,world,cam,width,height),k=cam.scale/scale;
  // Neighbouring proximal phalanges hide the ring's sides when fingers are together.
  const local=q=>mul(cam.toCamera(sub(q,centre)),k),capsule=(a,b,r)=>({a:local(world[a]),b:local(world[b]),r});
  const occluders=[capsule(13,14,diameter/2),capsule(9,10,diameter*.53),capsule(17,18,diameter*.46),capsule(0,13,diameter*.62)];
  return {x:p.x,y:p.y,scale,axes:{X,Y,Z},size:{diameter},occluders,anatomicalRight:right,dialFacing:-Z.z};
}

// Necklace from MediaPipe Pose shoulders (11, 12) and the Face Landmarker chin (152).
// Necklace model frame: +X across the body, +Y up, +Z out of the chest; origin = neck centre at collar height.
export function solveNeckPose({shoulders,shouldersWorld,chin,width,height}){
  if(!shoulders?.[0]||!shoulders?.[1]||!chin)return null;
  const L={x:shoulders[0].x*width,y:shoulders[0].y*height},R={x:shoulders[1].x*width,y:shoulders[1].y*height},C={x:chin.x*width,y:chin.y*height};
  const px=Math.hypot(L.x-R.x,L.y-R.y);if(px<20)return null;
  let metric=.36,depth=0;
  if(shouldersWorld?.[0]&&shouldersWorld?.[1]){
    const a=shouldersWorld[0],b=shouldersWorld[1];metric=clamp(len(sub(a,b)),.28,.46);depth=(a.z-b.z)/metric;
  }
  const scale=px/metric,mid={x:(L.x+R.x)/2,y:(L.y+R.y)/2};
  // Body axes in camera space (y down, z into the scene). Body yaw comes from the shoulders' depth difference.
  let X=norm({x:(L.x-R.x)/px,y:(L.y-R.y)/px,z:clamp(depth,-.9,.9)});
  const up2=norm({x:C.x-mid.x,y:C.y-mid.y,z:0})||{x:0,y:-1,z:0};
  let Y=norm(sub(up2,mul(X,dot(up2,X))));if(!X||!Y)return null;
  let Z=cross(X,Y);if(Z.z>0){X=mul(X,-1);Z=cross(X,Y);}
  // The chain sits around the base of the neck, about a third of the way from the shoulder line to the chin.
  const t=.3,x=mid.x+(C.x-mid.x)*t,y=mid.y+(C.y-mid.y)*t;
  return {x,y,scale,axes:{X,Y,Z},size:{neck:.115},dialFacing:-Z.z};
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
