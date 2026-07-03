import { defineConfig, devices } from '@playwright/test';

// Headless WebGL is the fragile part of testing a Three.js app in CI, so we
// force software rendering (SwiftShader via ANGLE) and allow it explicitly —
// Chrome 128+ requires --enable-unsafe-swiftshader to run WebGL on software.
const webglArgs = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  // Milestone 4: grant a synthetic camera so getUserMedia works headlessly —
  // the fake device produces a rolling test-pattern video, no hardware needed.
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
];

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: webglArgs },
      },
    },
  ],
  // `npm test` builds first, then this serves the production build for the smoke
  // test to hit — the same bytes that would ship.
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
