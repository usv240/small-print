// Composites the recorded frames into the final demo video: branded backgrounds, phone frame, the E
// magnifier, burned-in captions (from Polly speech marks), narration mix (loudnorm), H.264 + AAC.
// Also writes the looping GIF and the poster frame. Usage: npx tsx video/compose.ts
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HERE = import.meta.dirname;
const TMP = resolve(HERE, 'tmp');
const FR = resolve(TMP, 'frames');
const CMP = resolve(TMP, 'compose');
const OUT = resolve(HERE, '../public/media');
mkdirSync(CMP, { recursive: true });
mkdirSync(OUT, { recursive: true });
const FPS = 30;
const ORDER = ['hook', 'validation', 'stats', 'app', 'swipe', 'near', 'result', 'refuse', 'tryon', 'aws', 'end'];
const tts = JSON.parse(readFileSync(resolve(TMP, 'tts/manifest.json'), 'utf8'));

interface Meta { name: string; layout: 'full' | 'desktop' | 'phone'; magnifier?: boolean; camView?: boolean; label?: string; labelKind?: 'cam' | 'refuse' | 'demo'; distNote?: string; live?: (string | null)[]; cam?: number[]; title?: string; sub?: string; eyebrow?: string; frames: number; cues: { id: string; frame: number }[]; dist: (number | null)[]; start: number }
const metas: Meta[] = ORDER.map((n) => JSON.parse(readFileSync(resolve(FR, n, 'meta.json'), 'utf8')));
let acc = 0;
for (const m of metas) { m.start = acc; acc += m.frames; }
const TOTAL = acc;
const totalSec = TOTAL / FPS;
console.log(`total ${TOTAL} frames = ${totalSec.toFixed(2)} s`);

const ff = (args: string[], cwd = CMP) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { cwd, stdio: ['ignore', 'inherit', 'inherit'] });

// ---------- layout ----------
const SCREEN = { x: 902, y: 35, w: 300, h: 650 }; // phone screen (390×844 CSS, recorded at 3×, scaled)
const PANEL_Y = 322;
const CAMBOX = { x: 80, y: PANEL_Y, w: 256, h: 192 };
const MAGBOX = { x: 630, y: PANEL_Y, s: 168 };
const DESK = { x: 80, y: 24, w: 1120, h: 590 };
const DIST_AT = (m: Meta) => (m.camView ? { x: 372, y: PANEL_Y } : { x: 80, y: PANEL_Y });

