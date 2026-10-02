// Negative controls, step 2: assemble public/data/negative-controls.json from
//  • the camera runs (bench-camera/negative.ts → <tmp>/small-print-negative/camera.json),
//  • the recommend() property checks (bench-camera/negative-logic.ts, same as tests/negative.test.ts),
//  • the refusal metrics already computed by the simulation (public/data/bench.json, copied with paths).
//   npx tsx bench-camera/negative-report.ts
//
// For every camera frame that showed a distance, the app's own downstream gate is replayed: the
// working-distance step (src/app.ts working()) only accepts a distance after every reading in the last
// second is within ±3% of their median for 1.5 s, and any "no face" frame resets it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { median as appMedian } from '../src/camera/calibration';
import { recommend } from '../src/core/recommend';
import { CAMERA_JSON, NEG_DIR, type EyePatch, type Frame, type Run, type Scene } from './negative';
import { APP_AGES, RANDOM_N, SEED, allInputs, checkRecommendProperties, isPossibleMyopia } from './negative-logic';

const WEB = resolve(import.meta.dirname, '..');
const OUT = resolve(WEB, 'public/data/negative-controls.json');
const BENCH = resolve(WEB, 'public/data/bench.json');

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Replays src/app.ts working(): returns when (ms after the first frame) a working distance would lock. */
export function workingGate(frames: Frame[]): { atMs: number; mm: number } | null {
  const T = 10_000; // performance.now() is never 0 in the app; keep "stableSince || now" faithful
  const recent: { at: number; mm: number }[] = [];
  let stableSince = 0;
  for (const f of frames) {
    const now = f.t + T;
    if (f.mm === null) { recent.length = 0; stableSince = 0; continue; }
    recent.push({ at: now, mm: f.mm });
    while (recent.length > 1 && now - recent[1].at >= 1000) recent.shift();
    const values = recent.map((r) => r.mm);
    const mid = appMedian(values);
    const covered = values.length >= 2 && now - recent[0].at >= 900;
    const steady = covered && values.every((v) => Math.abs(v - mid) / mid < 0.03);
    stableSince = steady ? stableSince || now : 0;
    const progress = steady ? Math.min(1, (now - stableSince) / 1500) : 0;
    if (progress >= 1) return { atMs: Math.round(now - T), mm: mid };
  }
  return null;
}

function longestStreak(frames: Frame[]): number {
  let best = 0, cur = 0;
  for (const f of frames) { cur = f.mm !== null ? cur + 1 : 0; best = Math.max(best, cur); }
  return best;
}

function runSummary(r: Run) {
  const hits = r.frames.filter((f) => f.mm !== null);
  const gate = workingGate(r.frames);
  return {
    repeat: r.repeat,
    frames: r.frames.length,
    withDistance: hits.length,
    firstDistanceMs: hits.length ? r1(hits[0].t) : null,
    longestStreakFrames: longestStreak(r.frames),
    workingGateLockedAtMs: gate?.atMs ?? null,
    workingGateLockedCm: gate ? r1(gate.mm / 10) : null,
    startupMs: r.startupMs,
    errors: r.errors.filter((e) => !/^INFO:/.test(e)), // MediaPipe logs its delegate choice via console.error
  };
}

/** Interpretation written after looking at the runs (the numbers themselves are computed). */
const NOTES_BEFORE: Record<string, string> = {
  smiley: 'HALLUCINATION: a drawn cartoon (three shapes, no skin texture) is accepted as a face on every frame, with iris landmarks fitted to the drawn eyes. The output is as steady as a real face, so the working-distance gate locks just as fast (≈2.5 s) and nothing downstream rejects it.',
  'eyes-blacked': 'HALLUCINATION: with both eyes covered by solid black, the model still returns iris landmarks on every frame. Their size is invented (iris width 0.0261 of frame vs 0.0278 for the visible eyes), so the distance reads about 32 cm instead of the 30 cm the same portrait gives, a 6–7% error, and it is steady enough for the working-distance gate to accept it. The same failure is expected for sunglasses, glare on lenses, or hair over the eyes.',
  rot90: 'Not a hallucination: this is a real face with real, visible irises, turned sideways. MediaPipe tracks it and the iris width is measured as a length in any direction (Math.hypot), so the distance (30.1 cm) matches the upright portrait (30.0 cm). Counted as an output here because the brief listed it as a negative; arguably a correct output (phone held sideways, head tilted).',
  rot180: 'A real face upside down: tracked on most frames, but with dropped frames and a wider spread (up to 37 cm). The dropped frames reset the working-distance gate, which never locked in 5 s, so this one was caught downstream.',
  blurred: 'With a 25 px Gaussian blur the face detector finds nothing; no landmarks are invented.',
  'lower-half': 'Mouth and chin alone are not accepted as a face: the detector needs the upper face.',
  dark: 'At 3% brightness (pixel values about 0–8 under sensor noise) nothing is detected; the app keeps showing "no face" rather than guessing.',
  wall: 'Blank wall with texture: no face found on any frame.',
  'text-page': 'Dense printed text: no face found on any frame.',
  'e-chart': 'Tumbling-E chart (the app\'s own optotype): no face found on any frame.',
};

