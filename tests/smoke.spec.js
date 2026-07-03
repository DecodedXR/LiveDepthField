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
