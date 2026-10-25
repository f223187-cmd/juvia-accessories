// Focused tests for the try-on pose solver on real phone frames.  Run: node --test tests/vto
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fitCamera,handScale,chiralityEvidence,detectForearm,solveWristPose,solveFingerPose,solveNeckPose,wristSize,fitFor,bangleAxes,SIZE_CHART} from '../../web/modules/wristpose.js';

const dir=new URL('./fixtures/',import.meta.url);
const F=JSON.parse(readFileSync(new URL('real_frames.json',dir)));
const pts=a=>a.map(([x,y,z])=>({x,y,z}));
const deg=v=>Math.atan2(v.y,v.x)*180/Math.PI;
const angleDiff=(a,b)=>Math.abs(((a-b+540)%360)-180);
const pixels=f=>new Uint8ClampedArray(readFileSync(new URL(f.pixels,dir)));

// Rotate a frame 90° clockwise: landmarks, world points and pixels.
function rotate(f,pix){
  const [w,h]=f.sample,out=new Uint8ClampedArray(pix.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const s=(y*w+x)*4,d=(x*h+(h-1-y))*4;out.set(pix.subarray(s,s+4),d);}
  return {f:{...f,W:f.H,H:f.W,sample:[h,w],image:f.image.map(([x,y,z])=>[1-y,x,z]),world:f.world.map(([x,y,z])=>[-y,x,z])},pix:out};
}
function solve(f,pix){
  const image=pts(f.image),world=pts(f.world),right=chiralityEvidence(world,f.label)>=0;
  const fa=pix?detectForearm(pix,f.sample[0],f.sample[1],image):null;
  const forearm=fa&&{dir:fa.dir,centre:fa.centre,widthPx:fa.widthPx*f.W/f.sample[0],frameW:f.W};
  const pose=solveWristPose({image,world,width:f.W,height:f.H,right,forearm});
  return {fa,pose,scale:handScale(image,world,fitCamera(image,world,f.W,f.H),f.W,f.H)};
}

test('true scale comes from the hand in the image, not MediaPipe world size', ()=>{
  for(const key of ['phone_wrist_dark','phone_wrist_bent']){
    const f=F[key],{pose}=solve(f,null),wristPx=pose.size.width*pose.scale;
    // The default 5.6 cm wrist must render close to the measured arm silhouette (strap hugs, never balloons).
    assert.ok(wristPx>.72*f.truth.armWidth&&wristPx<1.15*f.truth.armWidth,`${key}: wrist ${wristPx.toFixed(0)}px vs arm ${f.truth.armWidth}px`);
  }
  // MediaPipe's own metric scale is ~50% too large on the fist frame; the corrected one is not.
  const f=F.phone_wrist_dark,image=pts(f.image),world=pts(f.world),cam=fitCamera(image,world,f.W,f.H);
  assert.ok(cam.scale/handScale(image,world,cam,f.W,f.H)>1.3,'fixture still exercises the world-scale error');
});

test('dial faces the camera on both real wrists', ()=>{
  for(const key of ['phone_wrist_dark','phone_wrist_bent'])assert.ok(solve(F[key],null).pose.dialFacing>.5,key);
});

test('forearm is found on the bent-wrist frame and aligns the watch to the arm, not the fist', ()=>{
  const f=F.phone_wrist_bent,{fa,pose}=solve(f,pixels(f));
  assert.ok(fa,'forearm detected');
  assert.ok(angleDiff(deg(fa.dir),f.truth.forearmDeg)<8,`forearm ${deg(fa.dir).toFixed(1)}°`);
  assert.ok(Math.abs(fa.widthPx*f.W/f.sample[0]-f.truth.armWidth)<.18*f.truth.armWidth,'arm width');
  assert.ok(pose.aligned&&angleDiff(deg(pose.axes.X),f.truth.forearmDeg)<10,`watch axis ${deg(pose.axes.X).toFixed(1)}°`);
  const [tx,ty]=f.truth.armCentreAtX,dy=pose.y+(tx-pose.x)*Math.tan(deg(pose.axes.X)*Math.PI/180)-ty;
  assert.ok(Math.abs(dy)<.15*f.truth.armWidth,`centre off the arm axis by ${dy.toFixed(0)}px`);
});

