# STATUS — Live Depth Field

Single source of truth for "what's next." One milestone per PR/run. Autopilot:
pick the one task under **NEXT**, ship it, stop. Do **not** start anything under
**BLOCKED**.

_Last updated: 2026-07-03 — Milestone 4 (live webcam input) landed. Milestone 5
(toggle + polish) is the actionable NEXT._

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
  starvation regression above. Real-model probe (fake camera, WASM):
  continuous live passes verified end-to-end, canvas input 512×384 →
  input-sized depth back. Debug hook grew `__setEstimator`, `__getEstimator`,
  `webcamRunning()`, `__webcamVideo`. Proven non-tautological (RED with
  production files reverted, tests kept). Pre-change HEAD (rollback) `33ce681`.

---

## NEXT (the one actionable task)

### Milestone 5 — Toggle + polish

**Goal:** Webcam/Photo toggle with clean webcam teardown; FPS + inference-time
readout; graceful WebGPU-unavailable message (fall back to WASM, warn it's
slower — `src/depth.js` already console.warns and picks WASM; M5 makes it
user-visible); error states for no-camera-permission, bad file, model-load
failure.

**Carry-over facts from M3/M4 (do not re-derive):**

- Depth output contract: `depth` RawImage, Uint8, 1 channel, input W×H, 0–255
  min–max normalized, **brighter = nearer** (verified empirically 2026-07-03).
- Estimator input contract: accepts `RawImage | string | URL | Blob |
  HTMLCanvasElement | OffscreenCanvas` (confirmed from the installed 4.2.0
  source 2026-07-03 — see `src/depth.js` header).
- transformers.js 4.2.0 quirk: a rejected WebGPU session init poisons the
  shared `webInitChain` — `src/depth.js` probes `requestAdapter()` and picks
  the device once; keep that pattern.
- M4 already ships much of M5's raw material: start/stop button with full
  teardown, permission/model-failure error states in `#status`, and the
  WASM-fallback console.warn. M5's job is the user-visible polish (toggle UX,
  FPS/inference readouts, surfaced device warning), not new inference
  machinery.

**Test command:** `npm test` (builds, then runs Playwright).

---

## BLOCKED — do NOT start until the prior milestone has merged

(Nothing currently queued behind M5 — propose Milestone 6 candidates with a
human before adding one.)

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
