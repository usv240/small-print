// An ILLUSTRATED face (SVG, not a real person) rendered to a multi-frame Y4M for Chrome's fake webcam
// (--use-file-for-fake-video-capture). The face is drawn at the size a real face would have at a given
// distance from a 70° front camera (the app's uncalibrated assumption), so moving it "closer" is just
// drawing it bigger: pixels per mm = focal length (px) ÷ distance (mm). Proportions are adult averages:
// iris 11.7 mm, eyes 63 mm apart, eye opening ~30 × 10 mm.
// Each frame also carries its index as a 12-bit barcode in the bottom-left corner, so the recorder can
// tell exactly which camera frame the app is processing (decodeFrameIndex below runs in the page).
// Usage: npx tsx video/face.ts   (writes video/tmp/cam/*.y4m)
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

export const CAM = { w: 640, h: 480, fps: 30 };
/** Focal length in px for a 70° horizontal field of view (matches UNCALIBRATED_HFOV_DEG in the app). */
export const FOCAL_PX = (CAM.w * 0.5) / Math.tan((35 * Math.PI) / 180);
/** Where the point between the eyes sits in the camera frame. */
const ANCHOR = { x: CAM.w / 2, y: CAM.h * 0.44 };
/** MediaPipe's iris ring on this drawing comes out ~1.15× the drawn 11.7 mm (lab.html probe: readings were
 *  0.87× the designed distance), so the drawing is scaled by 0.87 to make the app read the designed distance. */
export const IRIS_GAIN = 0.87;
export const MARK = { bits: 12, size: 10, x: 4, y: CAM.h - 14 };

export interface Key { t: number; cm: number }

const easeInOut = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** Piecewise eased distance (cm) through keyframes, plus a small natural hand tremor. */
export function profile(keys: Key[], tremorCm = 0.12) {
  return (t: number) => {
    let cm = keys[keys.length - 1].cm;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (t >= a.t && t < b.t) { cm = a.cm + (b.cm - a.cm) * easeInOut((t - a.t) / (b.t - a.t)); break; }
    }
    if (t < keys[0].t) cm = keys[0].cm;
    return cm + tremorCm * (Math.sin(t * 2.3) * 0.6 + Math.sin(t * 5.1 + 1) * 0.4);
  };
}

