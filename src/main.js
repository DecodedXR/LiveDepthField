import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getDepthEstimator } from './depth.js';

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
// the M2 blue-white glow tint so the pre-upload cloud renders exactly as M2 did.
// (Named `aColor`, not `color` — Three injects its own `color` attribute
// declaration when vertexColors is on, and we manage this one ourselves.)
const colors = new Float32Array(GRID * GRID * 3);
for (let i = 0; i < colors.length; i += 3) {
  colors[i] = 0.55;
  colors[i + 1] = 0.78;
  colors[i + 2] = 1.0;
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
    statusEl.textContent = 'Estimating depth…';
    const url = URL.createObjectURL(file);
    try {
      const { depth } = await estimator(url);
      applyDepthToCloud(depth, image);
    } finally {
      URL.revokeObjectURL(url);
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
  }
});

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Keep sprite pixel size stable across viewport / DPR changes.
  cloudMaterial.uniforms.uScale.value = renderer.domElement.height * 0.5;
}
window.addEventListener('resize', onResize);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
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
};
