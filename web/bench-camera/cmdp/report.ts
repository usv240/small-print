// CMDP validation, step 2 of 2: statistics → public/data/cmdp.json + public/figures/cmdp-*.svg.
// Reads %TEMP%/cmdp/raw.json written by run.ts. Numbers and charts only: no image, crop or
// subject code ever leaves %TEMP%; people are identified by the dataset's folder number only.
//
//   npx tsx bench-camera/cmdp/report.ts

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RAW_PATH } from './vite.config';
import { pxPerMm, type Exif } from './exif';
import type { ImageResult } from './harness';

const WEB = resolve(import.meta.dirname, '../..');
const OUT_JSON = resolve(WEB, 'public/data/cmdp.json');
const OUT_DIST = resolve(WEB, 'public/figures/cmdp-distance.svg');
const OUT_IRIS = resolve(WEB, 'public/figures/cmdp-iris.svg');

const IRIS_MM = 11.7; // src/core/optics.ts IRIS_DIAMETER_MM (MediaPipe Iris, 11.7 ± 0.5 mm)
const FT = [2, 3, 4, 6, 8, 12, 16];
const REF_FT = 2;
const ftToMm = (ft: number) => ft * 304.8; // the dataset's own distancesVec_MM (609.6 … 4876.8)

interface RawRow { subject: number; feet: number; rel: string; exif: Exif | null; result: ImageResult }
const raw = JSON.parse(readFileSync(RAW_PATH, 'utf8')) as {
  generatedAt: string; seconds: number; info: Record<string, unknown>; machine: Record<string, string>; rows: RawRow[];
};

// ---------------------------------------------------------------- helpers
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => sum(xs) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1)); };
const psd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / xs.length); };
function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const median = (xs: number[]) => quantile(xs, 0.5);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
/** Summary of relative errors given as fractions; reported in %. */
function errStats(e: number[]) {
  const a = e.map(Math.abs);
  return {
    n: e.length,
    medianAbsPct: r1(median(a) * 100),
    meanAbsPct: r1(mean(a) * 100),
    p90AbsPct: r1(quantile(a, 0.9) * 100),
    medianSignedPct: r1(median(e) * 100),
    within5Pct: r1((a.filter((x) => x <= 0.05).length / a.length) * 100),
    within10Pct: r1((a.filter((x) => x <= 0.1).length / a.length) * 100),
  };
}

// ---------------------------------------------------------------- rows
interface Row {
  subject: number; feet: number; d: number;
  detected: boolean; irisNorm: number | null; width: number; height: number;
  irisPx: number | null; ipdPx: number | null;
  eyeContrast: [number | null, number | null] | null; eyesVisible: boolean | null;
  focalMm: number | null; pxPerMm: number | null;
  /** Iris angular size: iris px ÷ focal length in px (radians, small-angle). */
  theta: number | null;
}
const rows: Row[] = raw.rows.map((r) => {
  const res = r.result;
  const irisPx = res.irisNorm === null ? null : res.irisNorm * res.width;
  const focalMm = r.exif?.focalLengthMm ?? null;
  const ppm = pxPerMm(r.exif);
  return {
    subject: r.subject, feet: r.feet, d: ftToMm(r.feet),
    detected: res.irisNorm !== null, irisNorm: res.irisNorm, width: res.width, height: res.height,
    irisPx, ipdPx: res.ipdPx, eyeContrast: res.eyeContrast, eyesVisible: res.eyesVisible,
    focalMm, pxPerMm: ppm,
    theta: irisPx !== null && focalMm && ppm ? irisPx / (focalMm * ppm) : null,
  };
});
const subjects = [...new Set(rows.map((r) => r.subject))].sort((a, b) => a - b);
const bySubject = new Map(subjects.map((s) => [s, rows.filter((r) => r.subject === s)]));
const exifSubjects = subjects.filter((s) => bySubject.get(s)!.every((r) => r.theta !== null));
const noExifSubjects = subjects.filter((s) => !exifSubjects.includes(s));
const cameraModels = [...new Set(raw.rows.map((r) => r.exif?.model).filter(Boolean))];
const ppmValues = [...new Set(rows.map((r) => r.pxPerMm).filter((x): x is number => x !== null))];
const sensorWidthMm = 3072 / ppmValues[0];

// ---------------------------------------------------------------- (a) detection, (e) eye check
const detection = FT.map((ft) => {
  const at = rows.filter((r) => r.feet === ft);
  const det = at.filter((r) => r.detected);
  const pass = det.filter((r) => r.eyesVisible);
  const irisPx = det.map((r) => r.irisPx!);
  return {
    feet: ft, cm: r1(ftToMm(ft) / 10), photos: at.length, detected: det.length, detectedPct: r1((det.length / at.length) * 100),
    eyeCheckPass: pass.length, eyeCheckPassPct: r1((pass.length / det.length) * 100),
    irisPxMedian: r1(median(irisPx)), irisPxMin: r1(Math.min(...irisPx)), irisPxMax: r1(Math.max(...irisPx)),
  };
});
const bestEye = rows.filter((r) => r.detected).map((r) => Math.max(...r.eyeContrast!.filter((c): c is number => c !== null)));
const peopleFailingAll = subjects.filter((s) => bySubject.get(s)!.every((r) => r.eyesVisible === false));
const failBest = rows.filter((r) => peopleFailingAll.includes(r.subject)).map((r) => Math.max(...r.eyeContrast!.filter((c): c is number => c !== null)));
const failRange = failBest.length ? `${Math.min(...failBest).toFixed(2)}–${Math.max(...failBest).toFixed(2)}` : 'n/a';
const peoplePassingAll = subjects.filter((s) => bySubject.get(s)!.every((r) => r.eyesVisible === true));

