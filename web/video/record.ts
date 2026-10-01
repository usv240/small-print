// Records every shot of the demo video as numbered JPEG frames at exactly 30 fps.
// Phone shots drive the real app (test.html, demo mode) under Playwright's fake clock, advancing
// 1/30 s per frame, so the timing is deterministic and the E's resizing is captured frame by frame.
// Usage: npx tsx video/record.ts [title] [stats] [card] [phone] [aws] [end]   (default: all)
// Needs the site served at BASE (default http://127.0.0.1:4789): node scripts/copy-mediapipe.mjs && npx vite build --outDir video/tmp/site && npx vite preview --outDir video/tmp/site --port 4789
// Pipeline: node video/tts.mjs → npx tsx video/record.ts → npx tsx video/compose.ts → npx tsx video/stills.ts
import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FPS = 30;
const BASE = process.env.BASE ?? 'http://127.0.0.1:4789';
const HERE = import.meta.dirname;
const TMP = resolve(HERE, 'tmp');
const FRAMES = resolve(TMP, 'frames');
const tts = JSON.parse(readFileSync(resolve(TMP, 'tts/manifest.json'), 'utf8'));
const dur = (id: string): number => tts.segments[id].duration;
const sec = (s: number) => Math.round(s * FPS);

export const PHONE = { width: 390, height: 760, dsf: 3 };
export const DESKTOP = { width: 896, height: 472, dsf: 1.25 }; // renders 1120×590 px
const MAG = 28; // CSS px square around the E that the magnifier shows

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const pad = (n: number) => String(n).padStart(5, '0');

interface ClipOpts { layout: 'full' | 'desktop' | 'phone'; clock?: boolean; magnifier?: boolean; title?: string; sub?: string; eyebrow?: string }

class Clip {
  n = 0;
  ms = 0;
  cues: { id: string; frame: number }[] = [];
  dist: (number | null)[] = [];
  marks: Record<string, number> = {};
  dir: string;
  render?: (t: number) => Promise<void>;
  constructor(public name: string, public page: Page, public opts: ClipOpts) {
    this.dir = resolve(FRAMES, name);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
  }
  /** Start narration segment `id` now (plus an optional delay). */
  cue(id: string, delay = 0) { this.cues.push({ id, frame: this.n + sec(delay) }); }
  mark(name: string) { this.marks[name] = this.n; }
  /** Frame at which narration `id` ends. */
  cueEnd(id: string) { const c = this.cues.find((q) => q.id === id)!; return c.frame + sec(dur(id)); }
  async snap() {
    if (this.render) await this.render(this.n / FPS);
    if (this.opts.clock) {
      const target = Math.round(((this.n + 1) * 1000) / FPS);
      await this.page.clock.runFor(target - this.ms);
      this.ms = target;
    }
    const st = this.opts.layout === 'phone'
      ? await this.page.evaluate(() => (window as any).__fx.state())
      : { dist: null, e: null };
    await this.page.screenshot({ path: `${this.dir}/f${pad(this.n)}.jpg`, type: 'jpeg', quality: 93 });
    if (this.opts.magnifier) {
      const m = `${this.dir}/m${pad(this.n)}.png`;
      if (st.e) await this.page.screenshot({ path: m, type: 'png', clip: { x: st.e.cx - MAG / 2, y: st.e.cy - MAG / 2, width: MAG, height: MAG } });
      else if (this.n > 0) copyFileSync(`${this.dir}/m${pad(this.n - 1)}.png`, m);
    }
    this.dist.push(st.dist);
    this.n++;
  }
  async hold(seconds: number) { for (let i = 0, k = sec(seconds); i < k; i++) await this.snap(); }
  async holdUntil(frame: number) { while (this.n < frame) await this.snap(); }
  save() {
    const meta = { name: this.name, ...this.opts, frames: this.n, fps: FPS, cues: this.cues, dist: this.dist, marks: this.marks, mag: MAG };
    writeFileSync(resolve(this.dir, 'meta.json'), JSON.stringify(meta));
    console.log(`${this.name.padEnd(8)} ${this.n} frames (${(this.n / FPS).toFixed(2)} s)`);
  }
}

// ---------- in-page helpers (finger overlay, state, highlight) ----------