const css = `
  :root { --bg:#fbf8f3; --ink:#1a1917; --muted:#5d5a55; --line:#e4ddd2; --accent:#b4410e; --accent-soft:#fbe9df; --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif; --sans:"Segoe UI",system-ui,sans-serif; }
  html,body { margin:0; width:1280px; height:720px; overflow:hidden; background:transparent; font-family:var(--sans); color:var(--ink); }
  .bg { position:absolute; inset:0; background:var(--bg); }
  .brand { position:absolute; left:80px; top:34px; font:700 26px var(--serif); }
  .brand span { color:var(--accent); }
  .eyebrow { position:absolute; left:80px; top:96px; font:600 15px var(--sans); letter-spacing:.14em; text-transform:uppercase; color:var(--accent); }
  .h { position:absolute; left:80px; top:120px; width:760px; font:600 40px/1.1 var(--serif); margin:0; }
  .sub { position:absolute; left:80px; width:740px; font:19px/1.45 var(--sans); color:var(--muted); margin:0; }
  .plabel { position:absolute; top:${PANEL_Y - 24}px; font:600 13px var(--sans); letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
  .magbox { position:absolute; left:${MAGBOX.x - 2}px; top:${MAGBOX.y - 2}px; width:${MAGBOX.s}px; height:${MAGBOX.s}px; border:2px solid var(--line); border-radius:4px; background:#fff; }
  .cambox { position:absolute; left:${CAMBOX.x - 2}px; top:${CAMBOX.y - 2}px; width:${CAMBOX.w}px; height:${CAMBOX.h}px; border:2px solid var(--line); border-radius:6px; background:#2a2826; }
  .chip { position:absolute; left:80px; top:${CAMBOX.y + CAMBOX.h + 22}px; max-width:730px; box-sizing:border-box; font:600 15px/1.4 var(--sans); padding:8px 16px 8px 34px; border-radius:14px; }
  .chip::before { content:""; position:absolute; left:14px; top:14px; width:10px; height:10px; border-radius:50%; }
  .chip.cam { background:#eef5ef; color:#1d5a32; border:1.5px solid #b9d8c1; } .chip.cam::before { background:#2f8a4c; }
  .chip.refuse { background:var(--accent-soft); color:#8a300a; border:1.5px solid #f0c3aa; } .chip.refuse::before { background:var(--accent); }
  .chip.demo { background:#f4efe7; color:var(--muted); border:1.5px solid var(--line); } .chip.demo::before { background:#9a948b; }
  .bezel { position:absolute; left:${SCREEN.x - 12}px; top:${SCREEN.y - 12}px; width:${SCREEN.w + 24}px; height:${SCREEN.h + 24}px; border-radius:44px; background:#1a1917; box-shadow:0 24px 60px rgba(26,25,23,.22), 0 4px 14px rgba(26,25,23,.12); }
  .hole { position:absolute; left:${SCREEN.x}px; top:${SCREEN.y}px; width:${SCREEN.w}px; height:${SCREEN.h}px; border-radius:32px; box-shadow:0 0 0 13px #1a1917, inset 0 0 0 1px rgba(0,0,0,.25); }
  .card { position:absolute; left:${DESK.x}px; top:${DESK.y}px; width:${DESK.w}px; height:${DESK.h}px; border-radius:14px; background:#fff; box-shadow:0 20px 50px rgba(26,25,23,.14), 0 2px 8px rgba(26,25,23,.08); }
  .dhole { position:absolute; left:${DESK.x}px; top:${DESK.y}px; width:${DESK.w}px; height:${DESK.h}px; border-radius:14px; box-shadow:inset 0 0 0 1px #e4ddd2, 0 0 0 8px #fbf8f3; }
`;

async function renderPngs() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const shot = async (html: string, file: string, transparent = false) => {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    // place the sub line under the (1 or 2 line) heading
    await page.evaluate(() => { const h = document.querySelector('.h') as HTMLElement | null; const s = document.querySelector('.sub') as HTMLElement | null; if (h && s) s.style.top = `${h.offsetTop + h.offsetHeight + 16}px`; });
    await page.screenshot({ path: resolve(CMP, file), omitBackground: transparent });
  };
  await shot('<div class="bg"></div><div class="card"></div>', 'bg-desktop.png');
  await shot('<div class="dhole"></div>', 'fg-desktop.png', true);
  await shot('<div class="hole"></div>', 'fg-phone.png', true);
  for (const m of metas.filter((x) => x.layout === 'phone')) {
    const d = DIST_AT(m);
    await shot(`<div class="bg"></div><div class="brand">Small <span>Print</span></div>
      <div class="eyebrow">${m.eyebrow ?? ''}</div><p class="h">${m.title ?? ''}</p><p class="sub">${m.sub ?? ''}</p>
      ${m.camView ? `<div class="plabel" style="left:${CAMBOX.x}px">What the camera sees</div><div class="cambox"></div>` : ''}
      <div class="plabel" style="left:${d.x}px">Eye-to-screen distance</div>
      ${m.magnifier ? `<div class="plabel" style="left:${MAGBOX.x}px">The E, zoomed in</div><div class="magbox"></div>` : ''}
      ${m.label ? `<div class="chip ${m.labelKind ?? 'cam'}" style="${m.camView ? '' : `top:${PANEL_Y + 150}px`}">${m.label}</div>` : ''}
      <div class="bezel"></div>`, `bg-${m.name}.png`);
  }
  await browser.close();
}

