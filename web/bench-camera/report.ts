// Camera distance bench, step 2 of 2: statistics → public/data/camera-bench.json + public/figures/camera-linearity.svg.
//   npx tsx bench-camera/report.ts      (reads raw.json written by run.ts)
//
// Method (mirrors the app):
//  • Each run gives one iris width per processed frame (after a 2.5 s warm-up), for 3 s.
//  • Calibration: the app stores k = 300 mm × median iris width while the screen is held at 30 cm.
//    Here the reference scale stands in for 30 cm, so k = 300 × median iris width at that scale
//    (all frames of all its runs pooled).
//  • Every other scale s has a true relative distance 300 × S_REF ÷ s. Calibrated distance = k ÷ median
//    iris width at that scale; error = (calibrated − true) ÷ true.
//  • Jitter = SD of the per-frame calibrated distance within a run (no smoothing), averaged over runs (RMS).
//    The app additionally applies a 5-frame median and a light exponential filter; that is replayed
//    on the same frames and reported as smoothed jitter.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RAW, REF_MM, type RawFile } from './config';
import { NOMINAL_MM, screenRows } from './screen-specs';

const WEB = resolve(import.meta.dirname, '..');
const OUT_JSON = resolve(WEB, 'public/data/camera-bench.json');
const OUT_SVG = resolve(WEB, 'public/figures/camera-linearity.svg');

const IRIS_DIAMETER_MM = 11.7; // src/core/optics.ts
const UNCALIBRATED_HFOV_DEG = 70; // src/camera/distance.ts
const FOCAL_NORM = 0.5 / Math.tan(((UNCALIBRATED_HFOV_DEG / 2) * Math.PI) / 180);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const mad = (xs: number[]) => {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
};
const r = (x: number, d: number) => Number(x.toFixed(d));

/** The app's display filter (src/camera/distance.ts toSample): median of the last 5, then EMA 0.35. */
function appSmooth(mm: number[]): number[] {
  const hist: number[] = [];
  let sm: number | null = null;
  return mm.map((x) => {
    hist.push(x);
    if (hist.length > 5) hist.shift();
    const med = [...hist].sort((a, b) => a - b)[Math.floor(hist.length / 2)];
    sm = sm === null ? med : sm + 0.35 * (med - sm);
    return sm;
  });
}

const raw = JSON.parse(readFileSync(RAW, 'utf8')) as RawFile;
const runs30 = raw.runs.filter((x) => x.videoFps === 30);
const runs60 = raw.runs.filter((x) => x.videoFps === 60);
const scales = [...new Set(runs30.map((x) => x.scale))].sort((a, b) => b - a);
const refScale = scales.find((s) => Math.abs(s - raw.sRef) < 1e-9)!;

const pooled = (s: number) => runs30.filter((x) => x.scale === s).flatMap((x) => x.iris);
const k = REF_MM * median(pooled(refScale));
const refRunKs = runs30.filter((x) => x.scale === refScale).map((x) => REF_MM * median(x.iris));

const points = scales.map((s) => {
  const rs = runs30.filter((x) => x.scale === s);
  const trueMm = (REF_MM * raw.sRef) / s;
  const irisMedian = median(pooled(s));
  const measuredMm = k / irisMedian;
  const runMedians = rs.map((x) => median(x.iris));
  const runErrors = runMedians.map((m) => ((k / m - trueMm) / trueMm) * 100);
  // Worst case of one calibration session paired with one measurement session.
  const pairErrors = refRunKs.flatMap((kk) => runMedians.map((m) => ((kk / m - trueMm) / trueMm) * 100));
  const jitterSdMm = Math.sqrt(mean(rs.map((x) => sd(x.iris.map((i) => k / i)) ** 2)));
  const jitterMadMm = mean(rs.map((x) => mad(x.iris.map((i) => k / i))));
  const smoothSdMm = Math.sqrt(mean(rs.map((x) => sd(appSmooth(x.iris.map((i) => k / i)).slice(5)) ** 2)));
  const betweenRunSdPct = (sd(runMedians.map((m) => k / m)) / measuredMm) * 100;
  return {
    scale: s,
    isReference: s === refScale,
    trueCm: r(trueMm / 10, 2),
    irisMedian: r(irisMedian, 6),
    calibratedCm: r(measuredMm / 10, 2),
    errorPct: r(((measuredMm - trueMm) / trueMm) * 100, 2),
    runErrorPct: runErrors.map((e) => r(e, 2)),
    worstSessionPairErrorPct: r(Math.max(...pairErrors.map(Math.abs)), 2),
    uncalibratedCm: r((FOCAL_NORM * IRIS_DIAMETER_MM) / irisMedian / 10, 1),
    jitterSdMm: r(jitterSdMm, 2),
    jitterSdPct: r((jitterSdMm / measuredMm) * 100, 2),
    jitterMadMm: r(jitterMadMm, 2),
    smoothedJitterSdMm: r(smoothSdMm, 2),
    betweenRunSdPct: r(betweenRunSdPct, 2),
    frames: rs.map((x) => x.iris.length),
    fpsMedian: median(rs.flatMap((x) => x.fps)),
  };
});

