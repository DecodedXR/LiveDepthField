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

// Milestone 5: the device pickDevice() chose, kept so the UI can surface the
// WASM fallback to the user (M3/M4 only console.warned). null until a load
// has picked one.
let selectedDevice = null;

export function getSelectedDevice() {
  return selectedDevice;
}

// Milestone 8: model-download progress. pipeline() wraps any progress_callback
// in DefaultProgressCallback (utils/core.js, confirmed from the installed
// 4.2.0 source), which emits aggregate `progress_total` events — progress is
// 0–100 across ALL weight files — alongside the raw per-file events. We
// filter for the aggregate here, in one place for both device paths: the
// WebGPU (main-thread) pipeline gets emitProgress directly; the WASM worker
// relays its events over the bridge (see createWorkerEstimator).
let onProgress = null;

export function setProgressHandler(fn) {
  onProgress = fn;
}

function emitProgress(event) {
  if (event && event.status === 'progress_total' && onProgress) {
    onProgress(event.progress);
  }
}

// Test seam: CI can't download the real model, so tests feed fake events
// through the same filter the real callbacks use.
export function _emitProgressForTests(event) {
  emitProgress(event);
}

// Returns (and caches) the depth-estimation pipeline. A failed load clears
// the cache so the next upload can retry (e.g. after a network blip during
// the weight download).
export function getDepthEstimator() {
  if (!estimatorPromise) {
    // Cache resets are guarded by promise identity: only the load that owns
    // the cache may clear it, so a test-installed fake (or a newer retry)
    // never gets clobbered by a stale load's failure or worker crash.
    const p = loadEstimator(() => resetCacheIf(p)).catch((err) => {
      resetCacheIf(p);
      throw err;
    });
    estimatorPromise = p;
  }
  return estimatorPromise;
}

function resetCacheIf(promise) {
  if (estimatorPromise === promise) estimatorPromise = null;
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

async function loadEstimator(resetCache) {
  const device = await pickDevice();
  selectedDevice = device;
  if (device === 'webgpu') {
    // WebGPU already computes off the main thread — keep the direct path.
    const { pipeline } = await import('@huggingface/transformers');
    // Stop forwarding progress once the load settles: pipeline() loads its
    // components via Promise.all, so a rejected component (→ 'Depth failed: …'
    // in #status) doesn't cancel a sibling download, whose surviving progress
    // events would otherwise overwrite the error forever (verifier finding).
    // The worker path is immune — fail() terminates the worker.
    let settled = false;
    const p = pipeline('depth-estimation', MODEL, {
      device,
      progress_callback: (e) => {
        if (!settled) emitProgress(e);
      },
    });
    p.then(
      () => (settled = true),
      () => (settled = true),
    );
    return p;
  }
  // Milestone 6: on the WASM fallback the ONNX session blocks whatever thread
  // runs it (~4–11s/pass, M4 finding) — run it in a dedicated module worker so
  // orbit stays live during a pass. Splitting by device also keeps the
  // webInitChain poison quirk structurally impossible: the worker only ever
  // inits WASM, the main thread only ever inits WebGPU.
  return createWorkerEstimator(resetCache);
}

// Spawn the depth worker and resolve to an estimator with the same call shape
// the direct pipeline has at our call sites: async (canvas) => { depth }.
// Callers pass a canvas (both call sites in main.js do); a canvas can't cross
// postMessage, so the bridge reads it back to ImageData here (synchronous,
// bounded by the M4 512px capture cap on the hot path) and transfers the
// pixel buffer to the worker. depth comes back as a plain { data, width,
// height } — exactly the subset of the RawImage contract applyDepthToCloud
// consumes. hud.timeEstimator wraps the returned function at the call sites,
// so the M5 readout measures this full round trip.
function createWorkerEstimator(resetCache) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./depth-worker.js', import.meta.url), {
      type: 'module',
    });
    const pending = new Map(); // id → { resolve, reject }
    let nextId = 0;
    let dead = null;

    // A worker failure (init or crash) kills this estimator for good: reject
    // everything in flight, terminate, and clear the module cache (identity-
    // guarded by the caller) so the next upload spawns a fresh worker — the
    // same retry semantics as a failed load.
    const fail = (err) => {
      dead = err;
      worker.terminate();
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      resetCache();
      reject(err); // no-op if 'ready' already resolved us
    };

    worker.addEventListener('error', (e) => {
      fail(new Error(e.message || 'depth worker crashed'));
    });
    worker.addEventListener('messageerror', () => {
      fail(new Error('depth worker message error'));
    });
    worker.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        emitProgress(msg.event);
      } else if (msg.type === 'ready') {
        resolve(estimatorFn);
      } else if (msg.type === 'init-error') {
        fail(new Error(msg.error));
      } else if (msg.type === 'result') {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve({ depth: { data: msg.data, width: msg.width, height: msg.height } });
      }
    });

    worker.postMessage({ type: 'init', model: MODEL });

    function estimatorFn(canvas) {
      if (dead) return Promise.reject(dead);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        worker.postMessage(
          { type: 'infer', id, data: img.data, width: img.width, height: img.height },
          [img.data.buffer],
        );
      });
    }
  });
}

// Test hook (M4): swap in a fake estimator so the smoke tests can drive the
// photo/webcam paths without downloading the real model. Never called by app
// code — only via window.__app.__setEstimator. M5: the optional `device` arg
// simulates the device pick (the real probe can't run meaningfully in CI) so
// tests can exercise the WASM-fallback warning.
export function _setEstimatorForTests(fake, device) {
  estimatorPromise = Promise.resolve(fake);
  selectedDevice = device ?? null;
}