async function installFx(page: Page) {
  await page.evaluate(() => {
    const f = document.createElement('div');
    f.id = 'fx-finger';
    f.style.cssText = 'position:fixed;left:0;top:0;width:40px;height:40px;border-radius:50%;background:rgba(26,25,23,.30);border:3px solid rgba(255,255,255,.95);box-shadow:0 2px 10px rgba(0,0,0,.28);pointer-events:none;z-index:2147483647;opacity:0;box-sizing:border-box;';
    document.body.appendChild(f);
    const st = document.createElement('style');
    st.textContent = '.fx-hl{outline:3px solid #b4410e !important;outline-offset:5px;border-radius:10px;box-shadow:0 0 0 9px rgba(180,65,14,.10) !important;}';
    document.head.appendChild(st);
    (window as any).__fx = {
      set(x: number, y: number, s: number, o: number) { f.style.transform = `translate(${x - 20}px,${y - 20}px) scale(${s})`; f.style.opacity = String(o); },
      hide() { f.style.opacity = '0'; },
      state() {
        const live = document.querySelector('[data-live]');
        const s = document.getElementById('demo-range') as HTMLInputElement | null;
        const e = document.getElementById('e');
        let er = null;
        if (e) { const b = e.getBoundingClientRect(); er = { cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; }
        return { dist: live && s ? Number(s.value) : null, e: er };
      },
    };
  });
}

const fx = (page: Page, x: number, y: number, s: number, o: number) => page.evaluate(([x, y, s, o]) => (window as any).__fx.set(x, y, s, o), [x, y, s, o]);
const fxHide = (page: Page) => page.evaluate(() => (window as any).__fx.hide());

async function rectOf(page: Page, sel: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing ${sel}`);
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2, top: b.top + scrollY, vh: innerHeight };
  }, sel);
}

async function scrollTo(c: Clip, y: number, seconds: number) {
  const from = await c.page.evaluate(() => scrollY);
  const k = Math.max(1, sec(seconds));
  for (let i = 1; i <= k; i++) {
    const v = from + (y - from) * ease(i / k);
    await c.page.evaluate((v) => window.scrollTo({ top: v, behavior: 'instant' as ScrollBehavior }), v);
    await c.snap();
  }
}

/** Phone: scroll (if needed) so the element is comfortably visible above the demo bar. */
async function reveal(c: Clip, sel: string) {
  const r = await rectOf(c.page, sel);
  if (r.y < 70 || r.y + r.h > r.vh - 135) await scrollTo(c, Math.max(0, r.top - r.vh * 0.42), 0.45);
}

async function tap(c: Clip, sel: string, after = 0.15, quick = false) {
  if (c.opts.layout === 'phone') await reveal(c, sel);
  const r = await rectOf(c.page, sel);
  const k = quick ? 2 : 4;
  for (let i = 0; i < k; i++) { await fx(c.page, r.cx, r.cy, 1.3 - (0.4 / k) * i, (i + 1) / k); await c.snap(); }
  await c.page.mouse.click(r.cx, r.cy);
  await fx(c.page, r.cx, r.cy, 0.82, 1); await c.snap(); if (!quick) await c.snap();
  for (let i = 1; i <= k; i++) { await fx(c.page, r.cx, r.cy, 0.85 + (0.24 / k) * i, 1 - i / k); await c.snap(); }
  await fxHide(c.page);
  await c.hold(after);
}

async function sliderThumb(page: Page, v: number) {
  return page.evaluate((v) => {
    const s = document.getElementById('demo-range') as HTMLInputElement;
    const b = s.getBoundingClientRect();
    const min = Number(s.min), max = Number(s.max), thumb = 16;
    return { x: b.x + thumb / 2 + ((v - min) / (max - min)) * (b.width - thumb), y: b.y + b.height / 2 };
  }, v);
}

/** Drag the demo slider (the camera stand-in) from its current value to `to`, eased. */
async function slide(c: Clip, to: number, seconds: number, opts: { keepFinger?: boolean; easing?: (x: number) => number } = {}) {
  const page = c.page;
  const from = await page.evaluate(() => Number((document.getElementById('demo-range') as HTMLInputElement).value));
  const e = opts.easing ?? ease;
  let p = await sliderThumb(page, from);
  for (let i = 0; i < 3; i++) { await fx(page, p.x, p.y, 1.2 - 0.1 * i, (i + 1) / 3); await c.snap(); }
  const k = Math.max(1, sec(seconds));
  for (let i = 1; i <= k; i++) {
    const v = Math.round(from + (to - from) * e(i / k));
    await page.evaluate((v) => { const s = document.getElementById('demo-range') as HTMLInputElement; if (s.value !== String(v)) { s.value = String(v); s.dispatchEvent(new Event('input', { bubbles: true })); } }, v);
    p = await sliderThumb(page, v);
    await fx(page, p.x, p.y, 0.95, 1);
    await c.snap();
  }
  if (!opts.keepFinger) {
    for (let i = 1; i <= 3; i++) { await fx(page, p.x, p.y, 0.95 + 0.08 * i, 1 - i / 3); await c.snap(); }
    await fxHide(page);
  }
}

/** Which way the open side of the drawn E faces, read from the canvas pixels (the spine is opposite). */
async function eDirection(page: Page): Promise<'up' | 'down' | 'left' | 'right'> {
  // Passed as a string: tsx would otherwise inject its __name helper, which doesn't exist in the page.
  return page.evaluate(`(() => {
    const c = document.getElementById('e');
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    const d = ctx.getImageData(0, 0, w, h).data;
    const dark = (x, y) => d[(Math.round(y) * w + Math.round(x)) * 4 + 3] > 110;
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

async function swipe(c: Clip, dir: 'up' | 'down' | 'left' | 'right') {
  const page = c.page;
  const r = await rectOf(page, '#stage');
  const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  const L = 92;
  const sx = r.cx - v[0] * L * 0.45, sy = r.cy - v[1] * L * 0.45;
  for (let i = 0; i < 3; i++) { await fx(page, sx, sy, 1.25 - 0.08 * i, (i + 1) / 3); await c.snap(); }
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const k = 6;
  let x = sx, y = sy;
  for (let i = 1; i <= k; i++) {
    x = sx + v[0] * L * ease(i / k); y = sy + v[1] * L * ease(i / k);
    await page.mouse.move(x, y);
    await fx(page, x, y, 0.92, 1);
    if (i < k) await c.snap();
  }
  await page.mouse.up();
  await c.snap();
  for (let i = 1; i <= 3; i++) { await fx(page, x, y, 0.92 + 0.06 * i, 1 - i / 3); await c.snap(); }
  await fxHide(page);
}

// ---------- shots ----------

async function sceneClip(browser: Browser, name: string, file: string, seconds: (c: Clip) => number, cue: [string, number]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(resolve(HERE, 'scenes', file)).href);
  await page.evaluate(() => document.fonts.ready);
  const c = new Clip(name, page, { layout: 'full' });
  c.render = (t) => page.evaluate((t) => (window as any).render(t), t);
  c.cue(cue[0], cue[1]);
  await c.holdUntil(seconds(c));
  c.save();
  await ctx.close();
}

async function desktopPage(browser: Browser, path: string) {
  const ctx = await browser.newContext({ viewport: { width: DESKTOP.width, height: DESKTOP.height }, deviceScaleFactor: DESKTOP.dsf, colorScheme: 'light', locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await installFx(page);
  return { ctx, page };
}

const topOf = (page: Page, sel: string) => rectOf(page, sel).then((r) => r.top);
const hl = (page: Page, sel: string, on: boolean) => page.evaluate(([s, on]) => document.querySelector(s as string)?.classList.toggle('fx-hl', on as boolean), [sel, on]);

async function stats(browser: Browser) {
  const { ctx, page } = await desktopPage(browser, '/index.html');
  const c = new Clip('stats', page, { layout: 'desktop' });
  const statsTop = await topOf(page, '.stats');
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), Math.max(0, statsTop - 230));
  await c.hold(0.5);
  c.cue('stats', 0.0);
  await scrollTo(c, statsTop - 70, 1.0);
  const words = tts.segments.stats.words as { t: number; w: string }[];
  const at = (w: string) => c.cues[0].frame + sec(words.find((x) => x.w.startsWith(w))!.t);
  const stat = (i: number) => `.stats .stat:nth-child(${i})`;
  await hl(page, stat(1), true);
  await c.holdUntil(at('Reading') - 3);
  await hl(page, stat(1), false);
  await c.holdUntil(at('productivity'));
  await hl(page, stat(3), true);
  await c.holdUntil(at('income'));
  await hl(page, stat(3), false); await hl(page, stat(4), true);
  await c.holdUntil(c.cueEnd('stats') + sec(0.5));
  c.save();
  await ctx.close();
}

async function card(browser: Browser) {
  // Part A: the findings table (distance). Part B: the three reasons on the home page.
  const a = await desktopPage(browser, '/findings.html');
  const c = new Clip('card', a.page, { layout: 'desktop' });
  const top = await topOf(a.page, '#card');
  await a.page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), top - 24);
  const words = tts.segments.card.words as { t: number; w: string }[];
  c.cue('card', 0.25);
  const tbl = await topOf(a.page, '#card table');
  await c.hold(1.2);
  await scrollTo(c, tbl - 120, 1.0);
  await c.holdUntil(c.cues[0].frame + sec(words.find((x) => x.w === 'distance')!.t + 0.55));
  // switch page within the same clip
  const b = await desktopPage(browser, '/index.html');
  const lst = await topOf(b.page, 'main section.wrap > ul');
  const h2 = await b.page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find((x) => x.textContent?.startsWith('Why choosing')); return h!.getBoundingClientRect().top + scrollY; });
  await b.page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), h2 - 24);
  c.page = b.page;
  const li = (i: number) => `main section.wrap > ul > li:nth-child(${i})`;
  await hl(b.page, li(1), true);
  await c.hold(0.35);
  await hl(b.page, li(1), false); await hl(b.page, li(2), true);
  await c.holdUntil(c.cues[0].frame + sec(words.find((x) => x.w === 'only' && x.t > 5)!.t - 0.1));
  await hl(b.page, li(2), false); await hl(b.page, li(3), true);
  await c.holdUntil(c.cueEnd('card') + sec(0.45));
  void lst;
  c.save();
  await a.ctx.close(); await b.ctx.close();
}

