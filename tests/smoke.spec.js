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
  // ticking (rAF advances)…
  const frames = await page.evaluate(
    () =>
      new Promise((done) => {
        let n = 0;
        const t0 = performance.now();
        (function tick() {
          n++;
          if (performance.now() - t0 < 400) requestAnimationFrame(tick);
          else done(n);
        })();
      }),
  );
  expect(frames, 'rAF must keep ticking while inference is in flight').toBeGreaterThan(5);
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

  // And rAF keeps advancing while the live loop churns. (With an instant
  // estimator every frame also captures + consumes, so under software WebGL
  // frames are slow — the bar is "repeatedly ticking", not a frame rate; the
  // starved case never even reaches this assert.)
  const frames = await page.evaluate(
    () =>
      new Promise((done) => {
        let n = 0;
        const t0 = performance.now();
        (function tick() {
          n++;
          if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
          else done(n);
        })();
      }),
  );
  expect(frames, 'rAF must keep ticking during a fast live loop').toBeGreaterThan(3);

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

  await page.click('#webcam-toggle');

  await expect(page.locator('#status')).toContainText(/denied|camera|webcam|failed/i);
  expect(await page.evaluate(() => window.__app.webcamRunning())).toBe(false);
  // Button and photo input both recover for another attempt.
  await expect(page.locator('#webcam-toggle')).toBeEnabled();
  await expect(page.locator('#webcam-toggle')).toContainText(/start/i);
  await expect(page.locator('#photo-input')).toBeEnabled();
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});
