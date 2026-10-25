// Juvia live try-on: MediaPipe tracking runs on this device; vto3d.js renders the product's 3D model on top.
const VTO_TARGET = { watches: 'wrist', bracelets: 'wrist', rings: 'finger', necklaces: 'neck' };
const VTO_COPY = {
  wrist: {
    text: 'Your camera finds your wrist and the piece follows every move, in real 3D.',
    tips: ['Hold your forearm across the frame, back of the wrist toward the camera', 'Keep your hand and lower forearm in view', 'Bright, even light makes metal look real'],
    search: 'Show your wrist and hand', size: 'Wrist circumference (inches)', sizeHelp: 'Wrap a soft tape around your wrist just below the bone and enter the reading.', range: [4, 10],
  },
  finger: {
    text: 'Your camera finds your ring finger and the ring stays on as you move.',
    tips: ['Hold your hand up with fingers slightly apart', 'Keep the ring finger and knuckles in view', 'Turn your hand slowly to see the stone from every side'],
    search: 'Show your hand with fingers apart', size: 'Ring finger circumference (inches)', sizeHelp: 'Wrap a strip of paper around the base of your ring finger, mark where it meets, and measure it.', range: [1.5, 3.6],
  },
  neck: {
    text: 'Face the camera and the necklace settles on your collarbone.',
    tips: ['Use the front camera at arm’s length', 'Keep your chin, neck and both shoulders in view', 'Move hair away from your neck'],
    search: 'Face the camera, shoulders in view', size: 'Neck circumference (inches)', sizeHelp: 'Measure around the base of your neck with a soft tape.', range: [10, 22],
  },
};
const VTO_MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models/';
const VTO_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
let vtoCategory = 'watches', vtoProducts = [], vtoSelected = null, vtoLoop = false, vtoRunId = 0, vtoStable = 0, vtoLocked = false;
let vtoFacingMode = 'user', vtoHandedness = '', vtoLastTs = 0, vtoStatusText = '', vtoLoggedRun = -1, vtoWatchdog = null;
let vtoShots = [], vtoLastSig = null, vtoLastShotAt = 0, vtoAutoCapture = true, vtoAutoCount = 0, vtoMeasurements = {};
let handLandmarker = null, faceLandmarker = null, poseLandmarker = null, vtoVisionPromise = null, vtoVisionKey = '', vtoFaceCache = null, vtoFrameNo = 0;
let vtoTorchTrack = null, vtoTorch = false, vtoBrightness = 255, vtoBrightTick = 0, vtoFitTipShown = false;
let accessoryAR = null, accessoryARPromise = null, vtoKindFor = null, vtoPendingId = null, vtoSizing = null, vtoFitText = '', vtoFitTick = 0;
const vtoTarget = () => VTO_TARGET[vtoCategory] || 'wrist';
const isTouch = () => matchMedia('(pointer:coarse)').matches;

