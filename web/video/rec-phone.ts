// Real-time phone takes for the demo video. The camera shots can't run under a fake clock (Chrome's fake
// webcam and MediaPipe run in real time), so each take is captured with the CDP screencast (every
// repaint, as JPEG, with its wall-clock time) while an in-page logger records, on every animation frame,
// the live distance the app shows, where the E is, and which camera frame the app is processing (read
// from the barcode drawn into each Y4M frame by face.ts). `materialize` then cuts the take into 30 fps
// clip frames (tmp/frames/<clip>/) using an edit list, for compose.ts.
// Usage: npx tsx video/rec-phone.ts [main] [shades] [tryon]   (default: all three takes; then materializes)
//        npx tsx video/rec-phone.ts cut                        (materialize only)
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DECODE_FRAME_JS, CAM, MAIN_T, SHADES_T } from './face';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4789';
const HERE = import.meta.dirname;
const TMP = resolve(HERE, 'tmp');
const RT = resolve(TMP, 'rt');
const FRAMES = resolve(TMP, 'frames');
const CAMDIR = resolve(TMP, 'cam');
const FPS = 30;
export const PHONE = { width: 390, height: 844, dsf: 3 };
const MAG = 28; // CSS px square around the E shown zoomed in (84 device px)
const tts = JSON.parse(readFileSync(resolve(TMP, 'tts/manifest.json'), 'utf8'));
const dur = (id: string): number => tts.segments[id].duration;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ---------- in-page helpers: finger overlay, highlight, per-frame state log ----------
const INIT_JS = `(() => {
  const boot = () => {
    if (window.__fx) return;
    const f = document.createElement('div');
    f.id = 'fx-finger';
    f.style.cssText = 'position:fixed;left:0;top:0;width:40px;height:40px;border-radius:50%;background:rgba(26,25,23,.30);border:3px solid rgba(255,255,255,.95);box-shadow:0 2px 10px rgba(0,0,0,.28);pointer-events:none;z-index:2147483647;opacity:0;box-sizing:border-box;';
    document.body.appendChild(f);
    const log = [];
    const set = (x, y, s, o) => { f.style.transform = 'translate(' + (x - 20) + 'px,' + (y - 20) + 'px) scale(' + s + ')'; f.style.opacity = String(o); };
    const anim = (ms, fn) => new Promise((res) => { const t0 = performance.now(); const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); fn(k); if (k < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
    const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    window.__fx = {
      log,
      set, hide() { f.style.opacity = '0'; },
      fadeIn(x, y, ms) { return anim(ms, (k) => set(x, y, 1.3 - 0.35 * k, k)); },
      fadeOut(x, y, ms) { return anim(ms, (k) => set(x, y, 0.95 + 0.15 * k, 1 - k)); },
      move(x0, y0, x1, y1, ms) { return anim(ms, (k) => { const e = ease(k); set(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, 0.92, 1); }); },
      slide(to, ms) {
        const s = document.getElementById('demo-range');
        const from = Number(s.value);
        const thumb = (v) => { const b = s.getBoundingClientRect(); const min = Number(s.min), max = Number(s.max); return { x: b.x + 8 + ((v - min) / (max - min)) * (b.width - 16), y: b.y + b.height / 2 }; };
        return anim(ms, (k) => { const v = Math.round(from + (to - from) * ease(k)); if (s.value !== String(v)) { s.value = String(v); s.dispatchEvent(new Event('input', { bubbles: true })); } const p = thumb(v); set(p.x, p.y, 0.95, 1); });
      },
      thumb(v) { const s = document.getElementById('demo-range'); const b = s.getBoundingClientRect(); const min = Number(s.min), max = Number(s.max); return { x: b.x + 8 + ((v - min) / (max - min)) * (b.width - 16), y: b.y + b.height / 2 }; },
      hl(sel, on) { document.querySelector(sel)?.classList.toggle('fx-hl', on); },
      smoothScroll(y, ms) { const y0 = scrollY; return anim(ms, (k) => window.scrollTo({ top: y0 + (y - y0) * ease(k), behavior: 'instant' })); },
    };
    const st = document.createElement('style');
    st.textContent = '.fx-hl{outline:3px solid #b4410e !important;outline-offset:5px;border-radius:10px;}';
    document.head.appendChild(st);
    const tick = () => {
      const live = document.querySelector('[data-live]');
      const e = document.getElementById('e');
      let er = null;
      if (e) { const b = e.getBoundingClientRect(); er = [b.x + b.width / 2, b.y + b.height / 2]; }
      const slider = document.getElementById('demo-range');
      // the E at true device pixels: an 84×84 px (28 CSS px) square from the centre of its canvas, on white
      let mag = null;
      if (e && e.width >= 84) {
        const mc = window.__fxMag || (window.__fxMag = Object.assign(document.createElement('canvas'), { width: 84, height: 84 }));
        const mx = mc.getContext('2d');
        mx.fillStyle = '#fff'; mx.fillRect(0, 0, 84, 84);
        mx.drawImage(e, Math.round(e.width / 2 - 42), Math.round(e.height / 2 - 42), 84, 84, 0, 0, 84, 84);
        mag = mc.toDataURL('image/png');
      }
      log.push({ t: Date.now(), f: ${DECODE_FRAME_JS}, live: live ? live.textContent : null, e: er, m: mag, demo: document.body.classList.contains('demo') && slider ? Number(slider.value) : null });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})()`;

