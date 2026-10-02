// "Works on cheap phones?" Chrome with CDP CPU throttling (4× and 6×, plus 1× for reference) and
// DevTools network presets, on a Pixel 7-sized viewport with Chrome's fake camera playing MediaPipe's
// test portrait. Measures:
//   1. time to interactive of /test.html (cold cache) and the response to the first tap,
//   2. time from tapping "Allow camera" to the first distance on screen (cold cache: includes downloading
//      the WebAssembly runtime and the face model),
//   3. frames per second of the landmark loop on lab.html (warm), with the GPU delegate and with WebGL
//      disabled (forces MediaPipe's CPU delegate, the worst case for a phone with a weak GPU).
// Against the LIVE site by default (real CDN compression and caching); PERF_BASE overrides it.
// The results API is mocked, so nothing is posted. Skipped unless QUALITY_PERF=1 (takes ~6 min).
// Caveat: CDP CPU throttling slows the page's main thread (where MediaPipe's WASM runs); GPU work runs in
// Chrome's GPU process at full speed, so GPU-delegate numbers flatter a cheap phone's GPU.

import { chromium, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { devices } from '@playwright/test';
import { resolve } from 'node:path';
import { answerSafety, mockApi } from './helpers';
import { saveQuality } from './quality-out';

const BASE = process.env.PERF_BASE ?? 'https://dxug72099q2ay.cloudfront.net';
const FAKE_VIDEO = resolve(import.meta.dirname, 'fixtures/portrait.y4m');
const CAMERA_ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${FAKE_VIDEO}`];

/** Chrome DevTools presets (throughput in bytes/s; DevTools applies these exact numbers). */
const NETWORKS = {
  none: null,
  // DevTools "Slow 4G" (called "Fast 3G" before Chrome 125): 1.6 Mbps × 0.9 down, 750 kbps × 0.9 up, 150 ms × 3.75 RTT.
  'slow-4g': { latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024 / 8) * 0.9, uploadThroughput: (750 * 1024 / 8) * 0.9 },
  // DevTools "Fast 4G": 9 Mbps × 0.9 down, 1.5 Mbps × 0.9 up, 60 ms × 2.75 RTT.
  'fast-4g': { latency: 165, downloadThroughput: (9 * 1024 * 1024 / 8) * 0.9, uploadThroughput: (1.5 * 1024 * 1024 / 8) * 0.9 },
} as const;
type Net = keyof typeof NETWORKS;

test.skip(!process.env.QUALITY_PERF, 'set QUALITY_PERF=1 to run the low-end phone measurements');
test.describe.configure({ mode: 'serial', timeout: 600_000 });

const phone = { ...devices['Pixel 7'] } as Record<string, unknown>;
delete phone.defaultBrowserType;

async function throttled(browser: Browser, cpu: number, net: Net, calibrated = false): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ ...phone, baseURL: BASE, permissions: ['camera'], serviceWorkers: 'block', locale: 'en-US' });
  if (calibrated) {
    // Stored calibration for the fake camera (640×480, iris ≈ 0.0272 of the width ↔ 30 cm), so
    // "Allow camera" goes straight to the live-distance screen.
    await context.addInitScript(() => localStorage.setItem('small-print.calibration.v1', JSON.stringify({
      screen: { cssPxPerMm: 6.0, at: '2026-10-01T00:00:00Z' }, camera: { k: 8.17, aspect: 4 / 3, refMm: 300, at: '2026-10-01T00:00:00Z' },
    })));
  }
  const page = await context.newPage();
  await mockApi(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const n = NETWORKS[net];
  if (n) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...n });
  }
  return { context, page };
}

/** In-page probes: long tasks, LCP, and when a selector first appears (performance.now() timestamps). */
async function installProbes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __q: { longTasks: [number, number][]; lcp: number; seen: Record<string, number>; watch: string[] } };
    w.__q = { longTasks: [], lcp: 0, seen: {}, watch: ['#start', '[data-live]'] };
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__q.longTasks.push([e.startTime, e.startTime + e.duration]))).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { w.__q.lcp = e.startTime; })).observe({ type: 'largest-contentful-paint', buffered: true });
    const check = () => {
      for (const sel of w.__q.watch) {
        if (w.__q.seen[sel]) continue;
        const el = document.querySelector(sel);
        if (el && (sel !== '[data-live]' || /\d+ cm/.test(el.textContent ?? ''))) w.__q.seen[sel] = performance.now();
      }
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

const q = (page: Page) => page.evaluate(() => (window as unknown as { __q: { longTasks: [number, number][]; lcp: number; seen: Record<string, number> } }).__q);

const results: Record<string, unknown[]> = { tti: [], camera: [], labFps: [] };

test('time to interactive of /test.html (cold cache)', async ({ browser }) => {
  for (const net of ['fast-4g', 'slow-4g'] as Net[]) {
    for (const cpu of [1, 4, 6]) {
      const runs: Record<string, number>[] = [];
      for (let rep = 0; rep < 2; rep++) {
        const { context, page } = await throttled(browser, cpu, net);
        await installProbes(page);
        await page.goto('/test.html?dev');
        await expect(page.locator('#start')).toBeVisible({ timeout: 120_000 });
        // Interactive = start button rendered (handlers attach in the same task) and 1 s without long tasks.
        let probe = await q(page);
        for (let i = 0; i < 60; i++) {
          const now = await page.evaluate(() => performance.now());
          probe = await q(page);
          const lastEnd = Math.max(0, ...probe.longTasks.map(([, e]) => e));
          if (now - lastEnd >= 1000) break;
          await page.waitForTimeout(250);
        }
        const nav = await page.evaluate(() => {
          const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
          const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
          const bytes = performance.getEntriesByType('resource').reduce((a, r) => a + ((r as PerformanceResourceTiming).transferSize || 0), n.transferSize || 0);
          return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, fcp, bytes };
        });
        const startSeen = probe.seen['#start'];
        const lastLong = Math.max(0, ...probe.longTasks.filter(([s]) => s <= startSeen + 5000).map(([, e]) => e));
        const tbt = probe.longTasks.reduce((a, [s, e]) => a + Math.max(0, e - s - 50), 0);
        // First tap: "Try without a camera" → safety questions heading.
        const tap = await page.evaluate(async () => {
          const t0 = performance.now();
          (document.getElementById('demo') as HTMLButtonElement).click();
          await new Promise<void>((r) => { const tick = () => (document.querySelector('fieldset.q') ? r() : requestAnimationFrame(tick)); tick(); });
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          return performance.now() - t0;
        });
        runs.push({ fcpMs: nav.fcp ?? NaN, lcpMs: probe.lcp, dclMs: nav.dcl, loadMs: nav.load, startButtonMs: startSeen, ttiMs: Math.max(startSeen, lastLong), tbtMs: tbt, firstTapToNextScreenMs: tap, transferKiB: nav.bytes / 1024 });
        await context.close();
      }
      const med = (k: string) => Math.round(runs.map((r) => r[k]).sort((a, b) => a - b)[Math.floor((runs.length - 1) / 2)] * 10) / 10;
      const row = { cpu, net, runs: runs.length, fcpMs: med('fcpMs'), lcpMs: med('lcpMs'), ttiMs: med('ttiMs'), tbtMs: med('tbtMs'), firstTapToNextScreenMs: med('firstTapToNextScreenMs'), transferKiB: med('transferKiB'), ttiAll: runs.map((r) => Math.round(r.ttiMs)) };
      console.log(`[tti] ${JSON.stringify(row)}`);
      results.tti.push(row);
    }
  }
  saveQuality('lowend-perf', { base: BASE, results });
});

test('"Allow camera" → first distance (cold cache: downloads runtime + model)', async ({ browser }) => {
  for (const net of ['fast-4g', 'slow-4g'] as Net[]) {
    for (const cpu of [1, 4, 6]) {
      const { context, page } = await throttled(browser, cpu, net, true);
      await installProbes(page);
      await page.goto('/test.html?dev');
      await page.getByRole('button', { name: 'Start with camera' }).click();
      await answerSafety(page);
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Turn on your camera' })).toBeVisible();
      const t0 = await page.evaluate(() => { (document.getElementById('allow') as HTMLButtonElement).click(); return performance.now(); });
      await expect(page.locator('[data-live]')).toHaveText(/^\d+ cm$/, { timeout: 300_000 });
      const probe = await q(page);
      const bytes = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /mediapipe|models/.test(r.name))
        .reduce((a, r) => a + ((r as PerformanceResourceTiming).transferSize || 0), 0));
      const row = { cpu, net, allowToFirstDistanceMs: Math.round(probe.seen['[data-live]'] - t0), downloadedKiB: Math.round(bytes / 1024), shown: await page.locator('[data-live]').textContent() };
      console.log(`[camera] ${JSON.stringify(row)}`);
      results.camera.push(row);
      await context.close();
    }
  }
  saveQuality('lowend-perf', { base: BASE, results });
});

test('lab.html landmark loop fps (warm cache), GPU delegate vs WebGL disabled', async ({ browser }) => {
  const noGpu = await chromium.launch({ channel: 'chrome', args: [...CAMERA_ARGS, '--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] });
  try {
    for (const [mode, b] of [['gpu', browser], ['webgl-disabled', noGpu]] as const) {
      for (const cpu of [1, 4, 6]) {
        const { context, page } = await throttled(b, cpu, 'none');
        // No network throttling here: the first start includes an unthrottled download of the runtime + model.
        await page.goto('/lab.html?dev');
        const webgl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
        const t0 = Date.now();
        await page.getByRole('button', { name: 'Start camera' }).click();
        await expect(page.locator('#live')).toHaveText(/^\d+(\.\d)? cm$/, { timeout: 300_000 });
        const startMs = Date.now() - t0;
        await page.waitForTimeout(3000);
        const fps: number[] = [];
        for (let i = 0; i < 10; i++) {
          await page.waitForTimeout(500);
          fps.push(Number(await page.locator('#fps').textContent()));
        }
        const sorted = [...fps].sort((x, y) => x - y);
        const row = { mode, webgl2: webgl, cpu, startToFirstDistanceMs: startMs, fpsMedian: sorted[Math.floor(sorted.length / 2)], fpsMin: sorted[0], fpsSamples: fps, distance: await page.locator('#live').textContent() };
        console.log(`[lab] ${JSON.stringify(row)}`);
        results.labFps.push(row);
        await context.close();
      }
    }
  } finally {
    await noGpu.close();
  }
  saveQuality('lowend-perf', { base: BASE, chrome: browser.version(), results });
});