/** The face in mm, origin between the eyes. viewBox covers 240 × 300 mm. */
export function faceSvg(opts: { sunglasses?: boolean; shadesDy?: number } = {}): string {
  const eye = (s: -1 | 1) => {
    const cx = s * 31.5;
    const almond = `M ${cx - 15} 0.6 C ${cx - 9} -7.2, ${cx + 7} -7.6, ${cx + 15} -0.4 C ${cx + 8} 6.2, ${cx - 8} 6.6, ${cx - 15} 0.6 Z`;
    const id = s < 0 ? 'L' : 'R';
    return `
      <clipPath id="clip${id}"><path d="${almond}"/></clipPath>
      <path d="M ${cx - 16} -1 C ${cx - 9} -11.5, ${cx + 8} -12, ${cx + 16.5} -2.5" fill="none" stroke="#b77a5c" stroke-width="0.9" opacity="0.8"/>
      <path d="${almond}" fill="#f6f3ef"/>
      <g clip-path="url(#clip${id})">
        <rect x="${cx - 16}" y="-8" width="32" height="16" fill="url(#scl)"/>
        <circle cx="${cx}" cy="-0.3" r="5.85" fill="url(#iris)"/>
        <circle cx="${cx}" cy="-0.3" r="5.6" fill="none" stroke="#21150c" stroke-width="0.6"/>
        <circle cx="${cx}" cy="-0.3" r="2.05" fill="#0b0806"/>
        <circle cx="${cx + 1.7}" cy="-2.1" r="0.85" fill="#ffffff" opacity="0.95"/>
        <path d="M ${cx - 15} -1 C ${cx - 9} -8.2, ${cx + 7} -8.6, ${cx + 15} -1.4 L ${cx + 15} -9 L ${cx - 15} -9 Z" fill="#000" opacity="0.10"/>
      </g>
      <path d="M ${cx - 15.2} 0.6 C ${cx - 9} -7.4, ${cx + 7} -7.8, ${cx + 15.2} -0.4" fill="none" stroke="#2a1a12" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M ${cx - 14} 1.6 C ${cx - 8} 6.8, ${cx + 8} 6.6, ${cx + 14.5} 0" fill="none" stroke="#9c6249" stroke-width="0.6" opacity="0.7"/>`;
  };
  const brow = (s: -1 | 1) => `<path d="M ${s * 47} -13 Q ${s * 33} -23, ${s * 15} -17" fill="none" stroke="#3a2618" stroke-width="4.2" stroke-linecap="round"/>`;
  const shades = opts.sunglasses ? `
    <g transform="translate(0 ${opts.shadesDy ?? 0})">
      ${[-1, 1].map((s) => `<rect x="${s * 31.5 - 25}" y="-17" width="50" height="37" rx="13" fill="url(#lens)" stroke="#0a0a0a" stroke-width="2.6"/>
        <path d="M ${s * 31.5 - 17} -12 L ${s * 31.5 - 6} -12 L ${s * 31.5 - 18} 6 Z" fill="#ffffff" opacity="0.07"/>`).join('')}
      <path d="M -6.5 -6 Q 0 -10, 6.5 -6" fill="none" stroke="#0a0a0a" stroke-width="2.6"/>
      <path d="M -56.5 -8 L -73 -4" stroke="#0a0a0a" stroke-width="2.6"/><path d="M 56.5 -8 L 73 -4" stroke="#0a0a0a" stroke-width="2.6"/>
    </g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-160 -150 320 420">
  <defs>
    <radialGradient id="skin" cx="46%" cy="40%" r="62%"><stop offset="0" stop-color="#f3caa9"/><stop offset="0.65" stop-color="#e2a985"/><stop offset="1" stop-color="#c58462"/></radialGradient>
    <radialGradient id="iris" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#2a1a0e"/><stop offset="0.38" stop-color="#5a3a1f"/><stop offset="0.7" stop-color="#7a5231"/><stop offset="1" stop-color="#3a2414"/></radialGradient>
    <linearGradient id="scl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d9cfc7"/><stop offset="0.25" stop-color="#f7f4f0"/><stop offset="0.75" stop-color="#f7f4f0"/><stop offset="1" stop-color="#d9cfc7"/></linearGradient>
    <linearGradient id="lens" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1d22"/><stop offset="1" stop-color="#0d0e10"/></linearGradient>
    <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9d4cb"/><stop offset="1" stop-color="#b9b2a6"/></linearGradient>
    <radialGradient id="blush" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#e58d78" stop-opacity="0.35"/><stop offset="1" stop-color="#e58d78" stop-opacity="0"/></radialGradient>
  </defs>
  <path d="M -38 92 L -36 150 L 36 150 L 38 92 Z" fill="#cf9473"/>
  <path d="M -160 270 L -160 175 C -150 132, -100 116, -40 112 Q 0 140, 40 112 C 100 116, 150 132, 160 175 L 160 270 Z" fill="#3f5f7d"/>
  <path d="M -40 112 Q 0 140, 40 112 L 36 104 Q 0 128, -36 104 Z" fill="#335069"/>
  <ellipse cx="0" cy="-22" rx="84" ry="108" fill="#33241a"/>
  <ellipse cx="-73" cy="10" rx="10" ry="19" fill="#d99c79"/><ellipse cx="73" cy="10" rx="10" ry="19" fill="#d99c79"/>
  <path d="M 0 -104 C 58 -104 76 -62 74 -12 C 72 46 50 104 0 118 C -50 104 -72 46 -74 -12 C -76 -62 -58 -104 0 -104 Z" fill="url(#skin)"/>
  <ellipse cx="-40" cy="30" rx="18" ry="12" fill="url(#blush)"/><ellipse cx="40" cy="30" rx="18" ry="12" fill="url(#blush)"/>
  <path d="M -80 -16 C -86 -96, -34 -128, 8 -121 C 56 -114, 88 -82, 80 -16 C 74 -50, 52 -72, 18 -76 C -16 -64, -52 -70, -80 -16 Z" fill="#33241a"/>
  ${brow(-1)}${brow(1)}
  ${eye(-1)}${eye(1)}
  <path d="M -7 4 C -8 18, -10 28, -12 35" fill="none" stroke="#c88a68" stroke-width="1.6" opacity="0.7"/>
  <path d="M -11 38 C -8 43, 8 43, 11 38" fill="none" stroke="#b5765a" stroke-width="1.4"/>
  <ellipse cx="-6.5" cy="38" rx="3.2" ry="1.7" fill="#7a4532"/><ellipse cx="6.5" cy="38" rx="3.2" ry="1.7" fill="#7a4532"/>
  <ellipse cx="0" cy="33" rx="7" ry="5" fill="#f5cfb2" opacity="0.5"/>
  <path d="M -24 62 C -12 56, -4 58, 0 60 C 4 58, 12 56, 24 62 C 12 64, -12 64, -24 62 Z" fill="#b65a50"/>
  <path d="M -24 62 C -12 72, 12 72, 24 62 C 12 65, -12 65, -24 62 Z" fill="#c96a5e"/>
  <path d="M -24 62 C -12 64.5, 12 64.5, 24 62" fill="none" stroke="#7a3530" stroke-width="1.1"/>
  ${shades}
</svg>`;
}