async function aws(browser: Browser) {
  const words = tts.segments.aws.words as { t: number; w: string }[];
  const w = (s: string) => words.find((x) => x.w.startsWith(s))!.t;
  // 1) trust cards on the home page ("video never leaves the phone", "no AI guesses")
  const a = await desktopPage(browser, '/index.html');
  const c = new Clip('aws', a.page, { layout: 'desktop' });
  const g = await a.page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((x) => x.textContent?.startsWith('Built to be trusted'))!;
    (h.nextElementSibling as HTMLElement).id = 'fx-trust';
    return h.getBoundingClientRect().top + scrollY;
  });
  await a.page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), g - 24);
  c.cue('aws', 0.2);
  await hl(a.page, '#fx-trust .card:nth-child(1)', true);
  await c.holdUntil(c.cues[0].frame + sec(w('and') - 0.05));
  await hl(a.page, '#fx-trust .card:nth-child(1)', false); await hl(a.page, '#fx-trust .card:nth-child(3)', true);
  await scrollTo(c, await topOf(a.page, '#fx-trust .card:nth-child(3)') - 250, 0.5);
  await c.holdUntil(c.cues[0].frame + sec(w("It's") - 0.25));
  // 2) architecture diagram
  const b = await desktopPage(browser, '/evidence.html');
  const arch = await topOf(b.page, 'svg.arch');
  await b.page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), arch - 6);
  c.page = b.page;
  await c.holdUntil(c.cues[0].frame + sec(w('for') - 0.3));
  // 3) cost table total
  const cost = await b.page.evaluate(() => { const r = document.querySelector('tr.hl') as HTMLElement; return r.getBoundingClientRect().top + scrollY; });
  await b.page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), cost - 330);
  await hl(b.page, 'tr.hl', true);
  await c.holdUntil(c.cueEnd('aws') + sec(0.6));
  c.save();
  await a.ctx.close(); await b.ctx.close();
}