// ---------- Product selection ----------
function renderVtoCats() {
  $('vtoCats').innerHTML = Object.entries(CATEGORY).map(([k, c]) =>
    `<button class="${k === vtoCategory ? 'active' : ''}" role="tab" aria-selected="${k === vtoCategory}" onclick="setVtoCategory('${k}')">${icon(c.icon)}${c.label}</button>`).join('');
}
// ---------- Sizes ----------
function pickTryOnSize(id, size) {
  chosenSize[id] = size; const p = vtoProducts.find(r => r.id === id) || vtoSelected;
  accessoryAR?.setSize(p.category, size); vtoFitText = ''; renderVtoSizes();
  toast(`Size ${size} · ${(SIZES[p.category].find(([s]) => s === size) || [])[1] || ''}`);
}
// Body size for the fit check: a soft-tape reading if saved, otherwise what the tracker measured.
function bodyMeasure() {
  const t = vtoTarget(), tape = vtoMeasurements[t], p = accessoryAR?.lastPose;
  if (t === 'wrist') { const c = tape ? tape * .0254 : p?.size?.circumference; return c ? { wristCircumference: c, wristWidth: c / 2.72 } : {}; }
  if (t === 'finger') { const d = tape ? tape * .0254 / Math.PI : p?.size?.diameter; return d ? { fingerDiameter: d } : {}; }
  return {};
}
function renderVtoSizes() {
  const p = vtoSelected;
  $('vtoSizes').innerHTML = p ? sizeChips(p, 'pickTryOnSize') : '';
  $('stageSizes').innerHTML = p ? sizeChips(p, 'pickTryOnSize', 'glass-sizes') : '';
  updateFit(true);
}
function updateFit(force) {
  const p = vtoSelected, f = p && vtoSizing?.fitFor(p.category, sizeOf(p), bodyMeasure());
  const text = f ? f.label : '', kind = f?.fit || '';
  if (!force && text + kind === vtoFitText) return; vtoFitText = text + kind;
  // Show the body size the fit check is using, so an exact tape reading is one tap away.
  const t = vtoTarget(), body = bodyMeasure();
  if (vtoMeasurements[t] == null && (body.wristCircumference || body.fingerDiameter)) {
    const cm = body.wristCircumference ? body.wristCircumference * 100 : body.fingerDiameter * Math.PI * 100;
    $('vtoMeasurementResult').textContent = `Estimated ${t === 'finger' ? 'ring finger' : 'wrist'} ${cm.toFixed(1)} cm (${(cm / 2.54).toFixed(1)} in) from your hand. Enter a soft-tape reading for an exact fit.`;
  }
  for (const id of ['vtoFit', 'stageFit']) { const el = $(id); el.textContent = text; el.className = 'fit-badge ' + kind; el.classList.toggle('hidden', !text); if (!force) { void el.offsetWidth; el.classList.add('bump'); } }
}
function vtoThumb(p) { return p.image ? `<img src="${esc(p.image)}" alt="">` : icon(CATEGORY[p.category]?.icon || 'cube'); }
function renderVtoProducts() {
  const empty = `<p class="fine" style="margin:4px 2px">No ${CATEGORY[vtoCategory].label.toLowerCase()} with a 3D model yet.</p>`;
  $('vtoList').innerHTML = vtoProducts.map(p => `<button class="prow ${p.id === vtoSelected?.id ? 'active' : ''}" onclick="selectVtoProduct(${p.id})"><span class="thumb">${vtoThumb(p)}</span><span><b>${esc(p.name)}</b><small>${money(p.price)}</small></span></button>`).join('') || empty;
  $('vtoCarousel').innerHTML = Object.entries(CATEGORY).filter(([k]) => k !== vtoCategory).map(([k, c]) => `<button class="car-item glass" onclick="setVtoCategory('${k}')" aria-label="Switch to ${c.label}"><span class="thumb">${icon(c.icon)}</span><span>${c.label}</span></button>`).join('');
  $('vtoCarousel').insertAdjacentHTML('afterbegin', vtoProducts.map(p => `<button class="car-item glass ${p.id === vtoSelected?.id ? 'active' : ''}" onclick="selectVtoProduct(${p.id})"><span class="thumb">${vtoThumb(p)}</span><span>${esc(p.name)}</span></button>`).join(''));
  renderVtoSizes();
}
async function initTryOn() {
  renderVtoCats(); updateIntro(); updateMeasurementUI(); renderShots();
  window.Motion?.stagger('.tryon-panel > *', { y: 14, scale: .98, each: .07, delay: .08 });
  window.Motion?.stagger('#vtoIntro .intro-card > *', { y: 12, scale: .98, each: .06, delay: .1 });
  if (!vtoProducts.length || vtoProducts[0].category !== vtoCategory) await loadVtoProducts(vtoSelected?.id);
}
async function setVtoCategory(category, preferId) {
  const targetChanged = VTO_TARGET[category] !== vtoTarget();
  vtoCategory = category; renderVtoCats(); updateMeasurementUI();
  $('cameraGuide').className = 'camera-guide ' + vtoTarget();
  await loadVtoProducts(preferId);
  if (vtoLoop && targetChanged) {
    vtoStable = 0; setStatus('Switching tracker…');
    if (vtoTarget() === 'neck' && vtoFacingMode === 'environment') switchVtoCamera();
    ensureVision().catch(e => msg(e.message));
  }
}
async function loadVtoProducts(preferId) {
  try {
    const rows = await api('/products?category=' + encodeURIComponent(vtoCategory));
    vtoProducts = rows.filter(r => r.has_3d_asset);
    const want = preferId ?? vtoPendingId, pick = vtoProducts.find(p => p.id === want) || vtoProducts.find(p => p.id === vtoSelected?.id) || vtoProducts[0] || null;
    if (pick?.id === vtoPendingId) vtoPendingId = null;
    if (pick) await selectVtoProduct(pick.id); else { vtoSelected = null; renderVtoProducts(); updateIntro(); }
  } catch (e) { msg(e.message); }
}
async function getAR() {
  if (accessoryAR) return accessoryAR;
  accessoryARPromise ??= Promise.all([import('/modules/vto3d.js?v=9'), import('/modules/wristpose.js?v=8')]).then(([mod, sizing]) => { vtoKindFor = mod.kindFor; vtoSizing = sizing; accessoryAR = new mod.AccessoryAR($('vtoCanvas')); return accessoryAR; }).catch(e => { accessoryARPromise = null; throw e; });
  return accessoryARPromise;
}
async function selectVtoProduct(id) {
  const p = vtoProducts.find(r => r.id === id); if (!p) return;
  vtoSelected = p; renderVtoProducts(); updateIntro();
  $('stageProduct').textContent = p.name; $('stageCategory').textContent = CATEGORY[p.category].label + ' · ' + money(p.price);
  try {
    const url = p.asset_url || (await api('/products/' + p.id + '/asset')).url;
    const ar = await getAR(); if (vtoSelected?.id !== id) return;
    if (vtoLoop) setStatus('Loading ' + p.name + '…');
    vtoStable = 0; ar.setSize(p.category, sizeOf(p)); await ar.load(url, vtoKindFor(p.category)); renderVtoSizes();
  } catch { if (vtoSelected?.id === id) { setStatus('This 3D model could not be loaded.', 'error'); msg('This 3D model could not be loaded. Check that the file is a valid GLB.'); } }
}
async function chooseVtoProduct(id, category) {
  vtoPendingId = id;
  if (location.hash !== '#tryon') location.hash = 'tryon';
  await setVtoCategory(category, id);
  if (!vtoLoop && vtoSelected?.id === id) startVto();
  if (user) api('/history', { method: 'POST', body: { kind: 'product_view', detail: `try-on: ${vtoSelected?.name || 'product'} (product:${id})` } }).catch(() => {});
}
function updateIntro() {
  const c = CATEGORY[vtoCategory], copy = VTO_COPY[vtoTarget()];
  $('introEyebrow').textContent = c.label + ' · ' + c.target;
  $('introTitle').textContent = vtoSelected ? vtoSelected.name : 'Try it on live';
  $('introText').textContent = vtoSelected ? copy.text : `No ${c.label.toLowerCase()} with a 3D model are available yet.`;
  $('introTips').innerHTML = copy.tips.map(t => `<li>${icon('check')}<span>${esc(t)}</span></li>`).join('');
  $('vtoStart').disabled = !vtoSelected;
  const m = $('introModel');
  if (vtoSelected?.asset_url && m.dataset.src !== vtoSelected.asset_url) {
    m.dataset.src = vtoSelected.asset_url;
    m.innerHTML = `<model-viewer src="${esc(vtoSelected.asset_url)}" camera-orbit="${ORBIT[vtoSelected.category] || 'auto'}" ${ORIENT[vtoSelected.category] ? `orientation="${ORIENT[vtoSelected.category]}"` : ''} auto-rotate rotation-per-second="20deg" interaction-prompt="none" environment-image="neutral" exposure="1.1" disable-zoom></model-viewer>`;
  } else if (!vtoSelected) { m.dataset.src = ''; m.innerHTML = ''; }
  if (!vtoSelected) { $('stageProduct').textContent = 'Choose a piece'; $('stageCategory').textContent = 'Live try-on'; }
}