// ---------------------------------------------------------------- label-free scale check
// Iris width ÷ inter-pupil distance (both from the same landmarks) needs no distance label and no
// focal length. If the iris measurement scales exactly like the rest of the face, this ratio is the
// same in all 7 photos of a person; its spread bounds the landmark noise on real photos.
const ratioWithin = subjects.map((s) => {
  const v = bySubject.get(s)!.filter((r) => r.detected).map((r) => r.irisPx! / r.ipdPx!);
  return { s, cv: sd(v) / mean(v), dev: v.map((x) => x / median(v) - 1) };
});
const ratioByFt = FT.map((ft) => {
  const v = rows.filter((r) => r.feet === ft && r.detected).map((r) => r.irisPx! / r.ipdPx!);
  return { feet: ft, median: r3(median(v)), sdBetweenPeople: r3(sd(v)) };
});

// ---------------------------------------------------------------- distance-reference offset
// CMDP distances are floor marks for the monopod foot (paper §3); where the zoom lens' centre of
// projection and the eyes sit relative to the marks is not documented. Model: true camera-to-eye
// distance = mark + δ, one δ for the whole dataset. δ is chosen to make (mark + δ) × θ as constant
// as possible within each person (it uses no iris size and no truth beyond the marks' spacing).
const exifRows = (s: number) => bySubject.get(s)!;
function within(delta: number, subs: number[]): number {
  return mean(subs.map((s) => psd(exifRows(s).map((r) => Math.log((r.d + delta) * r.theta!)))));
}
function fitDelta(subs: number[]): number {
  let best = 0, bestV = Infinity;
  for (let dlt = -450; dlt <= 200; dlt += 1) {
    const v = within(dlt, subs);
    if (v < bestV) { bestV = v; best = dlt; }
  }
  return best;
}
const deltaAll = fitDelta(exifSubjects);
const deltaLoso = new Map(exifSubjects.map((s) => [s, fitDelta(exifSubjects.filter((t) => t !== s))]));
const deltaLosoRange = [Math.min(...deltaLoso.values()), Math.max(...deltaLoso.values())];
const withinNominal = within(0, exifSubjects), withinCorrected = within(deltaAll, exifSubjects);

// ---------------------------------------------------------------- (b) calibrated, (c) uncalibrated
// The app: k = d_ref × irisNorm at one known distance, then d = k ÷ irisNorm. CMDP re-zoomed for
// every photo, so the zoom is divided out with the EXIF focal length: k = d_ref × θ_ref, d = k ÷ θ.
interface Pred { subject: number; feet: number; d: number; dTrue: number; pred: number; err: number }
function calibrated(offset: (s: number) => number): Pred[] {
  const out: Pred[] = [];
  for (const s of exifSubjects) {
    const rs = exifRows(s), dl = offset(s);
    const ref = rs.find((r) => r.feet === REF_FT)!;
    const k = (ref.d + dl) * ref.theta!;
    for (const r of rs) {
      if (r.feet === REF_FT) continue;
      const dTrue = r.d + dl, pred = k / r.theta!;
      out.push({ subject: s, feet: r.feet, d: r.d, dTrue, pred, err: pred / dTrue - 1 });
    }
  }
  return out;
}
function uncalibrated(offset: number): Pred[] {
  return exifSubjects.flatMap((s) => exifRows(s).map((r) => {
    const dTrue = r.d + offset, pred = IRIS_MM / r.theta!;
    return { subject: s, feet: r.feet, d: r.d, dTrue, pred, err: pred / dTrue - 1 };
  }));
}
function calibratedAt(refFt: number, offset: number): number[] {
  return exifSubjects.flatMap((s) => {
    const rs = exifRows(s), ref = rs.find((r) => r.feet === refFt)!;
    const k = (ref.d + offset) * ref.theta!;
    return rs.filter((r) => r.feet !== refFt).map((r) => k / r.theta! / (r.d + offset) - 1);
  });
}
const calNominal = calibrated(() => 0);
const calCorrected = calibrated((s) => deltaLoso.get(s)!);
const uncalNominal = uncalibrated(0);
const uncalCorrected = uncalibrated(deltaAll);
const perFt = (preds: Pred[], fts = FT) => fts.map((ft) => ({ feet: ft, cm: r1(ftToMm(ft) / 10), ...errStats(preds.filter((p) => p.feet === ft).map((p) => p.err)) }));
const NON_REF = FT.filter((f) => f !== REF_FT);
const near = (p: Pred) => p.feet === 3 || p.feet === 4;

// ---------------------------------------------------------------- (d) implied iris diameter
// Far photos (12 and 16 ft) at face value: a ±20 cm reference offset changes them by ≤ 5%.
const irisFar = exifSubjects.map((s) => ({ s, mm: mean(exifRows(s).filter((r) => r.feet >= 12).map((r) => r.d * r.theta!)) }));
// All 7 photos with the offset correction (δ fitted on the other people).
const irisCorr = exifSubjects.map((s) => {
  const v = exifRows(s).map((r) => (r.d + deltaLoso.get(s)!) * r.theta!);
  return { s, mm: median(v), cv: sd(v) / mean(v) };
});
// Thin-lens sensitivity: a lens focused at u has magnification f/(u − f), not f/u.
const thinLensFactor = median(exifSubjects.flatMap((s) => exifRows(s).filter((r) => r.feet >= 12).map((r) => (r.d - r.focalMm!) / r.d)));
const irisStats = (v: number[]) => ({ n: v.length, meanMm: r2(mean(v)), sdMm: r2(sd(v)), cvPct: r1((sd(v) / mean(v)) * 100), minMm: r2(Math.min(...v)), maxMm: r2(Math.max(...v)), p10Mm: r2(quantile(v, 0.1)), p90Mm: r2(quantile(v, 0.9)) });

