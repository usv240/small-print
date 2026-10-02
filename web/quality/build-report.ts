// Merges quality/results/*.json into public/data/quality.json (see quality/README.md for how each
// result file is produced).   npx tsx quality/build-report.ts

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem, type, version } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const R = resolve(root, 'quality/results');
const read = (name: string) => (existsSync(join(R, `${name}.json`)) ? JSON.parse(readFileSync(join(R, `${name}.json`), 'utf8')) : null);
const pkg = (name: string) => JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8')).version as string;

// ---------- environment ----------
const msPlaywright = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const builds = existsSync(msPlaywright) ? readdirSync(msPlaywright) : [];
const latest = (prefix: string) => builds.filter((d) => d.startsWith(prefix)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0] ?? null;
const imgPhone = read('engine-image-phone');
const imgWebkit = read('engine-image-webkit-iphone');
const imgFirefox = read('engine-image-firefox-desktop');
const perf = read('lowend-perf');

const environment = {
  os: `${type()} ${release()} (${version()})`,
  cpu: `${cpus()[0]?.model.trim()} × ${cpus().length} threads`,
  ramGB: Math.round(totalmem() / 2 ** 30),
  node: process.version,
  playwright: pkg('@playwright/test'),
  chrome: perf?.chrome ?? imgPhone?.browserVersion ?? null,
  webkit: { version: imgWebkit?.browserVersion ?? null, playwrightBuild: latest('webkit-'), note: 'Playwright WebKit on Windows (Safari engine, not iOS Safari: no iOS media stack, no MediaStream, cannot decode video; WebGL reports "Apple GPU" but runs on the host GPU).' },
  firefox: { version: imgFirefox?.browserVersion ?? null, playwrightBuild: latest('firefox-') },
  gpu: imgPhone?.webglRenderer ?? null,
  axeCore: pkg('axe-core'),
  lighthouse: pkg('lighthouse'),
};

// ---------- cross-browser e2e ----------
interface JsonSpec { title: string; file: string; tests: { projectName: string; status: string; results: { status: string; duration: number }[] }[] }
interface JsonSuite { title: string; file?: string; specs?: JsonSpec[]; suites?: JsonSuite[] }
function e2eSummary() {
  const rep = read('e2e');
  if (!rep) return null;
  const rows: Record<string, Record<string, { passed: number; failed: number; skipped: number; flaky: number; tests: { title: string; outcome: string }[] }>> = {};
  const walk = (s: JsonSuite) => {
    for (const spec of s.specs ?? []) {
      for (const t of spec.tests) {
        const p = (rows[t.projectName] ??= {});
        const f = (p[spec.file] ??= { passed: 0, failed: 0, skipped: 0, flaky: 0, tests: [] });
        const outcome = t.status === 'expected' ? (t.results.some((r) => r.status === 'skipped') ? 'skipped' : 'passed') : t.status === 'skipped' ? 'skipped' : t.status === 'flaky' ? 'flaky' : 'failed';
        f[outcome as 'passed']++;
        f.tests.push({ title: spec.title, outcome });
      }
    }
    for (const c of s.suites ?? []) walk(c);
  };
  for (const s of rep.suites ?? []) walk(s);
  const totals = Object.fromEntries(Object.entries(rows).map(([p, files]) => [p, Object.values(files).reduce((a, f) => ({
    passed: a.passed + f.passed, failed: a.failed + f.failed, skipped: a.skipped + f.skipped, flaky: a.flaky + f.flaky,
  }), { passed: 0, failed: 0, skipped: 0, flaky: 0 })]));
  return { at: rep.stats?.startTime ?? null, durationS: Math.round((rep.stats?.duration ?? 0) / 1000), totals, byProject: rows };
}

