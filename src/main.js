import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  getDepthEstimator,
  getSelectedDevice,
  setProgressHandler,
  _setEstimatorForTests,
  _emitProgressForTests,
} from './depth.js';
import { initHud } from './hud.js';

// ---------------------------------------------------------------------------
// Live Depth Field — render/camera scaffold.
//
// This file stands up the Three.js pipeline and camera controls only. The
// actual point cloud is added per milestone (see STATUS.md). Right now the
// scene is intentionally empty so we can prove orbit/zoom/pan and resize work
// before any geometry or depth model exists.
// ---------------------------------------------------------------------------

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(0, 0, 3);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// ===========================================================================
// MILESTONE 1: a fake 128x128 point cloud (16,384 points) to prove the render
// pipeline and camera controls with real geometry. Grid on the XY plane,
// centered at the origin (-1..1 in X and Y) so it sits in front of the camera
// at z = 3; each point gets a random Z (-0.5..0.5) so the cloud has depth to
// orbit around.
// ===========================================================================
const GRID = 128; // 128 x 128 = 16,384 points
const positions = new Float32Array(GRID * GRID * 3);
for (let iy = 0; iy < GRID; iy++) {
  for (let ix = 0; ix < GRID; ix++) {
    const i = (iy * GRID + ix) * 3;
    positions[i] = (ix / (GRID - 1)) * 2 - 1; // x: -1..1
    positions[i + 1] = (iy / (GRID - 1)) * 2 - 1; // y: -1..1
    positions[i + 2] = Math.random() - 0.5; // z: -0.5..0.5
  }
}

const cloudGeometry = new THREE.BufferGeometry();
cloudGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

// Milestone 3: per-point color, sampled from the uploaded photo. Initialized to
// a phosphor-green glow tint — the app's black+green "coding" accent — so the
// pre-upload cloud reads as a terminal-green splat field. (Named `aColor`, not
// `color` — Three injects its own `color` attribute declaration when
// vertexColors is on, and we manage this one ourselves.)
const colors = new Float32Array(GRID * GRID * 3);
for (let i = 0; i < colors.length; i += 3) {
  colors[i] = 0.15;
  colors[i + 1] = 1.0;
  colors[i + 2] = 0.45;
}
cloudGeometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

// ===========================================================================
// MILESTONE 2: style the M1 cloud as Gaussian-splat-like sprites. A custom
// ShaderMaterial draws each point as a soft, round, additively-blended glow
// whose on-screen size grows as the point nears the camera (perspective size
// attenuation, mirroring PointsMaterial's sizeAttenuation). pointSize / glow /
// falloff are live uniforms wired to the sliders below. Still no depth model or
// upload — pure Three.js shading over the same 16,384-point geometry.
//
// ShaderMaterial injects the built-in `position`, `modelViewMatrix`, and
// `projectionMatrix` for us, so we only declare our own uniforms. `uScale` is
// half the drawing-buffer height (in device pixels) so gl_PointSize lands in
// framebuffer pixels regardless of viewport size / DPR; it is refreshed on
// resize.
// ===========================================================================
const cloudMaterial = new THREE.ShaderMaterial({
  uniforms: {
    // Defaults tuned (against a real production build) so the cloud reads as
    // thousands of distinct soft glowing splats with volumetric depth — bright
    // but not additively blown out to white. The sliders trade size/brightness/
    // softness from here. All three defaults sit on their slider step grids so
    // the thumbs match the initial uniform value exactly.
    pointSize: { value: 0.05 },
    glow: { value: 0.5 },
    falloff: { value: 2.2 },
    uScale: { value: (renderer.domElement.height || window.innerHeight) * 0.5 },
  },
  vertexShader: /* glsl */ `
    uniform float pointSize;
    uniform float uScale;
    attribute vec3 aColor;
    varying vec3 vColor;

    void main() {
      vColor = aColor;
      vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
      gl_Position = projectionMatrix * mvPosition;
      // Closer points (smaller -z) render larger, like splats. Clamp to keep a
      // point from vanishing or ballooning past sane GL point-size limits.
      gl_PointSize = clamp( pointSize * ( uScale / -mvPosition.z ), 1.0, 128.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float glow;
    uniform float falloff;
    varying vec3 vColor;

    void main() {
      // gl_PointCoord is 0..1 across the sprite; measure squared distance from
      // its center. r2 is 0 at the center and 0.25 at the inscribed-circle edge
      // (radius 0.5); the corners reach 0.5.
      vec2 uv = gl_PointCoord - 0.5;
      float r2 = dot( uv, uv );

      // Clip to that circle so the sprite is ALWAYS round, independent of
      // falloff. (An alpha-threshold discard would leave hard square corners at
      // low falloff, where even the corner alpha stays above the cutoff.)
      if ( r2 > 0.25 ) discard;

      // Soft Gaussian-ish radial falloff within the disc; r2*4 maps the edge to
      // 1.0 so the falloff uniform sets how quickly the glow fades to the rim.
      float a = exp( -falloff * ( r2 * 4.0 ) );

      // Per-point color (M3): the photo's pixel color, or the M2 blue-white
      // tint before any upload — the initial aColor fill carries that default.
      gl_FragColor = vec4( vColor * glow, a );
    }
  `,
  transparent: true,
  depthWrite: false, // additive glow: don't let sprites occlude one another
  blending: THREE.AdditiveBlending,
});

