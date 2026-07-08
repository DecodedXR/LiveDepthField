# STATUS — Live Depth Field

Single source of truth for "what's next." One milestone per PR/run. Autopilot:
pick the one task under **NEXT**, ship it, stop. Do **not** start anything under
**BLOCKED**.

_Last updated: 2026-07-08 — Milestone 8 (model-download progress) done; M9
STL+PLY export is NEXT, then M10 expanded depth range._

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

- **Polish — boot loading bar (user-directed, not a milestone).** The app used
  to show a blank black screen until the ~194KB-gzipped entry bundle (Three.js)
  downloaded, parsed, and rendered the first frame — no feedback. Added an
  **inline, instant-paint boot loader**: an overlay + critical CSS live directly
  in `index.html` (a `<head>` `<style>` + `#boot-loader` markup Vite passes
  through untouched into the built HTML, ahead of the module `<script>`), so it
  paints on the FIRST paint, before any JS downloads. The fill advances toward
  92% on a pure-CSS animation; `src/main.js` snaps it to 100% and fades the
  overlay out on the **first rendered frame** (a one-shot after the first
  `renderer.render` in `animate()`, which runs synchronously at module eval —
  before `window.__app` is set, so the overlay is `pointer-events:none`/removed
  before any UI interaction). This is a **perceived-load** win (First Contentful
  Paint: blank → instant) — the JS payload is unchanged (Three.js is required for
  the first frame; the depth model already lazy-loads, no model bytes at boot).
  Smoke test asserts the loader ships in the raw server HTML (fetched via
  `page.request.get('/')`, so a JS-injected node can't satisfy it) AND is gone
  once the app boots — non-tautological only together (loader-in-HTML but no
  dismissal was verified RED on the second assertion). Verified visually on a
  real build (frozen-loader screenshot). Pre-change HEAD (rollback) `789d6ae`.

- **Polish — black + green "coding" aesthetic (user-directed, not a milestone).**
  Restyled the whole UI to a phosphor-green-on-black terminal look. `src/style.css`
  gains `--accent` (`#00ff9c`) / `--accent-dim` / `--mono` (monospace stack)
  custom properties driving the `#controls` panel, slider labels+thumbs
  (`accent-color`), the webcam/`::file-selector-button` buttons, `#status`, and
  the `#hud` — all green, monospace, with a soft green outer glow on the panel.
  `index.html`'s inline boot-loader CSS goes green (title + track + fill + glow),
  monospace. `src/main.js`'s pre-upload point-cloud tint flips from blue-white
  `(0.55, 0.78, 1.0)` to phosphor green `(0.15, 1.0, 0.45)` — the one
  JS-observable change; **post-upload color still samples the image** (M3 path
  untouched). `#device-note` stays amber on purpose (a caution signal that must
  read distinctly against the green). Geometry, material identity, uniforms, the
  render loop, and the M4 decoupling machinery are byte-unchanged. Smoke test
  asserts the pre-upload `aColor` reads green (G>0.8, G dominant) — proven
  non-tautological (RED on the old blue tint: G=0.78 fails G>0.8, and B=1.0
  dominates). Verified visually on a real build (green splat cloud + green HUD,
  30.7fps). Deployed to the linked Netlify site (`live-depth-field`).
  Pre-change HEAD (rollback) `d455809`.

- **Polish — persistent title + author credit (user-directed, not a milestone).**
  The "Live Depth Field" name previously lived only on the boot loader; it now
  also sits **persistently at the top-middle of the running app**, with the
  author credit **"by Noah Federovitch"** beneath it. Both are static
  presentational chrome — an inline `#app-title` overlay in `index.html` (like
  `#boot-loader`, so it's in the page from the first paint and testable in the
  raw server bytes) styled in `src/style.css` to mirror the boot loader's
  phosphor-green `.boot-title` (uppercase name in `--accent` with a green glow,
  dimmer `--accent-dim` credit line, monospace). `pointer-events: none` keeps the
  overlay from ever intercepting orbit drags on the canvas underneath, and
  `z-index: 5` (below the loader's 10) means the loader still fully covers it
  during boot. **No JS** — `src/main.js`, the render loop, OrbitControls, the
  geometry/shader, and the M4 decoupling machinery are byte-unchanged. Smoke test
  asserts both strings ship in the raw HTML AND the live title is visible,
  horizontally centered near the top, and does not capture pointer events over
  the canvas (`elementFromPoint` at its center returns the canvas). Proven
  non-tautological (RED on the prior HTML: no `#app-title`). Verified visually on
  a real build (centered green title + credit above the orbiting cloud, ~21fps).
  Pre-change HEAD (rollback) `d5546e8`.

- **Polish — bottom "Built with Claude Fable 5" build credit (user-directed, not
  a milestone).** A bottom-middle build-attribution line, the counterpart to the
  top `#app-title`. Same treatment: an inline `#build-credit` div in `index.html`
  styled in `src/style.css` (`position: fixed; bottom: 12px`, centered, dim
  `--accent-dim` monospace), `pointer-events: none` + `z-index: 5` so it never
  intercepts orbit drags and the boot loader still covers it during boot. **No
  JS.** Smoke test asserts the string ships in the raw HTML AND the live credit
  is visible, horizontally centered near the bottom, and doesn't capture pointer
  events over the canvas. Proven non-tautological (RED on the prior HTML: no
  `#build-credit`). Verified visually on a real build. Pre-change HEAD (rollback)
  `94b4084`.

- **Milestone 7 — Mobile-responsive UI.** Fixes the user's "unusable on
  iPhone" report (2026-07-08): on a ~390px screen the fixed top-left
  `#controls` panel (~236px) collided with the centered `#app-title`, and the
  controls were far below finger size. Pure-CSS fix — one
  `@media (max-width: 640px)` block in `src/style.css`, **no JS and no markup
  changes** (`src/main.js`, the render loop, and the decoupling machinery are
  byte-identical; desktop above the breakpoint is untouched since every new
  rule lives inside the query). Mobile layout: `#controls` docks to the
  bottom edge full-width (safe-area padding for the home bar), sliders
  stretch, buttons + file input meet the 44px tap minimum; `#build-credit`
  moves up under the top-center title (the panel owns the bottom edge).
  **Landscape phones** (≤640px wide but only ~320–360px tall — verifier
  finding, a regression risk the portrait-only design missed) are handled by
  capping the panel at `calc(100dvh − 88px)` (vh fallback) with internal
  `overflow-y` scrolling, so it never reaches the top chrome or exceeds the
  viewport. Test harness: a new **`mobile-chromium` Playwright project**
  (Chromium, 390×844, DPR 3, `hasTouch`, `isMobile` — no WebKit, CI provisions
  Chromium only) runs the new `tests/mobile.spec.js`: boot-loader dismissal;
  pairwise non-intersection of `#controls`/`#app-title`/`#build-credit`;
  every control fully in-viewport; tap targets ≥ 44px; the landscape
  cap/scroll contract at 640×360 with a grown status line; and touch orbit —
  driven via **CDP `Input.dispatchTouchEvent`** (trusted `pointerType:'touch'`
  pointer events; a synthetic `dispatchEvent` would hit OrbitControls 0.185's
  unguarded `setPointerCapture` and throw `NotFoundError` — verified from the
  installed source) asserting the camera quaternion moves. Proven
  non-tautological twice (portrait overlap RED on the pre-M7 CSS with exactly
  the reported geometry; landscape RED pre-cap on the verifier's geometry).
  Verified visually on a real build (mobile + desktop screenshots; desktop
  byte-identical). Pre-change HEAD (rollback) `58d3b9a`.

- **Milestone 8 — Model-download progress.** The first photo/webcam model load
  now shows a live `Downloading depth model… NN%` in `#status`. Event shape
  confirmed from the installed 4.2.0 source before coding (working rule 1):
  `pipeline()` wraps any `progress_callback` in `DefaultProgressCallback`
  (`utils/core.js`), which emits aggregate **`progress_total`** events —
  `progress` is 0–100 across ALL weight files — alongside the raw per-file
  `initiate/download/progress/done` events, so no manual aggregation was
  needed. `src/depth.js` filters for `progress_total` in one place
  (`emitProgress`) feeding a handler `src/main.js` registers once
  (`setProgressHandler`); the WebGPU (main-thread) pipeline gets the callback
  directly, the WASM worker relays its raw events over the bridge as a new
  `{type:'progress', event}` message (`src/depth-worker.js`). Completion needs
  no special-casing: each call site's next status write ('Estimating depth…' /
  'Starting webcam…') ends the readout, and cached loads emit nothing (module
  cache) or an instant flash (browser cache re-read). Render loop, decoupling
  machinery, and all estimator call sites byte-unchanged. Test seam
  `window.__app.__emitProgress` routes fake events through the real filter;
  smoke test M8 asserts advancing rounded %, per-file events ignored, and
  return to the normal `Done — …` flow. Proven non-tautological (RED with
  production `src/` reverted, test kept). Pre-change HEAD (rollback) `c2f0a9f`.

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

- **Milestone 9 — Export: "Save as STL" + "Save as PLY" buttons.** (Format
  question resolved with the user 2026-07-08: **both**.) One export module,
  two buttons in `#controls`, fully client-side (build an ArrayBuffer → Blob →
  anchor download; hand-roll both writers — no new dependencies, both formats
  are simple). **Binary STL** — for 3D printing: triangulate the current
  128×128 grid as a heightfield (fixed grid topology, two triangles per cell,
  ~32.3k tris); STL has no color, that's inherent to the format. **Binary
  little-endian PLY** — the actual colored point cloud for
  MeshLab/CloudCompare/Blender: positions plus per-point `aColor` as uchar
  RGB. Both exporters must bake in the Points object's world scale (M3
  preserves photo aspect via object scale, so raw attribute positions are not
  world coords). Export snapshots whatever is currently displayed — works
  pre-upload too (the green random cloud); no special webcam guard needed,
  buffers only swap between frames. Smoke: apply a synthetic ramp, click each
  button, capture the download (Playwright download event), parse the bytes →
  assert header/counts and a few known vertex values; PLY colors match
  `aColor`.

---

## BLOCKED — do NOT start until the prior milestone has merged

- **Milestone 10 — Expanded depth range** (user: "make the potential depth
  more expansive"). Displacement is hard-coded — `z = d/255 − 0.5`, a total
  span of 1.0 world unit — so relief always reads shallow. Add a fourth
  "depth" slider to `#controls` (alongside pointSize/glow/falloff) scaling
  the span, e.g. ×0.25–×4, default ×1. Cache the last applied
  `{depth, canvas}` so moving the slider re-applies **live** to the on-screen
  cloud, not just the next pass; during a webcam session the next consumed
  frame picks it up anyway — do not touch the M4 drop-never-queue machinery.
  Sign contract (bright = near) and the default look at ×1 unchanged. Smoke:
  synthetic ramp at two slider values → z extent scales proportionally;
  existing M3 sign asserts stay green. (If M9 landed first, exports
  automatically reflect the scaled Z — no extra work.)

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