const engineRows = ['phone', 'webkit-iphone', 'firefox-desktop'].map((p) => {
  const img = read(`engine-image-${p}`);
  const lab = read(`engine-lab-${p}`);
  const flow = read(`engine-flow-${p}`);
  return {
    project: p,
    browserVersion: img?.browserVersion ?? null,
    webglRenderer: img?.webglRenderer ?? null,
    wasmSimd: img?.wasmSimd ?? null,
    wasmFile: img?.wasmFile ?? null,
    appDelegate: img?.appDelegate ?? null,
    appDelegateWorks: img?.appDelegateWorks ?? null,
    imageMode: img?.runs?.map((r: Record<string, number | string | boolean>) => ({ delegate: r.delegate, ok: r.ok, landmarks: r.landmarks, irisLandmarks: r.irisLandmarks,
      initMs: Math.round(Number(r.initMs)), firstDetectMs: Math.round(Number(r.firstDetectMs)), medianDetectMs: Math.round(Number(r.medianDetectMs)), distanceCm: Number(Number(r.distanceCm).toFixed(1)), error: r.error })) ?? null,
    videoMode: img?.video?.map((r: Record<string, number | string | boolean>) => ({ delegate: r.delegate, ok: r.ok, framesWithIris: r.framesWithIris, frames: r.frames,
      medianFrameMs: Math.round(Number(r.medianFrameMs)), maxFps: Math.round(Number(r.maxFps)), distanceCm: Number(Number(r.distanceCm).toFixed(1)), error: r.error })) ?? null,
    media: img?.media ?? null,
    labPage: lab ? { firstDistanceMs: lab.firstDistanceMs, distanceCm: lab.distanceCm, video: lab.video, fps: lab.fps } : { skipped: p === 'webkit-iphone' ? 'Windows WebKit cannot play video or create a MediaStream' : 'not run' },
    testFlow: flow ? { cameraReadyMs: flow.cameraReadyMs, workingDistanceCm: flow.workingCm } : { skipped: p === 'webkit-iphone' ? 'Windows WebKit cannot play video or create a MediaStream' : 'not run' },
  };
});

// ---------- accessibility ----------
function axeSummary() {
  const parts = ['axe-pages-light', 'axe-pages-dark', 'axe-flow-light', 'axe-flow-dark'].map(read).filter(Boolean);
  if (!parts.length) return null;
  const findings = parts.flatMap((p) => p.findings);
  const audits = parts.flatMap((p) => p.audits);
  const byImpact: Record<string, number> = {};
  const rules: Record<string, { impact: string; help: string; where: Set<string>; themes: Set<string>; nodes: number }> = {};
  for (const f of findings) {
    byImpact[f.impact] = (byImpact[f.impact] ?? 0) + 1;
    const r = (rules[f.id] ??= { impact: f.impact, help: f.help, where: new Set(), themes: new Set(), nodes: 0 });
    r.where.add(f.where); r.themes.add(f.theme); r.nodes += f.nodes;
  }
  return {
    standard: 'axe-core rules tagged wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22a, wcag22aa',
    viewport: 'Pixel 7 (412×839, Chrome)',
    auditsRun: audits.length,
    pagesAndScreens: [...new Set(audits.map((a: { where: string }) => a.where))],
    themes: ['light', 'dark'],
    violationsByImpact: byImpact,
    cleanAudits: audits.filter((a: { violations: number }) => a.violations === 0).length,
    rules: Object.entries(rules).map(([id, r]) => ({ id, impact: r.impact, help: r.help, where: [...r.where], themes: [...r.themes], nodesAcrossThemes: r.nodes })),
    colorContrastViolations: findings.filter((f: { id: string }) => f.id === 'color-contrast').length,
    focusNotObscured: read('focus-not-obscured'),
  };
}

const lh = read('lighthouse');
const readability = read('readability');
const offline = read('offline-engines');

