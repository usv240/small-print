// Fake-webcam videos for the camera distance bench: MediaPipe's test portrait, rescaled to simulate the
// face being nearer or farther. In a pinhole camera, moving a face from distance d to d/s scales its
// image by s, so drawing the same photo at scale s is optically the face at d0/s (for the iris, which is
// close to flat; a flat photo can't reproduce the small perspective changes of a real 3D head).
//
// Each video is one 640×480 I420 frame (Chrome loops it), so every frame the pipeline sees is identical
// and any frame-to-frame variation is the landmark model itself. The JPEG is decoded and rescaled by
// Chrome (canvas, high-quality smoothing), so no image library is needed. The Y4M writer is the same
// conversion as e2e/fake-camera.ts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

export const FRAME = { w: 640, h: 480 };
/** Face centre in the 820×1024 portrait (between the eyes, a little above). Kept at the frame centre. */
export const PIVOT = { x: 400, y: 190 };
/** Neutral mid-grey outside the photo when it is drawn smaller than the frame. */
const BACKGROUND = 'rgb(128,128,128)';

export const PORTRAIT_JPG = resolve(import.meta.dirname, '../e2e/fixtures/portrait.jpg');
const PORTRAIT_URL = 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg';

export async function ensurePortrait(): Promise<void> {
  if (existsSync(PORTRAIT_JPG)) return;
  const res = await fetch(PORTRAIT_URL);
  if (!res.ok) throw new Error(`Could not download ${PORTRAIT_URL}: ${res.status}`);
  mkdirSync(resolve(PORTRAIT_JPG, '..'), { recursive: true });
  writeFileSync(PORTRAIT_JPG, Buffer.from(await res.arrayBuffer()));
}

export const videoName = (scale: number, fps = 30) => `face-s${scale.toFixed(4)}-f${fps}.y4m`;

/** Writes one .y4m per scale into outDir (skipping any that already exist). Returns their paths. */
export async function makeScaledVideos(scales: number[], outDir: string, fps = 30): Promise<Map<number, string>> {
  await ensurePortrait();
  mkdirSync(outDir, { recursive: true });
  const out = new Map<number, string>();
  const todo = scales.filter((s) => {
    const p = resolve(outDir, videoName(s, fps));
    out.set(s, p);
    return !existsSync(p);
  });
  if (!todo.length) return out;
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    const dataUrl = `data:image/jpeg;base64,${readFileSync(PORTRAIT_JPG).toString('base64')}`;
    for (const s of todo) {
      const rgba: number[] = await page.evaluate(async ({ dataUrl, s, f, p, bg }) => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = f.w;
        canvas.height = f.h;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, f.w, f.h);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        // Scale about the face centre, which stays at the centre of the frame.
        const dx = f.w / 2 - p.x * s;
        const dy = f.h / 2 - p.y * s;
        ctx.drawImage(img, dx, dy, img.naturalWidth * s, img.naturalHeight * s);
        return Array.from(ctx.getImageData(0, 0, f.w, f.h).data);
      }, { dataUrl, s, f: FRAME, p: PIVOT, bg: BACKGROUND });
      writeFileSync(out.get(s)!, toY4m(Uint8ClampedArray.from(rgba), FRAME.w, FRAME.h, fps));
    }
  } finally {
    await browser.close();
  }
  return out;
}

/** RGBA → one-frame Y4M, I420 (BT.601 full range, "C420jpeg"). Same as e2e/fake-camera.ts. */
function toY4m(rgba: Uint8ClampedArray, w: number, h: number, fps: number): Buffer {
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
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F${fps}:1 Ip A1:1 C420jpeg\n`, 'ascii');
  return Buffer.concat([header, Buffer.from('FRAME\n', 'ascii'), y, u, v]);
}
