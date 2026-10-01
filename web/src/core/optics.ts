// Optics and vision-science helpers. Pure functions with units in the names.
// Every constant cites where it comes from; /how-it-works.html explains them in plain language.

/** Mean horizontal visible iris diameter of adults, about 11.7 ± 0.5 mm (Google MediaPipe Iris, 2020).
 *  Only used before camera calibration: calibrating at a known distance cancels it out. */
export const IRIS_DIAMETER_MM = 11.7;

/** ISO/IEC 7810 ID-1 card (bank card, ID card, library card): 85.60 × 53.98 mm. */
export const ID1_CARD = { widthMm: 85.6, heightMm: 53.98 } as const;

/** One M-unit: a letter that subtends 5 arcmin at 1 m is 1.454 mm tall (Sloan & Habel). */
export const M_UNIT_MM = 1.454;

/** Point size of the near-vision target. N6 is the standard "small print" line (Stevens 2019). */
export const TARGET_PRINT_N = 6;

/** Ready-made readers are mostly sold from +1.00 to +3.00 (Stevens 2019: "most people with
 *  presbyopia do not need spectacles with powers of less than +1.00 or more than +3.00"). */
export const READERS_MIN_D = 1.0;
export const READERS_MAX_D = 3.0;

/** Total depth of focus of the eye for small letters, in dioptres. A push-up near point lands
 *  about half of this closer than the true accommodative limit. Typical published values are
 *  0.3–1.0 D depending on pupil size; we use 0.5 D and expose it as an assumption. */
export const DEPTH_OF_FOCUS_D = 0.5;

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const dioptresFromMm = (mm: number) => 1000 / mm;
export const mmFromDioptres = (d: number) => 1000 / d;
export const roundTo = (x: number, step: number) => Math.round(x / step) * step;

/** N-point print size in M-units: 8-point print is about 1M, so N/8. */
export const nPointToMUnits = (n: number) => n / 8;

/** Physical letter height (mm) of N-point print, e.g. N6 ≈ 1.09 mm. */
export const nPointHeightMm = (n: number) => nPointToMUnits(n) * M_UNIT_MM;

/** Height (mm) of a 5×5 optotype (tumbling E) whose stroke subtends 10^logMAR arcmin at distanceMm. */
export function optotypeHeightMm(distanceMm: number, logMAR: number): number {
  const letterArcmin = 5 * 10 ** logMAR;
  const angleRad = (letterArcmin / 60) * (Math.PI / 180);
  return 2 * distanceMm * Math.tan(angleRad / 2);
}

/** logMAR of a letter of physical height heightMm seen from distanceMm. */
export function logMARForHeight(heightMm: number, distanceMm: number): number {
  const angleArcmin = 2 * Math.atan(heightMm / (2 * distanceMm)) * (180 / Math.PI) * 60;
  return Math.log10(angleArcmin / 5);
}

/** Hofstetter (1950) expected amplitude of accommodation in dioptres for an age in years. */
export function hofstetter(age: number) {
  return {
    min: Math.max(0, 15 - 0.25 * age),
    mean: Math.max(0, 18.5 - 0.3 * age),
    max: Math.max(0, 25 - 0.4 * age),
  };
}

/** "Eye age" for fun: the age whose Hofstetter mean amplitude matches the measured amplitude. */
export function eyeAgeFromAmplitude(amplitudeD: number): number {
  return clamp((18.5 - amplitudeD) / 0.3, 10, 75);
}

/** Starting reading addition for a 40 cm working distance, by age.
 *  Stevens S. How to prescribe spectacles for near vision. Community Eye Health J 2019;32(107):47, Table 2. */
export function ageTableAdd40(age: number): number {
  if (age < 35) return 0;
  if (age <= 45) return 1.0;
  if (age <= 50) return 1.5;
  if (age <= 55) return 2.0;
  return 2.5;
}

/** Shift an addition worked out for 40 cm to another working distance (pure dioptric difference;
 *  matches the clinical rule of +0.50 at 33 cm and −0.50 at 50 cm). */
export const addForWorkingDistance = (add40: number, workingDistanceMm: number) =>
  add40 + (dioptresFromMm(workingDistanceMm) - 2.5);