// ---------------------------------------------------------------- JSON
const json = {
  title: 'Real-people check: the app\'s iris distance method on the Caltech Multi-Distance Portraits dataset',
  label: 'Measured on a public dataset of real people (not recorded by us). Numbers only: no image from the dataset is published.',
  generatedAt: raw.generatedAt,
  reportedAt: new Date().toISOString(),
  code: 'web/bench-camera/cmdp/ (run.ts collects, report.ts analyses; README.md has the steps)',
  dataset: {
    name: 'Caltech Multi-Distance Portraits (CMDP)',
    citation: 'X. P. Burgos-Artizzu, M. R. Ronchi, P. Perona. Distance Estimation of an Unknown Person from a Portrait. ECCV 2014, LNCS 8689, pp. 313–327. doi:10.1007/978-3-319-10590-1_21',
    record: 'https://data.caltech.edu/records/n5vnm-mqr05',
    doi: '10.22002/D1.20110',
    license: 'CC-BY (CaltechDATA record); the files\' own README/bsd.txt state the Simplified BSD License. Attribution: Burgos-Artizzu, Ronchi, Perona, Caltech.',
    files: 'CMDP-ANNO.zip (md5 ca117c8ba92f68a2a8191c0510cb88b0), CMDP_1.zip (md5 7d9a19c26fe92f894e88ace8de8c7fc6), CMDP_2.zip (md5 18023d525d3b7924b57840704852b30a); md5 verified',
    people: subjects.length,
    photos: rows.length,
    distances: FT.map((ft) => ({ feet: ft, cm: r1(ftToMm(ft) / 10) })),
    howDistanceWasSet: 'Paper §3: markings on the ground indicated the seven distances; the photographer moved the foot of the camera monopod to the next marking, adjusted the zoom to fill the frame with the face, and took the 7 pictures within 15–20 s. Lens centre at the height of the bridge of the nose. The exact reference points (monopod foot vs lens; mark vs eyes) are not documented. Paper: "Images were then cropped and resampled to a common format."',
    camera: `EXIF: ${cameraModels.join(', ')} (the paper says Canon Rebel XTi) with a 28–300 mm Canon L zoom (EXIF focal length 28–300 mm, re-zoomed for every photo). Sensor ${r2(sensorWidthMm)} mm wide from EXIF FocalPlaneXResolution (${r2(ppmValues[0])} px/mm; Canon spec 22.7 mm). Photos ${exifSubjects.length} people: 3072×2048 / 2048×3072 with EXIF; ${noExifSubjects.length} people: 2056×3088 with no EXIF (no focal length).`,
    excluded: 'nonPortrait/ extra photos and the STANDARDIZED_* derived crops were not used; only the 7 original portraits per person.',
  },
  scopeNote: 'The app works at 25–70 cm with a fixed-focus front camera. CMDP covers 61–488 cm with a zoom lens, so it tests the physics the app relies on (distance × iris size ÷ focal length is constant, and adult irises are about the same size) on real people, not the app\'s exact use.',
  method: {
    model: 'MediaPipe Face Landmarker, web/public/models/face_landmarker.task (the file the app ships), @mediapipe/tasks-vision in Chrome via Playwright (channel "chrome", headless), runningMode IMAGE, numFaces 1, same options as the app otherwise',
    delegate: raw.info.delegate,
    webgl: raw.info.webgl,
    irisCode: 'irisWidthNorm() imported unchanged from src/camera/distance.ts (landmarks 469/471 and 474/476: 0.5 × larger + 0.25 × sum, as a fraction of image width); iris px = irisNorm × image width',
    eyeCheckCode: `eyePatchContrast(), EYE_PATCH_PX (${raw.info.eyePatchPx}) and EYE_MIN_CONTRAST (${raw.info.eyeMinContrast}) imported from src/camera/distance.ts; CameraDistance.checkEyes() repeated with the photo as drawImage source (patch 3 iris radii wide around landmarks 468/473; pass = at least one eye ≥ threshold)`,
    geometry: `θ = iris px ÷ (EXIF focal length mm × ${r2(ppmValues[0])} px/mm). Pinhole: distance = iris diameter ÷ θ.`,
    calibrated: `As in the app: per person, k = d(2 ft) × θ(2 ft); predicted d = k ÷ θ at 3–16 ft. The app divides by irisNorm; CMDP re-zoomed between photos, so θ (iris size ÷ focal length) replaces irisNorm. ${exifSubjects.length} people with EXIF.`,
    uncalibrated: `d = 11.7 mm ÷ θ = f_px × 11.7 mm ÷ iris px (EXIF focal length and sensor width). ${exifSubjects.length} people with EXIF.`,
    referenceOffset: `One offset δ added to every floor-mark distance, chosen to make (mark + δ) × θ most constant within each person (least mean within-person SD of log). All people: δ = ${deltaAll} mm. For the calibrated errors δ is refit leaving out the person being tested (range ${deltaLosoRange[0]} to ${deltaLosoRange[1]} mm). Within-person SD of log(d × θ): ${r1(withinNominal * 100)}% with the marks as given, ${r1(withinCorrected * 100)}% with δ. It is a property of the dataset's distance labels/zoom, not of the iris: iris ÷ inter-pupil distance is the same at every distance (labelFreeScaleCheck).`,
  },
  environment: { ...raw.machine, userAgent: raw.info.userAgent, seconds: Math.round(raw.seconds) },
  detection: {
    summary: `${rows.filter((r) => r.detected).length} of ${rows.length} photos (${subjects.length} people) gave a face with all 478 landmarks. CMDP zoomed to fill the frame with the face at every distance, so this does not test small, distant faces.`,
    byDistance: detection,
  },
  eyeCheck: {
    summary: `${rows.filter((r) => r.eyesVisible).length} of ${rows.filter((r) => r.detected).length} photos passed (${peoplePassingAll.length} of ${subjects.length} people at every distance). ${peopleFailingAll.length} person failed at all 7 distances (best-eye contrast ${failRange} < ${raw.info.eyeMinContrast}): light-coloured irises and partly closed lids, so the iris is barely darker than its surround. In the app that person would get "no face" (a false negative), never a wrong distance.`,
    peopleFailingEveryPhoto: peopleFailingAll.length,
    bestEyeContrast: { median: r2(median(bestEye)), p5: r2(quantile(bestEye, 0.05)), p10: r2(quantile(bestEye, 0.1)), min: r2(Math.min(...bestEye)), threshold: raw.info.eyeMinContrast },
    byDistance: detection.map((d) => ({ feet: d.feet, cm: d.cm, pass: d.eyeCheckPass, of: d.detected, passPct: d.eyeCheckPassPct })),
  },
  labelFreeScaleCheck: {
    what: 'Iris width ÷ inter-pupil distance (landmarks 468–473) in each photo. Needs no distance label or focal length. Constant within a person if the iris landmark scales like the rest of the face.',
    withinPersonCvMedianPct: r1(median(ratioWithin.map((x) => x.cv)) * 100),
    withinPersonCvP90Pct: r1(quantile(ratioWithin.map((x) => x.cv), 0.9) * 100),
    perPhotoDeviationFromPersonMedian: { medianAbsPct: r1(median(ratioWithin.flatMap((x) => x.dev).map(Math.abs)) * 100), p90AbsPct: r1(quantile(ratioWithin.flatMap((x) => x.dev).map(Math.abs), 0.9) * 100) },
    byDistance: ratioByFt,
    people: subjects.length,
    note: `Between people the ratio varies by only ${r1((median(ratioByFt.map((x) => x.sdBetweenPeople)) / median(ratioByFt.map((x) => x.median))) * 100)}% (SD ÷ median), less than independent iris and inter-pupil variation would give, so the model may partly infer iris size from the face. Either way its scale is consistent across photos of the same person, which is what a calibrated reading needs.`,
  },
  calibrated: {
    reference: `${REF_FT} ft (61 cm), the closest CMDP distance to the app's 30 cm calibration`,
    asLabelled: {
      what: 'Floor-mark distances taken at face value.',
      overall: errStats(calNominal.map((p) => p.err)),
      at3to4ft: errStats(calNominal.filter(near).map((p) => p.err)),
      byDistance: perFt(calNominal, NON_REF),
    },
    referenceCorrected: {
      what: 'Distances = mark + δ (δ fitted on the other people). Relative error of the camera-to-eye distance.',
      overall: errStats(calCorrected.map((p) => p.err)),
      at3to4ft: errStats(calCorrected.filter(near).map((p) => p.err)),
      byDistance: perFt(calCorrected, NON_REF),
    },
  },
  calibrationDistanceSensitivity: {
    what: 'Same calibrated method with the one-time calibration photo at another distance (all other distances predicted). Short reference distances suffer most from the unknown reference offset and from small changes in where the person stands.',
    rows: [REF_FT, 3, 4, 8].flatMap((ft) => [
      { referenceFeet: ft, distances: 'as labelled', ...errStats(calibratedAt(ft, 0)) },
      { referenceFeet: ft, distances: `mark + δ (${deltaAll} mm, fitted on all people)`, ...errStats(calibratedAt(ft, deltaAll)) },
    ]),
  },
  uncalibrated: {
    published: 'MediaPipe Iris (Google AI Blog, Aug 2020): mean relative error 4.3% (SD 2.4%) vs the iPhone 11 depth sensor, 200+ people, 11.7 mm iris.',
    asLabelled: { overall: errStats(uncalNominal.map((p) => p.err)), farOnly12to16ft: errStats(uncalNominal.filter((p) => p.feet >= 12).map((p) => p.err)), byDistance: perFt(uncalNominal) },
    referenceCorrected: { delta: deltaAll, overall: errStats(uncalCorrected.map((p) => p.err)), byDistance: perFt(uncalCorrected) },
  },
  impliedIrisDiameter: {
    published: '11.7 ± 0.5 mm (MediaPipe Iris, Google 2020)',
    far12and16ftAsLabelled: { what: 'Per person, mean of d × θ at 12 and 16 ft (pinhole, EXIF focal length).', ...irisStats(irisFar.map((x) => x.mm)) },
    allDistancesReferenceCorrected: { what: 'Per person, median of (d + δ) × θ over all 7 photos.', ...irisStats(irisCorr.map((x) => x.mm)), withinPersonCvMedianPct: r1(median(irisCorr.map((x) => x.cv)) * 100) },
    lensModelNote: `A thin-lens magnification f ÷ (u − f) instead of the pinhole f ÷ u would lower these by about ${r1((1 - thinLensFactor) * 100)}%; the nominal EXIF focal length of a zoom also differs from its effective focal length at close focus. The spread between people is robust to both; the mean is uncertain by ±5–6%.`,
  },
  perPerson: subjects.map((s) => {
    const rs = bySubject.get(s)!;
    const far = irisFar.find((x) => x.s === s), corr = irisCorr.find((x) => x.s === s);
    const cn = calNominal.filter((p) => p.subject === s), cc = calCorrected.filter((p) => p.subject === s);
    return {
      subject: s,
      exif: exifSubjects.includes(s),
      detected: rs.filter((r) => r.detected).length,
      eyeCheckPass: rs.filter((r) => r.eyesVisible).length,
      irisOverIpdCvPct: r1(ratioWithin.find((x) => x.s === s)!.cv * 100),
      impliedIrisFarMm: far ? r2(far.mm) : null,
      impliedIrisCorrectedMm: corr ? r2(corr.mm) : null,
      calibratedMedianAbsErrPctAsLabelled: cn.length ? r1(median(cn.map((p) => Math.abs(p.err))) * 100) : null,
      calibratedMedianAbsErrPctCorrected: cc.length ? r1(median(cc.map((p) => Math.abs(p.err))) * 100) : null,
    };
  }),
  perPhoto: {
    columns: ['subject', 'feet', 'irisNorm', 'imageWidthPx', 'irisPx', 'ipdPx', 'focalMm', 'eyeContrastA', 'eyeContrastB', 'eyesVisible'],
    rows: rows.map((r) => [r.subject, r.feet, r.irisNorm === null ? null : r5(r.irisNorm), r.width, r.irisPx === null ? null : r2(r.irisPx), r.ipdPx === null ? null : r1(r.ipdPx), r.focalMm, r.eyeContrast?.[0] == null ? null : r3(r.eyeContrast[0]), r.eyeContrast?.[1] == null ? null : r3(r.eyeContrast[1]), r.eyesVisible]),
  },
  caveats: [
    'CMDP re-zoomed for every photo (EXIF 28–300 mm), unlike a phone front camera. All distance results divide the zoom out with the EXIF focal length, so EXIF focal-length steps (e.g. 28 → 33 → 35 mm) and focus breathing add error that the app does not have.',
    'Distances are floor marks for the monopod foot; the reference points are undocumented and the paper says images were cropped and resampled. Taken at face value, the implied iris shrinks from 15.3 mm at 2 ft to 11.0 mm at 16 ft. The whole face does the same (iris ÷ inter-pupil distance is constant), so the bias is in the labels/zoom, not in the iris landmark.',
    'Distances are 61–488 cm; the app works at 25–70 cm with a fixed phone/laptop camera, where the iris is roughly 15–45 px wide in a 1280-px frame (70° field of view). CMDP iris widths are 40–126 px, so landmark precision here is if anything better than in the app.',
    'Still, frontal, evenly lit portraits against a blue background; no motion blur or low light.',
    `${noExifSubjects.length} of ${subjects.length} people have no EXIF, so they count only for detection, the eye check and the label-free scale check.`,
  ],
};
// Optional: same photos with the CPU delegate (CMDP_DELEGATE=CPU run.ts → raw-cpu.json).
const cpuPath = resolve(RAW_PATH, '..', 'raw-cpu.json');
if (existsSync(cpuPath)) {
  const cpu = JSON.parse(readFileSync(cpuPath, 'utf8')) as { info: Record<string, unknown>; rows: RawRow[] };
  const key = (r: { subject: number; feet: number }) => `${r.subject}/${r.feet}`;
  const gpu = new Map(raw.rows.map((r) => [key(r), r.result.irisNorm]));
  const diffs = cpu.rows.filter((r) => r.result.irisNorm !== null && gpu.get(key(r)) != null).map((r) => Math.abs(r.result.irisNorm! / gpu.get(key(r))! - 1));
  Object.assign(json, {
    delegateCrossCheck: {
      what: 'Same photos, CPU delegate instead of GPU: relative difference in irisWidthNorm per photo.',
      cpuDetected: cpu.rows.filter((r) => r.result.irisNorm !== null).length,
      cpuEyeCheckPass: cpu.rows.filter((r) => r.result.eyesVisible).length,
      photos: cpu.rows.length,
      medianAbsDiffPct: r2(median(diffs) * 100),
      p90AbsDiffPct: r2(quantile(diffs, 0.9) * 100),
      maxAbsDiffPct: r2(Math.max(...diffs) * 100),
    },
  });
}
writeFileSync(OUT_JSON, JSON.stringify(json, null, 1) + '\n');