/** How the scenes group for the headline. */
const GROUPS = {
  noUsableFace: ['wall', 'text-page', 'e-chart', 'blurred', 'lower-half', 'dark'],
  faceLikeOrEyesHidden: ['smiley', 'eyes-blacked'],
  realFaceRotated: ['rot90', 'rot180'],
};

function sceneResult(sc: Scene, runs: Run[], NOTES: Record<string, string>) {
  const all = runs.flatMap((r) => r.frames);
  const hits = all.filter((f) => f.mm !== null);
  const perRun = runs.map(runSummary);
  const locked = perRun.filter((p) => p.workingGateLockedAtMs !== null);
  const dist = hits.map((f) => f.mm! / 10);
  const auto = hits.length === 0
    ? `No distance on any of ${all.length} frames: the page showed "no face" throughout${perRun.some((p) => p.errors.length) ? ' (page errors logged, see runs)' : ''}.`
    : `A distance was shown on ${hits.length} of ${all.length} frames (MediaPipe returned iris landmarks${NOTES === NOTES_AFTER ? " and the eye check passed" : ""}) ` +
      `(median ${r1(median(dist))} cm, range ${r1(Math.min(...dist))}–${r1(Math.max(...dist))} cm; longest unbroken run ${Math.max(...perRun.map((p) => p.longestStreakFrames))} frames). ` +
      `Downstream: the working-distance steady gate (±3% for 1.5 s, reset by any "no face" frame) would have accepted a working distance in ${locked.length} of ${runs.length} runs` +
      (locked.length ? ` (after ${locked.map((p) => (p.workingGateLockedAtMs! / 1000).toFixed(1)).join(', ')} s, at ${locked.map((p) => p.workingGateLockedCm).join(', ')} cm).` : '.');
  return {
    id: sc.id,
    name: sc.name,
    description: sc.description,
    frames: all.length,
    falseOutputs: hits.length,
    rate: all.length ? r4(hits.length / all.length) : null,
    irisReportedFrames: all.filter((f) => f.iris !== null).length,
    distanceCm: hits.length ? { median: r1(median(dist)), min: r1(Math.min(...dist)), max: r1(Math.max(...dist)) } : null,
    irisNormMedian: hits.length ? median(hits.map((f) => f.iris!).filter((x) => x !== null)) : null,
    workingGateLockedRuns: locked.length,
    runs: perRun,
    notes: NOTES[sc.id] ? `${auto} ${NOTES[sc.id]}` : auto,
  };
}

function simulation() {
  const b = JSON.parse(readFileSync(BENCH, 'utf8'));
  const ids = ['spStart', 'spTry050', 'spTry025', 'age40', 'ageW', 'card14', 'cardOwn'];
  const pick = (pop: 'main' | 'under40', id: string) => {
    const s = b.strategies.find((x: { id: string }) => x.id === id);
    const m = pop === 'main' ? s.overall : b.under40.metrics[id];
    const path = pop === 'main' ? `strategies[id=${id}].overall` : `under40.metrics.${id}`;
    return {
      id,
      label: s.label,
      source: `public/data/bench.json → ${path}`,
      myopesHandedReadersPct: r1(m.myopiaMissedPct),
      myopesN: m.myopiaN,
      notYetNeedingHandedReadersPct: r1(m.noneGivenReadersPct),
      notYetNeedingN: m.noneN,
      referralSensitivityPct: r1(m.referSafePct),
      referN: m.referN,
      aboveRangeHandedReadersPct: r1(m.aboveRangeMissedPct),
      aboveRangeN: m.aboveRangeN,
    };
  };
  return {
    label: `SIMULATION (copied, not re-run): ${b.label}`,
    source: 'public/data/bench.json',
    benchVersion: b.version,
    benchGeneratedAt: b.generatedAt,
    definitions: {
      myopesHandedReadersPct: `myopiaMissedPct: % of people with myopia below ${b.config.scope.referMyopiaBelowD.toFixed(2)} D who were handed readers`,
      notYetNeedingHandedReadersPct: `noneGivenReadersPct: % of people whose ideal add is below +${b.config.scope.minUsefulD.toFixed(2)} D (don't need readers yet) who were handed readers`,
      referralSensitivityPct: 'referSafePct: % of people who should be referred (myopia < −1.00 D, or ideal add above +3.00) who were NOT handed readers',
      aboveRangeHandedReadersPct: 'aboveRangeMissedPct: % of people whose ideal add is above +3.00 who were handed readers anyway',
    },
    mainPopulation: { n: b.population.n, ages: `${b.config.population.ageMin}–${b.config.population.ageMax}`, strategies: ids.map((id) => pick('main', id)) },
    under40Population: { n: b.under40.population.n, ages: '35–39', strategies: ids.map((id) => pick('under40', id)) },
  };
}

