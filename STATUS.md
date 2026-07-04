# STATUS — Live Depth Field

Single source of truth for "what's next." One milestone per PR/run. Autopilot:
pick the one task under **NEXT**, ship it, stop. Do **not** start anything under
**BLOCKED**.

_Last updated: 2026-07-03 — Milestone 6 (Web Worker WASM inference) done;
queue empty pending an M7 proposal._

---

## DONE

- **Milestone 0 — Bootstrap.** Repo flattened to root; Vite + Three.js 0.185
  scaffold; render/camera pipeline in `src/main.js` (empty scene, OrbitControls,
  resize, rAF loop); Playwright headless-WebGL smoke harness; two-job GitHub
  Actions CI (`build` + `smoke`). Baseline is green. The scaffold renders an
  empty scene on purpose — no point cloud yet.

- **Milestone 1 — Fake point cloud.** `src/main.js` builds a 128×128 grid
  (16,384 points) `THREE.BufferGeometry` on the XY plane — X/Y centered at the
  origin (-1..1), a random Z per point (-0.5..0.5) — wrapped in a `THREE.Points`
  with the default `THREE.PointsMaterial` (`size 0.03`) and added to the scene.
  Render loop, `OrbitControls`, resize handler, and the `getPointCount()` hook
  unchanged. Smoke test asserts `getPointCount() === 16384` with no page/console
  errors. Landed via **PR #2**; pre-change HEAD (rollback) `4b81157`.

- **Milestone 2 — Splat-style point aesthetic.** `src/main.js` replaces the M1
  `PointsMaterial` with a custom `THREE.ShaderMaterial`: a soft round
  (circular Gaussian alpha falloff, square corners discarded) additively-blended
  sprite per point, with perspective size-by-depth (`gl_PointSize` scaled by
  `uScale / -mvPosition.z`, `uScale` = half the drawing-buffer height, refreshed
  on resize). Tunable uniforms `pointSize` / `glow` / `falloff` are wired to
  plain HTML range sliders (a top-left `#controls` panel — no dat.GUI dependency
  added). Same 16,384-point geometry; render loop / `OrbitControls` / resize /
  `getPointCount()` hook intact. Smoke test asserts the cloud material is a
  `ShaderMaterial` with `AdditiveBlending` + the three uniforms and
  `getPointCount() === 16384`, no page/console errors (a shader compile error
  would surface as `console.error`). Proven non-tautological (RED on the M1
  `PointsMaterial` state). Pre-change HEAD (rollback) `7345f44`.

- **Milestone 3 — Photo input → depth → cloud.** File upload (`#photo-input` +
  `#status` line in the `#controls` panel) → Depth Anything V2 Small via
  transformers.js → depth-displaced, image-colored cloud through the M2 splat
  shader. `src/depth.js` lazy-loads the pipeline (dynamic import keeps the boot
  bundle unchanged; no model bytes until first upload) and picks the device
  **once up front** by probing `navigator.gpu.requestAdapter()` — WebGPU if an
  adapter exists, else WASM. (Sequential try-webgpu-then-wasm does NOT work on
  transformers.js 4.2.0: a rejected WebGPU init poisons the library's shared
  `webInitChain`, so any later session-create rethrows the same error.)
  `applyDepthToCloud` (exposed as `window.__app.applyDepth` for tests) samples
  the `depth` RawImage nearest-neighbor onto the fixed 128×128 grid —
  `z = (d/255 − 0.5)`, **bright = near = toward the camera** — colors each
  point from the photo (new `aColor` attribute; pre-upload tint = M2 look),
  flips depth+color Y identically, and preserves photo aspect via object
  scale. Input disabled while a pass runs (never queue); bad-file and
  model-load failures surface in `#status` (console.warn, not error). Z sign
  **verified empirically against the real model** (COCO cats photo: cats
  landed nearer than the couch backrest) per the mandatory acceptance
  criterion; WASM-fallback path exercised in the same run. Smoke tests: M3-A
  synthetic depth ramp → sign/color/point-budget asserts; M3-B non-image file
  → visible error state, no console errors. Proven non-tautological (RED with
  production files reverted, tests kept). Pre-change HEAD (rollback) `5e01170`.

