import { test, expect } from '@playwright/test';

// Baseline smoke test. Proves the render pipeline boots headlessly: the canvas
// mounts, a WebGL context is acquired (WebGLRenderer construction would throw
// otherwise), the app module initializes, and nothing errors during boot.
//
// This is intentionally milestone-agnostic and passes on the empty scaffold.
// Each milestone adds its own assertions (e.g. Milestone 1 asserts
// window.__app.getPointCount() === 16384). See STATUS.md.
test('app boots: canvas mounts, WebGL alive, no page errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });

  await page.goto('/');

  await expect(page.locator('canvas')).toBeVisible();

  // The debug hook only exists after the module ran end-to-end without throwing.
  await page.waitForFunction(
    () => !!window.__app && typeof window.__app.getPointCount === 'function',
  );

  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

test('milestone 1: renders a 128x128 (16,384-point) cloud', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);
  expect(await page.evaluate(() => window.__app.getPointCount())).toBe(16384);
  expect(errors).toEqual([]);
});

// Milestone 2: the cloud must look like Gaussian splats — a custom ShaderMaterial
// with additive blending and tunable pointSize/glow/falloff uniforms, over the
// unchanged 16,384-point geometry. This asserts the material *identity*, not
// pixels; it fails on the M1 default PointsMaterial state and passes only once
// the splat shader lands (proven non-tautological by running before the fix).
test('milestone 2: cloud uses an additive splat ShaderMaterial with tunable uniforms', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);

  const mat = await page.evaluate(() => {
    const THREE = window.__app.THREE;
    let m = null;
    window.__app.scene.traverse((o) => {
      if (o.isPoints) m = o.material;
    });
    if (!m) return null;
    return {
      isShaderMaterial: m.isShaderMaterial === true,
      additive: m.blending === THREE.AdditiveBlending,
      transparent: m.transparent === true,
      hasPointSize: !!(m.uniforms && m.uniforms.pointSize),
      hasGlow: !!(m.uniforms && m.uniforms.glow),
      hasFalloff: !!(m.uniforms && m.uniforms.falloff),
    };
  });

  expect(mat, 'no THREE.Points found in the scene').not.toBeNull();
  expect(mat.isShaderMaterial, 'cloud material must be a ShaderMaterial').toBe(true);
  expect(mat.additive, 'cloud must use AdditiveBlending').toBe(true);
  expect(mat.transparent, 'cloud material must be transparent').toBe(true);
  expect(mat.hasPointSize, 'pointSize uniform must exist').toBe(true);
  expect(mat.hasGlow, 'glow uniform must exist').toBe(true);
  expect(mat.hasFalloff, 'falloff uniform must exist').toBe(true);

  // Geometry is untouched by the aesthetic change.
  expect(await page.evaluate(() => window.__app.getPointCount())).toBe(16384);
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

// Milestone 3: photo → depth → cloud. The depth model itself can't run in CI
// (it downloads ~100MB of weights), so the testable seam is the mapping:
// window.__app.applyDepth(depth, image) takes the transformers.js `depth`
// RawImage contract ({ data: Uint8, width, height }, 0–255, min–max normalized,
// BRIGHTER = NEARER) plus any CanvasImageSource, and must displace the fixed
// 128×128 grid's Z by depth and color each point from the image. Injecting a
// synthetic ramp proves the mapping — including the mandatory Z-direction sign:
// bright (255) must land at +Z (toward the camera at z=3), dark (0) at −Z.
test('milestone 3: applyDepth displaces Z by depth (bright = near) and colors points from the image', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);

  const res = await page.evaluate(() => {
    const app = window.__app;
    if (typeof app.applyDepth !== 'function') return { missing: true };

    // Synthetic depth map: 16×16 horizontal ramp, 0 (left) → 255 (right).
    const W = 16;
    const H = 16;
    const data = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) data[y * W + x] = Math.round((x / (W - 1)) * 255);
    }

    // Solid red source image.
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 8;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 8, 8);

    app.applyDepth({ data, width: W, height: H }, c);

    let cloud = null;
    app.scene.traverse((o) => {
      if (o.isPoints) cloud = o;
    });
    const pos = cloud.geometry.attributes.position;
    const col = cloud.geometry.attributes.aColor;
    const GRID = 128;
    const mid = Math.floor(GRID / 2) * GRID; // first point of the middle row
    return {
      missing: false,
      zLeft: pos.getZ(mid),
      zRight: pos.getZ(mid + GRID - 1),
      hasColor: !!col,
      colSample: col ? [col.getX(mid), col.getY(mid), col.getZ(mid)] : null,
      count: pos.count,
    };
  });

  expect(res.missing, 'window.__app.applyDepth must exist').toBe(false);
  // Sign contract: brighter = nearer = toward the camera (+Z), scale ±0.5.
  expect(res.zRight).toBeGreaterThan(res.zLeft);
  expect(res.zRight).toBeCloseTo(0.5, 2);
  expect(res.zLeft).toBeCloseTo(-0.5, 2);
  // Per-point color sampled from the (red) image.
  expect(res.hasColor, 'cloud geometry must have an aColor attribute').toBe(true);
  expect(res.colSample[0]).toBeGreaterThan(0.9);
  expect(res.colSample[1]).toBeLessThan(0.1);
  expect(res.colSample[2]).toBeLessThan(0.1);
  // Point budget unchanged: still the fixed 128×128 grid.
  expect(res.count).toBe(16384);
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