const nonRef = points.filter((p) => !p.isReference);
const absErr = nonRef.map((p) => Math.abs(p.errorPct));
const fps30 = runs30.flatMap((x) => x.fps);
const fps60 = runs60.flatMap((x) => x.fps);
const glLog = raw.runs.some((x) => x.console.some((l) => /gl_context\.cc.*GL version/.test(l)));
const xnnLog = raw.runs.some((x) => x.console.some((l) => /XNNPACK delegate for CPU/.test(l)));
const gpuErrors = raw.runs.flatMap((x) => x.console.filter((l) => /^\[(error|pageerror)\]/.test(l) && !/XNNPACK/.test(l)));
// Linear fit of calibrated vs true distance (slope 1, intercept 0 would be perfect).
const xs = nonRef.map((p) => p.trueCm);
const ys = nonRef.map((p) => p.calibratedCm);
const mx = mean(xs), my = mean(ys);
const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
const intercept = my - slope * mx;

const summary = {
  meanAbsErrorPct: r(mean(absErr), 2),
  maxAbsErrorPct: r(Math.max(...absErr), 2),
  maxAbsRunErrorPct: r(Math.max(...nonRef.flatMap((p) => p.runErrorPct.map(Math.abs))), 2),
  worstSessionPairErrorPct: r(Math.max(...nonRef.map((p) => p.worstSessionPairErrorPct)), 2),
  fitSlope: r(slope, 4),
  fitInterceptCm: r(intercept, 2),
  jitterSdPctRange: [r(Math.min(...points.map((p) => p.jitterSdPct)), 2), r(Math.max(...points.map((p) => p.jitterSdPct)), 2)],
  jitterSdMmRange: [r(Math.min(...points.map((p) => p.jitterSdMm)), 2), r(Math.max(...points.map((p) => p.jitterSdMm)), 2)],
  smoothedJitterSdMmRange: [r(Math.min(...points.map((p) => p.smoothedJitterSdMm)), 2), r(Math.max(...points.map((p) => p.smoothedJitterSdMm)), 2)],
  fps30FeedMedian: median(fps30),
  fps60FeedMedian: fps60.length ? median(fps60) : null,
  pointsExcludingReference: nonRef.length,
  runs: runs30.length,
  framesTotal: runs30.reduce((a, x) => a + x.iris.length, 0),
};

