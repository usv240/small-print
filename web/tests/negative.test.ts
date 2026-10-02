// Negative controls for the recommendation logic: red flags must never turn into a readers recommendation.
// Inputs: a 312,732-case grid over every input recommend() reads (ages 18–90, the app's range) plus
// 3 × 100,000 seeded random inputs (general, myopia-targeted, out-of-range-targeted). The same checker
// writes these counts to public/data/negative-controls.json (bench-camera/negative-report.ts).
//
// The safety-question stop screens live in the UI (src/app.ts) and are covered by e2e/safety.spec.ts
// ("sudden change → stop screen, no result posted").

import { describe, expect, it } from 'vitest';
import { checkRecommendProperties } from '../bench-camera/negative-logic';
import { EYE_MIN_CONTRAST, EYE_PATCH_PX, eyePatchContrast } from '../src/camera/distance';

const run = checkRecommendProperties();
const prop = (id: string) => run.results.find((r) => r.id === id)!;

describe('negative controls: recommend() never hands out readers on a red flag', () => {
  it('checks over 600,000 deterministic inputs', () => {
    expect(run.inputs).toBeGreaterThan(600_000);
  });

  it('possible myopia (amplitude > Hofstetter max + 1.5 D), ages 40–90 → never readers', () => {
    const p = prop('myopia-40plus');
    expect(p.cases).toBeGreaterThan(100_000);
    expect(p.examples).toEqual([]);
    expect(p.violations).toBe(0);
  });

  // Was a real gap (4,252 violations at ages 35–39): the starter-pair rule fired from 35 but the
  // short-sight check only from 40. Fixed with MYOPIA_CHECK_MIN_AGE = 35 in recommend.ts.
  it('possible myopia at every age the app accepts (18–90) → never readers', () => {
    const p = prop('myopia-all-ages');
    expect(p.cases).toBeGreaterThan(100_000);
    expect(p.violations).toBe(0);
  });

  it('out of range (estimate rounds above +3.00) → never readers', () => {
    const p = prop('out-of-range-never-readers');
    expect(p.cases).toBeGreaterThan(50_000);
    expect(p.violations).toBe(0);
  });

  it("out of range and not flagged possible-myopia → 'refer' with the out-of-range flag", () => {
    const p = prop('out-of-range-refer-unless-myopia');
    expect(p.cases).toBeGreaterThan(50_000);
    expect(p.violations).toBe(0);
  });

  // KNOWN, not a safety failure: when an out-of-range input is ALSO flagged possible-myopia (ages 59+),
  // the myopia check runs first, so the outcome is 'no-readers' + 'possible-myopia' (the result screen
  // says "you may be short-sighted… an eye exam can tell you for sure"), not the literal 'refer'.
  // Still never readers (test above). Kept as it.fails so the strict wording stays honest.
  it.fails("out of range → outcome is exactly 'refer' (strict)", () => {
    expect(prop('out-of-range-refer').violations).toBe(0);
  });

  it('every readers outcome is a ready-made strength: +1.00…+3.00 in 0.25 steps, try-first pairs in range', () => {
    const p = prop('readers-in-stock-range');
    expect(p.cases).toBeGreaterThan(100_000);
    expect(p.violations).toBe(0);
  });
});

describe('negative controls: eye-visibility check (src/camera/distance.ts)', () => {
  // Synthetic 24×24 patches: what the check sees around an iris centre.
  const patch = (lum: (r: number) => number) => {
    const px = new Uint8ClampedArray(EYE_PATCH_PX * EYE_PATCH_PX * 4);
    const c = (EYE_PATCH_PX - 1) / 2;
    for (let i = 0; i < EYE_PATCH_PX * EYE_PATCH_PX; i++) {
      const v = lum(Math.hypot((i % EYE_PATCH_PX) - c, Math.floor(i / EYE_PATCH_PX) - c) / (EYE_PATCH_PX / 3));
      px.set([v, v, v, 255], i * 4);
    }
    return px;
  };
  const eye = (iris: number, white: number) => patch((r) => (r < 0.35 ? 10 : r < 1 ? iris : white)); // pupil, iris, sclera/lids

  it('accepts a visible eye, in good light and at 30% light', () => {
    expect(eyePatchContrast(eye(60, 170))).toBeGreaterThanOrEqual(EYE_MIN_CONTRAST);
    expect(eyePatchContrast(eye(18, 51))).toBeGreaterThanOrEqual(EYE_MIN_CONTRAST);
  });

  it('rejects covered eyes: black bar, flat skin, a lens with a top-to-bottom gradient', () => {
    expect(eyePatchContrast(patch(() => 0))).toBeLessThan(EYE_MIN_CONTRAST);
    expect(eyePatchContrast(patch(() => 160))).toBeLessThan(EYE_MIN_CONTRAST);
    const lens = new Uint8ClampedArray(EYE_PATCH_PX * EYE_PATCH_PX * 4);
    for (let i = 0; i < EYE_PATCH_PX * EYE_PATCH_PX; i++) { const v = 50 - Math.floor(i / EYE_PATCH_PX); lens.set([v, v, v + 4, 255], i * 4); }
    expect(eyePatchContrast(lens)).toBeLessThan(EYE_MIN_CONTRAST);
  });
});