// ---------------------------------------------------------------- charts (style of bench-camera/report.ts)
const FONT = 'system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, sans-serif';
const INK = '#0b0b0b', INK2 = '#52514e', MUTED = '#6b6a66', GRID = '#e1e0d9', AXIS = '#c3c2b7', BAND = '#f0efec';
const BLUE = '#2a78d6', GREY = '#8a8984';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (x: number, d = 1) => x.toFixed(d);
const sgn = (x: number, d = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}`;
function frame(id: string, w: number, h: number, title: string, subtitle: string, desc: string, badge: string, body: string, footer: string, footer2: string): string {
  const bw = badge.length * 7.4 + 26;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="fig-${id}-title fig-${id}-desc" font-family="${FONT}">
<title id="fig-${id}-title">${esc(title)}</title>
<desc id="fig-${id}-desc">${esc(desc)}</desc>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="#ffffff" stroke="${GRID}"/>
<text x="24" y="34" font-size="17" font-weight="600" fill="${INK}">${esc(title)}</text>
<text x="24" y="55" font-size="12.5" fill="${INK2}">${esc(subtitle)}</text>
<g aria-hidden="true"><rect x="${w - 24 - bw}" y="20" width="${bw}" height="22" rx="11" fill="${BAND}" stroke="${AXIS}"/><text x="${w - 24 - bw / 2}" y="35" font-size="11" font-weight="600" fill="${INK2}" text-anchor="middle" letter-spacing="0.6">${esc(badge)}</text></g>
${body}
<text x="24" y="${h - 32}" font-size="11" fill="${MUTED}">${esc(footer)}</text>
<text x="24" y="${h - 16}" font-size="11" fill="${MUTED}">${esc(footer2)}</text>
</svg>
`;
}
// Deterministic jitter so the chart is reproducible.
const jit = (s: number, i: number) => (((s * 7919 + i * 104729) % 1000) / 1000 - 0.5);