const cloud = new THREE.Points(cloudGeometry, cloudMaterial);
scene.add(cloud);

// Minimal live controls for the splat uniforms — plain range inputs (no extra
// dependency; dat.GUI would add one). Each slider drives one uniform.
function addSlider(parent, label, min, max, step, uniform) {
  const row = document.createElement('label');
  row.className = 'ctrl-row';
  const name = document.createElement('span');
  name.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(uniform.value);
  input.addEventListener('input', () => {
    uniform.value = parseFloat(input.value);
  });
  row.append(name, input);
  parent.appendChild(row);
}

const controlPanel = document.createElement('div');
controlPanel.id = 'controls';
addSlider(controlPanel, 'Size', 0.01, 0.25, 0.005, cloudMaterial.uniforms.pointSize);
addSlider(controlPanel, 'Glow', 0.0, 2.5, 0.01, cloudMaterial.uniforms.glow);
addSlider(controlPanel, 'Falloff', 0.5, 6.0, 0.1, cloudMaterial.uniforms.falloff);
document.body.appendChild(controlPanel);

// ===========================================================================
// MILESTONE 3: photo upload → one depth pass → depth-displaced, image-colored
// cloud through the M2 splat shader. The depth model runs once per upload;
// nothing here touches the rAF render loop — the handler is plain async event
// code, and the input is disabled while a pass is in flight (one job at a
// time, never a queue).
// ===========================================================================

// Z displacement span for the normalized 0–255 depth: ±0.5 world units, the
// same range the M1 random cloud used, so camera/orbit framing still fits.
const DEPTH_SCALE = 1.0;

// Map a depth map + photo onto the fixed GRID×GRID cloud.
//
// depth: the transformers.js `depth` RawImage contract — { data, width,
// height }, Uint8, 1 channel, 0–255 min–max normalized, BRIGHTER = NEARER
// (confirmed in STATUS.md). Sampled nearest-neighbor down to the grid: the
// point budget stays fixed at 16,384 regardless of photo size (30fps orbit
// constraint). Bright → +Z, toward the camera at z = 3.
//
// image: any CanvasImageSource; resampled to GRID×GRID for per-point color.
// Grid +Y is up but image row 0 is the top, so both depth and color sampling
// flip Y identically — keeping them aligned and the photo right-side up.
function applyDepthToCloud(depth, image) {
  const sample = document.createElement('canvas');
  sample.width = GRID;
  sample.height = GRID;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, GRID, GRID);
  const rgba = ctx.getImageData(0, 0, GRID, GRID).data;

  const pos = cloudGeometry.attributes.position;
  const col = cloudGeometry.attributes.aColor;
  const { data, width, height } = depth;
  for (let iy = 0; iy < GRID; iy++) {
    const rowFlip = GRID - 1 - iy; // grid row iy=GRID-1 is y=+1 → image row 0
    const py = Math.round((rowFlip / (GRID - 1)) * (height - 1));
    for (let ix = 0; ix < GRID; ix++) {
      const px = Math.round((ix / (GRID - 1)) * (width - 1));
      const i = iy * GRID + ix;
      pos.setZ(i, (data[py * width + px] / 255 - 0.5) * DEPTH_SCALE);
      const c = (rowFlip * GRID + ix) * 4;
      col.setXYZ(i, rgba[c] / 255, rgba[c + 1] / 255, rgba[c + 2] / 255);
    }
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;

  // Preserve the photo's aspect ratio by scaling the (square) cloud object —
  // the geometry itself stays a static -1..1 grid.
  const aspect = image.width && image.height ? image.width / image.height : 1;
  if (aspect >= 1) cloud.scale.set(1, 1 / aspect, 1);
  else cloud.scale.set(aspect, 1, 1);
}