// Milestone 3 failure path: a non-image file must surface a visible error state
// in #status — not an uncaught rejection, not a console.error, not a dead UI.
test('milestone 3: upload UI exists; a non-image file shows an error state without page errors', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);

  await expect(page.locator('#photo-input')).toBeVisible();
  await expect(page.locator('#status')).toBeVisible();

  await page.setInputFiles('#photo-input', {
    name: 'not-an-image.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('definitely not pixels'),
  });

  await expect(page.locator('#status')).toContainText(/couldn|failed|error/i);
  // The input must recover so the user can try another file — enabled AND
  // cleared, so re-picking the SAME file fires `change` again.
  await expect(page.locator('#photo-input')).toBeEnabled();
  await expect(page.locator('#photo-input')).toHaveValue('');
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

// Milestone 4: live webcam → continuous depth loop, DECOUPLED from render.
// The real model can't run in CI (same reason as M3), so the testable seam is
// the loop machinery: a controllable fake estimator is injected via
// window.__app.__setEstimator, and Chromium's fake media device (see
// playwright.config.js) stands in for the camera. The contract under test is
// STATUS.md's M4 goal verbatim: the inference loop posts the latest depth map,
// render consumes the newest, frames drop and never queue, and the render loop
// never blocks on an in-flight inference.
test('milestone 4: webcam drives a continuous depth loop — decoupled, drop-never-queue', async ({
  page,
}) => {
  // Webcam-loop tests churn continuous capture/consume work and may share the
  // machine with the other churn test — give them headroom over the default.
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);

  await expect(page.locator('#webcam-toggle')).toBeVisible();

  // Install a controllable fake estimator BEFORE starting the webcam: each
  // call hands us a resolver so the test decides when "inference" completes.
  await page.evaluate(() => {
    const s = (window.__t = { calls: 0, resolvers: [], inputsWereCanvas: true });
    window.__app.__setEstimator((input) => {
      s.calls++;
      if (!(input instanceof HTMLCanvasElement)) s.inputsWereCanvas = false;
      return new Promise((res) => s.resolvers.push(res));
    });
  });

  await page.click('#webcam-toggle');

  // The loop starts and calls the estimator with a captured canvas frame.
  await page.waitForFunction(() => window.__t.calls === 1);

  // DECOUPLING: while that inference is pending, the render loop keeps
  // ticking. The property is LIVENESS (a starved loop yields zero frames,
  // ever), not a frame rate — software-WebGL pacing under parallel workers is
  // not the app's contract. Five observed frames before a generous deadline.
  const tick1 = await page.evaluate(
    () =>
      new Promise((done) => {
        let n = 0;
        const deadline = setTimeout(() => done({ alive: false, n }), 10_000);
        (function tick() {
          if (++n >= 5) {
            clearTimeout(deadline);
            done({ alive: true, n });
            return;
          }
          requestAnimationFrame(tick);
        })();
      }),
  );
  expect(
    tick1.alive,
    `rAF must keep ticking while inference is in flight (${tick1.n} frames in 10s)`,
  ).toBe(true);
  // …and NO second inference queued up behind the pending one (never queue).
  expect(await page.evaluate(() => window.__t.calls)).toBe(1);
  expect(await page.evaluate(() => window.__t.inputsWereCanvas)).toBe(true);

  // Resolve pass 1 with a horizontal ramp (0 left → 255 right). The posted
  // map must be consumed by the render loop: bright = near = +Z (M3 contract).
  await page.evaluate(() => {
    const W = 8;
    const H = 8;
    const data = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) data[y * W + x] = Math.round((x / (W - 1)) * 255);
    }
    window.__t.resolvers.shift()({ depth: { data, width: W, height: H } });
  });
  await page.waitForFunction(() => {
    let cloud = null;
    window.__app.scene.traverse((o) => {
      if (o.isPoints) cloud = o;
    });
    const pos = cloud.geometry.attributes.position;
    const GRID = 128;
    const mid = Math.floor(GRID / 2) * GRID;
    return pos.getZ(mid + GRID - 1) > 0.4 && pos.getZ(mid) < -0.4;
  });

  // CONTINUOUS: a second pass starts on its own (no user action).
  await page.waitForFunction(() => window.__t.calls >= 2);

  // STOP: the loop ends, the camera track is released, and the photo input
  // becomes usable again.
  await page.evaluate(() => {
    window.__t.track = window.__app.__webcamVideo.srcObject.getVideoTracks()[0];
  });
  await page.click('#webcam-toggle');
  await page.waitForFunction(() => window.__app.webcamRunning() === false);
  expect(await page.evaluate(() => window.__t.track.readyState)).toBe('ended');
  await expect(page.locator('#photo-input')).toBeEnabled();

  // A result that lands AFTER stop is stale and must be dropped, not applied:
  // resolve the still-pending pass with an INVERTED ramp and confirm the cloud
  // keeps the pass-1 orientation and no new inference starts.
  const callsAtStop = await page.evaluate(() => window.__t.calls);
  await page.evaluate(() => {
    const W = 8;
    const H = 8;
    const data = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) data[y * W + x] = 255 - Math.round((x / (W - 1)) * 255);
    }
    for (const res of window.__t.resolvers.splice(0)) {
      res({ depth: { data, width: W, height: H } });
    }
  });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    let cloud = null;
    window.__app.scene.traverse((o) => {
      if (o.isPoints) cloud = o;
    });
    const pos = cloud.geometry.attributes.position;
    const GRID = 128;
    const mid = Math.floor(GRID / 2) * GRID;
    return { calls: window.__t.calls, zRight: pos.getZ(mid + GRID - 1) };
  });
  expect(after.calls, 'no new inference may start after stop').toBe(callsAtStop);
  expect(after.zRight, 'a post-stop stale result must be dropped').toBeGreaterThan(0.4);

  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

