import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const FAKE_VIDEO = resolve(import.meta.dirname, 'e2e/fixtures/portrait.y4m');
/** Specs that also run on the WebKit (iPhone) and Firefox projects. offline.spec stays Chrome-only:
 *  Playwright's setOffline() in WebKit also fails requests the service worker answers from cache, and in
 *  Firefox a page loaded while "offline" never gets the `online` event. Offline mode is checked on all
 *  three engines with a real outage instead: node quality/offline-engines.mjs. */
const ENGINE_SPECS = /(demo-flow|safety|camp|a11y|engines-mediapipe)\.spec/;

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
    // Chrome projects use the installed Google Chrome (`channel: 'chrome'`, set per project so the
    // WebKit and Firefox projects can use Playwright's own builds: `npx playwright install webkit firefox`).
    locale: 'en-US',
    trace: 'retain-on-failure',
    // The app registers a service worker; block it so page.route() API mocks always apply.
    // e2e/offline.spec.ts opts back in to test offline mode.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'phone',
      testIgnore: [/camera-fake/, /lowend-perf/],
      use: { ...devices['Pixel 7'], channel: 'chrome' },
    },
    {
      // Safari's engine. Playwright's WebKit build on Windows is close to, but not the same as, iOS Safari
      // (no iOS media stack, different GPU path), so treat a pass here as strong evidence, not proof.
      // reducedMotion: the site uses `scroll-behavior: smooth`; WebKit and Firefox honour it when Playwright
      // scrolls a control into view, so the click can land mid-scroll on the fixed demo bar (Chrome scrolls
      // instantly via CDP). Reduced motion turns smooth scrolling off, as it does for users who ask for it.
      name: 'webkit-iphone',
      testMatch: ENGINE_SPECS,
      // Windows WebKit pages crash ("Page crashed") when ~10 run at once alongside the other projects,
      // and its full flows take 25–35 s alone but over 60 s when the whole suite runs in parallel.
      workers: 2,
      timeout: 120_000,
      use: { ...devices['iPhone 15'], reducedMotion: 'reduce' },
    },
    {
      name: 'firefox-desktop',
      testMatch: ENGINE_SPECS,
      // Passes 9/9 alone, but with the whole suite in parallel the demo slider's 33 ms timer can stall
      // long enough that the 15 s "Got it" wait in camp.spec times out.
      workers: 3,
      timeout: 120_000,
      use: { ...devices['Desktop Firefox'], reducedMotion: 'reduce' },
    },
    {
      // Low-end phone measurements (CDP CPU + network throttling, fake camera). Chrome only, and
      // skipped unless QUALITY_PERF=1, because it takes a few minutes. See quality/README.md.
      name: 'lowend-perf',
      testMatch: /lowend-perf/,
      timeout: 600_000,
      use: {
        ...devices['Pixel 7'],
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