function encodeClips() {
  const list: string[] = [];
  for (const m of metas) {
    const dir = resolve(FR, m.name).replace(/\\/g, '/');
    const out = `clip-${m.name}.mp4`;
    const enc = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-frames:v', String(m.frames), out];
    if (m.layout === 'full') {
      ff(['-framerate', String(FPS), '-i', `${dir}/f%05d.jpg`, '-vf', 'scale=1280:720:flags=lanczos,format=yuv420p', ...enc]);
    } else if (m.layout === 'desktop') {
      ff(['-loop', '1', '-framerate', String(FPS), '-i', 'bg-desktop.png', '-framerate', String(FPS), '-i', `${dir}/f%05d.jpg`, '-loop', '1', '-framerate', String(FPS), '-i', 'fg-desktop.png',
        '-filter_complex', `[1]scale=${DESK.w}:${DESK.h}:flags=lanczos[p];[0][p]overlay=${DESK.x}:${DESK.y}[a];[a][2]overlay=0:0,format=yuv420p`, ...enc]);
    } else {
      const inputs = ['-loop', '1', '-framerate', String(FPS), '-i', `bg-${m.name}.png`, '-framerate', String(FPS), '-i', `${dir}/f%05d.jpg`, '-loop', '1', '-framerate', String(FPS), '-i', 'fg-phone.png'];
      let fc = `[1]scale=${SCREEN.w}:${SCREEN.h}:flags=lanczos[p];[0][p]overlay=${SCREEN.x}:${SCREEN.y}[a];[a][2]overlay=0:0`;
      let k = 3;
      if (m.magnifier) {
        inputs.push('-framerate', String(FPS), '-i', `${dir}/m%05d.png`);
        fc += `[b${k}];[${k}]scale=${MAGBOX.s}:${MAGBOX.s}:flags=neighbor[m];[b${k}][m]overlay=${MAGBOX.x}:${MAGBOX.y}`;
        k++;
      }
      if (m.camView) {
        inputs.push('-framerate', String(FPS), '-i', `${dir}/c%05d.jpg`);
        fc += `[b${k}];[${k}]scale=${CAMBOX.w}:${CAMBOX.h}:flags=lanczos[c];[b${k}][c]overlay=${CAMBOX.x}:${CAMBOX.y}`;
        k++;
      }
      ff([...inputs, '-filter_complex', `${fc},format=yuv420p`, ...enc]);
    }
    list.push(`file '${out}'`);
    console.log(`encoded ${out}`);
  }
  writeFileSync(resolve(CMP, 'list.txt'), list.join('\n') + '\n');
  ff(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'video.mp4']);
}