/** Character of the myopia-at-35–39 gap, for the report. */
function myopiaGapDetail() {
  const strengths = new Map<number, number>();
  const flags = new Map<string, number>();
  let n = 0, maxNear = 0;
  for (const { m } of allInputs(RANDOM_N, SEED)) {
    if (!isPossibleMyopia(m) || m.age >= 40) continue;
    const r = recommend(m);
    if (r.outcome !== 'readers') continue;
    n++;
    strengths.set(r.strength!, (strengths.get(r.strength!) ?? 0) + 1);
    const f = r.flags.join('+') || '(none)';
    flags.set(f, (flags.get(f) ?? 0) + 1);
    maxNear = Math.max(maxNear, m.nearPointMm!);
  }
  return { violations: n, strengths: Object.fromEntries(strengths), flags: Object.fromEntries(flags), maxNearPointMm: Math.round(maxNear) };
}

/** Notes for the runs with the eye-visibility check in place (filled in after looking at the runs). */
const NOTES_AFTER: Record<string, string> = {
  ...NOTES_BEFORE,
  'eyes-blacked': 'Eye-visibility check: MediaPipe still invents iris points under the black bars, but the patch around them has no dark centre against a lighter ring (relative contrast 0), so every frame goes down the "no face" path. Before the check: 100% of frames gave a distance (about 32 cm for a face at 30 cm).',
  rot90: 'Not a hallucination: a real face with visible irises, turned sideways. It is tracked, and the iris width is measured as a length in any direction (Math.hypot), so the distance matches the upright portrait. The eye check keeps every frame (relative contrast 0.68 or more).',
  rot180: 'With the eye check, fewer frames are accepted than before (about 96% before). In the rejected checks the relative contrast is negative (down to −0.75): upside down, the tracker puts the iris centre on lighter skin rather than on the iris, so the check rejects frames whose iris points are not on an iris. The working-distance gate never locked, before or after.',
  smiley: 'MEASURED LIMIT of the eye check: the drawn eyes are a dark disc inside a white circle, which is exactly the pattern of a real eye (relative contrast 0.64–0.70, real eyes 0.45–0.87), so the cartoon still passes. Rejecting drawings and photos needs a liveness or blink check, not an eye-visibility check.',
};

type CamFile = {
  generatedAt: string; video: object; collectMs: number; repeats: number; environment: Record<string, string>; scenes: Scene[]; runs: Run[]; eyeBoxes: object; lowerShiftPx: number;
};
const loadCam = (file: string): CamFile | null => (existsSync(resolve(NEG_DIR, file)) ? JSON.parse(readFileSync(resolve(NEG_DIR, file), 'utf8')) : null);

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};
const dist = (xs: number[]) => (xs.length
  ? { n: xs.length, min: r1(Math.min(...xs)), p1: r1(quantile(xs, 0.01)), p5: r1(quantile(xs, 0.05)), median: r1(quantile(xs, 0.5)), p95: r1(quantile(xs, 0.95)), max: r1(Math.max(...xs)) }
  : null);

/** Groups the eye patches the app read into checks (both eyes are read within a millisecond). */
function eyeChecks(eye: EyePatch[]): EyePatch[][] {
  const out: EyePatch[][] = [];
  for (const e of eye) {
    const last = out[out.length - 1];
    if (last && Math.abs(e.t - last[0].t) < 3) last.push(e);
    else out.push([e]);
  }
  return out;
}