// ---------- Size ----------
function updateMeasurementUI() {
  const copy = VTO_COPY[vtoTarget()], value = vtoMeasurements[vtoTarget()];
  $('vtoMeasureLabel').textContent = copy.size; $('sizeLabel').textContent = copy.size; $('sizeHelp').textContent = copy.sizeHelp;
  $('vtoMeasurement').value = value ?? ''; $('sizeInput').value = value ?? '';
  $('vtoMeasurementResult').textContent = value == null ? 'Measure with a soft tape for an exact fit. Without it, Juvia estimates from your ' + (vtoTarget() === 'neck' ? 'shoulders.' : 'hand.') : `Fitted to your ${value} in reading. Pieces in the preview use this size.`;
}
function saveVtoMeasurement(raw = $('vtoMeasurement').value) {
  const value = Number(raw), [lo, hi] = VTO_COPY[vtoTarget()].range;
  if (!Number.isFinite(value) || value < lo || value > hi) return msg(`Enter a reading between ${lo} and ${hi} inches.`);
  vtoMeasurements[vtoTarget()] = Math.round(value * 10) / 10; updateMeasurementUI(); updateFit(true); toast('Size saved: ' + vtoMeasurements[vtoTarget()] + ' in');
}
function openSizeDialog() { updateMeasurementUI(); openDialog('sizeDialog'); }