const uploadRow = document.createElement('div');
uploadRow.className = 'ctrl-row';
const photoInput = document.createElement('input');
photoInput.type = 'file';
photoInput.id = 'photo-input';
photoInput.accept = 'image/*';
uploadRow.appendChild(photoInput);
controlPanel.appendChild(uploadRow);

const statusEl = document.createElement('div');
statusEl.id = 'status';
statusEl.textContent = 'Load a photo to see its depth field.';
controlPanel.appendChild(statusEl);

// M8: live model-download progress. depth.js emits the aggregate 0–100
// percentage (transformers.js `progress_total`) on both device paths; each
// call site's next status write ('Estimating depth…' / 'Starting webcam…')
// naturally ends the readout once the load resolves. Weights are cached
// after the first load, so later loads emit nothing (or an instant flash
// from the browser cache).
setProgressHandler((pct) => {
  statusEl.textContent = `Downloading depth model… ${Math.round(pct)}%`;
});

// ===========================================================================
// MILESTONE 5: polish readouts — FPS, per-pass inference time, and a
// user-visible warning when depth runs on the WASM fallback. All
// instrumentation lives in hud.js; the render loop and the M4 decoupling
// machinery below are untouched (the FPS meter runs its own rAF counter).
// ===========================================================================
const hud = initHud(controlPanel);

photoInput.addEventListener('change', async () => {
  const file = photoInput.files && photoInput.files[0];
  if (!file) return;
  photoInput.disabled = true;
  try {
    statusEl.textContent = 'Reading image…';
    let image;
    try {
      image = await createImageBitmap(file);
    } catch {
      statusEl.textContent = "Couldn't read that image — try a different file.";
      return;
    }
    statusEl.textContent = 'Loading depth model… (downloads once, then cached)';
    const estimator = await getDepthEstimator();
    hud.noteDevice(getSelectedDevice());
    statusEl.textContent = 'Estimating depth…';
    // M6: hand the estimator a canvas, not a blob URL — the one input type
    // valid on BOTH estimator paths (the direct pipeline reads canvases, and
    // the WASM worker bridge needs pixels it can post across the boundary; a
    // blob URL's reachability inside a worker is exactly the kind of
    // unverified assumption this repo forbids). Drawn at the photo's native
    // size, so depth resolution matches the pre-M6 URL path.
    const source = document.createElement('canvas');
    source.width = image.width;
    source.height = image.height;
    source.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0);
    try {
      const { depth } = await hud.timeEstimator(estimator)(source);
      applyDepthToCloud(depth, image);
    } finally {
      image.close();
    }
    statusEl.textContent = `Done — ${GRID}×${GRID} points from ${file.name}`;
  } catch (err) {
    // Model-load / inference failures land here. warn, not error: an expected,
    // user-visible failure state shouldn't trip the console.error smoke gate.
    console.warn('[depth] failed:', err);
    statusEl.textContent = `Depth failed: ${err && err.message ? err.message : err}`;
  } finally {
    photoInput.disabled = false;
    // Clear the selection so re-picking the SAME file fires `change` again —
    // otherwise a failed pass (e.g. network blip during the model download)
    // couldn't be retried without choosing a different file first.
    photoInput.value = '';
  }
});

// ===========================================================================
// MILESTONE 4: live webcam → continuous depth loop, DECOUPLED from render.
//
// The inference loop is a self-paced async function with exactly ONE pass in
// flight: capture the current video frame onto a canvas, await the estimator
// (the pipeline accepts a canvas directly — contract confirmed in depth.js),
// then POST the result as `pendingFrame`. Posting overwrites any unconsumed
// frame — drop, never queue. The rAF render loop CONSUMES the newest posted
// frame via applyDepthToCloud and never awaits anything, so orbit keeps
// running while inference is in flight. Frames the camera produces during a
// pass are simply never captured — dropped by construction.
//
// Two capture canvases alternate (ping-pong) so the canvas referenced by a
// posted-but-unconsumed frame is never being redrawn by the next capture.
// ===========================================================================
const MAX_CAPTURE = 512; // cap the longer video edge fed to the model