- **Milestone 4 — Live webcam input.** `#webcam-toggle` button (in `#controls`,
  reusing `#status`) → `getUserMedia` → hidden `<video>` → a ping-pong pair of
  capture canvases (longer edge capped at 512px, aspect preserved) fed
  **directly** to the shared lazy estimator — the canvas input path
  (`RawImage.read` → `fromCanvas`, a sync `getImageData`) was confirmed from
  the installed 4.2.0 source (`pipelines/_base.js` + `utils/image.js`) and is
  documented in `src/depth.js`'s header. Decoupling per the contract, verbatim:
  a self-paced async inference loop with exactly **one pass in flight** POSTS
  the latest `{depth, canvas}` (overwriting any unconsumed frame — drop, never
  queue); the rAF render loop CONSUMES the newest via `applyDepthToCloud` and
  never awaits anything. Photo and webcam mutually exclude via the existing
  `disabled` state (one estimator instance, one job at a time). Failure paths
  (permission denied / no camera / model-load / mid-loop inference error) tear
  down tracks, restore the idle UI, and surface in `#status` (console.warn,
  not error). **The loop yields one rAF tick between passes** — found
  empirically with the real model: the estimator's promise chain settles
  entirely in microtasks on the WASM path, so a yield-less loop spins
  post→capture→infer with rAF never firing — the posted depth was overwritten
  forever (35+ completed passes, zero consumed) and orbit froze. The rAF yield
  guarantees each posted frame is consumed and paces inference at ≤1 pass per
  rendered frame (M4-C regression test: an instantly-resolving estimator must
  not starve the render loop). **Worker design question resolved: no worker in
  M4.** WebGPU (the primary path) runs compute off the main thread; on WASM
  the main thread still blocks DURING each pass (measured ~4–11s/pass in the
  headless probe), rendering one frame between passes — a live slideshow, not
  30fps orbit. Accepted as the degraded fallback (M5 owns "warn it's slower");
  if WASM-machine UX matters, migrating inference to a Web Worker is the
  known fix and the natural M6 candidate. Smoke tests (fake camera via
  Chromium fake-media-stream flags in `playwright.config.js`; controllable
  fake estimator via the new `window.__app.__setEstimator` hook): M4-A — rAF
  keeps ticking during an in-flight pass, no second call queues, the posted
  ramp is consumed with the M3 sign contract, the loop continues unprompted,
  stop releases the camera track and drops a stale post-stop result; M4-B —
  permission denial surfaces in `#status` and the UI recovers; M4-C — the
  starvation regression above; M4-D — sessions carry a **generation token**
  (`webcamGen`): a stop→start with a pass still in flight must not let the
  dead session's result apply, its loop resurrect, or its rejection tear down
  the live session (verifier finding — a bare boolean re-validated stale
  passes). Real-model probe (fake camera, WASM):
  continuous live passes verified end-to-end, canvas input 512×384 →
  input-sized depth back. Debug hook grew `__setEstimator`, `__getEstimator`,
  `webcamRunning()`, `__webcamVideo`. Proven non-tautological (RED with
  production files reverted, tests kept). Pre-change HEAD (rollback) `33ce681`.