// ---------- Camera ----------
async function startVto() {
  const runId = ++vtoRunId;
  if (!vtoSelected) return msg('Choose a piece to try on first.');
  $('vtoStart').disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs HTTPS and a current browser.');
    getAR().then(ar => { if (!ar.ready && ar.state !== 'loading') selectVtoProduct(vtoSelected.id); });
    stopCameraStream();
    const facing = vtoTarget() === 'neck' || !isTouch() ? 'user' : 'environment';
    enterLive(); setStatus('Allow camera access to start');
    const opened = await openVtoCamera(facing);
    if (runId !== vtoRunId) { opened.getTracks().forEach(t => t.stop()); return; }
    stream = opened; setStatus('Loading the tracker…');
    await ensureVision();
    if (runId !== vtoRunId) return;
    vtoLoop = true; vtoStable = 0; vtoLocked = false; vtoLastTs = 0;
    startWatchdog(runId); scheduleFrame(runId);
  } catch (e) {
    if (runId !== vtoRunId) return;
    stopVto();
    const denied = /denied|NotAllowed|permission/i.test(e.name + e.message);
    msg(denied ? 'Camera permission was denied. Allow camera access in your browser settings and try again.' : 'Try-on could not start: ' + e.message);
  } finally { $('vtoStart').disabled = !vtoSelected; }
}
async function openVtoCamera(mode, exact = false) {
  const facingMode = exact ? { exact: mode } : { ideal: mode };
  const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  const video = $('camera'); video.srcObject = next;
  try { await video.play(); } catch (e) { next.getTracks().forEach(t => t.stop()); video.srcObject = null; throw e; }
  const fit = () => { if (video.videoWidth) $('cameraWrap').style.setProperty('--ar', video.videoWidth + ' / ' + video.videoHeight); };
  video.addEventListener('loadedmetadata', fit, { once: true }); fit();
  // Report the camera that actually opened (a laptop has only a front camera).
  const actual = next.getVideoTracks()[0]?.getSettings?.().facingMode;
  vtoFacingMode = actual === 'environment' || actual === 'user' ? actual : mode;
  video.classList.toggle('rear-camera', vtoFacingMode === 'environment');
  setupTorch(next);
  return next;
}
// Camera light (torch): in dim rooms MediaPipe's landmarks get noisy and the arm's edges vanish, so a light
// improves tracking accuracy. Offered only where the camera reports the capability (usually the back camera).
function setupTorch(cameraStream) {
  const track = cameraStream.getVideoTracks()[0]; let caps = {};
  try { caps = track?.getCapabilities?.() || {}; } catch {}
  vtoTorchTrack = caps.torch ? track : null; vtoTorch = false;
  const button = $('vtoTorch'); button.classList.toggle('hidden', !vtoTorchTrack); button.classList.remove('on'); button.setAttribute('aria-pressed', 'false');
}
async function toggleTorch() {
  if (!vtoTorchTrack) return;
  const next = !vtoTorch;
  try {
    await vtoTorchTrack.applyConstraints({ advanced: [{ torch: next }] });
    vtoTorch = next; $('vtoTorch').classList.toggle('on', next); $('vtoTorch').setAttribute('aria-pressed', String(next));
    toast(next ? 'Light on' : 'Light off');
  } catch { msg('This camera cannot turn its light on'); }
}
// Average brightness of the live frame, sampled tiny and rarely (every 30 frames) so it costs nothing.
const vtoBrightCanvas = document.createElement('canvas'); vtoBrightCanvas.width = 32; vtoBrightCanvas.height = 18;
function measureBrightness(frame) {
  if (++vtoBrightTick % 30) return;
  try {
    const g = vtoBrightCanvas.getContext('2d', { willReadFrequently: true }); g.drawImage(frame, 0, 0, 32, 18);
    const d = g.getImageData(0, 0, 32, 18).data; let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2];
    vtoBrightness = sum / (d.length / 4);
  } catch {}
}
async function switchVtoCamera() {
  if (!vtoLoop || !stream) return;
  const previous = vtoFacingMode, next = previous === 'user' ? 'environment' : 'user', button = $('vtoSwitch');
  button.disabled = true; vtoStable = 0; setStatus('Switching camera…'); stopCameraStream();
  try { stream = await openVtoCamera(next, true); vtoLastTs = 0; toast(next === 'user' ? 'Front camera' : 'Back camera'); }
  catch {
    try { stream = await openVtoCamera(previous); toast('Only one camera is available on this device'); }
    catch (e) { stopVto(); msg('Could not switch cameras: ' + e.message); }
  } finally { button.disabled = false; }
}
function stopCameraStream() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } $('camera').srcObject = null; }
function enterLive() {
  window.Motion?.freeze(); document.body.classList.add('tryon-live');
  $('vtoIntro').classList.add('hidden'); $('stageBottom').classList.remove('hidden'); $('vtoStop').classList.remove('hidden'); $('vtoStep').classList.remove('hidden');
  $('cameraGuide').className = 'camera-guide show ' + vtoTarget(); renderVtoProducts();
}
function stopVto() {
  vtoLoop = false; vtoRunId++; vtoLocked = false; vtoStable = 0; clearInterval(vtoWatchdog);
  stopCameraStream(); accessoryAR?.hide(); $('vtoCanvas').style.visibility = 'hidden'; $('vtoFrame').style.visibility = 'hidden'; $('cameraWrap').classList.remove('synced');
  document.body.classList.remove('tryon-live', 'vto-locked');
  $('vtoIntro').classList.remove('hidden'); $('stageBottom').classList.add('hidden'); $('vtoStop').classList.add('hidden'); $('vtoStep').classList.add('hidden');
  $('cameraGuide').className = 'camera-guide ' + vtoTarget(); vtoStatusText = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && vtoLoop) stopVto(); });