// Milestone 4 decoupling, starvation direction: a FAST estimator must not
// starve rendering. The webcam loop's post→capture→next-pass sequence runs in
// promise continuations (microtasks); if the estimator resolves without ever
// yielding to a macrotask — which the real WASM path does — a loop with no
// explicit yield spins entirely in microtasks, rAF never fires, and the posted
// depth is overwritten forever without one frame being consumed (found
// empirically with the real model: 35+ passes completed, zero consumed). The
// loop must yield to the renderer between passes.
test('milestone 4: an instantly-resolving estimator must not starve the render loop', async ({
  page,
}) => {
  // See the sibling webcam test: churn tests get headroom over the default.
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);

  // Fake estimator that resolves IMMEDIATELY (pure microtask — the starvation
  // scenario), returning a constant near-plane so consumption is observable.
  await page.evaluate(() => {
    const W = 8;
    const H = 8;
    const data = new Uint8Array(W * H).fill(255); // all-bright: z → +0.5
    window.__app.__setEstimator(() =>
      Promise.resolve({ depth: { data, width: W, height: H } }),
    );
  });
  await page.click('#webcam-toggle');

  // The render loop must consume a posted frame: every Z lands at +0.5. If the
  // loop starves rendering, the page wedges and this times out (RED).
  await page.waitForFunction(() => {
    let cloud = null;
    window.__app.scene.traverse((o) => {
      if (o.isPoints) cloud = o;
    });
    const pos = cloud.geometry.attributes.position;
    return pos.getZ(0) > 0.4 && pos.getZ(pos.count - 1) > 0.4;
  });

  // And rAF keeps advancing while the live loop churns. The property is
  // LIVENESS (a starved loop yields zero frames, ever), not a frame rate —
  // with an instant estimator every frame also captures + consumes, so
  // software-WebGL frames are slow. Five observed frames before a deadline.
  const tick2 = await page.evaluate(
    () =>
      new Promise((done) => {
        let n = 0;
        const deadline = setTimeout(() => done({ alive: false, n }), 10_000);
        (function tick() {
          if (++n >= 5) {
            clearTimeout(deadline);
            done({ alive: true, n });
            return;
          }
          requestAnimationFrame(tick);
        })();
      }),
  );
  expect(
    tick2.alive,
    `rAF must keep ticking during a fast live loop (${tick2.n} frames in 10s)`,
  ).toBe(true);

  await page.click('#webcam-toggle');
  await page.waitForFunction(() => window.__app.webcamRunning() === false);
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

// Milestone 4 session identity: restarting the webcam while the PREVIOUS
// session's pass is still in flight must not let that dead session leak into
// the live one. A bare boolean can't tell sessions apart — stop→start flips
// it back to true and retroactively "re-validates" the stale pass, so its
// result gets applied, its loop resurrects (two passes in flight), and its
// rejection tears down the NEW session. Each needs a per-session generation.
test('milestone 4: restart while a pass is in flight must not resurrect the dead session', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);

  // Fake estimator whose every pass is settled manually by the test.
  await page.evaluate(() => {
    const s = (window.__t = { calls: 0, passes: [] });
    window.__app.__setEstimator(
      () =>
        new Promise((res, rej) => {
          s.calls++;
          s.passes.push({ res, rej });
        }),
    );
  });

  // Session 1: one pass in flight. Stop it, start session 2.
  await page.click('#webcam-toggle');
  await page.waitForFunction(() => window.__t.calls === 1);
  await page.click('#webcam-toggle'); // stop
  await page.waitForFunction(() => window.__app.webcamRunning() === false);
  await page.click('#webcam-toggle'); // start session 2
  await page.waitForFunction(() => window.__t.calls === 2);

  // The DEAD session-1 pass resolves with an all-dark plane. It must be
  // dropped: the cloud stays untouched, and session 1's loop must NOT
  // resurrect and capture a third frame.
  await page.evaluate(() => {
    const W = 8;
    const H = 8;
    window.__t.passes[0].res({
      depth: { data: new Uint8Array(W * H).fill(0), width: W, height: H },
    });
  });
  await page.waitForTimeout(500);
  const afterStale = await page.evaluate(() => {
    let cloud = null;
    window.__app.scene.traverse((o) => {
      if (o.isPoints) cloud = o;
    });
    const pos = cloud.geometry.attributes.position;
    let allDark = true;
    for (let i = 0; i < pos.count; i += 997) {
      if (pos.getZ(i) > -0.4) allDark = false;
    }
    return { calls: window.__t.calls, allDark, running: window.__app.webcamRunning() };
  });
  expect(afterStale.allDark, 'a dead session’s result must not be applied').toBe(false);
  expect(afterStale.calls, 'a dead session’s loop must not capture again').toBe(2);
  expect(afterStale.running).toBe(true);

  // Same race, rejection flavor: stop session 2, start session 3, then the
  // DEAD session-2 pass rejects. The ghost failure must not tear down the
  // live session or overwrite its status.
  await page.click('#webcam-toggle'); // stop session 2
  await page.waitForFunction(() => window.__app.webcamRunning() === false);
  await page.click('#webcam-toggle'); // start session 3
  await page.waitForFunction(() => window.__t.calls === 3);
  await page.evaluate(() => {
    window.__t.track = window.__app.__webcamVideo.srcObject.getVideoTracks()[0];
    window.__t.passes[1].rej(new Error('ghost failure from dead session'));
  });
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => window.__app.webcamRunning()),
    'a dead session’s rejection must not stop the live session',
  ).toBe(true);
  expect(await page.evaluate(() => window.__t.track.readyState)).toBe('live');
  await expect(page.locator('#status')).not.toContainText(/failed/i);

  await page.click('#webcam-toggle'); // final stop
  await page.waitForFunction(() => window.__app.webcamRunning() === false);
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

