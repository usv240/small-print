// Turns the no-glasses measurements into a starting strength. The try-on check (tryon.ts) then
// confirms or corrects it with real lenses, so this only needs to land close enough to start.

import {
  DEPTH_OF_FOCUS_D, READERS_MAX_D, READERS_MIN_D, ageTableAdd40, addForWorkingDistance,
  dioptresFromMm, eyeAgeFromAmplitude, hofstetter, roundTo,
} from './optics';

export interface Measurements {
  age: number;
  /** Where the person habitually holds a phone or page to read (no glasses). */
  workingDistanceMm: number;
  /** Closest distance at which a constant-angle E (N6-equivalent at 40 cm) stayed clear; null if not reached. */
  nearPointMm: number | null;
  /** The E never became clear, even at the farthest distance the person could hold the phone. */
  nearPointBeyondReach: boolean;
  /** Farthest distance the person held the phone during the test. */
  reachMm: number;
  /** Correctly read N6-size E's at their working distance without glasses (null if not tested). */
  smallPrintAtWorkingDistance: boolean | null;
}

export type ReferReason = 'possible-myopia' | 'out-of-range' | 'inconsistent';
export type Outcome = 'readers' | 'no-readers' | 'refer';

export interface Recommendation {
  outcome: Outcome;
  /** Starting strength in dioptres (multiple of 0.25), or null when no readers are suggested. */
  strength: number | null;
  /** Two stocked strengths (0.50 steps) to try first at the rack. */
  tryFirst: number[];
  /** Measured accommodation, after the depth-of-focus correction (null if not measured). */
  amplitudeD: number | null;
  /** Fun "eye age" (null when the near point was out of reach). */
  eyeAge: number | null;
  flags: ReferReason[];
  /** Intermediate estimates, shown on the "how we got this" panel and used by the test bench. */
  detail: { fromAge: number; fromNearPoint: number | null; nearPointIsLowerBound: boolean };
}

/** Weight of the measured near point vs. the age table when both are available. */
export const NEAR_POINT_WEIGHT = 0.6;
/** From this age a starter pair (+1.00) can be offered, so the short-sight check must run from here too
 *  (negative-control property test: 4,252 violations at ages 35–39 when it started at 40). */
export const MYOPIA_CHECK_MIN_AGE = 35;
/** Disagreement (D) between the two estimates above which we flag possible uncorrected refractive error. */
export const DISAGREEMENT_D = 1.0;

/** Reading distances outside this range are clamped. Without glasses, people with presbyopia often
 *  stretch their arm to see; readers should be chosen for a comfortable distance, not that stretch. */
export const WORKING_DISTANCE_MM = { min: 250, max: 450 } as const;

export function recommend(m: Measurements): Recommendation {
  const workingMm = Math.min(WORKING_DISTANCE_MM.max, Math.max(WORKING_DISTANCE_MM.min, m.workingDistanceMm));
  const dWork = dioptresFromMm(workingMm);
  const fromAge = addForWorkingDistance(ageTableAdd40(m.age), workingMm);
  const flags: ReferReason[] = [];

  // A push-up near point overstates accommodation by half the depth of focus.
  let amplitudeD: number | null = null;
  let fromNearPoint: number | null = null;
  let lowerBound = false;
  if (m.nearPointMm !== null && !m.nearPointBeyondReach) {
    amplitudeD = Math.max(0, dioptresFromMm(m.nearPointMm) - DEPTH_OF_FOCUS_D / 2);
    // Keep half of the accommodation in reserve, so the working distance sits in the middle of the clear range.
    fromNearPoint = dWork - amplitudeD / 2;
  } else if (m.nearPointBeyondReach) {
    const maxAmplitude = Math.max(0, dioptresFromMm(m.reachMm) - DEPTH_OF_FOCUS_D / 2);
    fromNearPoint = dWork - maxAmplitude / 2;
    lowerBound = true;
  }

  // Far more close-up focus than anyone that age has: likely short-sighted, and readers would blur things.
  const expected = hofstetter(m.age);
  if (amplitudeD !== null && m.age >= MYOPIA_CHECK_MIN_AGE && amplitudeD > expected.max + 1.5) flags.push('possible-myopia');

  let estimate: number;
  if (fromNearPoint === null) estimate = fromAge;
  else if (lowerBound) estimate = Math.max(fromAge, fromNearPoint);
  else estimate = NEAR_POINT_WEIGHT * fromNearPoint + (1 - NEAR_POINT_WEIGHT) * fromAge;

  if (fromNearPoint !== null && !lowerBound && Math.abs(fromNearPoint - fromAge) > DISAGREEMENT_D) flags.push('inconsistent');

  const eyeAge = amplitudeD === null ? null : Math.round(eyeAgeFromAmplitude(amplitudeD));
  const detail = { fromAge, fromNearPoint, nearPointIsLowerBound: lowerBound };
  const strength = roundTo(estimate, 0.25);

  if (flags.includes('possible-myopia') || (m.smallPrintAtWorkingDistance && strength < READERS_MIN_D)) {
    return { outcome: 'no-readers', strength: null, tryFirst: [], amplitudeD, eyeAge, flags, detail };
  }
  if (strength < READERS_MIN_D) {
    // Struggles with small print but needs less than +1.00: the lowest stocked pair is the place to start.
    if (m.smallPrintAtWorkingDistance === false && m.age >= 35) {
      return { outcome: 'readers', strength: READERS_MIN_D, tryFirst: [READERS_MIN_D, 1.5], amplitudeD, eyeAge, flags, detail };
    }
    return { outcome: 'no-readers', strength: null, tryFirst: [], amplitudeD, eyeAge, flags, detail };
  }
  if (strength > READERS_MAX_D) {
    flags.push('out-of-range');
    return { outcome: 'refer', strength: null, tryFirst: [], amplitudeD, eyeAge, flags, detail };
  }
  return { outcome: 'readers', strength, tryFirst: bracket(strength), amplitudeD, eyeAge, flags, detail };
}

/** The two 0.50-step strengths around an estimate (stocked steps in most low-cost programmes). */
export function bracket(strength: number): number[] {
  const lo = Math.max(READERS_MIN_D, Math.floor(strength * 2) / 2);
  const hi = Math.min(READERS_MAX_D, Math.ceil(strength * 2) / 2);
  return lo === hi ? [lo] : [lo, hi];
}
