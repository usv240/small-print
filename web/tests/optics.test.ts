import { describe, expect, it } from 'vitest';
import {
  addForWorkingDistance, ageTableAdd40, eyeAgeFromAmplitude, hofstetter, logMARForHeight,
  nPointHeightMm, optotypeHeightMm,
} from '../src/core/optics';

describe('letter sizes', () => {
  it('a 1M letter is 1.454 mm and subtends 5 arcmin at 1 m (logMAR 0)', () => {
    expect(optotypeHeightMm(1000, 0)).toBeCloseTo(1.454, 3);
    expect(logMARForHeight(1.454, 1000)).toBeCloseTo(0, 3);
  });
  it('N6 print is about 1.09 mm, i.e. logMAR ≈ 0.27 at 40 cm', () => {
    expect(nPointHeightMm(6)).toBeCloseTo(1.09, 2);
    expect(logMARForHeight(nPointHeightMm(6), 400)).toBeCloseTo(0.273, 2);
  });
  it('height and logMAR are inverses', () => {
    for (const d of [250, 400, 600]) for (const l of [-0.1, 0.3, 1.0]) {
      expect(logMARForHeight(optotypeHeightMm(d, l), d)).toBeCloseTo(l, 6);
    }
  });
});

describe('Hofstetter (1950) amplitude of accommodation', () => {
  it('matches the published worked example at age 50: 2.5 / 3.5 / 5.0 D', () => {
    const a = hofstetter(50);
    expect(a.min).toBeCloseTo(2.5);
    expect(a.mean).toBeCloseTo(3.5);
    expect(a.max).toBeCloseTo(5.0);
  });
  it('never goes negative', () => expect(hofstetter(80).mean).toBe(0));
  it('eye age inverts the mean curve', () => expect(eyeAgeFromAmplitude(hofstetter(42).mean)).toBeCloseTo(42));
});

describe('age table (Stevens 2019, Table 2)', () => {
  it.each([[38, 1.0], [45, 1.0], [46, 1.5], [50, 1.5], [53, 2.0], [60, 2.5]])('age %i → +%f at 40 cm', (age, add) => {
    expect(ageTableAdd40(age)).toBe(add);
  });
  it('shifts by the dioptric difference: about +0.50 at 33 cm and −0.50 at 50 cm', () => {
    expect(addForWorkingDistance(2, 333) - 2).toBeCloseTo(0.5, 1);
    expect(addForWorkingDistance(2, 500) - 2).toBeCloseTo(-0.5, 6);
  });
});