const RENDER_JS = `window.renderFrame = async ({ svg, pxPerMm, sway, i, cam, anchor, mark }) => {
        const c = document.getElementById('c');
        c.width = cam.w; c.height = cam.h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        // wall
        const g = ctx.createLinearGradient(0, 0, cam.w, cam.h);
        g.addColorStop(0, '#dcd6cc'); g.addColorStop(1, '#b4ada1');
        ctx.fillStyle = g; ctx.fillRect(0, 0, cam.w, cam.h);
        const wpx = 320 * pxPerMm, hpx = 420 * pxPerMm;
        const img = new Image();
        img.src = 'data:image/svg+xml;base64,' + btoa(svg.replace('<svg ', \`<svg width="\${wpx}" height="\${hpx}" \`));
        await img.decode();
        // the SVG origin (between the eyes) is at (120, 150) mm inside the viewBox
        ctx.drawImage(img, anchor.x + sway - 160 * pxPerMm, anchor.y - 150 * pxPerMm, wpx, hpx);
        // frame-index barcode
        ctx.fillStyle = '#808080'; ctx.fillRect(0, mark.y - 4, mark.x * 2 + mark.bits * mark.size, mark.size + 8);
        for (let b = 0; b < mark.bits; b++) {
          ctx.fillStyle = (i >> b) & 1 ? '#000' : '#fff';
          ctx.fillRect(mark.x + b * mark.size, mark.y, mark.size, mark.size);
        }
        const d = ctx.getImageData(0, 0, cam.w, cam.h).data;
        const W = cam.w, H = cam.h;
        const buf = new Uint8Array(W * H * 1.5);
        const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
        for (let p = 0, q = 0; p < W * H; p++, q += 4) buf[p] = cl(0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2]);
        const uo = W * H, vo = uo + (W / 2) * (H / 2);
        for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) {
          let r = 0, gg = 0, bb = 0;
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const q = ((2 * y + dy) * W + 2 * x + dx) * 4; r += d[q]; gg += d[q + 1]; bb += d[q + 2]; }
          r /= 4; gg /= 4; bb /= 4;
          buf[uo + y * (W / 2) + x] = cl(128 - 0.168736 * r - 0.331264 * gg + 0.5 * bb);
          buf[vo + y * (W / 2) + x] = cl(128 + 0.5 * r - 0.418688 * gg - 0.081312 * bb);
        }
        let s = '';
        for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode.apply(null, Array.from(buf.subarray(k, k + 0x8000)));
        return btoa(s);
};`;

