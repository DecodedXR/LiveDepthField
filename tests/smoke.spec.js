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