function distanceChart(): string {
  const w = 780, h = 520, top = 104, ph = 300;
  const L = { ox: 78, pw: 290 }, R = { ox: 452, pw: 300 };
  // Left: predicted vs true camera-to-eye distance (reference-corrected), log–log.
  const lo = 35, hi = 600;
  const lx = (v: number) => L.ox + (Math.log(v / lo) / Math.log(hi / lo)) * L.pw;
  const ly = (v: number) => top + ph - (Math.log(v / lo) / Math.log(hi / lo)) * ph;
  let b = '';
  b += `<text x="${L.ox}" y="${top - 14}" font-size="12.5" font-weight="600" fill="${INK}">Calibrated reading vs camera-to-eye distance</text>`;
  for (const t of [50, 100, 200, 400]) {
    b += `<line x1="${L.ox}" y1="${ly(t)}" x2="${L.ox + L.pw}" y2="${ly(t)}" stroke="${GRID}"/><line x1="${lx(t)}" y1="${top}" x2="${lx(t)}" y2="${top + ph}" stroke="${GRID}"/>`;
    b += `<text x="${L.ox - 8}" y="${ly(t) + 4}" font-size="11" fill="${INK2}" text-anchor="end">${t}</text><text x="${lx(t)}" y="${top + ph + 18}" font-size="11" fill="${INK2}" text-anchor="middle">${t}</text>`;
  }
  b += `<line x1="${L.ox}" y1="${top + ph}" x2="${L.ox + L.pw}" y2="${top + ph}" stroke="${AXIS}"/><line x1="${L.ox}" y1="${top}" x2="${L.ox}" y2="${top + ph}" stroke="${AXIS}"/>`;
  b += `<line x1="${lx(lo)}" y1="${ly(lo)}" x2="${lx(hi)}" y2="${ly(hi)}" stroke="${AXIS}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  b += `<text x="${L.ox + L.pw - 4}" y="${top + ph - 40}" font-size="11" fill="${MUTED}" text-anchor="end">dashed: perfect</text>`;
  b += '<g fill-opacity="0.5">';
  for (const p of calCorrected) {
    b += `<circle cx="${r1(lx(p.dTrue / 10))}" cy="${r1(ly(p.pred / 10))}" r="2.6" fill="${BLUE}"><title>${esc(`Person ${p.subject}, ${p.feet} ft mark: ${f(p.dTrue / 10)} cm → ${f(p.pred / 10)} cm (${sgn(p.err * 100)}%)`)}</title></circle>`;
  }
  b += '</g>';
  // Calibration points (2 ft, by definition exact).
  const refs = exifSubjects.map((s) => (ftToMm(REF_FT) + deltaLoso.get(s)!) / 10);
  b += `<g><title>${esc(`Calibration at the 2 ft mark (${f(median(refs))} cm after the reference correction): error 0 by definition`)}</title><circle cx="${lx(median(refs))}" cy="${ly(median(refs))}" r="5" fill="#fff" stroke="${BLUE}" stroke-width="2"/></g>`;
  b += `<text x="${lx(median(refs)) + 8}" y="${ly(median(refs)) + 16}" font-size="11" fill="${MUTED}">calibration (2 ft mark)</text>`;
  b += `<text x="${L.ox + L.pw / 2}" y="${top + ph + 38}" font-size="12" fill="${INK2}" text-anchor="middle">camera-to-eye distance, cm (log scale)</text>`;
  b += `<text transform="translate(${L.ox - 44} ${top + ph / 2}) rotate(-90)" font-size="12" fill="${INK2}" text-anchor="middle">reading after calibration, cm</text>`;

  // Right: signed error by distance; blue = reference-corrected per person, grey = marks as given (median, P10–P90).
  const corr = perFt(calCorrected, NON_REF), nom = perFt(calNominal, NON_REF);
  const eMax = 60;
  const ry = (v: number) => top + ph / 2 - (Math.max(-eMax, Math.min(eMax, v)) / eMax) * (ph / 2);
  const slot = R.pw / NON_REF.length;
  const rx = (i: number) => R.ox + slot * (i + 0.5);
  b += `<text x="${R.ox}" y="${top - 14}" font-size="12.5" font-weight="600" fill="${INK}">Error by distance (calibrated at the 2 ft mark)</text>`;
  for (let t = -eMax; t <= eMax; t += 20) {
    b += `<line x1="${R.ox}" y1="${ry(t)}" x2="${R.ox + R.pw}" y2="${ry(t)}" stroke="${t === 0 ? AXIS : GRID}"${t === 0 ? ' stroke-width="1.5"' : ''}/>`;
    b += `<text x="${R.ox - 8}" y="${ry(t) + 4}" font-size="11" fill="${INK2}" text-anchor="end">${t > 0 ? '+' : t < 0 ? '−' : ''}${Math.abs(t)}%</text>`;
  }
  NON_REF.forEach((ft, i) => {
    const cx = rx(i);
    b += `<text x="${cx}" y="${top + ph + 18}" font-size="11" fill="${INK2}" text-anchor="middle">${ft} ft</text>`;
    // marks as given: grey median ± P10–P90
    const en = calNominal.filter((p) => p.feet === ft).map((p) => p.err * 100);
    const gx = cx + 11;
    b += `<g><title>${esc(`${ft} ft, marks as given: median ${sgn(median(en))}%, 10–90%: ${sgn(quantile(en, 0.1))} to ${sgn(quantile(en, 0.9))}%, median |error| ${f(nom[i].medianAbsPct)}%`)}</title><line x1="${gx}" y1="${ry(quantile(en, 0.1))}" x2="${gx}" y2="${ry(quantile(en, 0.9))}" stroke="${GREY}" stroke-width="2"/><rect x="${gx - 4}" y="${ry(median(en)) - 4}" width="8" height="8" fill="#fff" stroke="${GREY}" stroke-width="2"/></g>`;
    // corrected: per-person dots + median bar
    const ec = calCorrected.filter((p) => p.feet === ft);
    b += '<g fill-opacity="0.5">';
    for (const p of ec) b += `<circle cx="${r1(cx - 8 + jit(p.subject, i) * 14)}" cy="${r1(ry(p.err * 100))}" r="2.4" fill="${BLUE}"><title>${esc(`Person ${p.subject}, ${ft} ft: ${sgn(p.err * 100)}% (reference-corrected)`)}</title></circle>`;
    b += '</g>';
    const m = median(ec.map((p) => p.err * 100));
    b += `<g><title>${esc(`${ft} ft, reference-corrected: median ${sgn(m)}%, median |error| ${f(corr[i].medianAbsPct)}%, 90th percentile |error| ${f(corr[i].p90AbsPct)}%`)}</title><line x1="${cx - 17}" y1="${ry(m)}" x2="${cx + 1}" y2="${ry(m)}" stroke="${INK}" stroke-width="2"/></g>`;
  });
  b += `<text x="${R.ox + R.pw / 2}" y="${top + ph + 38}" font-size="12" fill="${INK2}" text-anchor="middle">floor mark (3 ft = 91 cm … 16 ft = 488 cm)</text>`;
  // legend
  const lgY = top + ph + 62;
  b += `<g font-size="12" fill="${INK2}"><circle cx="${L.ox + 6}" cy="${lgY - 4}" r="4" fill="${BLUE}" fill-opacity="0.6"/><text x="${L.ox + 16}" y="${lgY}">one person, reference-corrected (black bar: median)</text>`;
  b += `<rect x="${R.ox + 2}" y="${lgY - 8}" width="8" height="8" fill="#fff" stroke="${GREY}" stroke-width="2"/><text x="${R.ox + 18}" y="${lgY}">floor marks as given: median, 10–90% line</text></g>`;
  const cc = json.calibrated.referenceCorrected, cn = json.calibrated.asLabelled;
  const title = 'Real people (Caltech CMDP): calibrated iris distance';
  const subtitle = `${exifSubjects.length} people. Median |error| ${f(cc.overall.medianAbsPct)}% once the dataset's distance reference is corrected; ${f(cn.overall.medianAbsPct)}% with its floor marks as given.`;
  const footer = `App code (Face Landmarker + irisWidthNorm); zoom divided out with EXIF focal length; reference offset ${deltaAll} mm, refit without each person.`;
  const footer2 = `Tests 61–488 cm; the app works at 25–70 cm. Data: Burgos-Artizzu, Ronchi, Perona (ECCV 2014), CC-BY. /data/cmdp.json`;
  const desc = `Two-panel chart, measurement on a public dataset of ${exifSubjects.length} real people. Left: reading after calibrating at the 2 ft mark vs camera-to-eye distance, log scale, one dot per person and distance. Right: signed error by distance. ` +
    NON_REF.map((ft, i) => `${ft} ft: reference-corrected median |error| ${f(corr[i].medianAbsPct)}% (90th percentile ${f(corr[i].p90AbsPct)}%), marks as given median ${sgn(nom[i].medianSignedPct)}%`).join('; ') + '.';
  return frame('cmdp-distance', w, h, title, subtitle, desc, 'REAL PEOPLE · PUBLIC DATASET', b, footer, footer2);
}

