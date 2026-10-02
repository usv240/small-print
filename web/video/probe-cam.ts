// Checks that the app's real camera pipeline (lab.html: MediaPipe + eye-visibility check) measures the
// illustrated face fed through Chrome's fake webcam. Prints (camera frame, designed cm, live reading).
// Usage: npx tsx video/probe-cam.ts <y4m> [seconds]
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { DECODE_FRAME_JS } from './face';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4789';
const file = resolve(process.argv[2]);
const seconds = Number(process.argv[3] ?? 10);
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${file}`],
});
const page = await browser.newPage();
await page.goto(`${BASE}/lab.html?dev`);
await page.getByRole('button', { name: 'Start camera' }).click();
const t0 = Date.now();
const rows: string[] = [];
while (Date.now() - t0 < seconds * 1000) {
  const r = await page.evaluate(`({ f: ${DECODE_FRAME_JS}, live: document.getElementById('live').textContent, iris: document.getElementById('iris').textContent, fps: document.getElementById('fps').textContent, size: document.getElementById('vsize').textContent })`) as any;
  rows.push(`${((Date.now() - t0) / 1000).toFixed(1)}s frame ${r.f} live ${r.live} iris ${r.iris} fps ${r.fps} ${r.size}`);
  await page.waitForTimeout(250);
}
console.log(rows.join('\n'));
await browser.close();
