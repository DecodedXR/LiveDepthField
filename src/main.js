import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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

    void main() {
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

      vec3 color = vec3( 0.55, 0.78, 1.0 ); // soft blue-white glow
      gl_FragColor = vec4( color * glow, a );
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
window.__app = { THREE, scene, camera, renderer, controls, getPointCount };