// ---------- take: screencast + marks ----------
class Take {
  frames: { t: number; n: number }[] = [];
  marks: Record<string, number> = {};
  cdp!: CDPSession;
  n = 0;
  raw: string;
  constructor(public name: string, public page: Page) {
    this.raw = resolve(RT, name, 'raw');
    rmSync(resolve(RT, name), { recursive: true, force: true });
    mkdirSync(this.raw, { recursive: true });
  }
  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
      const n = this.n++;
      writeFileSync(resolve(this.raw, `s${String(n).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
      this.frames.push({ t: (metadata.timestamp ?? Date.now() / 1000) * 1000, n });
      try { await this.cdp.send('Page.screencastFrameAck', { sessionId }); } catch { /* stopped */ }
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: PHONE.width * PHONE.dsf, maxHeight: PHONE.height * PHONE.dsf, everyNthFrame: 1 });
  }
  async mark(name: string) { this.marks[name] = await this.page.evaluate('Date.now()') as number; console.log(`  ${this.name}: ${name}`); }
  async stop() {
    await this.cdp.send('Page.stopScreencast');
    await sleep(300);
    const log = await this.page.evaluate('window.__fx.log');
    writeFileSync(resolve(RT, this.name, 'take.json'), JSON.stringify({ frames: this.frames, marks: this.marks, log }));
    const span = (this.frames[this.frames.length - 1].t - this.frames[0].t) / 1000;
    console.log(`${this.name}: ${this.frames.length} screencast frames over ${span.toFixed(1)} s (${(this.frames.length / span).toFixed(1)} fps)`);
  }
}

// ---------- real-time gestures ----------
async function rect(page: Page, sel: string) {
  return page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) throw new Error('missing ' + sel); const b = el.getBoundingClientRect(); return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, y: b.y, h: b.height, top: b.top + scrollY, vh: innerHeight }; }, sel);
}
async function reveal(page: Page, sel: string, bottomPad = 40) {
  const r = await rect(page, sel);
  if (r.y < 60 || r.y + r.h > r.vh - bottomPad) await page.evaluate(([y]) => (window as any).__fx.smoothScroll(y, 420), [Math.max(0, r.top - r.vh * 0.45)]);
}
async function tap(page: Page, sel: string, after = 150, quick = false, bottomPad = 40) {
  await reveal(page, sel, bottomPad);
  const r = await rect(page, sel);
  await page.evaluate(([x, y, ms]) => (window as any).__fx.fadeIn(x, y, ms), [r.cx, r.cy, quick ? 90 : 160]);
  await page.mouse.click(r.cx, r.cy);
  await page.evaluate(([x, y]) => (window as any).__fx.set(x, y, 0.82, 1), [r.cx, r.cy]);
  await sleep(quick ? 40 : 90);
  await page.evaluate(([x, y, ms]) => (window as any).__fx.fadeOut(x, y, ms), [r.cx, r.cy, quick ? 90 : 160]);
  await sleep(after);
}
async function eDirection(page: Page): Promise<'up' | 'down' | 'left' | 'right'> {
  return page.evaluate(`(() => {
    const c = document.getElementById('e'); const ctx = c.getContext('2d'); const w = c.width, h = c.height;
    const d = ctx.getImageData(0, 0, w, h).data; const dark = (x, y) => d[(Math.round(y) * w + Math.round(x)) * 4 + 3] > 110;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dark(x, y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const bw = x1 - x0, bh = y1 - y0;
    const col = (x) => { let k = 0; for (let y = y0; y <= y1; y++) k += dark(x, y) ? 1 : 0; return k / (bh + 1); };
    const row = (y) => { let k = 0; for (let x = x0; x <= x1; x++) k += dark(x, y) ? 1 : 0; return k / (bw + 1); };
    const s = { left: col(x0 + bw * 0.1), right: col(x1 - bw * 0.1), up: row(y0 + bh * 0.1), down: row(y1 - bh * 0.1) };
    const spine = Object.keys(s).sort((a, b) => s[b] - s[a])[0];
    return { left: 'right', right: 'left', up: 'down', down: 'up' }[spine];
  })()`);
}
async function swipe(page: Page, dir: 'up' | 'down' | 'left' | 'right') {
  const r = await rect(page, '#stage');
  const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  const L = 92;
  const sx = r.cx - v[0] * L * 0.45, sy = r.cy - v[1] * L * 0.45;
  await page.evaluate(([x, y]) => (window as any).__fx.fadeIn(x, y, 110), [sx, sy]);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const k = 5;
  let x = sx, y = sy;
  for (let i = 1; i <= k; i++) {
    x = sx + v[0] * L * ease(i / k); y = sy + v[1] * L * ease(i / k);
    await page.mouse.move(x, y);
    await page.evaluate(([x, y]) => (window as any).__fx.set(x, y, 0.92, 1), [x, y]);
  }
  await page.mouse.up();
  await page.evaluate(([x, y]) => (window as any).__fx.fadeOut(x, y, 110), [x, y]);
}
const camT = async (page: Page) => ((await page.evaluate(DECODE_FRAME_JS)) as number) / CAM.fps;
async function waitCam(page: Page, t: number, max = 30000) {
  const t0 = Date.now();
  for (;;) {
    const c = await camT(page);
    if (c >= t) return c;
    if (Date.now() - t0 > max) throw new Error(`camera never reached ${t}s (at ${c})`);
    await sleep(15);
  }
}
const h1 = (page: Page) => page.evaluate(() => document.querySelector('h1')?.textContent ?? '');
async function waitH1(page: Page, re: RegExp, max = 60000) {
  const t0 = Date.now();
  while (!re.test(await h1(page))) { if (Date.now() - t0 > max) throw new Error(`timeout waiting for ${re}`); await sleep(20); }
}

async function launch(y4m?: string): Promise<Browser> {
  const args = y4m ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] : [];
  return chromium.launch({ channel: 'chrome', args });
}
async function phonePage(browser: Browser, url: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: PHONE.width, height: PHONE.height }, deviceScaleFactor: PHONE.dsf, isMobile: true, hasTouch: true, colorScheme: 'light', locale: 'en-US' });
  await ctx.addInitScript(INIT_JS);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction('!!window.__fx');
  return { ctx, page };
}

async function answerSafety(page: Page, quick: boolean) {
  for (const k of ['sudden-change', 'pain-redness', 'diabetes', 'glaucoma-family', 'distance-blur', 'distance-glasses']) {
    await tap(page, `label:has(> input[name="${k}"][value="no"])`, quick ? 40 : 60, true);
  }
}

// ---------- takes ----------
async function takeMain() {
  const browser = await launch(resolve(CAMDIR, 'main.y4m'));
  const { page } = await phonePage(browser, '/test.html?dev');
  const tk = new Take('main', page);
  await tk.start();
  await sleep(600);
  await tk.mark('start');
  await sleep(700);
  await tap(page, '#start', 250);
  await tk.mark('safety');
  await answerSafety(page, false);
  await tap(page, '#next', 250);
  await tk.mark('age');
  for (let i = 0; i < 5; i++) await tap(page, '#plus', 40, true);
  await sleep(200);
  await tap(page, '#next', 300);
  await tk.mark('camera');
  await sleep(500);
  await tap(page, '#allow', 0);
  await tk.mark('allow');
  await waitH1(page, /card/i);
  await tk.mark('card');
  await sleep(1300);
  await tap(page, '#skip', 200);
  await waitH1(page, /30 cm/);
  await tk.mark('calcam');
  const c0 = await camT(page);
  console.log(`  calcam reached at camera t=${c0.toFixed(2)} s (need ≤ ${MAIN_T.work})`);
  await waitCam(page, MAIN_T.work - 0.45);
  await tk.mark('calcamEnd');
  await tap(page, '#skip', 0);
  await tk.mark('working');
  await page.waitForFunction(() => !(document.getElementById('use') as HTMLButtonElement).disabled, null, { timeout: 20000 });
  await tk.mark('locked');
  await sleep(450);
  await tap(page, 'details.info summary', 1500);
  await tk.mark('infoOpen');
  await tap(page, 'details.info summary', 250);
  await tap(page, '#use', 150);
  await tk.mark('swipe');
  await sleep(500);
  for (let i = 0; i < 5; i++) {
    if (i === 4) {
      await tk.mark('sw4');
      const c = await camT(page);
      console.log(`  4 swipes done at camera t=${c.toFixed(2)} s (need ≤ ${MAIN_T.near - 0.3})`);
      await waitCam(page, MAIN_T.near - 0.3);
      await tk.mark('sw5');
    }
    await swipe(page, await eDirection(page));
    await sleep(i < 4 ? 200 : 0);
  }
  await waitH1(page, /sharp/i);
  await tk.mark('near');
  await waitCam(page, MAIN_T.blurry - 0.35);
  await tap(page, '#blurry', 0);
  await tk.mark('nearout');
  await waitCam(page, MAIN_T.sharp - 0.35);
  await tap(page, '#mark', 0);
  await tk.mark('result');
  await sleep(3200);
  await tk.mark('end');
  await tk.stop();
  await page.screenshot({ path: resolve(TMP, 'result-card@3x.png'), type: 'png' });
  await browser.close();
}

async function takeShades() {
  const browser = await launch(resolve(CAMDIR, 'shades.y4m'));
  const { page } = await phonePage(browser, '/test.html?dev');
  await tap(page, '#start', 50, true);
  await answerSafety(page, true);
  await tap(page, '#next', 80, true);
  await tap(page, '#next', 80, true);
  await tap(page, '#allow', 0, true);
  await waitH1(page, /card/i);
  await tap(page, '#skip', 50, true);
  await waitH1(page, /30 cm/);
  await tap(page, '#skip', 50, true);
  const tk = new Take('shades', page);
  await tk.start();
  console.log(`  working reached at camera t=${(await camT(page)).toFixed(2)} s (need ≤ ${SHADES_T.on - 2.5})`);
  await waitCam(page, SHADES_T.on - 2.6);
  await tk.mark('clipStart');
  await waitCam(page, SHADES_T.on);
  await tk.mark('on');
  await waitCam(page, SHADES_T.on + 5.2);
  await tk.mark('clipEnd');
  await tk.stop();
  await browser.close();
}

async function takeTryon() {
  const browser = await launch();
  const { page } = await phonePage(browser, '/test.html?dev&demo');
  // run the demo flow to the result without recording
  const setSlider = (v: number) => page.evaluate((v) => { const s = document.getElementById('demo-range') as HTMLInputElement; s.value = String(v); s.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  await answerSafety(page, true);
  await tap(page, '#next', 50, true);
  for (let i = 0; i < 5; i++) await tap(page, '#plus', 20, true);
  await tap(page, '#next', 50, true);
  await setSlider(40);
  await page.waitForFunction(() => !(document.getElementById('use') as HTMLButtonElement).disabled, null, { timeout: 20000 });
  await tap(page, '#use', 100, true);
  for (let i = 0; i < 5; i++) { await swipe(page, await eDirection(page)); await sleep(120); }
  await waitH1(page, /sharp/i);
  await tap(page, '#blurry', 100, true);
  await setSlider(55);
  await sleep(300);
  await tap(page, '#mark', 300, true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
  const tk = new Take('tryon', page);
  await tk.start();
  await sleep(400);
  await tk.mark('start');
  await tap(page, '#tryon', 350, false, 120);
  await tk.mark('pick');
  await tap(page, '.power-chip[data-p="2"]', 250, false, 120);
  await tap(page, '#next', 300, false, 120);
  await tk.mark('sharp');
  let p = await page.evaluate('window.__fx.thumb(Number(document.getElementById("demo-range").value))') as { x: number; y: number };
  await page.evaluate(([x, y]) => (window as any).__fx.fadeIn(x, y, 120), [p.x, p.y]);
  await page.evaluate('window.__fx.slide(40, 700)');
  p = await page.evaluate('window.__fx.thumb(40)') as { x: number; y: number };
  await page.evaluate(([x, y]) => (window as any).__fx.fadeOut(x, y, 120), [p.x, p.y]);
  await tap(page, '#ok', 200, false, 120);
  await tk.mark('nearlim');
  await page.evaluate('window.__fx.slide(27, 750)');
  await tap(page, '#mark', 200, false, 120);
  await tk.mark('farlim');
  await page.evaluate('window.__fx.slide(60, 900)');
  await tap(page, '#mark', 0, false, 120);
  await tk.mark('verdict');
  await sleep(2600);
  await page.screenshot({ path: resolve(TMP, 'verdict@3x.png'), type: 'png' });
  await tk.mark('end');
  await tk.stop();
  await browser.close();
}

// ---------- materialize: take + edit list → 30 fps clip frames ----------
interface Piece { from: string | number; to: string | number; speed?: number }
interface ClipSpec {
  name: string; take: string; pieces: Piece[];
  cues: { id: string; at: string | number; delay?: number }[];
  eyebrow: string; title: string; sub: string; label?: string; labelKind?: 'cam' | 'refuse' | 'demo';
  magnifier?: boolean; camView?: string; distNote: string;
}
interface TakeData { frames: { t: number; n: number }[]; marks: Record<string, number>; log: { t: number; f: number; live: string | null; e: [number, number] | null; m?: string | null; demo: number | null }[] }

function materialize(spec: ClipSpec) {
  const take: TakeData = JSON.parse(readFileSync(resolve(RT, spec.take, 'take.json'), 'utf8'));
  const raw = resolve(RT, spec.take, 'raw');
  const T = (x: string | number) => (typeof x === 'number' ? x : take.marks[x.split('+')[0]] + (x.includes('+') ? Number(x.split('+')[1]) * 1000 : 0));
  const tm = (x: string | number) => { if (typeof x === 'number') return x; const m = /^([a-zA-Z]+\d*)([+-][\d.]+)?$/.exec(x)!; return take.marks[m[1]] + (m[2] ? Number(m[2]) * 1000 : 0); };
  void T;
  const dir = resolve(FRAMES, spec.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // output frame → take time
  const times: number[] = [];
  for (const p of spec.pieces) {
    const a = tm(p.from), b = tm(p.to), s = p.speed ?? 1;
    const n = Math.round(((b - a) / 1000 / s) * FPS);
    for (let i = 0; i < n; i++) times.push(a + (i * 1000 * s) / FPS);
  }
  const pick = <X extends { t: number }>(arr: X[], t: number, from: number) => { let i = from; while (i + 1 < arr.length && arr[i + 1].t <= t) i++; return i; };
  let fi = 0, li = 0;
  const dist: (number | null)[] = [];
  const live: (string | null)[] = [];
  const cam: number[] = [];
  const erects: ([number, number] | null)[] = [];
  const cueFrames: { id: string; frame: number }[] = [];
  times.forEach((t, k) => {
    fi = pick(take.frames, t, fi);
    li = pick(take.log, t, li);
    const src = resolve(raw, `s${String(take.frames[fi].n).padStart(5, '0')}.jpg`);
    const dst = resolve(dir, `f${String(k).padStart(5, '0')}.jpg`);
    try { linkSync(src, dst); } catch { copyFileSync(src, dst); }
    const L = take.log[li];
    const m = L?.live ? /^(\d+) cm$/.exec(L.live) : null;
    dist.push(m ? Number(m[1]) : null);
    live.push(L?.live ?? null);
    cam.push(L?.f ?? -1);
    erects.push(L?.e ?? null);
  });
  const markFrames: Record<string, number> = {};
  for (const [k, v] of Object.entries(take.marks)) { const i = times.findIndex((x) => x >= v); if (i > 0) markFrames[k] = i; }
  for (const c of spec.cues) {
    const t = tm(c.at) + (c.delay ?? 0) * 1000;
    let k = times.findIndex((x) => x >= t);
    if (k < 0) k = times.length - 1;
    cueFrames.push({ id: c.id, frame: k });
  }
  // magnifier: the E's own canvas pixels as logged on each animation frame (see INIT_JS)
  if (spec.magnifier) {
    let lastPng: Buffer | null = null;
    times.forEach((t, k) => {
      let li2 = 0;
      while (li2 + 1 < take.log.length && take.log[li2 + 1].t <= t) li2++;
      let q = li2;
      while (q > 0 && !take.log[q].m) q--;
      const m = take.log[q]?.m;
      const png = m ? Buffer.from(m.split(',')[1], 'base64') : lastPng;
      if (png) lastPng = png;
      const out = resolve(dir, `m${String(k).padStart(5, '0')}.png`);
      if (png) writeFileSync(out, png);
      else execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=84x84', '-frames:v', '1', out]);
    });
  }
  // what the camera saw: the Y4M frame the app was processing
  if (spec.camView) {
    const all = resolve(CAMDIR, `${spec.camView}-frames`);
    if (!existsSync(resolve(all, 'c00000.jpg'))) {
      mkdirSync(all, { recursive: true });
      execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', resolve(CAMDIR, `${spec.camView}.y4m`), '-vf', 'crop=600:450:20:0,scale=320:240:flags=lanczos', '-q:v', '3', '-start_number', '0', resolve(all, 'c%05d.jpg')]);
    }
    const off = resolve(CAMDIR, 'camera-off.jpg');
    if (!existsSync(off)) execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2a2826:s=320x240', '-frames:v', '1', off]);
    let last = -1;
    cam.forEach((f, i) => {
      if (f >= 0) last = f;
      copyFileSync(last < 0 ? off : resolve(all, `c${String(last).padStart(5, '0')}.jpg`), resolve(dir, `c${String(i).padStart(5, '0')}.jpg`));
    });
  }
  const meta = { name: spec.name, layout: 'phone', rt: true, frames: times.length, fps: FPS, cues: cueFrames, markFrames, dist, live, cam, magnifier: !!spec.magnifier, camView: !!spec.camView,
    eyebrow: spec.eyebrow, title: spec.title, sub: spec.sub, label: spec.label, labelKind: spec.labelKind, distNote: spec.distNote, mag: MAG };
  writeFileSync(resolve(dir, 'meta.json'), JSON.stringify(meta));
  const nd = dist.filter((d) => d !== null) as number[];
  console.log(`${spec.name.padEnd(8)} ${times.length} frames (${(times.length / FPS).toFixed(2)} s)  distance shown ${nd.length ? `${Math.min(...nd)}–${Math.max(...nd)} cm` : 'none'}`);
}

const CAM_LABEL = 'Illustrated face fed through Chrome’s camera into the real app — the distance and the E are computed live';
export const CLIPS: ClipSpec[] = [
  {
    name: 'app', take: 'main', camView: 'main', labelKind: 'cam', label: CAM_LABEL, distNote: 'measured live by the camera',
    eyebrow: 'The real app · camera mode', title: 'Your camera becomes a ruler', sub: 'Eye-to-screen distance from the size of the iris, computed on the device. Video never leaves the phone.',
    pieces: [
      { from: 'start', to: 'camera+0.9', speed: 3.2 },
      { from: 'camera+0.9', to: 'camera+1.4', speed: 1 },
      { from: 'card-0.1', to: 'card+1.0', speed: 1.6 },
      { from: 'calcam-0.1', to: 'calcam+0.8', speed: 1.5 },
      { from: 'calcamEnd-0.35', to: 'locked+0.5', speed: 1.25 },
      { from: 'locked+0.5', to: 'infoOpen', speed: 1.4 },
      { from: 'infoOpen', to: 'swipe', speed: 1.5 },
    ],
    cues: [{ id: 'app', at: 'camera', delay: 0.1 }],
  },
  {
    name: 'swipe', take: 'main', camView: 'main', magnifier: true, labelKind: 'cam', label: CAM_LABEL, distNote: 'measured live by the camera',
    eyebrow: 'Step 6 of 8 · small print', title: 'Swipe the way the E points', sub: 'No reading needed. This E is drawn at the true size of medicine-label print.',
    pieces: [{ from: 'swipe', to: 'sw4', speed: 1.5 }, { from: 'sw5-0.1', to: 'near', speed: 1.5 }],
    cues: [{ id: 'swipe', at: 'swipe', delay: 0.25 }],
  },
  {
    name: 'near', take: 'main', camView: 'main', magnifier: true, labelKind: 'cam', label: CAM_LABEL, distNote: 'measured live by the camera',
    eyebrow: 'Step 7 of 8 · closest sharp point', title: 'Same size to your eye, at any distance', sub: 'As the face moves, the E is redrawn from the measured distance.',
    pieces: [{ from: 'near', to: 'nearout', speed: 1 }, { from: 'nearout', to: 'result', speed: 1.3 }],
    cues: [{ id: 'near', at: 'near', delay: 0.1 }],
  },
  {
    name: 'result', take: 'main', camView: 'main', labelKind: 'cam', label: CAM_LABEL, distNote: 'measured live by the camera',
    eyebrow: 'Step 8 of 8', title: 'A starting strength', sub: 'For ready-made reading glasses, from published optics. Not a prescription, and not an eye exam.',
    pieces: [{ from: 'result', to: 'end-1.4', speed: 1 }],
    cues: [],
  },
  {
    name: 'refuse', take: 'shades', camView: 'shades', labelKind: 'refuse', label: 'Eyes covered → the app refuses to measure', distNote: 'measured live by the camera',
    eyebrow: 'Eye-visibility check', title: 'No eyes, no number', sub: 'Sunglasses go on: the app stops measuring instead of guessing.',
    pieces: [{ from: 'clipStart+0.7', to: 'clipEnd-0.9', speed: 1 }],
    cues: [{ id: 'refuse', at: 'on', delay: 0.5 }],
  },
  {
    name: 'tryon', take: 'tryon', labelKind: 'demo', label: 'Demo mode: here a slider stands in for the camera', distNote: 'set by the demo slider',
    eyebrow: 'At the rack', title: 'Check the pair before you buy', sub: 'Glasses on, it finds where you see sharply. Your reading distance should sit in the middle.',
    pieces: [{ from: 'start', to: 'end', speed: 1.25 }],
    cues: [{ id: 'tryon', at: 'start', delay: 0.2 }],
  },
];

const want = new Set(process.argv.slice(2));
const all = want.size === 0;
if (all || want.has('main')) await takeMain();
if (all || want.has('shades')) await takeShades();
if (all || want.has('tryon')) await takeTryon();
if (all || want.has('cut')) for (const c of CLIPS) if (existsSync(resolve(RT, c.take, 'take.json'))) materialize(c);
void dur;