// Milestone 5: polish readouts. A HUD block inside #controls must report the
// live render frame rate. The property asserted is that the meter WORKS (it
// reports a positive rate measured from real frames), not any particular
// number — software-WebGL pacing under parallel workers is not the app's
// contract.
test('milestone 5: HUD shows a live FPS readout', async ({ page }) => {
  // FPS accumulates over ~1s windows and software WebGL frames are slow under
  // parallel workers — same headroom as the other churn-adjacent tests.
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);

  await expect(page.locator('#hud-fps')).toBeVisible();
  // The first report lands once a ≥1s frame window has elapsed.
  await page.waitForFunction(
    () => typeof window.__app.getFps === 'function' && window.__app.getFps() > 0,
  );
  await expect(page.locator('#hud-fps')).toContainText(/\d+(\.\d+)? fps/i);
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

// Milestone 5: the HUD must report how long each depth pass took. A fake
// estimator with a known ~120ms latency drives the webcam loop; the readout
// must show a measured duration at least that long (lower bound only — wall
// clock on a loaded machine can stretch a setTimeout, never shrink it).
test('milestone 5: HUD reports per-pass inference time from the webcam loop', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);

  await page.evaluate(() => {
    const W = 8;
    const H = 8;
    const data = new Uint8Array(W * H).fill(255);
    window.__app.__setEstimator(
      () =>
        new Promise((res) =>
          setTimeout(() => res({ depth: { data, width: W, height: H } }), 120),
        ),
    );
  });
  await page.click('#webcam-toggle');

  await page.waitForFunction(
    () =>
      typeof window.__app.getLastInferenceMs === 'function' &&
      window.__app.getLastInferenceMs() >= 100,
  );
  await expect(page.locator('#hud-infer')).toContainText(/\d+ ms/i);

  await page.click('#webcam-toggle');
  await page.waitForFunction(() => window.__app.webcamRunning() === false);
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

// Milestone 5: the WASM fallback must be USER-visible, not just a
// console.warn (src/depth.js already picks the device once up front — M5
// surfaces it). The real device pick can't run meaningfully in CI, so
// __setEstimator grows an optional device arg to simulate the pick; the
// warning must show for 'wasm' and stay hidden for 'webgpu'.
test('milestone 5: WASM fallback shows a visible slower-device warning; WebGPU does not', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);

  // No warning before any model load.
  await expect(page.locator('#device-note')).toBeHidden();

  await page.evaluate(() => {
    window.__app.__setEstimator(
      () =>
        Promise.resolve({
          depth: { data: new Uint8Array(64).fill(255), width: 8, height: 8 },
        }),
      'wasm',
    );
  });
  await page.click('#webcam-toggle');
  await page.waitForFunction(() => window.__app.webcamRunning() === true);
  await expect(page.locator('#device-note')).toBeVisible();
  await expect(page.locator('#device-note')).toContainText(/slower/i);
  await page.click('#webcam-toggle');
  await page.waitForFunction(() => window.__app.webcamRunning() === false);

  // Fresh page, WebGPU pick: the warning must NOT appear.
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);
  await page.evaluate(() => {
    window.__app.__setEstimator(
      () =>
        Promise.resolve({
          depth: { data: new Uint8Array(64).fill(255), width: 8, height: 8 },
        }),
      'webgpu',
    );
  });
  await page.click('#webcam-toggle');
  await page.waitForFunction(() => window.__app.webcamRunning() === true);
  await expect(page.locator('#device-note')).toBeHidden();
  await page.click('#webcam-toggle');
  await page.waitForFunction(() => window.__app.webcamRunning() === false);
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