const screen = screenRows();
const json = {
  title: 'Camera distance bench: a real face photo, rescaled to simulate distance, through the real MediaPipe pipeline in Chrome',
  label: 'Measured (bench). Not a physical ruler test on devices.',
  generatedAt: raw.generatedAt,
  reportedAt: new Date().toISOString(),
  code: 'web/bench-camera/ (run.ts collects, report.ts analyses)',
  method: {
    face: 'MediaPipe test portrait (https://storage.googleapis.com/mediapipe-assets/portrait.jpg), drawn at scale s about the face centre on a 640×480 frame with a mid-grey background; one frame per video, looped by Chrome',
    physics: 'Pinhole camera: moving a face from d to d/s scales its image by s, so scale s is the face at (reference distance × S_REF ÷ s).',
    pipeline: 'lab.html from a production build (vite preview, no brotli step), shipped src/camera/distance.ts unchanged: MediaPipe Face Landmarker, irisWidthNorm()',
    camera: `Chrome (Playwright channel "chrome", headless) fake webcam: --use-file-for-fake-video-capture, ${raw.runs[0]?.vsize ?? '640×480'}`,
    calibration: `k = ${REF_MM} mm × median iris width at the reference scale (S_REF = ${raw.sRef}), as the app does at 30 cm`,
    warmupMs: raw.warmupMs,
    collectMs: raw.collectMs,
    repeatsPerScale: Math.max(...runs30.map((x) => x.repeat)) + 1,
    rawPrecision: 'Full-precision iris widths, captured by wrapping Number.prototype.toFixed in the page (lab.ts calls irisNorm.toFixed(5) once per frame); the app itself is unchanged',
  },
  machine: { ...raw.machine, webgl: raw.runs[0]?.webgl, browser: raw.screen?.userAgent },
  delegate: {
    gpu: glLog,
    note: glLog
      ? 'MediaPipe created a WebGL 2 context ("GL version: 3.0 (OpenGL ES 3.0 (WebGL 2.0…") on the GPU listed under machine.webgl, so the app\'s first choice, the GPU delegate, loaded without falling back to CPU.' + (xnnLog ? ' MediaPipe also logged "Created TensorFlow Lite XNNPACK delegate for CPU" (it does this for a CPU-side helper graph); which sub-model runs where is not exposed.' : '')
      : 'No GPU context was logged; the CPU fallback may have been used.',
    otherErrors: [...new Set(gpuErrors)].slice(0, 10),
  },
  summary,
  points,
  limitations: [
    'One face (a single public test photo), frontal, evenly lit, perfectly still. Real use adds head movement, turning, glasses, poor light and different faces.',
    'A flat photo is rescaled, so only image size changes with "distance"; real perspective changes of a 3D head are not reproduced. For the near-flat iris this is a small effect.',
    'Above the photo\'s native size (simulated distances under about 31 cm) the image is upsampled, so it has less fine detail than a real close-up camera image.',
    'This tests the pipeline\'s linearity and noise, not absolute accuracy: the uncalibrated (70° field-of-view) distance cannot be checked here because a photo has no true distance.',
    'Frame rate: one Windows laptop (see machine). The 30 fps fake camera caps the normal runs; a 60 fps feed shows the headroom. Phones will be slower. 3 of 30 runs had brief dips (lowest 1-second reading 8 fps) while other jobs were running on the laptop.',
    'Physical accuracy of iris-based distance was evaluated by Google: 4.3% mean relative error (SD 2.4%) against an iPhone 11 depth sensor, over 200+ participants (https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/). That is a separate, published result, not ours.',
  ],
  runs: raw.runs.map((x) => ({
    scale: x.scale,
    targetCm: x.targetMm / 10,
    repeat: x.repeat,
    videoFps: x.videoFps,
    vsize: x.vsize,
    liveText: x.live,
    fps: x.fps,
    iris: x.iris.map((i) => r(i, 8)),
  })),
  screen: {
    label: 'Computed from published specs (not measured)',
    nominalCssPxMm: r(NOMINAL_MM, 4),
    formula: 'physical CSS px (mm) = devicePixelRatio ÷ PPI × 25.4',
    rows: screen.map((s) => ({
      device: s.device,
      ppi: r(s.ppi, 1),
      dpr: s.dpr,
      cssWidth: s.cssWidth,
      cssPxMm: r(s.cssPxMm, 4),
      ratioToNominal: r(s.ratioToNominal, 3),
      lettersTooSmallPct: r(s.lettersTooSmallPct, 1),
      sources: s.sources,
    })),
    thisLaptop: raw.screen ? { ...raw.screen, note: 'Read from Chrome (visible window, no emulation) on the bench laptop. Physical screen size is not exposed to web pages.' } : null,
  },
};
writeFileSync(OUT_JSON, JSON.stringify(json, null, 1) + '\n');

// ---------------------------------------------------------------- chart
const FONT = 'system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, sans-serif';
const INK = '#0b0b0b', INK2 = '#52514e', MUTED = '#6b6a66', GRID = '#e1e0d9', AXIS = '#c3c2b7', BAND = '#f0efec';
const BLUE = '#2a78d6';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (x: number, d = 1) => x.toFixed(d);

