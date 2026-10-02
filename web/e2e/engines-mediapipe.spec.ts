// Does the camera pipeline run in each browser engine (above all WebKit, Safari's engine)?
// Playwright's WebKit and Firefox have no fake-webcam flags, so:
//  1. IMAGE mode: MediaPipe Face Landmarker (the app's WASM + model, served by vite preview) runs on
//     MediaPipe's test portrait with the app's own irisWidthNorm/distanceFromIris, once with the GPU
//     delegate and once with CPU; then VIDEO mode (the app's running mode, 30 frames of a 640×480 canvas)
//     for both delegates, plus a probe of the engine's media support.
//  2. The real app code on lab.html and test.html, with getUserMedia() stubbed so the <video> element
//     plays a looping WebM of the same portrait (cropped like e2e/fake-camera.ts; see
//     e2e/fake-camera-webm.ts). Everything after getUserMedia (video element, VIDEO-mode
//     detectForVideo, eye check, smoothing, steadiness) is the app's own code.
// Runs on phone (Chrome), webkit-iphone and firefox-desktop. With QUALITY=1 the numbers are saved
// for public/data/quality.json (see quality/README.md).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { PORTRAIT_JPG } from './fake-camera';
import { portraitWebm } from './fake-camera-webm';
import { answerSafety, mockApi } from './helpers';
import type { HarnessReport } from './mediapipe-harness';
import { saveQuality } from './quality-out';

test.describe.configure({ timeout: 180_000 });

// Measured by the IMAGE-mode test (report.media): Playwright's Windows WebKit build has no MediaStream,
// no canvas.captureStream and cannot decode video (MEDIA_ERR_SRC_NOT_SUPPORTED, no MediaSource), so a
// <video>-based camera cannot be simulated there. iOS/macOS Safari have all three. The WebKit evidence
// for the camera path is the IMAGE- and VIDEO-mode MediaPipe runs in the first test.
const WEBKIT_NO_VIDEO = 'Playwright Windows WebKit cannot play video or build a MediaStream (see first test, report.media)';

let bundle: string | null = null;
async function harnessBundle(): Promise<string> {
  if (!bundle) {
    const out = await build({
      entryPoints: [resolve(import.meta.dirname, 'mediapipe-harness.ts')],
      bundle: true, format: 'esm', target: 'es2020', write: false, logLevel: 'silent',
    });
    bundle = out.outputFiles[0].text;
  }
  return bundle;
}

/** Serves the harness page, its bundle and the portrait under /__quality/ (never reaches the server). */
async function routeHarness(page: Page): Promise<void> {
  const js = await harnessBundle();
  const webm = await portraitWebm();
  await page.route('**/__quality/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/portrait.jpg')) return route.fulfill({ contentType: 'image/jpeg', body: readFileSync(PORTRAIT_JPG) });
    if (path.endsWith('/portrait.webm') && webm) return route.fulfill({ contentType: 'video/webm', body: readFileSync(webm) });
    if (path.endsWith('/harness.js')) return route.fulfill({ contentType: 'text/javascript', body: js });
    return route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><title>harness</title><img id="portrait" alt="" src="/__quality/portrait.jpg"><script type="module" src="/__quality/harness.js"></script>',
    });
  });
}

/** getUserMedia → a stand-in stream; assigning it to video.srcObject plays a looping 640×480 WebM of the
 *  portrait instead (same crop as the Chrome fake camera). Same stub on every engine, so the numbers
 *  compare like for like; Windows WebKit has no MediaStream/captureStream to build a real stream from. */
async function stubCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fake = { fakeCamera: true, getTracks: () => [{ kind: 'video', stop() {} }], getVideoTracks: () => [{ kind: 'video', stop() {} }] };
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => fake, configurable: true });
    const native = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
    const held = new WeakMap<HTMLMediaElement, unknown>();
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      get(this: HTMLMediaElement) { return held.get(this) ?? native?.get?.call(this) ?? null; },
      set(this: HTMLMediaElement, v: unknown) {
        if (v === fake) {
          held.set(this, v);
          this.loop = true;
          this.src = '/__quality/portrait.webm';
        } else native?.set?.call(this, v);
      },
    });
  });
}

