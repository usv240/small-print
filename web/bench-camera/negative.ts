// Negative controls for the camera pipeline: frames with no usable face must give NO distance.
//
// Needs a non-brotli build served locally (port 4190 so it doesn't clash with the e2e suite on 4173):
//   node scripts/copy-mediapipe.mjs && npx vite build --outDir <tmp>/dist-neg --emptyOutDir
//   npx vite preview --outDir <tmp>/dist-neg --port 4190 --strictPort
// then:
//   npx tsx bench-camera/negative.ts            (about 6 minutes; writes <tmp>/small-print-negative/camera.json)
//   npx tsx bench-camera/negative.ts --preview  (only writes a PNG of each scene, to check them by eye)
//   npx tsx bench-camera/negative-report.ts     (assembles public/data/negative-controls.json)
//
// Every scene is a 5 s, 30 fps, 640×480 Y4M video played by Chrome as its webcam
// (--use-file-for-fake-video-capture), with fresh sensor-like luma noise (SD 2 levels) on each of the
// 150 frames, so the pipeline sees 150 different frames, not one frame looped. lab.html runs the shipped
// pipeline (src/camera/distance.ts, unchanged). An init script records what lab.ts writes into #live
// ("no face" or "NN.N cm") and #iris on every processed frame, so a "false output" is exactly a frame
// where the page showed a distance. Counting starts at the first processed frame (no warm-up is
// discarded: a hallucination at start-up counts).
//
// The images are drawn by Chrome (canvas), from MediaPipe's test portrait (the same one the distance
// bench uses, at the bench's 30 cm reference scale) or from simple shapes and text.

import { execSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { S_REF, scaleFor } from './config';
import { FRAME, PIVOT, PORTRAIT_JPG, ensurePortrait } from './video';

export const BASE_URL = process.env.BENCH_URL ?? 'http://localhost:4190';
export const NEG_DIR = process.env.NEG_DIR ?? resolve(tmpdir(), 'small-print-negative');
export const CAMERA_JSON = resolve(NEG_DIR, 'camera.json');
const FPS = 30;
const FRAMES = 150; // 5 s of video
const NOISE_SD = 2; // luma levels, per frame
const COLLECT_MS = 5000;
const REPEATS = Number(process.env.NEG_REPEATS ?? 3);

/** Eye regions in the 640×480 frame of the reference-scale portrait (checked by eye with --preview). */
const EYE_BOXES = [
  { x: 242, y: 203, w: 74, h: 44 },
  { x: 334, y: 203, w: 74, h: 44 },
];
/** Lower-half crop: the portrait is moved up this many pixels so the frame starts just below the nose. */
const LOWER_SHIFT_PX = 285;

export interface Scene { id: string; name: string; kind: 'negative' | 'positive' | 'no-face'; description: string; scale?: number }

export const SCENES: Scene[] = [
  { id: 'wall', name: 'Empty room / wall', kind: 'negative', description: 'Plain warm-grey wall with a lighting gradient and a fine static noise texture; no face.' },
  { id: 'text-page', name: 'Printed page of text', kind: 'negative', description: 'Off-white page filling the frame: heading and paragraphs of black serif text (15 px).' },
  { id: 'e-chart', name: 'Tumbling-E chart', kind: 'negative', description: 'White chart with 8 rows of tumbling E optotypes, 70 px down to 10 px, random orientations.' },
  { id: 'smiley', name: 'Cartoon smiley face', kind: 'negative', description: 'Skin-coloured disc (r 115 px) with two white eye circles holding iris-sized dark discs (17 px, the size of a real iris at 30 cm) and an arc mouth, on mid-grey.' },
  { id: 'eyes-blacked', name: 'Portrait, both eyes blacked out', kind: 'negative', description: 'Reference portrait with two solid black 74×44 px rectangles covering both eyes (lids and brows partly).' },
  { id: 'blurred', name: 'Portrait, Gaussian blur 25 px', kind: 'negative', description: 'Reference portrait blurred with a 25 px Gaussian (canvas filter blur(25px)); no facial detail left.' },
  { id: 'rot90', name: 'Portrait rotated 90°', kind: 'negative', description: 'Reference portrait rotated 90° clockwise about the frame centre (between the eyes).' },
  { id: 'rot180', name: 'Portrait upside down (180°)', kind: 'negative', description: 'Reference portrait rotated 180° about the frame centre.' },
  { id: 'lower-half', name: 'Portrait, lower half of face only', kind: 'negative', description: `Reference portrait moved up ${LOWER_SHIFT_PX} px: the frame starts just below the nose, so only mouth, chin and neck are visible (no eyes).` },
  { id: 'dark', name: 'Very dark frame (3% brightness)', kind: 'negative', description: 'Reference portrait at 3% brightness (canvas filter brightness(0.03)): pixel values 0–8 plus sensor noise.' },
  { id: 'positive', name: 'Positive control: reference portrait', kind: 'positive', description: 'MediaPipe test portrait at the distance bench reference scale (about 30 cm), same noise as the negatives.' },
];

const byId = (id: string) => SCENES.find((s) => s.id === id)!;
const NO_FACE_IDS = ['wall', 'text-page', 'e-chart', 'blurred', 'lower-half', 'dark'];

/** Scenes for tuning and proving the eye-visibility check (src/camera/distance.ts EYE_MIN_CONTRAST). */
export const EYECHECK_SCENES: Scene[] = [
  ...[220, 300, 400, 500, 600, 700].map((mm): Scene => ({
    id: `pos-d${mm}`, name: `Portrait at ${mm / 10} cm`, kind: 'positive', scale: scaleFor(mm),
    description: `Reference portrait drawn at scale ${scaleFor(mm)} (the distance bench's ${mm / 10} cm).`,
  })),
  { id: 'bright30', name: 'Portrait at 30% brightness', kind: 'positive', description: 'Reference portrait (30 cm) through canvas filter brightness(0.3).' },
  { id: 'bright50', name: 'Portrait at 50% brightness', kind: 'positive', description: 'Reference portrait (30 cm) through canvas filter brightness(0.5).' },
  { id: 'warm', name: 'Portrait, warm tint', kind: 'positive', description: 'Reference portrait (30 cm), channels x (1.00, 0.85, 0.62): tungsten-like light.' },
  { id: 'cool', name: 'Portrait, cool tint', kind: 'positive', description: 'Reference portrait (30 cm), channels x (0.72, 0.88, 1.00): daylight/LED-like light.' },
  { id: 'blur3', name: 'Portrait, slight blur (3 px)', kind: 'positive', description: 'Reference portrait (30 cm) through canvas filter blur(3px): slightly out of focus.' },
  { ...byId('rot90'), kind: 'positive' },
  { ...byId('eyes-blacked') },
  { id: 'sunglasses', name: 'Portrait wearing dark sunglasses', kind: 'negative', description: 'Two dark lens ellipses (84x56 px) over the eyes with a top-to-bottom gradient (RGB 58 to 14), a black rim, bridge and arms.' },
  { id: 'hand', name: 'Hand over the eyes', kind: 'negative', description: 'Skin-coloured hand shape (palm + four shaded fingers, softened 1.5 px) laid across both eyes.' },
  { ...byId('smiley') },
  ...NO_FACE_IDS.map((id) => ({ ...byId(id), kind: 'no-face' as const })),
];

// ---------- scene rendering (runs in Chrome) ----------

interface RenderArgs { id: string; dataUrl: string; f: { w: number; h: number }; p: { x: number; y: number }; s: number; eyes: typeof EYE_BOXES; lowerShift: number }

/** Draws one scene on a canvas; returns RGBA (base64) and a PNG data URL. Self-contained: runs in the page. */
async function renderInPage(a: RenderArgs): Promise<{ rgba: string; png: string }> {
  let seed = 12345;
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const { w, h } = a.f;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const img = new Image();
  img.src = a.dataUrl;
  await img.decode();
  const portrait = (dyExtra = 0) => {
    const dx = w / 2 - a.p.x * a.s;
    const dy = h / 2 - a.p.y * a.s - dyExtra;
    ctx.drawImage(img, dx, dy, img.naturalWidth * a.s, img.naturalHeight * a.s);
  };
  const grey = () => { ctx.fillStyle = 'rgb(128,128,128)'; ctx.fillRect(0, 0, w, h); };

  switch (a.id) {
    case 'wall': {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgb(188,182,172)');
      g.addColorStop(1, 'rgb(160,154,145)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const tex = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < tex.data.length; i += 4) {
        const n = (rand() - 0.5) * 12;
        tex.data[i] += n; tex.data[i + 1] += n; tex.data[i + 2] += n;
      }
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      tmp.getContext('2d')!.putImageData(tex, 0, 0);
      ctx.filter = 'blur(1px)';
      ctx.drawImage(tmp, 0, 0);
      ctx.filter = 'none';
      break;
    }
    case 'text-page': {
      ctx.fillStyle = 'rgb(90,88,84)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgb(238,235,228)';
      ctx.fillRect(18, 10, w - 36, h - 20);
      ctx.fillStyle = 'rgb(20,20,20)';
      ctx.font = 'bold 22px Georgia, serif';
      ctx.fillText('Directions for use', 44, 48);
      const words = 'the of and to in is for on with read this page each day take one tablet after meals store below twenty five degrees keep out of reach children do not exceed stated dose if symptoms persist consult your pharmacist doctor before use small print may contain ingredients carefully label leaflet water hours'.split(' ');
      ctx.font = '15px Georgia, serif';
      let y = 80;
      while (y < h - 24) {
        let line = '';
        while (true) {
          const next = (line ? line + ' ' : '') + words[Math.floor(rand() * words.length)];
          if (ctx.measureText(next).width > w - 96) break;
          line = next;
        }
        ctx.fillText(line, 44, y);
        y += rand() < 0.12 ? 34 : 20; // paragraph breaks
      }
      break;
    }
    case 'e-chart': {
      ctx.fillStyle = 'rgb(250,250,248)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgb(10,10,10)';
      const sizes = [70, 52, 40, 30, 23, 17, 13, 10];
      let y = 18;
      for (const [r, size] of sizes.entries()) {
        const n = Math.min(12, 2 + r * 1.5) | 0;
        const gap = size * 0.9;
        const total = n * size + (n - 1) * gap;
        let x = (w - total) / 2;
        for (let i = 0; i < n; i++) {
          const rot = Math.floor(rand() * 4) * (Math.PI / 2);
          ctx.save();
          ctx.translate(x + size / 2, y + size / 2);
          ctx.rotate(rot);
          const u = size / 5;
          ctx.translate(-size / 2, -size / 2);
          ctx.fillRect(0, 0, u, size);
          for (const row of [0, 2, 4]) ctx.fillRect(0, row * u, size, u);
          ctx.restore();
          x += size + gap;
        }
        y += size + Math.max(10, size * 0.45);
      }
      break;
    }
    case 'smiley': {
      grey();
      const cx = w / 2, cy = h / 2 + 10;
      ctx.fillStyle = 'rgb(224,182,140)';
      ctx.strokeStyle = 'rgb(90,60,40)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy, 115, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      for (const ex of [cx - 47, cx + 47]) {
        ctx.fillStyle = 'rgb(245,245,240)';
        ctx.beginPath(); ctx.arc(ex, cy - 25, 15, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = 'rgb(70,45,30)';
        ctx.beginPath(); ctx.arc(ex, cy - 25, 8.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgb(5,5,5)';
        ctx.beginPath(); ctx.arc(ex, cy - 25, 3.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgb(120,40,40)';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(cx, cy + 5, 55, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
      break;
    }
    case 'eyes-blacked':
      grey(); portrait();
      ctx.fillStyle = 'rgb(0,0,0)';
      for (const b of a.eyes) ctx.fillRect(b.x, b.y, b.w, b.h);
      break;
    case 'blurred':
      grey(); ctx.filter = 'blur(25px)'; portrait(); ctx.filter = 'none';
      break;
    case 'rot90':
    case 'rot180':
      grey();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(a.id === 'rot90' ? Math.PI / 2 : Math.PI);
      ctx.translate(-w / 2, -h / 2);
      portrait();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      break;
    case 'lower-half':
      grey(); portrait(a.lowerShift);
      break;
    case 'dark':
      ctx.filter = 'brightness(0.03)'; grey(); portrait(); ctx.filter = 'none';
      break;
    case 'positive':
    case 'pos-d220': case 'pos-d300': case 'pos-d400': case 'pos-d500': case 'pos-d600': case 'pos-d700':
      grey(); portrait();
      break;
    case 'bright30':
    case 'bright50':
      ctx.filter = a.id === 'bright30' ? 'brightness(0.3)' : 'brightness(0.5)'; grey(); portrait(); ctx.filter = 'none';
      break;
    case 'blur3':
      grey(); ctx.filter = 'blur(3px)'; portrait(); ctx.filter = 'none';
      break;
    case 'warm':
    case 'cool': {
      grey(); portrait();
      const k = a.id === 'warm' ? [1, 0.85, 0.62] : [0.72, 0.88, 1];
      const im = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < im.data.length; i += 4) { im.data[i] *= k[0]; im.data[i + 1] *= k[1]; im.data[i + 2] *= k[2]; }
      ctx.putImageData(im, 0, 0);
      break;
    }
    case 'sunglasses': {
      grey(); portrait();
      const centres = a.eyes.map((b) => [b.x + b.w / 2, b.y + b.h / 2]);
      ctx.strokeStyle = 'rgb(8,8,8)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(centres[0][0] + 40, centres[0][1] - 10); ctx.lineTo(centres[1][0] - 40, centres[1][1] - 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(centres[0][0] - 42, centres[0][1] - 6); ctx.lineTo(centres[0][0] - 82, centres[0][1] + 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(centres[1][0] + 42, centres[1][1] - 6); ctx.lineTo(centres[1][0] + 82, centres[1][1] + 2); ctx.stroke();
      for (const [cx, cy] of centres) {
        const g = ctx.createLinearGradient(0, cy - 28, 0, cy + 28);
        g.addColorStop(0, 'rgb(58,58,64)');
        g.addColorStop(1, 'rgb(14,14,18)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(cx, cy, 42, 28, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      break;
    }
    case 'hand': {
      grey(); portrait();
      const hand = document.createElement('canvas');
      hand.width = w; hand.height = h;
      const hc = hand.getContext('2d')!;
      hc.fillStyle = 'rgb(196,150,118)';
      hc.beginPath(); hc.ellipse(150, 240, 90, 75, 0, 0, Math.PI * 2); hc.fill(); // palm, from the side
      const ys = [192, 216, 240, 264];
      const lens = [300, 330, 320, 280];
      ys.forEach((y, i) => {
        const g = hc.createLinearGradient(0, y - 12, 0, y + 12);
        g.addColorStop(0, 'rgb(170,126,98)');
        g.addColorStop(0.5, 'rgb(212,168,136)');
        g.addColorStop(1, 'rgb(170,126,98)');
        hc.fillStyle = g;
        hc.beginPath(); hc.roundRect(150, y - 12, lens[i], 24, 12); hc.fill();
      });
      ctx.filter = 'blur(1.5px)';
      ctx.drawImage(hand, 0, 0);
      ctx.filter = 'none';
      break;
    }
    default:
      throw new Error(`unknown scene ${a.id}`);
  }
  const data = ctx.getImageData(0, 0, w, h).data;
  let bin = '';
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return { rgba: btoa(bin), png: canvas.toDataURL('image/png') };
}

// ---------- Y4M writing ----------

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RGBA → I420 planes (BT.601 full range, as bench-camera/video.ts and e2e/fake-camera.ts). */
function toI420(rgba: Uint8Array, w: number, h: number) {
  const y = Buffer.alloc(w * h);
  const u = Buffer.alloc((w / 2) * (h / 2));
  const v = Buffer.alloc((w / 2) * (h / 2));
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  for (let i = 0; i < w * h; i++) y[i] = clamp(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
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
  return { y, u, v };
}

/** Writes FRAMES frames: the same image with fresh Gaussian luma noise on each frame (seeded). */
function writeNoisyY4m(path: string, rgba: Uint8Array, w: number, h: number, seed: number): void {
  const { y, u, v } = toI420(rgba, w, h);
  const rand = mulberry32(seed);
  const TABLE = 1 << 20;
  const noise = new Int8Array(TABLE);
  for (let i = 0; i < TABLE; i += 2) {
    const r = Math.sqrt(-2 * Math.log(1 - rand()));
    const th = 2 * Math.PI * rand();
    noise[i] = Math.round(NOISE_SD * r * Math.cos(th));
    noise[i + 1] = Math.round(NOISE_SD * r * Math.sin(th));
  }
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, Buffer.from(`YUV4MPEG2 W${w} H${h} F${FPS}:1 Ip A1:1 C420jpeg\n`, 'ascii'));
    const yf = Buffer.alloc(w * h);
    for (let f = 0; f < FRAMES; f++) {
      const off = Math.floor(rand() * (TABLE - w * h));
      for (let i = 0; i < w * h; i++) {
        const val = y[i] + noise[off + i];
        yf[i] = val < 0 ? 0 : val > 255 ? 255 : val;
      }
      writeSync(fd, Buffer.from('FRAME\n', 'ascii'));
      writeSync(fd, yf);
      writeSync(fd, u);
      writeSync(fd, v);
    }
  } finally {
    closeSync(fd);
  }
}

async function makeVideos(scenes: Scene[], preview: boolean): Promise<Map<string, string>> {
  await ensurePortrait();
  mkdirSync(resolve(NEG_DIR, 'preview'), { recursive: true });
  const dataUrl = `data:image/jpeg;base64,${readFileSync(PORTRAIT_JPG).toString('base64')}`;
  const out = new Map<string, string>();
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.evaluate('window.__name = (f) => f'); // tsx keeps function names with a __name() helper
    for (const sc of scenes) {
      const i = [...SCENES, ...EYECHECK_SCENES].findIndex((x) => x.id === sc.id); // stable noise seed per scene
      const r = await page.evaluate(renderInPage, { id: sc.id, dataUrl, f: FRAME, p: PIVOT, s: sc.scale ?? S_REF, eyes: EYE_BOXES, lowerShift: LOWER_SHIFT_PX });
      writeFileSync(resolve(NEG_DIR, 'preview', `${sc.id}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
      if (preview) continue;
      const path = resolve(NEG_DIR, `${sc.id}.y4m`);
      writeNoisyY4m(path, new Uint8Array(Buffer.from(r.rgba, 'base64')), FRAME.w, FRAME.h, 1000 + i);
      out.set(sc.id, path);
    }
  } finally {
    await browser.close();
  }
  return out;
}

// ---------- measurement ----------

/** Records every value lab.ts writes into #live and #iris (one write each per processed frame). */
const INIT = `(() => {
  const d = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  window.__samples = [];
  Object.defineProperty(Node.prototype, 'textContent', {
    configurable: true,
    enumerable: d.enumerable,
    get() { return d.get.call(this); },
    set(v) {
      if (this.id === 'live') window.__samples.push({ t: performance.now(), live: String(v) });
      else if (this.id === 'iris') { const s = window.__samples[window.__samples.length - 1]; if (s && s.iris === undefined) s.iris = String(v); }
      d.set.call(this, v);
    },
  });
  // Eye-visibility check (src/camera/distance.ts): record the luminance SD of every 24x24 eye patch
  // the app reads, plus the iris-vs-surround contrast, for the threshold distributions.
  window.__eye = [];
  const gid = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h, ...rest) {
    const im = gid.call(this, x, y, w, h, ...rest);
    if (w === 24 && h === 24) {
      let s = 0, s2 = 0, disc = 0, nd = 0, ring = 0, nr = 0;
      for (let i = 0; i < 576; i++) {
        const p = i * 4, l = 0.299 * im.data[p] + 0.587 * im.data[p + 1] + 0.114 * im.data[p + 2];
        s += l; s2 += l * l;
        const dx = (i % 24) - 11.5, dy = Math.floor(i / 24) - 11.5, r = Math.hypot(dx, dy);
        if (r < 6) { disc += l; nd++; } else if (r > 9.2) { ring += l; nr++; }
      }
      const m = s / 576;
      window.__eye.push({ t: performance.now(), sd: Math.sqrt(Math.max(0, s2 / 576 - m * m)), contrast: ring / nr - disc / nd, mean: m });
    }
    return im;
  };
})();`;

export interface Frame { t: number; mm: number | null; iris: number | null; live: string }
export interface EyePatch { t: number; sd: number; contrast: number; mean: number }
export interface Run { scene: string; repeat: number; frames: Frame[]; startupMs: number; errors: string[]; eye?: EyePatch[] }

async function measure(scene: string, video: string, repeat: number): Promise<Run> {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  });
  const errors: string[] = [];
  try {
    const context = await browser.newContext({ permissions: ['camera'], viewport: { width: 1280, height: 800 } });
    await context.addInitScript(INIT);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/^INFO:/.test(m.text())) errors.push(m.text()); }); // MediaPipe logs INFO lines as errors
    await page.goto(`${BASE_URL}/lab.html`);
    const clickedAt = await page.evaluate(() => performance.now());
    await page.getByRole('button', { name: 'Start camera' }).click();
    await page.waitForFunction(() => (window as any).__samples.length > 0, null, { timeout: 60_000 });
    const t0: number = await page.evaluate(() => (window as any).__samples[0].t);
    await page.waitForFunction((end) => performance.now() > end, t0 + COLLECT_MS + 100, { timeout: COLLECT_MS + 30_000, polling: 100 });
    const raw: { t: number; live: string; iris?: string }[] = await page.evaluate(() => (window as any).__samples);
    const eyeRaw: EyePatch[] = await page.evaluate(() => (window as any).__eye);
    const eye = eyeRaw.filter((e) => e.t - t0 < COLLECT_MS).map((e) => ({ t: Math.round((e.t - t0) * 10) / 10, sd: Math.round(e.sd * 100) / 100, contrast: Math.round(e.contrast * 100) / 100, mean: Math.round(e.mean * 10) / 10 }));
    const frames = raw
      .filter((s) => s.t - t0 < COLLECT_MS)
      .map((s) => {
        const m = /^(\d+(?:\.\d+)?) cm$/.exec(s.live);
        const iris = s.iris !== undefined && /^\d/.test(s.iris) ? Number(s.iris) : null;
        return { t: Math.round((s.t - t0) * 10) / 10, mm: m ? Number(m[1]) * 10 : null, iris, live: s.live };
      });
    const odd = frames.filter((f) => f.mm === null && f.live !== 'no face');
    if (odd.length) errors.push(`unexpected #live text: ${odd[0].live}`);
    return { scene, repeat, frames, startupMs: Math.round(t0 - clickedAt), errors, eye };
  } finally {
    await browser.close();
  }
}

function machineInfo(): Record<string, string> {
  const ps = (cmd: string) => {
    try {
      return execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  };
  return {
    os: ps('(Get-CimInstance Win32_OperatingSystem).Caption'),
    cpu: ps('(Get-CimInstance Win32_Processor).Name'),
    gpu: ps('(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join \', \''),
    node: process.version,
  };
}

async function main(): Promise<void> {
  const preview = process.argv.includes('--preview');
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  const set = process.argv.find((a) => a.startsWith('--set='))?.slice(6) ?? 'baseline';
  const outFile = resolve(NEG_DIR, process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'camera.json');
  const scenes = (set === 'eyecheck' ? EYECHECK_SCENES : SCENES).filter((sc) => !only || only.includes(sc.id));
  const videos = await makeVideos(scenes, preview);
  if (preview) {
    console.log(`previews in ${resolve(NEG_DIR, 'preview')}`);
    return;
  }
  const b = await chromium.launch({ channel: 'chrome' });
  const chrome = b.version();
  await b.close();
  const runs: Run[] = [];
  for (let rep = 0; rep < REPEATS; rep++) {
    for (const sc of scenes) {
      const r = await measure(sc.id, videos.get(sc.id)!, rep);
      runs.push(r);
      const pos = r.frames.filter((f) => f.mm !== null).length;
      console.log(`rep ${rep} ${sc.id.padEnd(13)} frames ${String(r.frames.length).padStart(4)}  with distance ${String(pos).padStart(4)}  startup ${r.startupMs} ms${r.errors.length ? `  errors: ${r.errors.slice(0, 2).join(' | ')}` : ''}`);
    }
  }
  const out = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    video: { width: FRAME.w, height: FRAME.h, fps: FPS, frames: FRAMES, lumaNoiseSd: NOISE_SD, referenceScale: S_REF },
    collectMs: COLLECT_MS,
    repeats: REPEATS,
    environment: { ...machineInfo(), chrome, headless: true },
    set,
    scenes,
    eyeBoxes: EYE_BOXES,
    lowerShiftPx: LOWER_SHIFT_PX,
    runs,
  };
  writeFileSync(outFile, JSON.stringify(out));
  console.log(`wrote ${outFile}`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('bench-camera/negative.ts')) await main();