const bugs = [
  { id: 'a11y-select-name', severity: 'high (axe critical)', where: 'src/app.ts result(): "Do you already have reading glasses?" card',
    evidence: 'axe select-name on test result screen, light and dark: <select id="existing"> has no accessible name; screen readers announce only "combo box".',
    fix: 'Give the <h2> an id (existing-h) and add aria-labelledby="existing-h" to the select (or wrap it in a <label>).' },
  { id: 'a11y-focus-obscured', severity: 'medium (WCAG 2.2 SC 2.4.11 AA, demo mode only)', where: 'src/styles/app.css .demo-bar',
    evidence: 'Tabbing at 412×839 in demo mode: a safety-question radio and the result screen "Share" button end up entirely behind the fixed demo slider bar (122 px tall); "Check a pair in the shop" partly. On the small-print screen the four answer arrows start behind the bar: iPhone 15 (393×659) all four hidden, Pixel 7 "Down" hidden and Left/Right partly; the user has to scroll to reach them (WebKit test clicks retried for >60 s on this). On iPhone 15 the arrows start below the fold even without the bar (top at 646 px of 659).',
    fix: 'body.demo { padding-bottom: <bar height> } and html:has(body.demo) { scroll-padding-bottom: calc(<bar height> + 1rem) }; on short screens shrink the E stage (e.g. .stage { height: min(…, 35svh) }) so the arrows fit above the fold.' },
  { id: 'a11y-scrollable-regions', severity: 'medium (axe serious)', where: 'how-it-works, validation, findings, impact, evidence pages at phone width',
    evidence: 'axe scrollable-region-focusable: 11 sideways-scrolling .formula / .table-wrap / .arch-wrap blocks cannot be scrolled with a keyboard (Firefox and Safari do not make scrollers focusable).',
    fix: 'Add tabindex="0", role="region" and an aria-label to each scroll wrapper (or let formulas wrap at narrow widths).' },
  { id: 'a11y-lab-textarea', severity: 'low (axe critical, internal page)', where: 'lab.html #json',
    evidence: 'axe label: the results <textarea id="json"> has no label.', fix: 'aria-label="Results as JSON" or a visible <label for="json">.' },
  { id: 'voice-autoplay', severity: 'low (Lighthouse best-practices 81 on test.html)', where: 'src/ui/voice.ts say()/speakFallback()',
    evidence: 'On first load the welcome clip is blocked by autoplay policy, and the catch() falls back to speechSynthesis.speak() without user activation: Chrome flags it as deprecated (to be removed; Lighthouse best-practices 81) and iOS Safari also needs a user gesture for speech, so the welcome prompt is likely silent on first load.',
    fix: 'In play().catch(e), if e.name === "NotAllowedError", replay the same clip on the first pointerdown/keydown ({ once: true }) instead of calling speakFallback(); only use speech synthesis when the clip is missing or fails to load.' },
  { id: 'outbox-retry', severity: 'low', where: 'src/app.ts boot() / src/api.ts flushOutbox()',
    evidence: 'Queued results are only sent on the window "online" event or at the next page load. In Firefox (Playwright) a page loaded while offline never receives "online" after the connection returns, so the e2e offline test keeps 1 queued result for 15 s; Chrome sends it immediately.',
    fix: 'Also flush on visibilitychange (visible) and pageshow, and retry every 30–60 s while the outbox is not empty.' },
];

