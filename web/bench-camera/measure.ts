// One bench run: Chrome plays a .y4m as its webcam, lab.html runs the shipped MediaPipe pipeline
// (src/camera/distance.ts, unchanged), and we record every raw iris width it computes.
//
// lab.ts prints the raw iris width with s.irisNorm.toFixed(5), once per processed frame. To keep full
// precision without touching app code, an init script wraps Number.prototype.toFixed and records the
// number whenever it is called with 5 digits (only that line in lab.ts does this). The wrapper returns
// the normal result, so the page behaves exactly as usual.

import { chromium, type ConsoleMessage } from '@playwright/test';

export interface RunResult {
  video: string;
  /** Raw iris widths (fraction of video width), one per processed frame, after warm-up. */
  iris: number[];
  /** Page timestamps (ms) of those frames. */
  t: number[];
  /** #fps readings (frames processed in the last second), sampled every 250 ms. */
  fps: number[];
  /** #live text at the end (the app's smoothed, uncalibrated distance). */
  live: string;
  vsize: string;
  webgl: string;
  delegateHints: string[];
  console: string[];
  warmupMs: number;
  collectMs: number;
}

const INIT = `(() => {
  const orig = Number.prototype.toFixed;
  window.__iris = [];
  window.__irisT = [];
  Number.prototype.toFixed = function (d) {
    if (d === 5) { window.__iris.push(Number(this)); window.__irisT.push(performance.now()); }
    return orig.call(this, d);
  };
})();`;

export async function measure(baseUrl: string, videoPath: string, opts: { warmupMs: number; collectMs: number; headless?: boolean }): Promise<RunResult> {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: opts.headless ?? true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${videoPath}`,
    ],
  });
  const logs: string[] = [];
  try {
    const context = await browser.newContext({ permissions: ['camera'], viewport: { width: 1280, height: 800 } });
    await context.addInitScript(INIT);
    const page = await context.newPage();
    page.on('console', (m: ConsoleMessage) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    await page.goto(`${baseUrl}/lab.html`);
    const webgl = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null;
      if (!gl) return 'no WebGL2';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)} | ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : String(gl.getParameter(gl.RENDERER));
    });
    await page.getByRole('button', { name: 'Start camera' }).click();
    await page.locator('#iris').filter({ hasText: /^0\.\d{5}$/ }).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(opts.warmupMs);
    await page.evaluate(() => { (window as any).__iris.length = 0; (window as any).__irisT.length = 0; });
    const fps: number[] = [];
    const end = Date.now() + opts.collectMs;
    while (Date.now() < end) {
      await page.waitForTimeout(250);
      const f = Number(await page.locator('#fps').textContent());
      if (Number.isFinite(f)) fps.push(f);
    }
    const { iris, t } = await page.evaluate(() => ({ iris: [...(window as any).__iris] as number[], t: [...(window as any).__irisT] as number[] }));
    const live = (await page.locator('#live').textContent()) ?? '';
    const vsize = (await page.locator('#vsize').textContent()) ?? '';
    const delegateHints = logs.filter((l) => /gpu|webgl|delegate|xnnpack|cpu|opengl|gl version/i.test(l));
    return { video: videoPath, iris, t, fps, live, vsize, webgl, delegateHints, console: logs.slice(0, 40), warmupMs: opts.warmupMs, collectMs: opts.collectMs };
  } finally {
    await browser.close();
  }
}

/** This laptop's real screen as Chrome reports it: a visible window with no viewport emulation. */
export async function readScreen(): Promise<{ devicePixelRatio: number; screen: string; availScreen: string; userAgent: string }> {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  try {
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    await page.goto('about:blank');
    return await page.evaluate(() => ({
      devicePixelRatio: window.devicePixelRatio,
      screen: `${screen.width}x${screen.height}`,
      availScreen: `${screen.availWidth}x${screen.availHeight}`,
      userAgent: navigator.userAgent,
    }));
  } finally {
    await browser.close();
  }
}
