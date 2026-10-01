// Confirms a candidate pair of readers by measuring the person's range of clear vision while wearing it.
//
// Clinical rule (Stevens 2019): with the right power, the usual reading distance sits in the middle of the
// range of clear vision. With readers of power A on an eye with accommodation AA, the clear range in
// dioptres is [A, A + AA], so its midpoint is A + AA/2 and the rule is exactly "keep half the
// accommodation in reserve". We measure both ends with the camera, so neither AA nor the eye's depth
// of focus has to be known: depth of focus widens both ends equally and leaves the midpoint unchanged.

import { dioptresFromMm, roundTo } from './optics';

export interface TryOnMeasurement {
  /** Strength printed on the pair being tried. */
  strength: number;
  workingDistanceMm: number;
  /** Closest distance at which the E stayed clear with the pair on. */
  nearLimitMm: number;
  /** Farthest distance at which the E stayed clear; null if it was still clear at arm's length. */
  farLimitMm: number | null;
  /** Farthest distance reached while measuring (used when farLimitMm is null). */
  reachMm: number;
}

export type TryOnVerdict = 'good' | 'stronger' | 'weaker';

export interface TryOnResult {
  verdict: TryOnVerdict;
  /** Signed correction to try next, in dioptres (multiple of 0.25; 0 when good). */
  change: number;
  /** Where the working distance falls in the clear range: 0 = near end, 1 = far end, 0.5 = middle. */
  position: number | null;
  rangeD: { near: number; far: number | null };
  /** Still sharp at arm's length, so this pair could be slightly too weak without us being able to tell.
   *  Readers shift the clear range rigidly, so trying one stronger pair (whose far end will be measurable)
   *  settles it: if that pair is "too strong", this one was right. */
  farEndUnknown: boolean;
}

/** Strength step suggested when the far end was out of reach. */
export const CONFIRM_STEP_D = 0.5;

/** How far (D) the working distance may sit from the middle of the clear range before we suggest a change. */
export const CENTRE_TOLERANCE_D = 0.375;

export function assessTryOn(t: TryOnMeasurement): TryOnResult {
  const dWork = dioptresFromMm(t.workingDistanceMm);
  const dNear = dioptresFromMm(t.nearLimitMm);
  const dFar = t.farLimitMm === null ? null : dioptresFromMm(t.farLimitMm);
  const rangeD = { near: dNear, far: dFar };

  const res = (verdict: TryOnVerdict, change: number, position: number | null, farEndUnknown = false): TryOnResult =>
    ({ verdict, change, position, rangeD, farEndUnknown });

  // Can't see at the working distance at all: too weak (closer than near limit) or too strong (beyond far limit).
  if (dWork > dNear) return res('stronger', step(dWork - dNear + 0.25), 0);
  if (dFar !== null && dWork < dFar) return res('weaker', -step(dFar - dWork + 0.25), 1);

  if (dFar === null) {
    // Still clear at arm's length, so the far end is at most dReach. If the working distance is
    // nearer than the middle even in the best case, the pair is too weak. Otherwise it may be right,
    // or slightly weak: we can't tell without the far end, so the UI offers one stronger pair to confirm.
    const dReach = dioptresFromMm(t.reachMm);
    const bestMid = (dNear + dReach) / 2;
    if (dWork - bestMid > CENTRE_TOLERANCE_D) return res('stronger', step(dWork - bestMid), null);
    return res('good', 0, null, true);
  }

  const mid = (dNear + dFar) / 2;
  const position = dNear === dFar ? 0.5 : (dNear - dWork) / (dNear - dFar);
  const off = dWork - mid; // > 0: working distance nearer than the middle, so more power is needed
  if (off > CENTRE_TOLERANCE_D) return res('stronger', step(off), position);
  if (off < -CENTRE_TOLERANCE_D) return res('weaker', -step(-off), position);
  return res('good', 0, position);
}

/** Round a correction up to at least one 0.25 step. */
const step = (d: number) => Math.max(0.25, roundTo(d, 0.25));