function chart(): string {
  const w = 780, h = 484;
  const top = 104, ph = 270;
  const L = { ox: 74, pw: 290 };
  const R = { ox: 448, pw: 300 };
  const xMin = 20, xMax = 72;
  const xL = (v: number) => L.ox + ((v - xMin) / (xMax - xMin)) * L.pw;
  const yL = (v: number) => top + ph - ((v - xMin) / (xMax - xMin)) * ph;
  const xR = (v: number) => R.ox + ((v - xMin) / (xMax - xMin)) * R.pw;
  const eMax = Math.max(2, Math.ceil(Math.max(...points.map((p) => Math.abs(p.errorPct) + p.jitterSdPct)) + 0.5));
  const yR = (v: number) => top + ph / 2 - (v / eMax) * (ph / 2);
  const ticks = [20, 30, 40, 50, 60, 70];
  let b = '';
  // badge
  b += `<g aria-hidden="true"><rect x="${w - 24 - 160}" y="20" width="160" height="22" rx="11" fill="${BAND}" stroke="${AXIS}"/><text x="${w - 24 - 80}" y="35" font-size="11" font-weight="600" fill="${INK2}" text-anchor="middle" letter-spacing="0.6">BENCH MEASUREMENT</text></g>`;
  // left panel
  b += `<text x="${L.ox}" y="${top - 14}" font-size="12.5" font-weight="600" fill="${INK}">Calibrated reading vs true distance</text>`;
  for (const t of ticks) {
    b += `<line x1="${L.ox}" y1="${yL(t)}" x2="${L.ox + L.pw}" y2="${yL(t)}" stroke="${t === 20 ? AXIS : GRID}"/>`;
    b += `<text x="${L.ox - 8}" y="${yL(t) + 4}" font-size="11" fill="${INK2}" text-anchor="end">${t}</text>`;
    b += `<text x="${xL(t)}" y="${top + ph + 18}" font-size="11" fill="${INK2}" text-anchor="middle">${t}</text>`;
  }
  b += `<line x1="${xL(xMin)}" y1="${yL(xMin)}" x2="${xL(xMax)}" y2="${yL(xMax)}" stroke="${AXIS}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  b += `<text x="${xL(71)}" y="${yL(42)}" font-size="11" fill="${MUTED}" text-anchor="end">dashed: perfect (y = x)</text>`;
  for (const p of points) {
    const cx = xL(p.trueCm), cy = yL(p.calibratedCm);
    const tip = `${f(p.trueCm)} cm true → ${f(p.calibratedCm)} cm measured (${p.errorPct >= 0 ? '+' : ''}${f(p.errorPct, 1)}%)${p.isReference ? ', calibration point' : ''}`;
    b += `<g><title>${esc(tip)}</title>${p.isReference ? `<circle cx="${cx}" cy="${cy}" r="5" fill="#fff" stroke="${BLUE}" stroke-width="2"/>` : `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${BLUE}" stroke="#fff" stroke-width="2"/>`}</g>`;
  }
  b += `<text x="${L.ox + L.pw / 2}" y="${top + ph + 38}" font-size="12" fill="${INK2}" text-anchor="middle">true (simulated) distance, cm</text>`;
  b += `<text transform="translate(${L.ox - 40} ${top + ph / 2}) rotate(-90)" font-size="12" fill="${INK2}" text-anchor="middle">camera reading after calibration, cm</text>`;
  // right panel
  b += `<text x="${R.ox}" y="${top - 14}" font-size="12.5" font-weight="600" fill="${INK}">Error (bars: ±1 SD jitter, smaller than the dots)</text>`;
  const eStep = eMax <= 3 ? 1 : 2;
  for (let t = -eMax; t <= eMax; t += eStep) {
    b += `<line x1="${R.ox}" y1="${yR(t)}" x2="${R.ox + R.pw}" y2="${yR(t)}" stroke="${t === 0 ? AXIS : GRID}"${t === 0 ? ' stroke-width="1.5"' : ''}/>`;
    b += `<text x="${R.ox - 8}" y="${yR(t) + 4}" font-size="11" fill="${INK2}" text-anchor="end">${t > 0 ? '+' : t < 0 ? '−' : ''}${Math.abs(t)}%</text>`;
  }
  for (const t of ticks) b += `<text x="${xR(t)}" y="${top + ph + 18}" font-size="11" fill="${INK2}" text-anchor="middle">${t}</text>`;
  for (const p of points) {
    const cx = xR(p.trueCm), cy = yR(p.errorPct);
    const y1 = yR(p.errorPct + p.jitterSdPct), y2 = yR(p.errorPct - p.jitterSdPct);
    const tip = `${f(p.trueCm)} cm: error ${p.errorPct >= 0 ? '+' : ''}${f(p.errorPct, 2)}%, jitter SD ${f(p.jitterSdPct, 2)}% (${f(p.jitterSdMm, 1)} mm)${p.isReference ? '; calibration point, error 0 by definition' : ''}`;
    b += `<g><title>${esc(tip)}</title><line x1="${cx}" y1="${y1}" x2="${cx}" y2="${y2}" stroke="${BLUE}" stroke-width="1.5"/><line x1="${cx - 4}" y1="${y1}" x2="${cx + 4}" y2="${y1}" stroke="${BLUE}" stroke-width="1.5"/><line x1="${cx - 4}" y1="${y2}" x2="${cx + 4}" y2="${y2}" stroke="${BLUE}" stroke-width="1.5"/>`;
    b += p.isReference ? `<circle cx="${cx}" cy="${cy}" r="5" fill="#fff" stroke="${BLUE}" stroke-width="2"/></g>` : `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${BLUE}" stroke="#fff" stroke-width="2"/></g>`;
  }
  const ref = points.find((p) => p.isReference)!;
  b += `<text x="${xR(ref.trueCm) + 6}" y="${yR(0) + 22}" font-size="11" fill="${MUTED}">↖ calibration point (30 cm)</text>`;
  b += `<text x="${R.ox + R.pw / 2}" y="${top + ph + 38}" font-size="12" fill="${INK2}" text-anchor="middle">true (simulated) distance, cm</text>`;
  const title = 'Camera distance pipeline: linearity bench';
  const subtitle = `A real face photo rescaled to simulate 22–70 cm, through the shipped MediaPipe pipeline in Chrome. Mean |error| ${f(summary.meanAbsErrorPct, 1)}%, max ${f(summary.maxAbsErrorPct, 1)}%.`;
  const footer = `Not a ruler test on a device: one still, frontal, evenly lit face photo; ${summary.runs} runs, ${summary.framesTotal.toLocaleString('en-US')} frames, Chrome on a Windows laptop.`;
  const footer2 = `Hollow point = the 30 cm calibration (error 0 by definition). Data: /data/camera-bench.json`;
  const desc = `Two-panel chart, bench measurement. ` + points.map((p) => `True ${f(p.trueCm)} cm: measured ${f(p.calibratedCm)} cm, error ${p.errorPct >= 0 ? '+' : ''}${f(p.errorPct, 2)}%, jitter SD ${f(p.jitterSdPct, 2)}%${p.isReference ? ' (calibration point)' : ''}`).join('; ') + `. Mean absolute error ${f(summary.meanAbsErrorPct, 2)}%, maximum ${f(summary.maxAbsErrorPct, 2)}%.`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="fig-camera-linearity-title fig-camera-linearity-desc" font-family="${FONT}">