// Milestone 4 failure path: camera permission denied (or no camera) must
// surface a visible error state in #status and leave the UI recoverable — not
// an uncaught rejection, not a console.error, not a stuck-disabled button.
test('milestone 4: camera-permission failure shows an error state and recovers', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);

  // The model now loads BEFORE the camera opens — stub it so this test does
  // not reach for the real (CI-impossible) download on the way to the
  // permission failure under test.
  await page.evaluate(() => {
    window.__app.__setEstimator(() =>
      Promise.resolve({ depth: { data: new Uint8Array(64), width: 8, height: 8 } }),
    );
  });
  await page.click('#webcam-toggle');

  await expect(page.locator('#status')).toContainText(/denied|camera|webcam|failed/i);
  expect(await page.evaluate(() => window.__app.webcamRunning())).toBe(false);
  // Button and photo input both recover for another attempt.
  await expect(page.locator('#webcam-toggle')).toBeEnabled();
  await expect(page.locator('#webcam-toggle')).toContainText(/start/i);
  await expect(page.locator('#photo-input')).toBeEnabled();
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

// Boot loading bar. A loading indicator must be present in the INITIAL
// server-delivered HTML — up on the first paint, before the app module (~194KB
// gzipped of Three.js) has even downloaded, let alone run — and must be
// dismissed once the app has actually booted (first frame rendered).
//
// The two assertions are non-tautological only together: (a) proves the loader
// ships in the raw HTML (checked via a bare request, NOT the live DOM, so it
// can't be a JS-injected node), and (b) proves main.js clears it. Add the HTML
// but forget the dismissal → (a) passes, (b) fails (loader sits over the booted
// app forever). Add neither → (a) fails. Only both together go green.
test('boot loader: shipped in the initial HTML before JS, dismissed once the app boots', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });

  // (a) The loader — an overlay carrying an ARIA progressbar — is in the exact
  // bytes the server sends, so it renders before any module executes. Fetched
  // raw (not via the live DOM) so a JS-injected element can't satisfy it.
  const html = await (await page.request.get('/')).text();
  expect(html, 'initial HTML must contain a #boot-loader overlay').toMatch(
    /id=["']boot-loader["']/,
  );
  expect(html, 'the boot loader must expose an ARIA progressbar').toMatch(
    /role=["']progressbar["']/,
  );

  // (b) Live: once the app has booted (the debug hook only exists after main.js
  // ran end-to-end), the loader must be gone/hidden — main.js dismisses it.
  await page.goto('/');
  await page.waitForFunction(
    () => !!window.__app && typeof window.__app.getPointCount === 'function',
  );
  await expect(page.locator('#boot-loader')).toBeHidden();

  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

// Polish — black + green "coding" aesthetic (user-directed, not a milestone).
// The one JS-observable part of the restyle is the pre-upload point-cloud tint:
// before any photo/webcam upload, the cloud renders in the app's accent color.
// A green coding aesthetic means that default tint reads GREEN — the green
// channel dominates and is strong. (Post-upload the cloud is colored from the
// image; this asserts only the default fill, so the M3 image-color path is
// untouched.) Non-tautological: RED on the prior blue-white (0.55, 0.78, 1.0)
// tint where blue dominates; green only once the tint is changed.
test('aesthetic: pre-upload cloud tint reads green (coding aesthetic)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);

  const tint = await page.evaluate(() => {
    let cloud = null;
    window.__app.scene.traverse((o) => {
      if (o.isPoints) cloud = o;
    });
    const col = cloud.geometry.attributes.aColor;
    return { r: col.getX(0), g: col.getY(0), b: col.getZ(0) };
  });
  // Green channel dominates and is strong — a green cloud, not blue-white.
  expect(tint.g, 'green channel must be strong').toBeGreaterThan(0.8);
  expect(tint.g, 'green must dominate red').toBeGreaterThan(tint.r);
  expect(tint.g, 'green must dominate blue').toBeGreaterThan(tint.b);
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

// Milestone 6: WASM inference moves into a Web Worker so the main thread stays
// responsive during a pass. The worker itself can't run in CI (it loads the
// real ~100MB model — the worker-path proof is a local real-model probe, like
// M3's Z-sign), so the testable main-thread seam is the input contract that
// feeds the worker bridge: BOTH call sites must hand the estimator a CANVAS.
// A canvas converts to ImageData for postMessage; the blob-URL string the
// photo path passed before M6 does not cross the worker boundary usefully.
// The webcam path already passes a canvas (M4-A pins it); this pins the photo
// path. Fails on the pre-M6 code, which hands the estimator a string URL.
test('milestone 6: photo path feeds the estimator a canvas (worker-bridgeable input)', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);

  // Fake estimator that records what input type it was handed.
  await page.evaluate(() => {
    const s = (window.__t6 = { input: null });
    window.__app.__setEstimator((input) => {
      s.input = {
        isCanvas: input instanceof HTMLCanvasElement,
        type: typeof input,
        width: input && input.width,
        height: input && input.height,
      };
      return Promise.resolve({
        depth: { data: new Uint8Array(16), width: 4, height: 4 },
      });
    });
  });

  // A real 3×2 PNG, generated in the page so no hand-rolled magic bytes.
  const pngB64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 3;
    c.height = 2;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f00';
    ctx.fillRect(0, 0, 3, 2);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.setInputFiles('#photo-input', {
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: Buffer.from(pngB64, 'base64'),
  });

  await expect(page.locator('#status')).toContainText(/done/i);
  const rec = await page.evaluate(() => window.__t6.input);
  expect(rec, 'estimator was never called').not.toBeNull();
  expect(
    rec.isCanvas,
    `photo path must hand the estimator a canvas, got ${rec.type} (${rec.width}×${rec.height})`,
  ).toBe(true);
  // Drawn from the decoded photo bitmap at its native size.
  expect(rec.width).toBe(3);
  expect(rec.height).toBe(2);
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});