let webcamActive = false;
let webcamStream = null;
let pendingFrame = null; // newest completed { depth, image } — null once consumed

// Session identity. A bare boolean can't distinguish sessions: stop→start
// flips it back to true and retroactively "re-validates" a pass still in
// flight from the DEAD session — its result would apply, its loop resurrect
// (two passes in flight), and its rejection would tear down the live session.
// Every start and stop bumps the generation; a loop only acts while the
// generation it captured is still current.
let webcamGen = 0;

const webcamVideo = document.createElement('video');
webcamVideo.muted = true;
webcamVideo.playsInline = true;

const captureCanvases = [document.createElement('canvas'), document.createElement('canvas')];
let captureIndex = 0;

async function webcamLoop(estimator, gen) {
  while (gen === webcamGen) {
    const canvas = captureCanvases[(captureIndex ^= 1)];
    const vw = webcamVideo.videoWidth;
    const vh = webcamVideo.videoHeight;
    const s = Math.min(1, MAX_CAPTURE / Math.max(vw, vh));
    const cw = Math.max(1, Math.round(vw * s));
    const ch = Math.max(1, Math.round(vh * s));
    // Assigning width/height clears a canvas even when the value is unchanged
    // — only resize on a real dimension change (e.g. the camera rotates).
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    // willReadFrequently: the estimator reads this canvas back with
    // getImageData every pass (RawImage.fromCanvas). The FIRST getContext call
    // fixes the attribute, so setting it here covers the library's reads too.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(webcamVideo, 0, 0, cw, ch);
    const { depth } = await estimator(canvas);
    if (gen !== webcamGen) break; // session ended mid-pass: stale — drop it
    pendingFrame = { depth, image: canvas }; // overwrite = drop, never queue
    // Yield ONE rendered frame before the next pass. The estimator's promise
    // chain can settle entirely in microtasks (the WASM path does), and
    // microtask continuations starve rendering — without this, the loop spins
    // post→capture→infer with rAF never firing, so the posted depth is
    // overwritten forever and orbit freezes. One rAF tick guarantees the
    // posted frame is consumed and paces inference at ≤1 pass per frame.
    await new Promise((res) => requestAnimationFrame(res));
  }
}

function stopWebcam(message) {
  webcamGen++; // invalidate any in-flight pass from this session
  webcamActive = false;
  pendingFrame = null;
  if (webcamStream) {
    webcamStream.getTracks().forEach((t) => t.stop());
    webcamStream = null;
  }
  webcamVideo.srcObject = null;
  webcamBtn.textContent = 'Start webcam';
  webcamBtn.disabled = false;
  photoInput.disabled = false;
  statusEl.textContent = message;
}

async function startWebcam() {
  if (photoInput.disabled) {
    // A photo pass is mid-flight (it owns this flag while running) — the two
    // inputs share one estimator, so don't interleave jobs.
    statusEl.textContent = 'Wait for the current photo pass to finish.';
    return;
  }
  webcamBtn.disabled = true; // no double-start while permissions/model resolve
  photoInput.disabled = true;
  const gen = ++webcamGen; // this session's identity
  try {
    // Model BEFORE camera: the first-run weight download can take minutes and
    // the toggle is disabled while pending — never hold a hot camera with no
    // off switch during it.
    statusEl.textContent = 'Loading depth model… (downloads once, then cached)';
    const estimator = await getDepthEstimator();
    hud.noteDevice(getSelectedDevice());
    statusEl.textContent = 'Starting webcam…';
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
    webcamVideo.srcObject = webcamStream;
    await webcamVideo.play();
    if (!webcamVideo.videoWidth) {
      await new Promise((res) =>
        webcamVideo.addEventListener('loadedmetadata', res, { once: true }),
      );
    }
    webcamActive = true;
    webcamBtn.textContent = 'Stop webcam';
    webcamBtn.disabled = false;
    statusEl.textContent = 'Webcam live — newest depth wins; slow frames drop.';
    webcamLoop(hud.timeEstimator(estimator), gen).catch((err) => {
      // A rejection from a pass that outlived its session is a ghost — the
      // user already stopped (or restarted) — never tear down the live one.
      if (gen !== webcamGen) return;
      console.warn('[webcam] depth loop failed:', err);
      stopWebcam(`Webcam depth failed: ${err && err.message ? err.message : err}`);
    });
  } catch (err) {
    // Permission denied, no camera, or model-load failure: an expected,
    // user-visible state — warn (not error) and restore the idle UI.
    console.warn('[webcam] start failed:', err);
    stopWebcam(`Webcam failed: ${err && err.message ? err.message : err}`);
  }
}