async function phone(browser: Browser) {
  const ctx = await browser.newContext({
    viewport: { width: PHONE.width, height: PHONE.height }, deviceScaleFactor: PHONE.dsf, isMobile: true, hasTouch: true,
    colorScheme: 'light', locale: 'en-US',
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date('2026-10-01T10:00:00Z') });
  await page.goto(`${BASE}/test.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.clock.pauseAt(new Date('2026-10-01T10:00:10Z'));
  await installFx(page);

  // --- app: welcome → demo → safety → age → reading distance
  let c = new Clip('app', page, { layout: 'phone', clock: true, eyebrow: 'The real app · demo mode', title: 'Your camera becomes a ruler', sub: 'It measures eye-to-screen distance on the device. In this recording a slider stands in for the camera.' });
  c.cue('app', 0.3);
  await c.hold(1.0);
  await tap(c, '#demo', 0.25);
  for (const k of ['sudden-change', 'pain-redness', 'diabetes', 'glaucoma-family', 'distance-blur', 'distance-glasses']) {
    await tap(c, `label:has(> input[name="${k}"][value="no"])`, 0.03, true);
  }
  await tap(c, '#next', 0.2);
  for (let i = 0; i < 5; i++) await tap(c, '#plus', 0.03, true);
  await c.hold(0.2);
  await tap(c, '#next', 0.2);
  c.mark('working');
  await slide(c, 38, 1.0);
  await tap(c, 'details.info summary', 0.2);
  // hold steady until the app has locked the reading distance, and the narration has finished
  for (let i = 0; i < sec(6); i++) {
    if (await page.evaluate(() => !(document.getElementById('use') as HTMLButtonElement).disabled)) break;
    await c.snap();
  }
  await c.hold(0.5);
  await c.holdUntil(c.cueEnd('app') + sec(0.15));
  await tap(c, '#use', 0);
  c.save();

  // --- swipe: small-print E (true size), 5 answers
  c = new Clip('swipe', page, { layout: 'phone', clock: true, magnifier: true, eyebrow: 'Step 6 of 8', title: 'Swipe the way the E points', sub: 'No reading needed. This E is small print, the size of a medicine label.' });
  c.cue('swipe', 0.15);
  await c.hold(0.55);
  for (let i = 0; i < 5; i++) {
    if (i === 4) await c.holdUntil(c.cueEnd('swipe') - 8);
    await swipe(c, await eDirection(page));
    if (i < 4) await c.hold(0.2);
  }
  c.save();

  // --- near point: the E keeps a constant visual angle while the distance changes
  c = new Clip('near', page, { layout: 'phone', clock: true, magnifier: true, eyebrow: 'Step 7 of 8', title: 'Same size to your eye, at any distance', sub: 'Redrawn about 30 times a second from the measured distance, to find your closest sharp point.' });
  c.cue('near', 0.1);
  await c.hold(0.35);
  await slide(c, 30, 0.8, { keepFinger: true });
  await slide(c, 62, 2.4, { keepFinger: true });
  await slide(c, 40, 1.3);
  await c.hold(0.2);
  await tap(c, '#blurry', 0.25);
  await slide(c, 55, 1.9, { easing: (x) => x });
  await c.holdUntil(c.cueEnd('near') - sec(0.2));
  await tap(c, '#mark', 0);
  c.save();

  // --- result
  c = new Clip('result', page, { layout: 'phone', clock: true, eyebrow: 'Step 8 of 8', title: 'A starting strength', sub: 'For ready-made reading glasses, from published optics. Not a prescription, and not an eye exam.' });
  c.cue('result', 0.3);
  await c.hold(1.8);
  await page.screenshot({ path: resolve(TMP, 'result-card@3x.png'), type: 'png' });
  await scrollTo(c, 150, 0.8);
  await c.holdUntil(c.cueEnd('result') + sec(0.5));
  c.save();

  // --- try-on in the shop
  c = new Clip('tryon', page, { layout: 'phone', clock: true, eyebrow: 'In the shop', title: 'Check the pair before you buy', sub: 'With the glasses on, it measures where you see sharply. Your reading distance should sit in the middle.' });
  c.cue('tryon', 0.2);
  await tap(c, '#tryon', 0.3);
  await tap(c, '.power-chip[data-p="2"]', 0.2);
  await tap(c, '#next', 0.25);
  await slide(c, 40, 0.9);
  await tap(c, '#ok', 0.2);
  await slide(c, 27, 0.9);
  await tap(c, '#mark', 0.2);
  await slide(c, 60, 1.1);
  await tap(c, '#mark', 0);
  c.mark('verdict');
  await c.hold(1.2);
  await page.screenshot({ path: resolve(TMP, 'verdict@3x.png'), type: 'png' });
  await c.holdUntil(Math.max(c.cueEnd('tryon') + sec(0.6), c.marks.verdict + sec(2.6)));
  c.save();
  await ctx.close();
}

// ---------- main ----------

const want = new Set(process.argv.slice(2));
const all = want.size === 0;
const browser = await chromium.launch();
try {
  if (all || want.has('title')) await sceneClip(browser, 'title', 'title.html', (c) => c.cueEnd('title') + sec(0.7), ['title', 0.45]);
  if (all || want.has('stats')) await stats(browser);
  if (all || want.has('card')) await card(browser);
  if (all || want.has('phone')) await phone(browser);
  if (all || want.has('aws')) await aws(browser);
  if (all || want.has('end')) await sceneClip(browser, 'end', 'end.html', (c) => c.cueEnd('end') + sec(1.9), ['end', 0.35]);
} finally {
  await browser.close();
}