// ---------- captions ----------
const ts = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000), mi = Math.floor((cs % 360000) / 6000), se = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};
const pretty = (s: string) => s.replace(/'/g, '’');

function captionEvents(): string[] {
  const ev: string[] = [];
  for (const m of metas) {
    if (m.name === 'end') continue; // the end card shows the same words on screen
    for (const cue of m.cues) {
      const seg = tts.segments[cue.id];
      const t0 = (m.start + cue.frame) / FPS;
      const timed = (seg.tokens as { tok: string; t: number }[]).map((x) => ({ tok: x.tok, t: x.t }));
      const max = m.layout === 'phone' ? 48 : 72;
      // Split each sentence into the fewest roughly equal chunks that fit, preferring breaks after commas.
      const chunks: { text: string; t: number }[] = [];
      const sentences: (typeof timed)[] = [];
      let sent: typeof timed = [];
      for (const x of timed) { sent.push(x); if (/[.?!]$/.test(x.tok)) { sentences.push(sent); sent = []; } }
      if (sent.length) sentences.push(sent);
      const textOf = (xs: typeof timed) => xs.map((y) => y.tok).join(' ');
      const split = (s: typeof timed): void => {
        const total = textOf(s).length;
        if (total <= max || s.length < 2) { chunks.push({ text: textOf(s), t: s[0].t }); return; }
        const target = total / Math.ceil(total / max);
        let best = 0, bestScore = Infinity;
        for (let i = 1; i < s.length; i++) {
          const left = textOf(s.slice(0, i)).length;
          if (left > max) break;
          const score = Math.abs(left - target) - (/[,;:]$/.test(s[i - 1].tok) ? 10 : 0);
          if (score < bestScore) { bestScore = score; best = i; }
        }
        if (best === 0) best = 1;
        chunks.push({ text: textOf(s.slice(0, best)), t: s[0].t });
        split(s.slice(best));
      };
      sentences.forEach(split);
      const style = m.layout === 'phone' ? 'Side' : 'Bottom';
      chunks.forEach((c, i) => {
        const s = t0 + c.t;
        const e = i + 1 < chunks.length ? t0 + chunks[i + 1].t - 0.02 : t0 + seg.duration + 0.4;
        ev.push(`Dialogue: 0,${ts(s - 0.05)},${ts(Math.max(e, s + 0.8))},${style},,0,0,0,,${pretty(c.text)}`);
      });
    }
  }
  return ev;
}

function distanceEvents(): string[] {
  const ev: string[] = [];
  for (const m of metas.filter((x) => x.layout === 'phone')) {
    const p = DIST_AT(m);
    const key = (i: number) => (m.dist[i] !== null ? `d${m.dist[i]}` : m.live?.[i]?.startsWith('Can') ? 'refused' : (m.cam?.[i] ?? -1) < 0 && m.camView ? 'off' : 'none');
    let i = 0;
    while (i < m.dist.length) {
      const k = key(i);
      let j = i + 1;
      while (j < m.dist.length && key(j) === k) j++;
      const s = ts((m.start + i) / FPS), e = ts((m.start + j) / FPS);
      const at = (dy: number) => `{\\pos(${p.x},${p.y + dy})}`;
      if (k.startsWith('d')) {
        ev.push(`Dialogue: 1,${s},${e},Dist,,0,0,0,,${at(-4)}${m.dist[i]} cm`);
        ev.push(`Dialogue: 1,${s},${e},DistNote,,0,0,0,,${at(98)}${m.distNote ?? ''}`);
      } else if (k === 'refused') {
        ev.push(`Dialogue: 1,${s},${e},DistNone,,0,0,0,,${at(-4)}—`);
        ev.push(`Dialogue: 1,${s},${e},DistRefuse,,0,0,0,,${at(98)}eyes not visible: no measurement`);
      } else {
        ev.push(`Dialogue: 1,${s},${e},DistNone,,0,0,0,,${at(-4)}–`);
        ev.push(`Dialogue: 1,${s},${e},DistNote,,0,0,0,,${at(98)}${k === 'off' ? 'camera not started yet' : 'not shown on this screen'}`);
      }
      i = j;
    }
  }
  return ev;
}

function writeAss() {
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Bottom,Segoe UI Semibold,30,&H0017191A,&H0017191A,&H00F3F8FB,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,90,90,26,1
Style: Side,Segoe UI Semibold,28,&H0017191A,&H0017191A,&H00F3F8FB,&H00000000,0,0,0,0,100,100,0,0,1,0,0,1,80,450,26,1
Style: Dist,Palatino Linotype,84,&H000E41B4,&H000E41B4,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: DistNone,Palatino Linotype,84,&H00B2C1CB,&H00B2C1CB,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: DistNote,Segoe UI,16,&H00555A5D,&H00555A5D,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: DistRefuse,Segoe UI Semibold,16,&H000A308A,&H000A308A,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${[...captionEvents(), ...distanceEvents()].join('\n')}
`;
  writeFileSync(resolve(CMP, 'captions.ass'), ass);
}

function mixAudio() {
  const inputs: string[] = [];
  const parts: string[] = [];
  let k = 0;
  for (const m of metas) for (const cue of m.cues) {
    inputs.push('-i', tts.segments[cue.id].mp3);
    const ms = Math.round(((m.start + cue.frame) / FPS) * 1000);
    parts.push(`[${k}:a]aresample=48000,adelay=${ms}:all=1[a${k}]`);
    k++;
  }
  const fc = `${parts.join(';')};${Array.from({ length: k }, (_, i) => `[a${i}]`).join('')}amix=inputs=${k}:normalize=0:duration=longest,apad=whole_dur=${totalSec.toFixed(3)},atrim=0:${totalSec.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]`;
  ff([...inputs, '-filter_complex', fc, '-map', '[out]', '-ac', '2', '-c:a', 'pcm_s16le', 'audio.wav']);
}

function final() {
  const fadeOut = (totalSec - 0.7).toFixed(2);
  ff(['-i', 'video.mp4', '-i', 'audio.wav',
    '-vf', `fade=t=in:st=0:d=0.4:color=0xfbf8f3,fade=t=out:st=${fadeOut}:d=0.7:color=0xfbf8f3,subtitles=captions.ass,scale=out_range=tv:out_color_matrix=bt709:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-maxrate', '2600k', '-bufsize', '5200k', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', '-shortest', 'demo.mp4']);
  copyFileSync(resolve(CMP, 'demo.mp4'), resolve(OUT, 'demo.mp4'));
  // poster: the near-point sweep at its farthest (big E, camera view, live distance)
  const n = metas.find((m) => m.name === 'near')!;
  let best = 0;
  n.dist.forEach((d, i) => { if (d !== null && d > (n.dist[best] ?? 0) && i < n.frames * 0.6) best = i; });
  ff(['-ss', ((n.start + best) / FPS).toFixed(3), '-i', 'demo.mp4', '-frames:v', '1', '-q:v', '3', '-update', '1', resolve(OUT, 'demo-poster.jpg')]);
}

