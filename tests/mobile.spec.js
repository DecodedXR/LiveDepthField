import { test, expect } from '@playwright/test';

// Milestone 7: mobile-responsive UI. These tests run ONLY under the
// `mobile-chromium` project (390×844, DPR 3, hasTouch — see
// playwright.config.js); the desktop project ignores this file, and the
// desktop suite pins that layout unchanged above the breakpoint.
//
// The user report driving this milestone: on an iPhone the fixed top-left
// #controls panel collides with the centered #app-title and the controls are
// too small to tap. So the contract asserted here is geometric — the three
// pieces of fixed chrome never intersect, every control sits fully inside the
// viewport, tap targets meet the 44px minimum — plus the two behaviors a
// phone actually needs: the boot loader still dismisses, and a touch drag
// orbits the camera.

// Two axis-aligned boxes intersect iff they overlap on both axes.
function intersects(a, b) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function insideViewport(box, viewport) {
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height
  );
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

test('mobile: boot completes and the fixed chrome is overlap-free, on-screen, and tappable', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);

  // The boot loader must still dismiss on a phone — main.js removes the
  // overlay after the first rendered frame.
  await expect(page.locator('#boot-loader')).toHaveCount(0);

  const viewport = page.viewportSize();

  // (a) No pairwise intersection among the three pieces of fixed chrome —
  // this is the iPhone collision from the user report.
  const chrome = {};
  for (const id of ['controls', 'app-title', 'build-credit']) {
    const el = page.locator(`#${id}`);
    await expect(el, `#${id} must be visible on mobile`).toBeVisible();
    chrome[id] = await el.boundingBox();
  }
  const ids = Object.keys(chrome);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      expect(
        intersects(chrome[ids[i]], chrome[ids[j]]),
        `#${ids[i]} ${JSON.stringify(chrome[ids[i]])} must not overlap #${
          ids[j]
        } ${JSON.stringify(chrome[ids[j]])}`,
      ).toBe(false);
    }
  }

  // (b) The panel and every control in it sit fully inside the viewport —
  // nothing to scroll to, nothing clipped off-screen (body overflow is
  // hidden, so off-viewport chrome is simply unreachable on a phone).
  const controlSelectors = [
    '#controls',
    '#webcam-toggle',
    '#photo-input',
    '#controls input[type="range"] >> nth=0',
    '#controls input[type="range"] >> nth=1',
    '#controls input[type="range"] >> nth=2',
  ];
  for (const sel of controlSelectors) {
    const box = await page.locator(sel).boundingBox();
    expect(box, `${sel} must render a box`).not.toBeNull();
    expect(
      insideViewport(box, viewport),
      `${sel} ${JSON.stringify(box)} must sit fully inside the ${viewport.width}×${
        viewport.height
      } viewport`,
    ).toBe(true);
  }

  // (c) Coarse-pointer tap targets: the buttons and the file input must meet
  // the 44px minimum (Apple HIG / WCAG AAA) — the "too small to tap" half of
  // the user report.
  for (const sel of ['#webcam-toggle', '#photo-input']) {
    const box = await page.locator(sel).boundingBox();
    expect(
      box.height,
      `${sel} must be at least 44px tall to tap (got ${box.height})`,
    ).toBeGreaterThanOrEqual(44);
  }

  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

// Landscape phones sit inside the same ≤640px breakpoint but are only
// ~320–360px TALL — and the bottom-docked panel is taller than that, so
// without a height cap it collides with the top chrome and extends above the
// viewport, where body{overflow:hidden} makes the clipped rows unreachable
// (verifier finding: at 640×360 the uncapped panel overlapped #app-title AND
// #build-credit, and with a grown status line its top edge went negative).
// Contract here: the panel stays clear of the top chrome and fully inside the
// viewport, and anything clipped is reachable by scrolling the panel itself.
test('mobile landscape: panel caps its height below the top chrome and scrolls internally', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);
  await expect(page.locator('#boot-loader')).toHaveCount(0);

  // Grow the panel through its real growth path — a long status error line
  // (mobile drops the desktop max-width, so this wraps to multiple rows).
  await page.evaluate(() => {
    document.getElementById('status').textContent =
      'Webcam failed: NotReadableError: Could not start video source — the ' +
      'device is already in use by another application.';
  });

  const viewport = page.viewportSize();
  const chrome = {};
  for (const id of ['controls', 'app-title', 'build-credit']) {
    const el = page.locator(`#${id}`);
    await expect(el, `#${id} must be visible in landscape`).toBeVisible();
    chrome[id] = await el.boundingBox();
  }
  const ids = Object.keys(chrome);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      expect(
        intersects(chrome[ids[i]], chrome[ids[j]]),
        `#${ids[i]} ${JSON.stringify(chrome[ids[i]])} must not overlap #${
          ids[j]
        } ${JSON.stringify(chrome[ids[j]])} in landscape`,
      ).toBe(false);
    }
  }
  expect(
    insideViewport(chrome['controls'], viewport),
    `#controls ${JSON.stringify(chrome['controls'])} must sit fully inside the ${
      viewport.width
    }×${viewport.height} viewport`,
  ).toBe(true);

  // The grown panel cannot fit 44px rows in ~280px of height, so it must be
  // scrollable — and scrolling must actually move (reach the clipped rows).
  const scroll = await page.evaluate(() => {
    const el = document.getElementById('controls');
    const scrollable = el.scrollHeight > el.clientHeight + 1;
    el.scrollTop = el.scrollHeight;
    return { scrollable, moved: el.scrollTop > 0 };
  });
  expect(scroll.scrollable, 'clipped panel must overflow internally').toBe(true);
  expect(scroll.moved, 'panel must scroll to reach clipped controls').toBe(true);

  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});

// Touch orbit: a one-finger drag on the canvas must rotate the camera.
// OrbitControls listens to pointer events, but its pointerdown handler calls
// setPointerCapture(event.pointerId) unguarded (verified in the installed
// three 0.185 source) — a synthetic dispatchEvent(new PointerEvent(...)) has
// no active pointer behind it, so Chromium throws NotFoundError and orbit
// never engages. CDP Input.dispatchTouchEvent drives the REAL input pipeline:
// the browser itself synthesizes trusted pointerdown/move/up events with
// pointerType 'touch' and a live active pointer, exactly what a finger sends.
test('mobile: a touch drag on the canvas orbits the camera', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__app?.getPointCount() === 128 * 128);
  await expect(page.locator('#boot-loader')).toHaveCount(0);

  const before = await page.evaluate(() =>
    window.__app.camera.quaternion.toArray(),
  );

  // Drag across the upper-middle of the screen — canvas territory, clear of
  // the title (top) and the docked controls panel (bottom).
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 195, y: 300 }],
  });
  for (let i = 1; i <= 8; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 195 + i * 15, y: 300 + i * 6 }],
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  // The rAF loop applies the rotation via controls.update(); wait until the
  // camera orientation has actually moved off its starting quaternion.
  await page.waitForFunction((start) => {
    const q = window.__app.camera.quaternion.toArray();
    return q.some((v, i) => Math.abs(v - start[i]) > 1e-4);
  }, before);

  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([]);
});