/** Reads EYE_MIN_CONTRAST from the app source (importing distance.ts would pull MediaPipe into Node). */
function eyeThreshold(): number {
  const src = readFileSync(resolve(WEB, 'src/camera/distance.ts'), 'utf8');
  return Number(/export const EYE_MIN_CONTRAST = ([\d.]+);/.exec(src)![1]);
}
/** Same measure as eyePatchContrast() in src/camera/distance.ts, from what the harness recorded. */
const relContrast = (e: EyePatch) => (e.mean < 1 ? 0 : e.contrast / e.mean);
const r3 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);
const dist3 = (xs: number[]) => (xs.length
  ? { n: xs.length, min: r3(Math.min(...xs)), p1: r3(quantile(xs, 0.01)), p5: r3(quantile(xs, 0.05)), median: r3(quantile(xs, 0.5)), p95: r3(quantile(xs, 0.95)), max: r3(Math.max(...xs)) }
  : null);

function eyeCheckSection() {
  const before = loadCam('eyecheck-before.json');
  const after = loadCam('eyecheck-after.json');
  if (!before) return null;
  const rate = (cam: CamFile | null, id: string) => {
    const fr = cam?.runs.filter((r) => r.scene === id).flatMap((r) => r.frames) ?? [];
    const acc = fr.filter((f) => f.mm !== null).length;
    return fr.length ? { frames: fr.length, accepted: acc, acceptRate: r4(acc / fr.length) } : null;
  };
  const scenes = (after ?? before).scenes;
  const table = scenes.map((sc) => {
    const b = rate(before, sc.id), a = rate(after, sc.id);
    const checks = before.runs.filter((r) => r.scene === sc.id).flatMap((r) => eyeChecks(r.eye ?? []));
    return {
      id: sc.id,
      name: sc.name,
      kind: sc.kind,
      want: sc.kind === 'positive' ? 'accept (≥ 99% of frames)' : 'reject',
      before: b,
      after: a,
      distributionsBefore: {
        relativeContrastBestEye: dist3(checks.map((c) => Math.max(...c.map(relContrast)))),
        relativeContrastPerEye: dist3(checks.flatMap((c) => c.map(relContrast))),
        lumaSdBestEye: dist(checks.map((c) => Math.max(...c.map((e) => e.sd)))),
        lumaMeanPerEye: dist(checks.flatMap((c) => c.map((e) => e.mean))),
      },
    };
  });
  const T = eyeThreshold();
  const best = (kind: Scene['kind'], key: 'relativeContrastBestEye' | 'lumaSdBestEye', exclude: string[] = []) =>
    table.filter((t) => t.kind === kind && !exclude.includes(t.id)).map((t) => t.distributionsBefore[key]).filter((d) => d !== null);
  const posMin = Math.min(...best('positive', 'relativeContrastBestEye').map((d) => d!.min!));
  const coveredMax = Math.max(...best('negative', 'relativeContrastBestEye', ['smiley']).map((d) => d!.max!));
  const sdPosMin = Math.min(...best('positive', 'lumaSdBestEye').map((d) => d!.min!));
  const sdCoveredMax = Math.max(...best('negative', 'lumaSdBestEye', ['smiley']).map((d) => d!.max!));
  return {
    rule: 'src/camera/distance.ts: for each eye, a square 3 iris radii wide around the iris centre (landmarks 468/473; radius from ring points 469–471 / 474–476) is drawn from the video frame into a 24×24 canvas (willReadFrequently). Relative contrast = (mean luminance of the ring beyond 1.15 iris radii − mean of the centre within 0.75 iris radii) ÷ mean luminance of the patch. The eye counts as visible when this is ≥ EYE_MIN_CONTRAST; if neither eye is visible the frame is treated as "no face" (distance null), the existing no-face path. Checked on every 3rd processed frame, with the verdict reused in between, and straight away when a face reappears.',
    threshold: { EYE_MIN_CONTRAST: T, unit: 'relative contrast (dimensionless): a dark iris/pupil against lighter sclera and lids gives about 0.45–0.87; a covered eye about 0' },
    margin: {
      lowestRealEye: posMin,
      highestCoveredEye: coveredMax,
      ratioThresholdToHighestCovered: r1(T / coveredMax),
      ratioLowestRealToThreshold: r1(posMin / T),
      note: 'Per check, the better of the two eyes (the rule accepts the frame if either eye is visible), from the BEFORE runs (all frames, nothing filtered). Real eyes: every positive scene (6 distances 22–70 cm, 30%/50% brightness, warm/cool tint, 3 px blur, turned 90°). Covered: blacked-out eyes, sunglasses, hand. The cartoon is reported separately.',
    },
    whyNotLumaSd: `Luminance SD alone (the first candidate) does not separate them: lowest real eye ${sdPosMin} (30% brightness) vs highest covered ${sdCoveredMax} (hand over the eyes: finger edges). Relative contrast does not depend on the light level and needs a dark centre, which a hand or lens does not have.`,
    before: {
      label: 'BEFORE: the shipped pipeline without the check. Measured on a build where the check ran but its threshold was 0 (accepts every frame, exactly like the shipped code), so the eye-patch statistics of every frame could be recorded.',
      runAt: before.generatedAt,
      repeatsPerScene: before.repeats,
    },
    after: after ? { label: `AFTER: eye-visibility check with EYE_MIN_CONTRAST = ${T}.`, runAt: after.generatedAt, repeatsPerScene: after.repeats } : null,
    table,
  };
}

