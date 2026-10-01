// Turns MediaPipe's test portrait (e2e/fixtures/portrait.jpg) into a video file Chrome can play as a
// fake webcam (--use-file-for-fake-video-capture). Chrome accepts .y4m (raw YUV 4:2:0) and .mjpeg;
// Y4M is the robust choice because the portrait is a progressive JPEG. The JPEG is decoded by Chrome
// itself (canvas → getImageData), so no image library is needed.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

export const FIXTURES = resolve(import.meta.dirname, 'fixtures');
export const PORTRAIT_JPG = resolve(FIXTURES, 'portrait.jpg');
export const PORTRAIT_Y4M = resolve(FIXTURES, 'portrait.y4m');

/** Webcam-like 4:3 frame cut from the 820×1024 portrait, centred on the face (native pixels, no scaling). */
const CROP = { x: 80, y: 0, w: 640, h: 480 };

export async function makeFakeCameraVideo(force = false): Promise<string> {
  if (!force && existsSync(PORTRAIT_Y4M)) return PORTRAIT_Y4M;
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    const dataUrl = `data:image/jpeg;base64,${readFileSync(PORTRAIT_JPG).toString('base64')}`;
    const rgba: number[] = await page.evaluate(async ({ dataUrl, c }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = c.w;
      canvas.height = c.h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
      return Array.from(ctx.getImageData(0, 0, c.w, c.h).data);
    }, { dataUrl, c: CROP });
    writeFileSync(PORTRAIT_Y4M, toY4m(Uint8ClampedArray.from(rgba), CROP.w, CROP.h));
  } finally {
    await browser.close();
  }
  return PORTRAIT_Y4M;
}

/** RGBA → one-frame Y4M, I420 (BT.601 full range, "C420jpeg"). Chrome loops the single frame. */
function toY4m(rgba: Uint8ClampedArray, w: number, h: number): Buffer {
  const y = Buffer.alloc(w * h);
  const u = Buffer.alloc((w / 2) * (h / 2));
  const v = Buffer.alloc((w / 2) * (h / 2));
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const p = (j * w + i) * 4;
      y[j * w + i] = clamp(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
    }
  }
  for (let j = 0; j < h / 2; j++) {
    for (let i = 0; i < w / 2; i++) {
      let r = 0, g = 0, b = 0;
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const p = ((2 * j + dj) * w + (2 * i + di)) * 4;
        r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2];
      }
      r /= 4; g /= 4; b /= 4;
      u[j * (w / 2) + i] = clamp(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
      v[j * (w / 2) + i] = clamp(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
    }
  }
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`, 'ascii');
  return Buffer.concat([header, Buffer.from('FRAME\n', 'ascii'), y, u, v]);
}