function irisChart(): string {
  const w = 780, h = 486, top = 96, ph = 230, ox = 74, pw = 660;
  const lo = 9.0, hi = 13.5, bin = 0.25;
  const x = (v: number) => ox + ((v - lo) / (hi - lo)) * pw;
  const bins: number[][] = [];
  for (let v = lo; v < hi - 1e-9; v += bin) bins.push(irisFar.filter((p) => p.mm >= v && p.mm < v + bin).map((p) => p.s));
  const maxC = Math.max(...bins.map((b) => b.length));
  const yMax = Math.ceil(maxC / 2) * 2 + 2;
  const y = (c: number) => top + ph - (c / yMax) * ph;
  let b = '';
  // published 11.7 ± 0.5 band
  b += `<g><title>Published: 11.7 ± 0.5 mm (MediaPipe Iris, Google 2020)</title><rect x="${x(11.2)}" y="${top}" width="${x(12.2) - x(11.2)}" height="${ph}" fill="${BAND}"/><line x1="${x(11.7)}" y1="${top}" x2="${x(11.7)}" y2="${top + ph}" stroke="${AXIS}" stroke-width="1.5" stroke-dasharray="5 4"/></g>`;
  b += `<text x="${x(11.7) + 6}" y="${top + 14}" font-size="11" fill="${MUTED}">published 11.7 ± 0.5 mm</text>`;
  for (let c = 0; c <= yMax; c += 2) {
    b += `<line x1="${ox}" y1="${y(c)}" x2="${ox + pw}" y2="${y(c)}" stroke="${c === 0 ? AXIS : GRID}" stroke-opacity="${c === 0 ? 1 : 0.7}"/><text x="${ox - 8}" y="${y(c) + 4}" font-size="11" fill="${INK2}" text-anchor="end">${c}</text>`;
  }
  for (let v = 9; v <= 13.5; v += 0.5) b += `<text x="${x(v)}" y="${top + ph + 18}" font-size="11" fill="${INK2}" text-anchor="middle">${f(v, 1)}</text>`;
  bins.forEach((ss, i) => {
    if (!ss.length) return;
    const v = lo + i * bin;
    b += `<g><title>${esc(`${f(v, 2)}–${f(v + bin, 2)} mm: ${ss.length} ${ss.length === 1 ? 'person' : 'people'}`)}</title><rect x="${x(v) + 1}" y="${y(ss.length)}" width="${x(v + bin) - x(v) - 2}" height="${y(0) - y(ss.length)}" rx="2" fill="${BLUE}"/></g>`;
  });
  const st = json.impliedIrisDiameter.far12and16ftAsLabelled;
  // mean ± SD bracket
  const by = top + ph + 66;
  b += `<g><title>${esc(`CMDP: ${f(st.meanMm, 2)} ± ${f(st.sdMm, 2)} mm (mean ± SD, ${st.n} people)`)}</title><line x1="${x(st.meanMm - st.sdMm)}" y1="${by}" x2="${x(st.meanMm + st.sdMm)}" y2="${by}" stroke="${BLUE}" stroke-width="2"/><line x1="${x(st.meanMm - st.sdMm)}" y1="${by - 5}" x2="${x(st.meanMm - st.sdMm)}" y2="${by + 5}" stroke="${BLUE}" stroke-width="2"/><line x1="${x(st.meanMm + st.sdMm)}" y1="${by - 5}" x2="${x(st.meanMm + st.sdMm)}" y2="${by + 5}" stroke="${BLUE}" stroke-width="2"/><circle cx="${x(st.meanMm)}" cy="${by}" r="4.5" fill="${BLUE}" stroke="#fff" stroke-width="2"/></g>`;
  b += `<text x="${x(st.meanMm + st.sdMm) + 10}" y="${by + 4}" font-size="12" fill="${INK2}">these ${st.n} people: ${f(st.meanMm, 1)} ± ${f(st.sdMm, 1)} mm (mean ± SD)</text>`;
  b += `<g><line x1="${x(11.2)}" y1="${by + 22}" x2="${x(12.2)}" y2="${by + 22}" stroke="${GREY}" stroke-width="2"/><line x1="${x(11.2)}" y1="${by + 17}" x2="${x(11.2)}" y2="${by + 27}" stroke="${GREY}" stroke-width="2"/><line x1="${x(12.2)}" y1="${by + 17}" x2="${x(12.2)}" y2="${by + 27}" stroke="${GREY}" stroke-width="2"/><circle cx="${x(11.7)}" cy="${by + 22}" r="4.5" fill="#fff" stroke="${GREY}" stroke-width="2"/></g>`;
  b += `<text x="${x(12.2) + 10}" y="${by + 26}" font-size="12" fill="${INK2}">published (Google): 11.7 ± 0.5 mm</text>`;
  b += `<text x="${ox + pw / 2}" y="${top + ph + 38}" font-size="12" fill="${INK2}" text-anchor="middle">implied horizontal iris diameter, mm (per person, photos at 12 and 16 ft)</text>`;
  b += `<text transform="translate(${ox - 40} ${top + ph / 2}) rotate(-90)" font-size="12" fill="${INK2}" text-anchor="middle">people</text>`;
  const title = 'Real people (Caltech CMDP): how much does iris size vary?';
  const subtitle = `From the app's iris landmarks, EXIF focal length and marked distance. SD ${f(st.sdMm, 2)} mm (${f(st.cvPct, 1)}%) includes measurement error.`;
  const footer = `Pinhole model; photos at 3.7 and 4.9 m, where a ±20 cm distance-reference error shifts values ≤ 5%. Thin-lens model: all values ~${f((1 - thinLensFactor) * 100, 0)}% lower.`;
  const footer2 = 'Data: Burgos-Artizzu, Ronchi, Perona (ECCV 2014), CC-BY. No dataset image is shown. /data/cmdp.json';
  const desc = `Histogram, measurement on a public dataset of ${st.n} real people. Implied iris diameter ${f(st.meanMm, 2)} ± ${f(st.sdMm, 2)} mm (mean ± SD), range ${f(st.minMm, 2)}–${f(st.maxMm, 2)} mm, 10th–90th percentile ${f(st.p10Mm, 2)}–${f(st.p90Mm, 2)} mm; published value 11.7 ± 0.5 mm. Bins of 0.25 mm: ` +
    bins.map((ss, i) => `${f(lo + i * bin, 2)}: ${ss.length}`).filter((s) => !s.endsWith(': 0')).join(', ') + '.';
  return frame('cmdp-iris', w, h, title, subtitle, desc, 'REAL PEOPLE · PUBLIC DATASET', b, footer, footer2);
}

writeFileSync(OUT_DIST, distanceChart());
writeFileSync(OUT_IRIS, irisChart());

console.log(JSON.stringify({
  people: subjects.length, photos: rows.length, exifPeople: exifSubjects.length, deltaAll, deltaLosoRange,
  withinNominalPct: r1(withinNominal * 100), withinCorrectedPct: r1(withinCorrected * 100),
  detection: json.detection.summary, eye: json.eyeCheck, scale: json.labelFreeScaleCheck,
  calibrated: json.calibrated, uncalibrated: json.uncalibrated, iris: json.impliedIrisDiameter,
}, null, 1));