function main(): void {
  const camBefore = JSON.parse(readFileSync(CAMERA_JSON, 'utf8')) as CamFile;
  const camAfter = loadCam('camera-after.json');
  const cam = camAfter ?? camBefore;
  const results = cam.scenes.map((sc) => sceneResult(sc, cam.runs.filter((r) => r.scene === sc.id), camAfter ? NOTES_AFTER : NOTES_BEFORE));
  const resultsBefore = camBefore.scenes.map((sc) => sceneResult(sc, camBefore.runs.filter((r) => r.scene === sc.id), NOTES_BEFORE));
  const brief = (r: ReturnType<typeof sceneResult>) => ({ id: r.id, name: r.name, frames: r.frames, falseOutputs: r.falseOutputs, rate: r.rate, distanceCm: r.distanceCm, workingGateLockedRuns: r.workingGateLockedRuns, notes: r.notes });
  const camera = results.filter((r) => r.id !== 'positive');
  const pos = results.find((r) => r.id === 'positive')!;
  const negFrames = camera.reduce((a, r) => a + r.frames, 0);
  const negFalse = camera.reduce((a, r) => a + r.falseOutputs, 0);
  const posRuns = cam.runs.filter((r) => r.scene === 'positive').map(runSummary);
  const group = (ids: string[]) => {
    const rs = camera.filter((r) => ids.includes(r.id));
    const frames = rs.reduce((a, r) => a + r.frames, 0);
    const falseOutputs = rs.reduce((a, r) => a + r.falseOutputs, 0);
    return { scenes: ids, frames, falseOutputs, rate: frames ? r4(falseOutputs / frames) : null, workingGateLockedRuns: `${rs.reduce((a, r) => a + r.workingGateLockedRuns, 0)} of ${rs.reduce((a, r) => a + r.runs.length, 0)}` };
  };
  const groups = { noUsableFace: group(GROUPS.noUsableFace), faceLikeOrEyesHidden: group(GROUPS.faceLikeOrEyesHidden), realFaceRotated: group(GROUPS.realFaceRotated) };
  const ec = eyeCheckSection();
  const ecSum = (kind: Scene['kind'], when: 'before' | 'after', exclude: string[] = []) => {
    const rows = (ec?.table ?? []).filter((t) => t.kind === kind && !exclude.includes(t.id) && t[when]);
    const frames = rows.reduce((a, t) => a + t[when]!.frames, 0);
    const accepted = rows.reduce((a, t) => a + t[when]!.accepted, 0);
    return { scenes: rows.length, frames, accepted, pct: frames ? ((100 * accepted) / frames).toFixed(1) : '–' };
  };
  const ecRow = (id: string) => ec?.table.find((t) => t.id === id);

  const t0 = Date.now();
  const logicRun = checkRecommendProperties();
  const logicMs = Date.now() - t0;
  const logic = logicRun.results.map((p) => ({
    id: p.id,
    property: p.property,
    cases: p.cases,
    violations: p.violations,
    status: p.violations === 0 ? 'holds' : 'VIOLATED',
    ...(p.violations ? { examples: p.examples.slice(0, 3) } : {}),
  }));

  const out = {
    title: 'Negative controls: how often Small Print correctly refuses to give an output',
    generatedAt: new Date().toISOString(),
    headline: {
      noUsableFace: `${groups.noUsableFace.falseOutputs} distance outputs in ${groups.noUsableFace.frames.toLocaleString('en-US')} frames with no usable face (${GROUPS.noUsableFace.length} scenes: wall, printed text, E chart, 25 px blur, mouth and chin only, 3% brightness; ${cam.repeats} runs × 5 s each).`,
      ...(ec?.after ? {
        eyesCovered: `With the eye-visibility check: ${ecSum('negative', 'after', ['smiley']).accepted} of ${ecSum('negative', 'after', ['smiley']).frames} frames gave a distance with the eyes covered (black bars, dark sunglasses, a hand over the eyes). Before the check: ${ecSum('negative', 'before', ['smiley']).accepted} of ${ecSum('negative', 'before', ['smiley']).frames} (${ecSum('negative', 'before', ['smiley']).pct}%).`,
        realEyesKept: `Real eyes still accepted on ${ecSum('positive', 'after').accepted} of ${ecSum('positive', 'after').frames} frames (${ecSum('positive', 'after').pct}%) across ${ecSum('positive', 'after').scenes} scenes: 22–70 cm, 30% and 50% light, warm and cool tint, 3 px blur, turned 90°. Before the check: ${ecSum('positive', 'before').accepted} of ${ecSum('positive', 'before').frames}.`,
        drawnFaceLimit: `Measured limit: a cartoon smiley with drawn eyes still gives a distance on ${ecRow('smiley')!.after!.accepted} of ${ecRow('smiley')!.after!.frames} frames. Its eyes are a dark disc in a white circle, which is what the check looks for.`,
        threshold: `EYE_MIN_CONTRAST = ${ec.threshold.EYE_MIN_CONTRAST}. Real eyes ${ec.margin.lowestRealEye} or more, covered eyes ${ec.margin.highestCoveredEye} or less (better eye per check), so the threshold sits ${ec.margin.ratioLowestRealToThreshold}× below the lowest real eye and ${ec.margin.ratioThresholdToHighestCovered}× above the highest covered one.`,
      } : {}),
      realFaceRotated: `A real face rotated 90° or 180° is still tracked (${groups.realFaceRotated.falseOutputs} of ${groups.realFaceRotated.frames} frames). At 90° the distance is correct (${results.find((r) => r.id === 'rot90')!.distanceCm?.median?.toFixed(1)} cm vs ${pos.distanceCm?.median?.toFixed(1)} cm upright), and at 180° the working-distance gate locked in ${results.find((r) => r.id === 'rot180')!.workingGateLockedRuns} of ${results.find((r) => r.id === 'rot180')!.runs.length} runs.`,
      allNegatives: `${negFalse} of ${negFrames} frames in the first negative-control set showed a distance (${camera.length} scenes, including the cartoon and the two rotated real faces); ${camera.filter((r) => r.falseOutputs === 0).length} of ${camera.length} scenes never did.`,
      positiveControl: `Reference portrait: distance shown on ${pos.falseOutputs} of ${pos.frames} frames (${((100 * pos.falseOutputs) / pos.frames).toFixed(1)}%), threshold 95%.`,
      logic: logic.map((l) => `${l.id}: ${l.violations} violations in ${l.cases.toLocaleString('en-US')} cases`).join('; '),
      ...(camAfter ? {
        beforeEyeCheck: `Before the eye check (shipped pipeline): ${resultsBefore.filter((r) => r.id !== 'positive').reduce((x, r) => x + r.falseOutputs, 0)} of ${resultsBefore.filter((r) => r.id !== 'positive').reduce((x, r) => x + r.frames, 0)} frames in the same set showed a distance; blacked-out eyes ${resultsBefore.find((r) => r.id === 'eyes-blacked')!.falseOutputs} of ${resultsBefore.find((r) => r.id === 'eyes-blacked')!.frames}, cartoon ${resultsBefore.find((r) => r.id === 'smiley')!.falseOutputs} of ${resultsBefore.find((r) => r.id === 'smiley')!.frames}.`,
      } : {}),
    },
    cameraGroups: groups,
    findings: [
      'No usable face, no guess: 0 distance outputs on blank, text, chart, heavily blurred, chin-only and near-black frames, before and after the eye-visibility check.',
      `Before the eye check, MediaPipe Face Landmarker hallucinated. A portrait with both eyes painted black and a three-shape cartoon smiley each gave a distance on 100% of frames, and dark sunglasses did too (${ecRow('sunglasses')?.before?.accepted ?? '–'} of ${ecRow('sunglasses')?.before?.frames ?? '–'}; hand over the eyes: ${ecRow('hand')?.before?.accepted ?? '–'} of ${ecRow('hand')?.before?.frames ?? '–'}). The invented output is as steady as a real face, so the working-distance gate (±3% for 1.5 s, reset by "no face") accepted it in about 2.5 s.`,
      `After the eye check (src/camera/distance.ts, EYE_MIN_CONTRAST = ${ec?.threshold.EYE_MIN_CONTRAST ?? '–'}): covered eyes (black bars, sunglasses, hand) give 0 distances, and real eyes are still accepted on 100% of frames at 22–70 cm, 30% light, tinted light, slight blur and turned 90°. The person sees the "no face" message, now worded "Can't see your eyes … without sunglasses", in all 4 languages.`,
      'Measured limit: a drawn cartoon face still passes, because its drawn eyes have the same dark-centre pattern as real ones. Cartoons are not a realistic use; blocking drawings and photos needs a liveness or blink check.',
      'Limits of the evidence: one real face (MediaPipe\'s test portrait, dark brown irises), synthetic occluders, and a fake camera with clean noise. Light (blue or grey) irises have less contrast against the white of the eye, and real sunglasses can have reflections. Both should be checked on real people before claiming more.',
    ],
    recommendedFixes: [
      'DONE: eye-visibility check (fix #1). Relative iris-vs-surround contrast of a 24×24 patch per eye, every 3rd frame; if neither eye passes, the frame counts as "no face".',
      'Refinement: when only one eye passes, measure the iris size from that eye alone. irisWidthNorm still averages in the invented iris of the covered eye.',
      'Liveness or blink check over the test, to catch cartoons and photos: enable outputFaceBlendshapes and require at least one blink (eyeBlinkLeft/Right above about 0.5) before accepting the working distance. It needs a dev/bench bypass, because the fake-camera e2e tests and these benches use a still portrait.',
      'Show the tracked eye points on the live camera preview, so the person can see what is being tracked.',
      'Check EYE_MIN_CONTRAST on real people: light irises, dark skin in dim light, reading glasses with reflections (the try-on step is done wearing readers).',
    ],
    camera: camera.map(({ id, name, description, frames, falseOutputs, rate, notes, ...rest }) => ({ name, id, frames, falseOutputs, rate, notes, description, ...rest })),
    cameraBeforeEyeCheck: camAfter ? {
      label: 'BEFORE the eye-visibility check: the same scenes on the shipped pipeline (first negative-control run). Kept for comparison.',
      runAt: camBefore.generatedAt,
      repeatsPerScene: camBefore.repeats,
      scenes: resultsBefore.map(brief),
    } : null,
    eyeCheck: ec,
    positiveControl: {
      name: pos.name,
      description: pos.description,
      frames: pos.frames,
      framesWithDistance: pos.falseOutputs,
      rate: pos.rate,
      threshold: 0.95,
      pass: (pos.rate ?? 0) >= 0.95,
      distanceCm: pos.distanceCm,
      irisNormMedian: pos.irisNormMedian,
      workingGateLockedRuns: pos.workingGateLockedRuns,
      workingGateLockedAtMs: posRuns.map((p) => p.workingGateLockedAtMs),
      runs: pos.runs,
      notes: 'Uncalibrated distance (no camera calibration in a fresh browser profile, 70° field of view assumed), so the absolute cm value is not the point; the point is that a real face gives a distance on nearly every frame in the same harness.',
    },
    logic,
    logicDetail: {
      test: 'tests/negative.test.ts (vitest), checker bench-camera/negative-logic.ts',
      inputs: logicRun.inputs,
      inputsBySource: logicRun.bySource,
      seed: SEED,
      randomPerTarget: RANDOM_N,
      ageRange: `${APP_AGES.min}–${APP_AGES.max} (the app's age slider)`,
      runtimeMs: logicMs,
      grid: 'ages 18–90 (every year) × working distance 100–900 mm (50 mm steps) × near point {beyond reach, not measured, 40 log-spaced values 50–2000 mm} × small-print result {pass, fail, not tested} × reach {max(wd, 450), 1000} mm',
      preconditions: 'Computed from the raw inputs and the published formulas (src/core/optics.ts), not from recommend()\'s own flags: amplitude = 1000/nearPoint − DOF/2; estimate = 0.6 × near-point estimate + 0.4 × age table at the working distance (or the max of the two when the near point is out of reach); out of range = estimate rounded to 0.25 D above +3.00.',
      knownGaps: {
        'myopia-all-ages': { ...myopiaGapDetail(), status: 'FIXED in src/core/recommend.ts (MYOPIA_CHECK_MIN_AGE = 35): 0 violations now; was 4,252 violations in 240,608 cases (ages 35–39) when first measured.', explanation: "Before the fix, recommend() only raised 'possible-myopia' from age 40, but its '+1.00 starter pair' rule (strength < +1.00, failed small print, age ≥ 35) fires from 35. All violations are ages 35–39, near point ≤ 9 cm, outcome readers +1.00 flagged only 'inconsistent' (result screen: 'check the pair in the shop with the try-on test'). In the simulation's 35–39 population the try-on step hands readers to 0% of myopes (spTry050), so the try-on catches it there; the start recommendation alone does not.", recommendedFix: "Run the possible-myopia check whenever the starter pair can fire (age ≥ 35), or never give the starter pair when the near-point estimate is negative / 'inconsistent' is set." },
        'out-of-range-refer': { explanation: "Not a safety failure: every one of these cases is also flagged possible-myopia (ages 59+, where Hofstetter's maximum is ≤ 1.4 D so the threshold is low), and the myopia check runs first, so the outcome is 'no-readers' + 'possible-myopia' (screen: 'you may be short-sighted… an eye exam can tell you for sure'), never readers. The logged outcome is 'no-readers', not 'refer'.", recommendedFix: "Optional: when both flags apply, return outcome 'refer' (keeping both flags) so dashboards count it as a referral." },
      },
      safetyScreens: "The safety-question stop screens live in src/app.ts (SAFETY list: 'sudden change' and 'pain/redness' stop the test; diabetes, family glaucoma, distance blur, distance glasses advise an exam). e2e/safety.spec.ts tests: urgent answer ('sudden change') → stop screen with no Continue button, 0 results posted; diabetes only → advise screen with 'Continue anyway', 0 results posted. The 'pain/redness' stop answer is not separately covered by an e2e test.",
    },
    simulation: simulation(),
    environment: {
      ...cam.environment,
      cameraRunAt: cam.generatedAt,
      build: 'vite build of the current src/ (camera.json and eyecheck-before.json: before the eye-visibility check; camera-after.json and eyecheck-after.json: with it), served by vite preview on port 4190; lab.html runs src/camera/distance.ts unchanged by the harness',
      harness: 'Playwright, Chrome channel "chrome", headless, --use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=<scene>.y4m; fresh browser profile per run (no camera calibration)',
      video: cam.video,
      collectMsPerRun: cam.collectMs,
      repeatsPerScene: cam.repeats,
      eyeBoxesPx: cam.eyeBoxes,
      lowerHalfShiftPx: cam.lowerShiftPx,
      counting: 'Every frame lab.ts processes writes #live once ("no face" or "NN.N cm"); an init script records each write. Counting starts at the first processed frame, nothing is discarded as warm-up.',
      scripts: ['bench-camera/negative.ts', 'bench-camera/negative-report.ts', 'bench-camera/negative-logic.ts', 'tests/negative.test.ts'],
      node: process.version,
    },
    timestamp: new Date().toISOString(),
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(out.headline.noUsableFace);
  for (const k of ['eyesCovered', 'realEyesKept', 'drawnFaceLimit', 'threshold', 'beforeEyeCheck'] as const) if (k in out.headline) console.log((out.headline as Record<string, string>)[k]);
  for (const t of ec?.table ?? []) console.log(`${t.id.padEnd(13)} ${t.kind.padEnd(9)} before ${t.before ? `${t.before.accepted}/${t.before.frames}` : '–'}  after ${t.after ? `${t.after.accepted}/${t.after.frames}` : '–'}  relContrast ${t.distributionsBefore.relativeContrastBestEye ? `${t.distributionsBefore.relativeContrastBestEye.min}–${t.distributionsBefore.relativeContrastBestEye.max}` : '–'}`);
  console.log(out.headline.realFaceRotated);
  console.log(out.headline.positiveControl);
  for (const r of camera) console.log(`${r.id.padEnd(13)} ${String(r.falseOutputs).padStart(4)} / ${String(r.frames).padStart(4)}  gate locked ${r.workingGateLockedRuns}/${r.runs.length}`);
  console.log(out.headline.logic);
  console.log(`wrote ${OUT}`);
}

main();