function gif() {
  // The real camera sweep (near-point screen): the illustrated face goes 40 → 25 → 62 → 38 cm and the app
  // redraws the E from the live distance. Top: the phone (live distance pill + E). Bottom: what the camera
  // sees and the E zoomed in. Frames from the near clip up to just before the "Blurry" tap.
  const n = metas.find((m) => m.name === 'near')!;
  const dir = resolve(FR, 'near').replace(/\\/g, '/');
  const end = Math.min(n.frames, ((n as any).markFrames?.nearout ?? 216) - 4);
  const font = 'C\\:/Windows/Fonts/seguisb.ttf';
  const cut = (i: number, f: string, label: string) => `[${i}]trim=start_frame=0:end_frame=${end},setpts=PTS-STARTPTS,${f},fps=15[${label}]`;
  const txt = (t: string, x: number, y: number, size = 15, color = '0x5d5a55') => `drawtext=fontfile='${font}':text='${t}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}`;
  const fc = [
    cut(0, 'crop=390:500:0:50,scale=480:-2:flags=lanczos', 'top'),
    cut(1, 'scale=150:150:flags=neighbor', 'mag'),
    cut(2, 'scale=200:150:flags=lanczos', 'cam'),
    `color=c=0xfbf8f3:s=480x214:r=15[strip]`,
    `[strip][cam]overlay=16:30:shortest=1[s1]`,
    `[s1][mag]overlay=314:30:shortest=1,${txt('WHAT THE CAMERA SEES', 16, 9, 12)},${txt('THE E, ZOOMED IN', 314, 9, 12)},${txt('Illustrated face fed through Chrome’s camera into the real app', 16, 188, 13, '0x1d5a32')}[bot]`,
    `[top][bot]vstack,split[v1][v2]`,
    `[v1]palettegen=max_colors=192:stats_mode=full[pal]`,
    `[v2][pal]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  ].join(';');
  ff(['-framerate', String(FPS), '-i', `${dir}/f%05d.jpg`, '-framerate', String(FPS), '-i', `${dir}/m%05d.png`, '-framerate', String(FPS), '-i', `${dir}/c%05d.jpg`, '-filter_complex', fc, '-loop', '0', resolve(OUT, 'e-resize.gif')]);
}

const steps = new Set(process.argv.slice(2));
const all = steps.size === 0;
if (all || steps.has('png')) await renderPngs();
if (all || steps.has('clips')) encodeClips();
if (all || steps.has('ass')) writeAss();
if (all || steps.has('audio')) mixAudio();
if (all || steps.has('final')) final();
if (all || steps.has('gif')) gif();
for (const f of ['demo.mp4', 'demo-poster.jpg', 'e-resize.gif']) {
  try { console.log(f, (statSync(resolve(OUT, f)).size / 1e6).toFixed(2), 'MB'); } catch { /* not built */ }
}