<title id="fig-camera-linearity-title">${esc(title)}</title>
<desc id="fig-camera-linearity-desc">${esc(desc)}</desc>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="#ffffff" stroke="${GRID}"/>
<text x="24" y="34" font-size="17" font-weight="600" fill="${INK}">${esc(title)}</text>
<text x="24" y="55" font-size="12.5" fill="${INK2}">${esc(subtitle)}</text>
${b}
<text x="24" y="${h - 32}" font-size="11" fill="${MUTED}">${esc(footer)}</text>
<text x="24" y="${h - 16}" font-size="11" fill="${MUTED}">${esc(footer2)}</text>
</svg>
`;
}
writeFileSync(OUT_SVG, chart());

console.log(JSON.stringify({ k, summary, delegate: json.delegate, machine: json.machine, screenLaptop: raw.screen }, null, 1));
console.table(points.map((p) => ({ trueCm: p.trueCm, calCm: p.calibratedCm, err: p.errorPct, runErr: p.runErrorPct.join(' '), worstPair: p.worstSessionPairErrorPct, uncal: p.uncalibratedCm, sdMm: p.jitterSdMm, sdPct: p.jitterSdPct, smSdMm: p.smoothedJitterSdMm, betweenPct: p.betweenRunSdPct, frames: p.frames.join('/'), fps: p.fpsMedian })));
console.table(screen.map((s) => ({ device: s.device, ppi: f(s.ppi, 1), dpr: s.dpr, mm: f(s.cssPxMm, 4), ratio: f(s.ratioToNominal, 3), small: f(s.lettersTooSmallPct, 1) })));