test('forearm detection is rotation invariant', ()=>{
  const f=F.phone_wrist_bent,a=solve(f,pixels(f)).fa,r=rotate(f,pixels(f)),b=solve(r.f,r.pix).fa;
  assert.ok(a&&b,'detected in both orientations');
  assert.ok(angleDiff(deg(b.dir),deg(a.dir)+90)<6,`${deg(a.dir).toFixed(1)}° vs ${deg(b.dir).toFixed(1)}°`);
});

test('a dark underside against a skin-coloured background is rejected, and the fallback stays on the arm', ()=>{
  const f=F.phone_wrist_dark,{fa,pose}=solve(f,pixels(f));
  // Either no forearm (fall back to the hand) or a correct one; never a confident wrong direction.
  if(fa)assert.ok(angleDiff(deg(fa.dir),f.truth.forearmDeg)<10,`wrong forearm ${deg(fa.dir).toFixed(1)}°`);
  const [tx,ty]=f.truth.armCentreAtX,dy=pose.y+(tx-pose.x)*Math.tan(deg(pose.axes.X)*Math.PI/180)-ty;
  assert.ok(Math.abs(dy)<.15*f.truth.armWidth,`centre off the arm by ${dy.toFixed(0)}px`);
  assert.ok(angleDiff(deg(pose.axes.X),f.truth.forearmDeg)<16,`axis ${deg(pose.axes.X).toFixed(1)}°`);
});

// Small rotations about the frame centre (bilinear resampling), like a hand-held phone moving between frames.
function tilt(f,pix,degrees){
  const [w,h]=f.sample,out=new Uint8ClampedArray(pix.length),a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a),cx=w/2,cy=h/2;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const sx=c*(x-cx)+s*(y-cy)+cx,sy=-s*(x-cx)+c*(y-cy)+cy,x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0,d=(y*w+x)*4;
    if(x0<0||y0<0||x0>=w-1||y0>=h-1){out[d+3]=255;continue;}
    for(let k=0;k<4;k++){const i=(y0*w+x0)*4+k,j=i+w*4;out[d+k]=(pix[i]*(1-fx)+pix[i+4]*fx)*(1-fy)+(pix[j]*(1-fx)+pix[j+4]*fx)*fy;}
  }
  const map=([nx,ny,nz])=>{const x=nx*f.W-f.W/2,y=ny*f.H-f.H/2;return [(c*x-s*y+f.W/2)/f.W,(s*x+c*y+f.H/2)/f.H,nz];};
  return {f:{...f,image:f.image.map(map),world:f.world.map(([x,y,z])=>[c*x-s*y,s*x+c*y,z]),truth:{...f.truth,forearmDeg:f.truth.forearmDeg+degrees}},pix:out};
}

test('no confident wrong forearm under hand-held jitter', ()=>{
  let bentFound=0;
  for(const key of ['phone_wrist_dark','phone_wrist_bent'])for(const d of [-6,-3,3,6]){
    const t=tilt(F[key],pixels(F[key]),d),{fa}=solve(t.f,t.pix);
    if(fa)assert.ok(angleDiff(deg(fa.dir),t.f.truth.forearmDeg)<10,`${key} @${d}°: forearm ${deg(fa.dir).toFixed(1)}° vs ${t.f.truth.forearmDeg}°`);
    if(key==='phone_wrist_bent'&&fa)bentFound++;
  }
  assert.ok(bentFound>=3,`bent wrist detected in ${bentFound}/4 jittered frames`);
});

test('ring uses the same true scale and real-metre occluders', ()=>{
  const f=F.phone_wrist_bent,image=pts(f.image),world=pts(f.world);
  const ring=solveFingerPose({image,world,width:f.W,height:f.H,right:chiralityEvidence(world,f.label)>=0});
  assert.equal(ring.scale,handScale(image,world,fitCamera(image,world,f.W,f.H),f.W,f.H));
  assert.equal(ring.size.diameter,.0173);
  const c=ring.occluders[0],len=Math.hypot(c.b.x-c.a.x,c.b.y-c.a.y,c.b.z-c.a.z);
  assert.ok(len>.018&&len<.06,`proximal phalanx ${(len*100).toFixed(1)} cm`);
});

