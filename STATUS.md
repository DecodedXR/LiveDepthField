# STATUS — Live Depth Field

Single source of truth for "what's next." One milestone per PR/run. Autopilot:
pick the one task under **NEXT**, ship it, stop. Do **not** start anything under
**BLOCKED**.

_Last updated: 2026-07-03 — M3 fully unblocked: human checkpoint **CLEARED**
(depth output format confirmed) **and** `@huggingface/transformers@4.2.0` added.
Milestone 3 is the actionable NEXT._

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

---

## NEXT (the one actionable task)

### Milestone 3 — Photo input → depth → cloud

**Human checkpoint: CLEARED — 2026-07-03.** The transformers.js Depth Anything V2
Small output format was confirmed against authoritative sources (the
`onnx-community/depth-anything-v2-small` model card, the transformers.js
`DepthEstimationPipeline` source, and the HF Depth Anything V2 docs). M3 is no
longer off-limits. Do **not** re-derive the contract below — it is the confirmed
checkpoint content.

**Goal:** File upload for one image; load Depth Anything V2 Small via
transformers.js (**WebGPU with WASM fallback**); run one depth pass; map depth →
Z displacement of a point grid; sample image pixels for per-point color; show a
clear async loading state. Reuse the M2 cloud + splat shader.

**Confirmed output contract:**

- Call: `pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small')`;
  then `const { predicted_depth, depth } = await estimator(imageBlobOrUrl)`.
- `depth`: a `RawImage` — `Uint8`, **1 channel** (grayscale), size = **input
  image W×H**, values **0–255** (min–max normalized: `(x−min)/(max−min)×255`).
- `predicted_depth`: `float32` `Tensor`, interpolated to input **W×H**, **raw,
  unbounded, RELATIVE** depth (not metric, not 0–1).
- Model is **relative** depth (`depth_estimation_type="relative"`). Convention:
  **higher value = closer** → in `depth`, **brighter = nearer**.

**Mapping decisions (agreed 2026-07-03):**

1. **Depth source:** use the `depth` RawImage (`depth.data`, `Uint8`, 0–255) as
   the per-point depth — simplest; avoids raw-tensor shape/normalization edge
   cases. `predicted_depth` stays available if unnormalized values are needed.
2. **Z direction:** map higher/brighter → nearer the camera
   (e.g. `z = (d/255 − 0.5) × scale`). **Mandatory acceptance criterion — verify
   the sign empirically** on the pinned transformers.js version (inspect one
   `depth` output: near objects must be bright; if inverted, flip the sign). This
   is a runtime check, not a guess.
3. **Point budget:** **downsample** the depth map to a fixed grid (near the
   current ~16k-point scale; exact size chosen in M3 to hold the 30fps orbit
   constraint) rather than one point per pixel.

**Definition of done:** upload an image → a depth-displaced, image-colored point
cloud renders through the M2 splat shader; async model-load state is visible;
`npm run build` succeeds; no console/page errors; 30fps orbit preserved. Author a
RED test first (e.g. the cloud's geometry/point layout updates to image-derived
values after a depth pass) proven non-tautological by reverting.

**Dependency note (SATISFIED — 2026-07-03):** `@huggingface/transformers@4.2.0`
was added to `package.json` + `package-lock.json` with human approval (the
bootstrap had deliberately left it out). The confirmed output contract above was
researched against this same v4 line (the `onnx-community/depth-anything-v2-small`
model card and the v4 `DepthEstimationPipeline` source), so it holds. Both M3
gates — the human checkpoint and the dependency add — are now **cleared**; M3 is
fully actionable for autopilot. Autopilot must **not** edit dependencies further —
that stays on its forbidden-ops list; the one intended addition is done.

**Autopilot note:** checkpoint is cleared, but M3 is the highest-uncertainty
milestone (model API, WebGPU/WASM, async decoupling). Keep the verify + review
gate tight; the Z-direction sign check (#2) is mandatory.

**Test command:** `npm test` (builds, then runs Playwright).

---

## BLOCKED — do NOT start until the prior milestone has merged

These are here for context only. Each depends on the one before it and must not be
picked up in the same run. (Milestone 3's human checkpoint has been **cleared** —
it now lives under NEXT above.)

- **Milestone 4 — Live webcam input.** `getUserMedia` → offscreen canvas; depth
  inference loop **decoupled** from render (post latest depth map; render consumes
  newest; drop frames, never queue); reuse the M2 cloud + shader. Blocked on M3.

- **Milestone 5 — Toggle + polish.** Webcam/Photo toggle with clean webcam
  teardown; FPS + inference-time readout; graceful WebGPU-unavailable message
  (fall back to WASM, warn it's slower); error states for no-camera-permission,
  bad file, model-load failure. Blocked on M4.

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