const e2e = e2eSummary();
const ax = axeSummary();
const headline = {
  e2e: e2e ? Object.fromEntries(Object.entries(e2e.totals).map(([p, t]) => [p, `${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped`])) : null,
  safariEngine: imgWebkit ? `MediaPipe Face Landmarker runs in WebKit ${imgWebkit.browserVersion} (GPU delegate, SIMD WASM): 478 landmarks incl. 10 iris points; distance ${imgWebkit.video?.[0]?.distanceCm?.toFixed(1)} cm vs Chrome ${imgPhone?.video?.[0]?.distanceCm?.toFixed(1)} cm on the same frame` : null,
  offlineAllEngines: offline ? Object.values(offline.results as Record<string, { pass: boolean }>).every((r) => r.pass) : null,
  axe: ax ? `${ax.auditsRun} audits (${ax.pagesAndScreens.length} pages/screens × light+dark): ${ax.cleanAudits} clean; ${ax.rules.length} rules violated (${ax.rules.map((r) => `${r.id} [${r.impact}]`).join(', ')}); 0 colour-contrast violations` : null,
  lighthouse: lh ? Object.fromEntries(Object.entries(lh.pages as Record<string, { scores: Record<string, number> }>).map(([p, v]) => [p, v.scores])) : null,
  readability: readability ? `English core screens: median Flesch–Kincaid grade ${readability.languages.en.core.medianGrade} (ease ${readability.languages.en.core.medianEase}); explanations grade ${readability.languages.en.explanations.medianGrade}; landing page grade ${readability.landingPage.grade}` : null,
  lowEnd: perf ? {
    ttiSlow4g6xMs: (perf.results.tti as { cpu: number; net: string; ttiAll: number[] }[]).find((r) => r.cpu === 6 && r.net === 'slow-4g')?.ttiAll,
    allowCameraToFirstDistanceSlow4gMs: (perf.results.camera as { cpu: number; net: string; allowToFirstDistanceMs: number }[]).filter((r) => r.net === 'slow-4g').map((r) => `${r.cpu}x: ${r.allowToFirstDistanceMs}`),
    labFpsMedian: (perf.results.labFps as { mode: string; cpu: number; fpsMedian: number }[]).map((r) => `${r.mode} ${r.cpu}x: ${r.fpsMedian} fps`),
  } : null,
};

const report = {
  generatedAt: new Date().toISOString(),
  headline,
  about: 'Measured quality evidence for Small Print: cross-browser (incl. the Safari engine), accessibility, Lighthouse, readability and low-end phone performance. How to re-run: web/quality/README.md.',
  environment,
  crossBrowser: {
    e2e,
    mediapipeByEngine: engineRows,
    offlineRealOutage: offline,
    notes: [
      'webkit-iphone = Playwright WebKit 26.6 on Windows with the iPhone 15 profile (393×659, touch, iOS UA). Same engine as Safari, different platform layer: treat as strong evidence, not proof for iOS Safari.',
      'WebKit/Firefox projects run with reducedMotion: reduce. The site uses scroll-behavior: smooth, which makes automated clicks land mid-scroll on the fixed demo bar in those engines.',
      'e2e/offline.spec.ts is Chrome-only: Playwright setOffline() in WebKit also blocks service-worker cache hits. offlineRealOutage instead kills the server after the service worker installs.',
    ],
  },
  accessibility: ax,
  lighthouse: lh ? { at: lh.at, base: lh.base, settings: lh.settings, pages: Object.fromEntries(Object.entries(lh.pages as Record<string, Record<string, unknown>>).map(([p, v]) => [p, {
    scores: v.scores, performanceScoresAllRuns: v.performanceScores, metrics: v.metrics, opportunities: v.opportunities, failedAudits: v.failedAudits,
  }])) } : null,
  readability,
  lowEndPerformance: perf ? {
    base: perf.base,
    method: 'Chrome (Playwright) Pixel 7 viewport; CDP Emulation.setCPUThrottlingRate; DevTools network presets; cold cache per run; fake camera = MediaPipe test portrait (.y4m). CPU throttling slows the main thread (where MediaPipe WASM runs) but not the GPU process. TTI rows: 2 runs each; the *Ms fields are the better run, ttiWorstMs the worse.',
    tti: (perf.results.tti as { ttiAll: number[] }[]).map((r) => ({ ...r, ttiWorstMs: Math.max(...r.ttiAll) })),
    camera: perf.results.camera,
    labFps: perf.results.labFps,
  } : null,
  bugs,
};

writeFileSync(resolve(root, 'public/data/quality.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote public/data/quality.json (${Math.round(JSON.stringify(report).length / 1024)} KiB)`);