function startWatchdog(runId) {
  clearInterval(vtoWatchdog); let since = 0;
  vtoWatchdog = setInterval(() => {
    if (runId !== vtoRunId) return clearInterval(vtoWatchdog);
    const v = $('camera');
    if (v.readyState >= 2 && v.videoWidth) { since = 0; return; }
    since ||= performance.now(); setStatus('Waiting for the camera preview…');
    if (performance.now() - since > 12000) { stopVto(); msg('The camera opened but sent no video. Check the site camera permission and try again.'); }
  }, 1000);
}

// ---------- Trackers ----------
async function ensureVision() {
  const key = vtoTarget() === 'neck' ? 'neck' : 'hand';
  if (vtoVisionPromise && vtoVisionKey === key) return vtoVisionPromise;
  if (vtoVisionPromise) try { await vtoVisionPromise; } catch {}
  for (const m of [handLandmarker, faceLandmarker, poseLandmarker]) m?.close();
  handLandmarker = faceLandmarker = poseLandmarker = null; vtoFaceCache = null;
  const load = (async () => {
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks(VTO_WASM);
    const create = async delegate => {
      const models = {};
      try {
        if (key === 'neck') {
          models.face = await vision.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: VTO_MODEL_BASE + 'face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate }, runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5 });
          models.pose = await vision.PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: VTO_MODEL_BASE + 'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .5 });
        } else models.hand = await vision.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: VTO_MODEL_BASE + 'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate }, runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: .55, minHandPresenceConfidence: .55, minTrackingConfidence: .55 });
        return models;
      } catch (e) { Object.values(models).forEach(m => m.close()); throw e; }
    };
    try { return await create('GPU'); } catch { return await create('CPU'); }
  })();
  vtoVisionKey = key; vtoVisionPromise = load;
  let timer;
  try {
    const models = await Promise.race([load, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The tracker did not load within 45 seconds. Check your connection and try again.')), 45000); })]);
    if (vtoVisionPromise === load) { handLandmarker = models.hand || null; faceLandmarker = models.face || null; poseLandmarker = models.pose || null; }
    return models;
  } catch (e) { if (vtoVisionPromise === load) { vtoVisionPromise = null; vtoVisionKey = ''; } throw e; }
  finally { clearTimeout(timer); }
}
const visionReady = () => vtoTarget() === 'neck' ? !!(faceLandmarker && poseLandmarker && vtoVisionKey === 'neck') : !!(handLandmarker && vtoVisionKey === 'hand');

// ---------- Per-frame loop ----------
function scheduleFrame(runId) {
  const video = $('camera'), next = () => { if (!vtoLoop || runId !== vtoRunId) return; processFrame(); scheduleFrame(runId); };
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(next); else requestAnimationFrame(next);
}
// The frame MediaPipe analyses is the frame on screen: each camera frame is copied to #vtoFrame, tracked,
// and drawn together with its accessory in the same task, so the piece cannot lag or drift off the body
// while it moves (the live <video> would already show a newer frame than the one the landmarks describe).
let vtoFrameCtx = null;
function captureFrame() {
  const video = $('camera'), canvas = $('vtoFrame'); if (video.readyState < 2 || !video.videoWidth) return null;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; vtoFrameCtx = null; }
  vtoFrameCtx ??= canvas.getContext('2d', { alpha: false });
  vtoFrameCtx.drawImage(video, 0, 0); return canvas;
}
function processFrame() {
  const frame = captureFrame(); if (!frame || !placeLayers()) return;
  measureBrightness(frame);
  if (!visionReady()) return;
  const ts = Math.max(performance.now(), vtoLastTs + 1); vtoLastTs = ts;
  let status;
  try { status = frameStatus(vtoTarget(), ts, frame); } catch (e) { stopVto(); msg('Tracking stopped: ' + e.message); return; }
  const pose = status.found ? renderAccessory(status, frame) : (accessoryAR?.miss(), null);
  vtoStable = status.ready ? Math.min(vtoStable + 1, 30) : 0;
  const locked = vtoStable >= 5 && !!pose;
  if (locked && !vtoLocked) { navigator.vibrate?.(10); if (user && vtoLoggedRun !== vtoRunId) { vtoLoggedRun = vtoRunId; api('/history', { method: 'POST', body: { kind: 'try_on', detail: `${vtoSelected?.name || 'Piece'} on your ${CATEGORY[vtoCategory].target.toLowerCase()}` } }).catch(() => {}); } }
  if (locked !== vtoLocked) document.body.classList.toggle('vto-locked', locked);
  vtoLocked = locked;
  const guide = $('cameraGuide'); guide.classList.toggle('show', !locked); guide.classList.toggle('near', status.found && !locked); guide.classList.toggle('locked', locked);
  updateLiveStatus(status, pose, locked);
  if (locked && ++vtoFitTick % 15 === 0) updateFit();
  if (locked) maybeAutoCapture(status, ts);
}
function frameStatus(target, ts, video) {
  if (target === 'neck') {
    if (!vtoFaceCache || vtoFrameNo++ % 2 === 0) vtoFaceCache = faceLandmarker.detectForVideo(video, ts).faceLandmarks?.[0] || [];
    const result = poseLandmarker.detectForVideo(video, ts), pose = result.landmarks?.[0] || [], world = result.worldLandmarks?.[0] || [], face = vtoFaceCache;
    if (!face.length) return { found: false, guidance: 'Face the camera so your face and neck are visible' };
    const faceWidth = Math.abs(face[454].x - face[234].x), faceCenter = (face[454].x + face[234].x) / 2, chin = face[152];
    const left = pose[11], right = pose[12], vis = p => p ? (p.visibility ?? p.presence ?? 0) : 0;
    let ready = false, guidance;
    if (faceCenter < .15 || faceCenter > .85 || chin.y < .06 || chin.y > .75) guidance = 'Centre your face in the frame';
    else if (faceWidth > .62) guidance = 'Move the phone a little farther away';
    else if (!left || !right || vis(left) < .35 || vis(right) < .35) guidance = 'Move back so both shoulders are visible';
    else if ((left.y + right.y) / 2 < chin.y + .05) guidance = 'Show your neck between chin and shoulders';
    else { ready = true; guidance = 'Looking good'; }
    const yaw = Math.atan2((face[234].x + face[454].x) / 2 - face[1].x, Math.max(.01, faceWidth * .5));
    return { found: true, ready, guidance, signature: { type: 'angle', value: yaw }, chin, shoulders: left && right ? [left, right] : null, shouldersWorld: world[11] && world[12] ? [world[11], world[12]] : null, box: [chin.x - faceWidth * .9, chin.y - faceWidth * .35, chin.x + faceWidth * .9, chin.y + faceWidth * 1.1] };
  }
  const result = handLandmarker.detectForVideo(video, ts), points = result.landmarks?.[0] || [];
  const hand = (result.handedness || result.handednesses)?.[0]?.[0]; if (hand?.categoryName) vtoHandedness = hand.categoryName;
  if (points.length !== 21) return { found: false, guidance: VTO_COPY[target].search };
  const xs = points.map(p => p.x), ys = points.map(p => p.y), span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const world = result.worldLandmarks?.[0]?.length === 21 ? result.worldLandmarks[0].map(p => ({ x: p.x, y: p.y, z: p.z })) : null;
  const image = points.map(p => ({ x: p.x, y: p.y, z: p.z }));
  let ready = false, guidance, signature;
  if (target === 'finger') {
    const ring = points.slice(13, 17), len = Math.hypot(ring[3].x - ring[0].x, ring[3].y - ring[0].y), cx = ring.reduce((s, p) => s + p.x, 0) / 4, cy = ring.reduce((s, p) => s + p.y, 0) / 4;
    if (cx < .08 || cx > .92 || cy < .08 || cy > .92) guidance = 'Bring your ring finger into the frame';
    else if (len < .09) guidance = 'Move your hand closer';
    else if (span > .95) guidance = 'Move your hand a little farther away';
    else { ready = true; guidance = 'Looking good'; }
    signature = { type: 'angle', value: Math.atan2(ring[3].y - ring[0].y, ring[3].x - ring[0].x) };
  } else {
    const wrist = points[0], palm = { x: (points[5].x + points[17].x) / 2, y: (points[5].y + points[17].y) / 2 };
    if (wrist.x < .04 || wrist.x > .96 || wrist.y < .04 || wrist.y > .96) guidance = 'Bring your wrist into the frame';
    else if (span < .16) guidance = 'Move your hand closer';
    else if (span > .9) guidance = 'Move your hand a little farther away';
    else if (Math.hypot(wrist.x - palm.x, wrist.y - palm.y) < .07) guidance = 'Show your wrist and the base of your palm';
    else { ready = true; guidance = 'Looking good'; }
  }
  if (!signature && world) {
    const a = { x: world[5].x - world[0].x, y: world[5].y - world[0].y, z: world[5].z - world[0].z }, b = { x: world[17].x - world[0].x, y: world[17].y - world[0].y, z: world[17].z - world[0].z };
    const n = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }, l = Math.hypot(n.x, n.y, n.z) || 1;
    signature = { type: 'normal', x: n.x / l, y: n.y / l, z: n.z / l };
  }
  const used = target === 'finger' ? points.slice(9, 18) : points, ux = used.map(p => p.x), uy = used.map(p => p.y);
  return { found: true, ready, guidance, image, world, handedness: vtoHandedness, signature, box: [Math.min(...ux), Math.min(...uy), Math.max(...ux), Math.max(...uy)] };
}
// Both canvases use the video element's own box and object-fit, so landmarks in frame pixels land on the
// same screen pixels for any aspect ratio, and a front camera is mirrored identically for frame and piece.
function placeLayers() {
  const video = $('camera'), wrapEl = $('cameraWrap'), rect = video.getBoundingClientRect(), wrap = wrapEl.getBoundingClientRect();
  const vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh || !rect.width || !rect.height) return false;
  const fit = getComputedStyle(video).objectFit, scale = fit === 'cover' ? Math.max(rect.width / vw, rect.height / vh) : Math.min(rect.width / vw, rect.height / vh);
  const w = vw * scale, h = vh * scale, left = rect.left - wrap.left + (rect.width - w) / 2, top = rect.top - wrap.top + (rect.height - h) / 2;
  const box = { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px', transform: vtoFacingMode === 'user' ? 'scaleX(-1)' : 'none', visibility: 'visible' };
  Object.assign($('vtoFrame').style, box); wrapEl.classList.add('synced');
  if (accessoryAR) { Object.assign($('vtoCanvas').style, box); accessoryAR.resize(w, h, vw, vh); }
  return true;
}
function renderAccessory(status, frame) {
  if (!accessoryAR?.ready || !vtoSelected) { accessoryAR?.hide(); return null; }
  const tape = vtoMeasurements[vtoTarget()];
  return accessoryAR.update({ video: frame, width: frame.width, height: frame.height, image: status.image, world: status.world, handedness: status.handedness, chin: status.chin, shoulders: status.shoulders, shouldersWorld: status.shouldersWorld, tapeInches: tape == null ? undefined : Number(tape) });
}
function setStatus(text, kind = '') {
  const el = $('vtoStep'); if (vtoStatusText === text + kind) return; vtoStatusText = text + kind;
  el.textContent = text; el.className = 'status-pill ' + kind;
}
function updateLiveStatus(status, pose, locked) {
  if (!accessoryAR?.ready) return setStatus(accessoryAR?.state === 'error' ? 'This 3D model could not be loaded' : 'Loading the 3D piece…', accessoryAR?.state === 'error' ? 'error' : 'adjust');
  const dark = vtoBrightness < 62;
  if (!status.found) return setStatus(dark ? (vtoTorchTrack && !vtoTorch ? 'Too dark to see clearly · tap the light' : 'Too dark · move to a brighter spot') : VTO_COPY[vtoTarget()].search, dark ? 'adjust' : '');
  if (locked && !vtoFitTipShown && vtoMeasurements[vtoTarget()] == null && vtoTarget() !== 'neck') {
    vtoFitTipShown = true; setTimeout(() => toast(`For an exact fit, tap the ruler and add your ${vtoTarget() === 'finger' ? 'ring finger' : 'wrist'} size`), 1800);
  }
  if (!status.ready) return setStatus(status.guidance, 'adjust');
  if (!locked) return setStatus(dark && vtoTorchTrack && !vtoTorch ? 'Low light · tap the light for steadier tracking' : 'Hold still…', 'adjust');
  const t = vtoTarget(), away = pose && pose.dialFacing < -.35;
  if (t === 'wrist' && away) return setStatus(vtoCategory === 'watches' ? 'Turn your wrist to see the dial' : 'Turn your wrist toward the camera', 'locked');
  if (t === 'finger' && away) return setStatus('Turn your hand to see the stone', 'locked');
  setStatus(vtoAutoCapture && vtoAutoCount < 6 ? 'Looking good · turn for more angles' : 'Looking good · move naturally', 'locked');
}

