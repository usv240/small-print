import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const FAKE_VIDEO = resolve(import.meta.dirname, 'e2e/fixtures/portrait.y4m');

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // The installed Google Chrome, so no browser download is needed.
    channel: 'chrome',
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      testIgnore: /camera-fake/,
      use: { ...devices['Pixel 7'], channel: 'chrome' },
    },
    {
      // Real MediaPipe path: Chrome plays MediaPipe's test portrait as the webcam.
      name: 'fake-camera',
      testMatch: /camera-fake/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${FAKE_VIDEO}`,
          ],
        },
      },
    },
  ],
  webServer: {
    // Production build, but without scripts/compress-dist.mjs: that step rewrites the MediaPipe
    // .wasm files as brotli bytes, which `vite preview` would serve without Content-Encoding.
    command: 'node scripts/copy-mediapipe.mjs && npx vite build && npx vite preview --port 4173 --strictPort',
    url: `http://localhost:${PORT}/test.html`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
