// ---------------------------------------------------------------------------
// Milestone 6: dedicated module worker for WASM depth inference, so the main
// thread keeps rendering during a pass (on WASM the ONNX session blocks the
// thread that runs it — measured ~4–11s/pass in the M4 probe).
//
// transformers.js 4.2.0 runs here by design: env.js classifies
// DedicatedWorkerGlobalScope as a supported web env (IS_WEBWORKER_ENV), and
// RawImage(data, width, height, channels) is a plain field-assignment
// constructor exported from the package root — both confirmed from the
// installed source 2026-07-03.
//
// Protocol (all messages are plain objects):
//   main → worker  { type: 'init', model }
//   worker → main  { type: 'ready' } | { type: 'init-error', error }
//   main → worker  { type: 'infer', id, data, width, height }
//                  — RGBA ImageData pixels; the buffer arrives transferred.
//   worker → main  { type: 'result', id, data, width, height }   (Uint8 depth)
//                | { type: 'result', id, error }
//
// The depth result is structured-cloned, NOT transferred: its typed array
// comes out of the library's post-processing and we don't own its buffer's
// lifetime; a ~200KB copy per pass is negligible next to the pass itself.
//
// Only device:'wasm' ever initializes in this worker — the WebGPU path stays
// on the main thread (it already computes off-thread) — so the webInitChain
// poison quirk (see depth.js) cannot occur here.
// ---------------------------------------------------------------------------

let estimator = null;
let RawImageCtor = null;

function errMessage(err) {
  return err && err.message ? String(err.message) : String(err);
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      const { pipeline, RawImage } = await import('@huggingface/transformers');
      RawImageCtor = RawImage;
      estimator = await pipeline('depth-estimation', msg.model, { device: 'wasm' });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'init-error', error: errMessage(err) });
    }
    return;
  }
  if (msg.type === 'infer') {
    try {
      const image = new RawImageCtor(msg.data, msg.width, msg.height, 4);
      const { depth } = await estimator(image);
      self.postMessage({
        type: 'result',
        id: msg.id,
        data: depth.data,
        width: depth.width,
        height: depth.height,
      });
    } catch (err) {
      self.postMessage({ type: 'result', id: msg.id, error: errMessage(err) });
    }
  }
};