- **Milestone 5 — Toggle + polish.** The toggle/teardown and error states
  already shipped in M4, so M5 added the user-visible instrumentation. New
  `src/hud.js`: a `#hud` block in `#controls` with an **FPS readout** (a
  self-scheduled rAF counter — same cadence as the render loop and stalls
  with it when WASM inference blocks the thread — so `animate()` and the M4
  post/consume decoupling machinery stayed byte-identical), a **per-pass
  inference-time readout** fed by a shared `timeEstimator()` pass-through
  wrapper applied at both estimator call sites (photo handler + the estimator
  handed to the webcam loop; `webcamLoop` itself untouched), and an amber
  `#device-note` — "WebGPU unavailable — depth runs on WASM (slower)." —
  shown after a successful model load only when the picked device is WASM
  (the M3 console.warn made user-visible). `src/depth.js` records the picked
  device (`getSelectedDevice()`); `_setEstimatorForTests(fake, device)` grew
  an optional device arg so tests can simulate the fallback (the real probe
  can't run meaningfully in CI). Debug hook grew additive `getFps` /
  `getLastInferenceMs`. Smoke tests: M5-A live FPS readout (> 0, liveness
  not a rate); M5-B ~120ms fake estimator on the webcam path → `NN ms`
  readout ≥ 100ms; M5-C warning visible for 'wasm', hidden for 'webgpu'.
  Verified visually on a real build (idle + live-WASM screenshots). Proven
  non-tautological (RED with production `src/` reverted, tests kept).
  Pre-change HEAD (rollback) `0c7a26d`.

- **Milestone 6 — Web Worker WASM inference.** On the WASM fallback the depth
  pipeline now runs in a dedicated **module Web Worker** (`src/depth-worker.js`),
  so the main thread keeps rendering during a pass; the **WebGPU path is
  byte-identical** (it already computes off-thread). The split-by-device design
  also makes the `webInitChain` poison structurally impossible: the worker only
  ever inits `wasm`, the main thread only ever inits `webgpu`. Facts verified
  from the installed 4.2.0 source before coding: `env.js` classifies
  `DedicatedWorkerGlobalScope` as a supported web env (`IS_WEBWORKER_ENV`), and
  root-exported `RawImage(data, width, height, channels)` is a plain
  field-assignment constructor — so the bridge posts ImageData pixels
  (buffer transferred) and the worker wraps them in a `RawImage`; the depth
  comes back as a plain `{ data, width, height }` (cloned, ~200KB — we don't
  own the library buffer's lifetime), exactly the subset `applyDepthToCloud`
  consumes. Both call sites now hand the estimator a **canvas** (the photo
  handler draws its ImageBitmap to one at native size instead of passing a
  blob URL, whose in-worker reachability is unverified). `hud.timeEstimator`
  wraps the bridge proxy, so the M5 readout measures the true round trip;
  the fake-estimator seam (`__setEstimator`) stays main-thread and never
  touches the worker — all M3–M5 tests unchanged. Worker init failure rejects
  the load and clears the estimator cache (retry spawns a fresh worker);
  a mid-session worker crash rejects in-flight passes (the M4 gen-token catch
  tears down) and clears the cache too. Smoke test M6-A pins the photo-path
  canvas input contract (RED pre-M6: it got a blob-URL string). Real-model
  probe (headless → WASM → worker): a 38.2s pass rendered **558 rAF frames,
  max gap 1.57s** — pre-M6 the gap was the whole pass. Pre-change HEAD
  (rollback) `c61d33b`.

**Carry-over facts from M3/M4 (do not re-derive):**

- Depth output contract: `depth` RawImage, Uint8, 1 channel, input W×H, 0–255
  min–max normalized, **brighter = nearer** (verified empirically 2026-07-03).
- Estimator input contract: accepts `RawImage | string | URL | Blob |
  HTMLCanvasElement | OffscreenCanvas` (confirmed from the installed 4.2.0
  source 2026-07-03 — see `src/depth.js` header).
- transformers.js 4.2.0 quirk: a rejected WebGPU session init poisons the
  shared `webInitChain` — `src/depth.js` probes `requestAdapter()` and picks
  the device once; keep that pattern.

---

## NEXT (the one actionable task)

(Nothing queued — propose an M7 candidate with the human before the next
autopilot run.)

---

## BLOCKED — do NOT start until the prior milestone has merged

(Nothing queued.)

---

## CI / merge-gate note for autopilot

- CI runs two jobs. **`build`** is the reliable gate. **`smoke`** runs the
  headless WebGL test under software SwiftShader and _may_ be flaky across
  Chromium versions.
- If the `smoke` job proves unstable on CI, the **`build`** job plus the **local**
  `npm test` (which exercises real WebGL in the autopilot session) together stand
  in for the runtime proof — a visual milestone can't be fully proven by CI alone.
  Do not weaken/delete the smoke test to force green; if CI is red for a real
  reason, bail and report per the autopilot rules.
- Do not edit dependencies or CI config as part of a milestone task — the
  bootstrap already provisioned `three`, Vite, Playwright, and CI. The one
  intended runtime-dependency addition, `@huggingface/transformers` (the depth
  model), is **already added (v4.2.0)** for M3 — no further dependency edits. Do
  not touch CI config.
