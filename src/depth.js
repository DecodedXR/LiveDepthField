// ---------------------------------------------------------------------------
// Milestone 3: lazy loader for the Depth Anything V2 Small estimator.
//
// transformers.js is imported dynamically so the boot bundle stays lean and no
// model bytes move until the user actually uploads a photo — the ONLY runtime
// network call this app makes is this model-weight download (see CLAUDE.md).
//
// Confirmed output contract (STATUS.md, human checkpoint cleared 2026-07-03):
//   const { predicted_depth, depth } = await estimator(imageBlobOrUrl);
//   depth: RawImage — Uint8, 1 channel, input W×H, 0–255 min–max normalized,
//   RELATIVE depth where BRIGHTER = NEARER.
//
// Confirmed input contract (read from the installed 4.2.0 source, 2026-07-03 —
// pipelines/_base.js prepareImages → utils/image.js RawImage.read): the
// estimator accepts RawImage | string | URL | Blob | HTMLCanvasElement |
// OffscreenCanvas. A canvas goes through RawImage.fromCanvas (a synchronous
// getImageData) — the M4 webcam path feeds capture canvases directly.
// ---------------------------------------------------------------------------

const MODEL = 'onnx-community/depth-anything-v2-small';

let estimatorPromise = null;

// Returns (and caches) the depth-estimation pipeline. A failed load clears
// the cache so the next upload can retry (e.g. after a network blip during
// the weight download).
export function getDepthEstimator() {
  if (!estimatorPromise) {
    estimatorPromise = loadEstimator().catch((err) => {
      estimatorPromise = null;
      throw err;
    });
  }
  return estimatorPromise;
}

// Probe WebGPU BEFORE touching transformers.js and pick the device once.
// Try-webgpu-then-retry-wasm does NOT work on this library version: it chains
// every web session load through a module-private promise
// (`webInitChain = webInitChain.then(load)` in backends/onnx.js), so one
// rejected WebGPU init poisons the chain and every later session-create —
// including a WASM retry — rethrows the original error. `requestAdapter()`
// probes exactly the failure that occurs in practice (`navigator.gpu` present
// but no adapter, e.g. headless/software Chromium).
async function pickDevice() {
  if (navigator.gpu) {
    try {
      if (await navigator.gpu.requestAdapter()) return 'webgpu';
    } catch {
      // fall through to WASM
    }
    console.warn('[depth] WebGPU exposed but no adapter — using WASM (slower).');
  }
  return 'wasm';
}

async function loadEstimator() {
  const { pipeline } = await import('@huggingface/transformers');
  const device = await pickDevice();
  return pipeline('depth-estimation', MODEL, { device });
}

// Test hook (M4): swap in a fake estimator so the smoke tests can drive the
// photo/webcam paths without downloading the real model. Never called by app
// code — only via window.__app.__setEstimator.
export function _setEstimatorForTests(fake) {
  estimatorPromise = Promise.resolve(fake);
}
