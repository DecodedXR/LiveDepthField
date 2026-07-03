# STATUS — Live Depth Field

Single source of truth for "what's next." One milestone per PR/run. Autopilot:
pick the one task under **NEXT**, ship it, stop. Do **not** start anything under
**BLOCKED**.

_Last updated: 2026-07-03 — Milestone 2 landed (splat-style shader + sliders)._

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

**None actionable by autopilot.** Milestone 2 has landed. The next milestone is
**Milestone 3**, which carries a mandatory **human checkpoint** (confirm the
transformers.js depth output format — tensor shape + value range — before wiring
Z mapping) and is therefore **off-limits to autopilot**. A human must clear that
checkpoint before M3 can be picked up. See BLOCKED below.

---

## BLOCKED — do NOT start until the prior milestone has merged

These are here for context only. Each depends on the one before it and must not be
picked up in the same run. **M3 onward also carries a human checkpoint and is
off-limits to autopilot** until a human clears it.

- **Milestone 3 — Photo input → depth → cloud.** File upload for one image; load
  Depth Anything V2 Small via transformers.js; run one depth pass; map depth →
  Z displacement of a point grid sized to the image; sample image pixels for
  per-point color; clear async loading state.
  ⚠️ **HUMAN CHECKPOINT / OFF-LIMITS TO AUTOPILOT:** must first STOP and confirm
  transformers.js output format (tensor shape + value range) with a human before
  wiring Z mapping — do **not** guess. M2 dependency now satisfied; remains gated
  on the human checkpoint.

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
  bootstrap already provisioned `three`, Vite, Playwright, and CI.