/** Writes a Y4M where the face is at `cmAt(t)` cm for `seconds`. Returns the path. */
export async function makeFaceY4m(out: string, seconds: number, cmAt: (t: number) => number, opts: { sunglasses?: boolean; shadesDy?: (t: number) => number; swayPx?: number } = {}): Promise<string> {
  mkdirSync(resolve(out, '..'), { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const fd = openSync(out, 'w');
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="c"></canvas>');
    await page.evaluate(RENDER_JS);
    writeSync(fd, Buffer.from(`YUV4MPEG2 W${CAM.w} H${CAM.h} F${CAM.fps}:1 Ip A1:1 C420jpeg\n`, 'ascii'));
    const n = Math.round(seconds * CAM.fps);
    for (let i = 0; i < n; i++) {
      const t = i / CAM.fps;
      const pxPerMm = (FOCAL_PX / (cmAt(t) * 10)) * IRIS_GAIN;
      const sway = (opts.swayPx ?? 3) * Math.sin(t * 1.3);
      const svg = faceSvg({ sunglasses: opts.sunglasses, shadesDy: opts.shadesDy?.(t) ?? 0 });
      const b64: string = await page.evaluate((a) => (window as any).renderFrame(a), { svg, pxPerMm, sway, i, cam: CAM, anchor: ANCHOR, mark: MARK });
      writeSync(fd, Buffer.from('FRAME\n', 'ascii'));
      writeSync(fd, Buffer.from(b64, 'base64'));
      if (i === 0) {
        // keep a PNG of the first frame for checking the drawing
        await page.locator('#c').screenshot({ path: out.replace(/\.y4m$/, '.png') });
      }
    }
  } finally {
    closeSync(fd);
    await browser.close();
  }
  return out;
}

/** In-page (string, so tsx helpers aren't injected): decode the barcode of the frame currently shown by `video`. */
export const DECODE_FRAME_JS = `(() => {
  const v = document.getElementById('cam');
  if (!v || v.readyState < 2) return -1;
  const M = ${JSON.stringify(MARK)};
  let c = window.__fxMarkCanvas;
  if (!c) { c = window.__fxMarkCanvas = document.createElement('canvas'); c.width = M.x * 2 + M.bits * M.size; c.height = M.size; }
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(v, 0, M.y, c.width, M.size, 0, 0, c.width, M.size);
  const d = ctx.getImageData(0, 0, c.width, M.size).data;
  let n = 0;
  for (let b = 0; b < M.bits; b++) {
    const x = M.x + b * M.size + (M.size >> 1), y = M.size >> 1;
    const p = (y * c.width + x) * 4;
    if (d[p] + d[p + 1] + d[p + 2] < 384) n |= 1 << b;
  }
  return n;
})()`;

/** Main take (seconds after the camera opens): sway while the model loads and the calibration screens
 *  are skipped; settle at 40 cm for the reading distance and the swipes; then the near-point sweep
 *  40 → 25 → 62 → 38 cm, and slowly out to 55 cm where the E turns sharp. */
export const MAIN_KEYS: Key[] = [
  { t: 0, cm: 36 }, { t: 1.4, cm: 33 }, { t: 2.8, cm: 38 }, { t: 4.2, cm: 34 }, { t: 5.6, cm: 38.5 }, { t: 7.0, cm: 33.5 },
  { t: 8.4, cm: 37.5 }, { t: 9.8, cm: 34 }, { t: 11.2, cm: 37.5 }, { t: 12.0, cm: 35.5 }, { t: 13.4, cm: 40.6 }, { t: 14.0, cm: 40 },
  { t: 29.0, cm: 40 }, { t: 30.6, cm: 25 }, { t: 33.6, cm: 62 }, { t: 35.6, cm: 38 }, { t: 36.6, cm: 38 }, { t: 39.2, cm: 55 }, { t: 47, cm: 55 },
];
export const MAIN_SECONDS = 47;
export const MAIN_T = { work: 12.0, near: 28.7, blurry: 35.9, sharp: 39.6 };
/** Sunglasses take: eyes visible (sunglasses pushed up on the head) and swaying, then the glasses come down. */
export const SHADES_KEYS: Key[] = [
  { t: 0, cm: 39 }, { t: 1.4, cm: 41.5 }, { t: 2.8, cm: 38 }, { t: 4.2, cm: 41 }, { t: 5.6, cm: 38.5 }, { t: 7.0, cm: 41.5 }, { t: 8.4, cm: 38.5 },
  { t: 9.8, cm: 41 }, { t: 11.2, cm: 38.5 }, { t: 12.6, cm: 41 }, { t: 14.0, cm: 39 }, { t: 15.4, cm: 41 }, { t: 16.8, cm: 38.5 }, { t: 18.2, cm: 40.5 }, { t: 20, cm: 39 },
];
export const SHADES_SECONDS = 20;
export const SHADES_T = { on: 13.0, onEnd: 13.6 };
export const shadesDy = (t: number) => -78 * (1 - easeInOut((t - SHADES_T.on) / (SHADES_T.onEnd - SHADES_T.on)));

if (process.argv[1]?.endsWith('face.ts')) {
  const dir = resolve(import.meta.dirname, 'tmp/cam');
  const which = process.argv[2] ?? 'probe';
  if (which === 'probe') {
    // 45 → 25 → 60 → 38 cm over 8 s (the brief's example), for checking detection in lab.html
    await makeFaceY4m(resolve(dir, 'probe.y4m'), 8, profile([{ t: 0, cm: 45 }, { t: 2.5, cm: 25 }, { t: 5.5, cm: 60 }, { t: 8, cm: 38 }]));
    await makeFaceY4m(resolve(dir, 'shades-probe.y4m'), 4, profile([{ t: 0, cm: 40 }, { t: 4, cm: 40 }]), { sunglasses: true });
  }
  if (which === 'main' || which === 'all') {
    await makeFaceY4m(resolve(dir, 'main.y4m'), MAIN_SECONDS, profile(MAIN_KEYS));
  }
  if (which === 'shades' || which === 'all') {
    await makeFaceY4m(resolve(dir, 'shades.y4m'), SHADES_SECONDS, profile(SHADES_KEYS), { sunglasses: true, shadesDy: shadesDy });
  }
  console.log('done', which);
}