const webcamRow = document.createElement('div');
webcamRow.className = 'ctrl-row';
const webcamBtn = document.createElement('button');
webcamBtn.id = 'webcam-toggle';
webcamBtn.type = 'button';
webcamBtn.textContent = 'Start webcam';
webcamBtn.addEventListener('click', () => {
  if (webcamActive) stopWebcam('Webcam stopped.');
  else startWebcam();
});
webcamRow.appendChild(webcamBtn);
controlPanel.insertBefore(webcamRow, statusEl);

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Keep sprite pixel size stable across viewport / DPR changes.
  cloudMaterial.uniforms.uScale.value = renderer.domElement.height * 0.5;
}
window.addEventListener('resize', onResize);

// Boot loading bar: dismiss the inline #boot-loader overlay (see index.html)
// once the app is actually up. It advances on its own CSS animation from the
// first paint; here we snap the fill to 100% and fade the overlay out, so the
// bar completes exactly when the app is ready rather than on a guessed timer.
// One-shot, fired after the first rendered frame.
let bootLoaderDismissed = false;
function dismissBootLoader() {
  const loader = document.getElementById('boot-loader');
  if (!loader) return;
  const fill = loader.querySelector('.boot-fill');
  if (fill) {
    // Stop the advance animation so the inline width wins, then let the width
    // transition carry it from wherever it reached up to a full 100%.
    fill.style.animation = 'none';
    fill.style.width = '100%';
  }
  loader.classList.add('boot-done'); // opacity → 0, pointer-events off
  // Remove after the fade so it never lingers over the UI or intercepts clicks.
  // Only the overlay's OWN opacity transition should trigger removal — a
  // transitionend from the fill's width tween bubbles up too and would cut the
  // fade short. The timeout is a fallback for when the fade is a no-op (e.g.
  // prefers-reduced-motion collapses its duration so transitionend may not fire).
  const remove = () => loader.remove();
  loader.addEventListener('transitionend', (e) => {
    if (e.target === loader && e.propertyName === 'opacity') remove();
  });
  setTimeout(remove, 600);
}

function animate() {
  requestAnimationFrame(animate);
  // M4: consume the newest completed depth frame, if one was posted by the
  // webcam inference loop. A plain null-check — render never waits on
  // inference, and anything older was already overwritten (dropped).
  if (pendingFrame) {
    const { depth, image } = pendingFrame;
    pendingFrame = null;
    applyDepthToCloud(depth, image);
  }
  controls.update();
  renderer.render(scene, camera);
  // First frame is on screen — tear down the boot loader.
  if (!bootLoaderDismissed) {
    bootLoaderDismissed = true;
    dismissBootLoader();
  }
}
animate();

// Debug/test hook: lets a headless smoke test introspect the scene graph
// without reading pixels. getPointCount() sums the vertices of every
// THREE.Points in the scene (0 until the cloud is added).
function getPointCount() {
  let n = 0;
  scene.traverse((o) => {
    if (o.isPoints && o.geometry?.attributes?.position) {
      n += o.geometry.attributes.position.count;
    }
  });
  return n;
}
window.__app = {
  THREE,
  scene,
  camera,
  renderer,
  controls,
  getPointCount,
  // M3: exposed so tests can drive the depth→cloud mapping with synthetic
  // data — the real model (a ~100MB download) can't run in CI.
  applyDepth: applyDepthToCloud,
  // M4: webcam-loop introspection for the smoke tests — a fake-estimator
  // injection point (the model still can't run in CI), the live flag, and the
  // hidden <video> so a test can watch the camera track get released.
  __setEstimator: _setEstimatorForTests,
  __getEstimator: getDepthEstimator,
  // M8: fake download-progress events for tests (the real download can't
  // run in CI); routes through the same progress_total filter as the real
  // callbacks.
  __emitProgress: _emitProgressForTests,
  webcamRunning: () => webcamActive,
  __webcamVideo: webcamVideo,
  // M5: HUD readouts, so tests can assert the meters against real values.
  getFps: hud.getFps,
  getLastInferenceMs: hud.getLastInferenceMs,
};