test('necklace sits between the shoulders and chin and faces the camera', ()=>{
  const n=F.phone_neck,p=solveNeckPose({shoulders:n.shoulders.map(([x,y])=>({x,y})),shouldersWorld:n.shouldersWorld.map(([x,y,z])=>({x,y,z})),chin:{x:n.chin[0],y:n.chin[1]},width:n.W,height:n.H});
  const chinY=n.chin[1]*n.H,shoulderY=(n.shoulders[0][1]+n.shoulders[1][1])/2*n.H;
  assert.ok(p.y>chinY&&p.y<shoulderY,'anchor between chin and shoulder line');
  assert.ok(p.dialFacing>.8,'necklace faces the camera');
  const shoulderPx=Math.hypot((n.shoulders[0][0]-n.shoulders[1][0])*n.W,(n.shoulders[0][1]-n.shoulders[1][1])*n.H);
  assert.ok(Math.abs(p.scale*.313-shoulderPx)<.05*shoulderPx,'scale from shoulder width');
});

test('a background-inflated arm measurement cannot balloon the strap', ()=>{
  // Phone photo 13: a skin-coloured curtain beside the arm made the silhouette ~1.3x too wide.
  assert.equal(wristSize(undefined,.074).width,.056,'1.32x measurement ignored');
  assert.equal(wristSize(undefined,.030).width,.056,'0.54x measurement ignored');
  assert.ok(Math.abs(wristSize(undefined,.061).width-.061)<1e-9,'consistent measurement used');
  const tape=wristSize(6.5);assert.ok(Math.abs(tape.circumference-6.5*.0254)<1e-6,'tape reading reproduced exactly');
});

test('S/M/L sizes are visibly different at real phone scale', ()=>{
  const pxPerM=3400; // measured on the user's phone frames
  const caseDiff=(SIZE_CHART.watches.sizes.L-SIZE_CHART.watches.sizes.S)*pxPerM;
  const bangleDiff=2*(bangleAxes(SIZE_CHART.bracelets.sizes.L).a-bangleAxes(SIZE_CHART.bracelets.sizes.S).a)*pxPerM;
  const ringDiff=(SIZE_CHART.rings.sizes.L-SIZE_CHART.rings.sizes.S)*pxPerM*1.8; // fingers are filmed closer
  const dropDiff=fitFor('necklaces','L').drop-fitFor('necklaces','S').drop;
  assert.ok(caseDiff>=25,`watch case S→L ${caseDiff.toFixed(0)}px`);
  assert.ok(bangleDiff>=30,`bangle S→L ${bangleDiff.toFixed(0)}px`);
  assert.ok(ringDiff>=15,`ring S→L ${ringDiff.toFixed(0)}px`);
  assert.ok(dropDiff*2650>=120,`pendant S→L ${(dropDiff*2650).toFixed(0)}px`);
  // The bangle oval really has the chosen inner circumference.
  const {a,b}=bangleAxes(.18),h=((a-b)/(a+b))**2,perimeter=Math.PI*(a+b)*(1+3*h/(10+Math.sqrt(4-3*h)));
  assert.ok(Math.abs(perimeter-.18)<.0005,`bangle perimeter ${(perimeter*100).toFixed(2)} cm`);
});

test('fit check compares each size with the body', ()=>{
  const wrist={wristCircumference:.16,wristWidth:.16/2.72};
  assert.equal(fitFor('bracelets','S',wrist).fit,'tight');
  assert.equal(fitFor('bracelets','M',wrist).fit,'fits');
  assert.equal(fitFor('bracelets','L',{wristCircumference:.15}).fit,'loose');
  const finger={fingerDiameter:.0173};
  assert.equal(fitFor('rings','S',finger).fit,'tight');
  assert.equal(fitFor('rings','M',finger).fit,'fits');
  assert.equal(fitFor('rings','L',finger).fit,'loose');
  assert.equal(fitFor('watches','L',wrist).fit,'fits');
  assert.ok(fitFor('necklaces','S').drop<0&&fitFor('necklaces','L').drop>0);
});