test('MediaPipe IMAGE mode: iris landmarks and a finite distance (GPU and CPU delegates)', async ({ page }, testInfo) => {
  await routeHarness(page);
  await page.goto('/__quality/harness.html');
  await page.waitForFunction(() => 'runHarness' in window, null, { timeout: 30_000 });
  const report = await page.evaluate(() => (window as unknown as { runHarness: () => Promise<HarnessReport> }).runHarness());
  console.log(`[${testInfo.project.name}] ${JSON.stringify(report)}`);
  saveQuality(`engine-image-${testInfo.project.name}`, { project: testInfo.project.name, browserVersion: page.context().browser()?.version(), ...report });

  expect(report.appDelegate).not.toBe('none');
  const appVideo = report.video.find((v) => v.delegate === report.appDelegate);
  expect(appVideo?.ok, 'VIDEO mode with the app delegate tracks the face on every frame').toBe(true);
  expect(Number.isFinite(appVideo?.distanceCm)).toBe(true);
  expect(report.appDelegateWorks, 'the delegate the app picks must produce iris landmarks').toBe(true);
  for (const r of report.runs.filter((x) => x.ok)) {
    expect(r.landmarks).toBe(478);
    expect(r.irisLandmarks).toBe(10);
    expect(Number.isFinite(r.distanceCm)).toBe(true);
    expect(r.distanceCm!).toBeGreaterThan(5);
    expect(r.distanceCm!).toBeLessThan(200);
  }
});

test('lab.html: live distance from the app camera code on a synthetic camera stream', async ({ page, browserName }, testInfo) => {
  test.skip(browserName === 'webkit', WEBKIT_NO_VIDEO);
  test.skip(!(await portraitWebm()), "needs Playwright's ffmpeg (npx playwright install ffmpeg)");
  await routeHarness(page);
  await stubCamera(page);
  await page.goto('/lab.html?dev');
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Start camera' }).click();
  const live = page.locator('#live');
  await expect(live).toHaveText(/^\d+(\.\d)? cm$/, { timeout: 90_000 });
  const firstDistanceMs = Date.now() - t0;
  const fps: number[] = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(500);
    fps.push(Number(await page.locator('#fps').textContent()));
  }
  const cm = parseFloat((await live.textContent())!);
  const iris = parseFloat((await page.locator('#iris').textContent())!);
  const vsize = await page.locator('#vsize').textContent();
  const result = { project: testInfo.project.name, browserVersion: page.context().browser()?.version(), firstDistanceMs, distanceCm: cm, irisNorm: iris, video: vsize, fps };
  console.log(`[${testInfo.project.name}] lab ${JSON.stringify(result)}`);
  saveQuality(`engine-lab-${testInfo.project.name}`, result);
  expect(cm).toBeGreaterThanOrEqual(10);
  expect(cm).toBeLessThanOrEqual(200);
  expect(iris).toBeGreaterThan(0);
});

test('test.html camera flow: working distance measured from the synthetic camera', async ({ page, browserName }, testInfo) => {
  test.skip(browserName === 'webkit', WEBKIT_NO_VIDEO);
  test.skip(!(await portraitWebm()), "needs Playwright's ffmpeg (npx playwright install ffmpeg)");
  await mockApi(page);
  await routeHarness(page);
  await stubCamera(page);
  await page.goto('/test.html?dev');
  await page.getByRole('button', { name: 'Start with camera' }).click();
  await answerSafety(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Turn on your camera' })).toBeVisible();
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Allow camera' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Match a card to the screen' })).toBeVisible({ timeout: 90_000 });
  const cameraReadyMs = Date.now() - t0;
  await page.getByRole('button', { name: 'I don’t have a card' }).click();
  await expect(page.locator('[data-live]')).toHaveText(/^\d+ cm$/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Skip (less accurate)' }).click();
  const got = page.getByText(/^Got it: you read at about \d+ cm\.$/);
  await expect(got).toBeVisible({ timeout: 30_000 });
  const workingCm = Number((await got.textContent())!.match(/(\d+) cm/)![1]);
  const result = { project: testInfo.project.name, cameraReadyMs, workingCm };
  console.log(`[${testInfo.project.name}] flow ${JSON.stringify(result)}`);
  saveQuality(`engine-flow-${testInfo.project.name}`, result);
  expect(workingCm).toBeGreaterThanOrEqual(10);
  expect(workingCm).toBeLessThanOrEqual(200);
});