// ---------- Photos ----------
function isNewView(sig) {
  if (!sig) return false; if (!vtoLastSig) return true;
  if (sig.type === 'normal' && vtoLastSig.type === 'normal') return Math.acos(Math.max(-1, Math.min(1, sig.x * vtoLastSig.x + sig.y * vtoLastSig.y + sig.z * vtoLastSig.z))) > Math.PI / 6;
  if (sig.type === 'angle' && vtoLastSig.type === 'angle') return Math.abs(((sig.value - vtoLastSig.value + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > Math.PI / 8;
  return true;
}
function maybeAutoCapture(status, ts) {
  if (!vtoAutoCapture || vtoAutoCount >= 6 || ts - vtoLastShotAt < 1500 || vtoStable < 10 || !isNewView(status.signature)) return;
  const frame = $('vtoFrame'), vw = frame.width, vh = frame.height, p = accessoryAR?.lastPose;
  let [x1, y1, x2, y2] = status.box;
  // Include the rendered piece (a watch sits on the forearm, outside the hand's landmarks).
  if (p) { const r = { wrist: .034, finger: .014, neck: .09 }[vtoTarget()] * p.scale; x1 = Math.min(x1, (p.x - r) / vw); x2 = Math.max(x2, (p.x + r) / vw); y1 = Math.min(y1, (p.y - r) / vh); y2 = Math.max(y2, (p.y + r) / vh); }
  const pad = Math.max(x2 - x1, y2 - y1) * .18;
  x1 = Math.max(0, (x1 - pad) * vw); y1 = Math.max(0, (y1 - pad) * vh); x2 = Math.min(vw, (x2 + pad) * vw); y2 = Math.min(vh, (y2 + pad) * vh);
  const canvas = accessoryAR.composite(frame, vtoFacingMode === 'user', [x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1)]); if (!canvas) return;
  vtoLastSig = status.signature; vtoLastShotAt = ts; vtoAutoCount++;
  addShot(canvas.toDataURL('image/jpeg', .9), 'Angle ' + vtoAutoCount); toast('New angle saved');
}
function captureLook() {
  const frame = $('vtoFrame'); if (!vtoLoop || !frame.width) return;
  const canvas = accessoryAR ? accessoryAR.composite(frame, vtoFacingMode === 'user') : null; if (!canvas) return;
  const flash = $('flash'); flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go'); navigator.vibrate?.(20);
  addShot(canvas.toDataURL('image/jpeg', .92), 'Photo'); toast('Photo saved');
}
function addShot(url, label) { vtoShots.unshift({ url, label, product: vtoSelected?.name || '' }); renderShots(); }
function renderShots() {
  $('vtoViewCount').textContent = vtoShots.length || '';
  $('vtoShots').innerHTML = vtoShots.map((s, i) => `<button class="shot" onclick="openLook(${i})" aria-label="Open ${esc(s.label)}"><img src="${s.url}" alt=""><small>${esc(s.label)}</small></button>`).join('');
  $('vtoShotsEmpty').classList.toggle('hidden', vtoShots.length > 0); $('vtoRetake').classList.toggle('hidden', !vtoShots.length);
  $('vtoGalleryBtn').innerHTML = vtoShots.length ? `<img src="${vtoShots[0].url}" alt="">` : icon('image');
}
function clearLooks() { vtoShots = []; vtoLastSig = null; vtoAutoCount = 0; renderShots(); closeDialog('photoDialog'); }
function openLooks() {
  if (!vtoShots.length) return toast('Tap the shutter to take a photo');
  $('photoBody').innerHTML = `<div class="dlg-pad" style="padding:18px"><h3 style="margin:4px 0 14px">Your photos</h3><div class="shots">${vtoShots.map((s, i) => `<button class="shot" onclick="openLook(${i})"><img src="${s.url}" alt=""><small>${esc(s.label)}</small></button>`).join('')}</div>
    <div class="photo-actions"><button class="btn ghost" onclick="clearLooks()">${icon('trash')}Clear all</button></div></div>`;
  openDialog('photoDialog');
}
function openLook(i) {
  const s = vtoShots[i]; if (!s) return;
  $('photoBody').innerHTML = `<img src="${s.url}" alt="${esc(s.label)}"><div class="photo-actions">
    <a class="btn gold" href="${s.url}" download="juvia-${(s.product || 'try-on').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${i + 1}.jpg">${icon('download')}Save</a>
    ${navigator.share ? `<button class="btn ghost" onclick="shareLook(${i})">${icon('share')}Share</button>` : ''}
    <button class="btn ghost" onclick="vtoShots.splice(${i},1);renderShots();closeDialog('photoDialog')">${icon('trash')}Delete</button></div>`;
  openDialog('photoDialog');
}
async function shareLook(i) {
  try {
    const s = vtoShots[i], blob = await (await fetch(s.url)).blob(), file = new File([blob], 'juvia-try-on.jpg', { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: s.product || 'Juvia try-on' });
    else await navigator.share({ title: 'Juvia try-on', text: 'Trying on ' + (s.product || 'a Juvia piece'), url: location.origin });
  } catch (e) { if (e.name !== 'AbortError') msg('Sharing is not available here'); }
}
