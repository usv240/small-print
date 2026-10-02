// Offline check per engine WITHOUT Playwright's network emulation: serve dist/ with `vite preview` on a
// private port, let the service worker install, then kill the server and reload. Playwright's
// context.setOffline() in WebKit also fails requests the service worker would answer from cache
// ("Load failed" even for cache-first files), so e2e/offline.spec.ts can't tell an emulation quirk from a
// real Safari problem. Killing the server is a real "no connection" for the page.
//
// Needs a build in dist/ (npx playwright test builds it; or `npx vite build`). Run: node quality/offline-engines.mjs
// Writes quality/results/offline-engines.json.

import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices, firefox, webkit } from 'playwright';

const PORT = Number(process.env.OFFLINE_PORT ?? 4181);
const BASE = `http://localhost:${PORT}`;
const root = resolve(import.meta.dirname, '..');

function startServer() {
  const p = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, shell: true, stdio: 'ignore' });
  return p;
}
function killServer(p) {
  if (process.platform === 'win32') { try { execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
  else p.kill('SIGKILL');
}
async function waitUp(up = true) {
  for (let i = 0; i < 100; i++) {
    const ok = await fetch(`${BASE}/test.html`).then((r) => r.ok, () => false);
    if (ok === up) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not go ${up ? 'up' : 'down'}`);
}

const engines = [
  ['webkit-iphone', webkit, devices['iPhone 15']],
  ['firefox-desktop', firefox, devices['Desktop Firefox']],
  ['chrome-phone', chromium, { ...devices['Pixel 7'], channel: undefined }],
];
const results = {};
for (const [name, type, device] of engines) {
  const server = startServer();
  const r = { engine: name };
  let browser;
  try {
    await waitUp(true);
    browser = await type.launch(name === 'chrome-phone' ? { channel: 'chrome' } : {});
    r.browserVersion = browser.version();
    const { defaultBrowserType: _d, ...opts } = device;
    const context = await browser.newContext({ ...opts, serviceWorkers: 'allow' });
    const page = await context.newPage();
    await page.goto(`${BASE}/test.html?demo&dev`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    for (let i = 0; i < 50 && !(await page.evaluate(() => !!navigator.serviceWorker.controller)); i++) await page.waitForTimeout(100);
    r.controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    r.precached = await page.evaluate(async () => {
      const urls = ['/test.html', '/models/face_landmarker.task', '/mediapipe/wasm/vision_wasm_internal.wasm'];
      return Promise.all(urls.map(async (u) => !!(await caches.match(u))));
    });
    killServer(server);
    await waitUp(false);
    try {
      await page.reload({ timeout: 15_000 });
      r.offlineReload = 'ok';
      r.offlineH1 = (await page.locator('h1').first().textContent({ timeout: 10_000 }))?.trim();
      r.offlineModelFetch = await page.evaluate(async () => {
        try { const res = await fetch('/models/face_landmarker.task'); return `${res.status} ${(await res.arrayBuffer()).byteLength} bytes`; } catch (e) { return String(e); }
      });
    } catch (e) {
      r.offlineReload = `failed: ${String(e.message ?? e).split('\n')[0]}`;
    }
    r.pass = r.controlled && r.offlineReload === 'ok' && r.offlineH1 === 'First, a few safety questions' && /^200 /.test(r.offlineModelFetch ?? '');
  } catch (e) {
    r.error = String(e.message ?? e).split('\n')[0];
    r.pass = false;
  } finally {
    await browser?.close();
    killServer(server);
  }
  console.log(JSON.stringify(r));
  results[name] = r;
}
mkdirSync(resolve(root, 'quality/results'), { recursive: true });
writeFileSync(resolve(root, 'quality/results/offline-engines.json'), JSON.stringify({ at: new Date().toISOString(), port: PORT, results }, null, 2));
