// SIMULATION ONLY. The strategies the bench compares. Small Print's are the shipped functions from
// src/core, called unchanged; "what-if" variants are clearly marked and are NOT what the app does.

import { DEPTH_OF_FOCUS_D, READERS_MAX_D, READERS_MIN_D, addForWorkingDistance, ageTableAdd40, hofstetter, roundTo } from '../src/core/optics';
import { type Measurements, type Recommendation, recommend } from '../src/core/recommend';
import { CENTRE_TOLERANCE_D, type TryOnMeasurement, type TryOnResult, assessTryOn } from '../src/core/tryon';
import { type Person, round025 } from './model';

export type DecisionKind = 'readers' | 'none' | 'refer';

export interface Decision {
  kind: DecisionKind;
  /** Chosen strength (D) when kind is 'readers'. */
  strength: number | null;
  /** The app raised a caution flag (e.g. 'inconsistent') while still suggesting readers. */
  flagged: boolean;
  /** Pairs tried at the rack (try-on strategies only). */
  tries: number;
}

export const readers = (strength: number, flagged = false, tries = 0): Decision => ({ kind: 'readers', strength, flagged, tries });
export const none = (tries = 0): Decision => ({ kind: 'none', strength: null, flagged: false, tries });
export const refer = (tries = 0): Decision => ({ kind: 'refer', strength: null, flagged: true, tries });

/** Clip a raw strength to what ready-made readers cover: below +1.00 → none, above +3.00 → refer. */
function stocked(raw: number): Decision {
  const s = round025(raw);
  if (s < READERS_MIN_D) return none();
  if (s > READERS_MAX_D) return refer();
  return readers(s);
}

// ---------------------------------------------------------------- baselines

/** Baseline A1: Stevens (2019) age table for a 40 cm reading distance. No measurement at all. */
export function ageTable40(p: Person): Decision {
  const add = ageTableAdd40(p.age);
  return add === 0 ? none() : readers(add);
}

/** Baseline A2: the same table shifted to the camera-measured working distance (no near-point test). */
export function ageTableAtDistance(p: Person, m: Measurements): Decision {
  const add = ageTableAdd40(p.age);
  if (add === 0) return none();
  return stocked(addForWorkingDistance(add, m.workingDistanceMm));
}

/** Baseline B: printed rack card. Modelled as an ideal blur meter at the distance it is held: the line the
 *  person can just read reports the dioptres of blur there, and the card labels it as blur + reserveD.
 *  Reading the smallest line means "+1.00" (the card's lowest strength). Anything past the largest line
 *  (+3.00 here) cannot be served by ready-made readers → counted as a referral. */
export function rackCard(blurD: number, reserveD: number): Decision {
  const s = round025(blurD + reserveD);
  if (s > READERS_MAX_D) return refer();
  return readers(Math.max(READERS_MIN_D, s));
}

// ---------------------------------------------------------------- Small Print (shipped code)

/** Map recommend() to a decision. 'no-readers' with a possible-myopia flag means "see an eye doctor". */
export function fromRecommendation(r: Recommendation): Decision {
  if (r.outcome === 'refer') return refer();
  if (r.outcome === 'no-readers') return r.flags.includes('possible-myopia') ? refer() : none();
  return readers(r.strength!, r.flags.length > 0);
}

/** Where W sits relative to the middle of the measured clear range, using the same best case the app
 *  uses when the far end is beyond reach. > 0: more power needed. */
export function offFromMiddle(t: TryOnMeasurement): number {
  const dWork = 1000 / t.workingDistanceMm;
  const dNear = 1000 / t.nearLimitMm;
  const dFar = t.farLimitMm === null ? 1000 / t.reachMm : 1000 / t.farLimitMm;
  return dWork - (dNear + dFar) / 2;
}

function nearestIndex(stock: number[], x: number, direction: number): number {
  let best = 0;
  for (let i = 1; i < stock.length; i++) {
    const di = Math.abs(stock[i] - x);
    const db = Math.abs(stock[best] - x);
    if (di < db - 1e-9 || (Math.abs(di - db) <= 1e-9 && direction > 0)) best = i;
  }
  return best;
}

export const STOCK_050 = [1.0, 1.5, 2.0, 2.5, 3.0];
export const STOCK_025 = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0];

/** Rack protocol: put on a pair, run the try-on check, follow its suggested change (snapped to what is
 *  stocked, at least one step) until 'good' or maxTries. Without a 'good', keep the best-centred pair
 *  tried. 'weaker' on the weakest pair → no readers; 'stronger' on the strongest → refer. */
export function tryOnAtRack(
  start: number,
  stock: number[],
  measure: (strength: number) => TryOnMeasurement,
  assess: (t: TryOnMeasurement) => TryOnResult,
  maxTries = 3,
): Decision {
  let idx = nearestIndex(stock, start, 0);
  const tried: { idx: number; off: number }[] = [];
  for (let k = 0; k < maxTries; k++) {
    const t = measure(stock[idx]);
    const r = assess(t);
    if (r.verdict === 'good') return readers(stock[idx], false, k + 1);
    tried.push({ idx, off: Math.abs(offFromMiddle(t)) });
    let next = nearestIndex(stock, stock[idx] + r.change, r.change);
    if (next === idx) next += Math.sign(r.change);
    if (next < 0) return none(k + 1);
    if (next >= stock.length) return refer(k + 1);
    if (tried.some((x) => x.idx === next)) break;
    idx = next;
  }
  const best = tried.reduce((a, b) => (b.off < a.off ? b : a));
  return readers(stock[best.idx], false, tried.length);
}

/** First pair to put on: the weaker of the app's two "try first" pairs (0.50 stock), or the starting
 *  strength itself when 0.25 steps are stocked. */
export const firstPair = (r: Recommendation, stock: number[]) => (stock === STOCK_050 ? r.tryFirst[0] : r.strength!);

// ---------------------------------------------------------------- what-if variants (NOT shipped)

/** WHAT-IF: recommend() with a different near-point weight. Re-uses recommend()'s own intermediate
 *  estimates and repeats its decision rules; with w = NEAR_POINT_WEIGHT it must equal recommend(). */
export function startWithWeight(m: Measurements, w: number): Decision {
  const r = recommend(m);
  if (r.flags.includes('possible-myopia')) return refer();
  const { fromAge, fromNearPoint, nearPointIsLowerBound } = r.detail;
  let estimate: number;
  if (fromNearPoint === null) estimate = fromAge;
  else if (nearPointIsLowerBound) estimate = Math.max(fromAge, fromNearPoint);
  else estimate = w * fromNearPoint + (1 - w) * fromAge;
  const strength = roundTo(estimate, 0.25);
  if (m.smallPrintAtWorkingDistance && strength < READERS_MIN_D) return none();
  if (strength < READERS_MIN_D) return m.smallPrintAtWorkingDistance === false && m.age >= 35 ? readers(READERS_MIN_D) : none();
  if (strength > READERS_MAX_D) return refer();
  return readers(strength, r.flags.length > 0);
}

/** WHAT-IF: flag possible myopia at a smaller margin above Hofstetter's maximum (shipped: 1.5 D).
 *  Only margins ≤ 1.5 are meaningful here (it can add referrals, not remove them). */
export function flaggedMyopiaAtMargin(m: Measurements, marginD: number): boolean {
  const r = recommend(m);
  return r.amplitudeD !== null && m.age >= 40 && r.amplitudeD > hofstetter(m.age).max + marginD;
}

/** WHAT-IF: assessTryOn() but, when the far end is beyond arm's reach, estimate it from the lens power
 *  (an eye without distance error sees clearly out to a demand of strength − DOF/2) instead of assuming
 *  it sits exactly at arm's length. Everything else is the shipped function. */
export function assessTryOnWithFarEstimate(t: TryOnMeasurement): TryOnResult {
  const base = assessTryOn(t);
  if (t.farLimitMm !== null) return base;
  const dWork = 1000 / t.workingDistanceMm;
  const dNear = 1000 / t.nearLimitMm;
  if (dWork > dNear) return base;
  const farEstimate = Math.min(1000 / t.reachMm, t.strength - DEPTH_OF_FOCUS_D / 2);
  const off = dWork - (dNear + farEstimate) / 2;
  const step = (d: number) => Math.max(0.25, roundTo(d, 0.25));
  if (off > CENTRE_TOLERANCE_D) return { ...base, verdict: 'stronger', change: step(off) };
  if (off < -CENTRE_TOLERANCE_D) return { ...base, verdict: 'weaker', change: -step(-off) };
  return { ...base, verdict: 'good', change: 0 };
}

/** WHAT-IF protocol (uses the shipped assessTryOn unchanged): when a pair is 'good' only because its far
 *  end is beyond arm's reach (so the middle of the clear range is unknown), don't accept it yet: put on a
 *  pair 0.50 D stronger, which pulls the far end in by 0.50 D. Readers shift the whole clear range rigidly by
 *  their power, so one pair with both ends measured gives the right power for every pair; its suggested
 *  change is then trusted. Same max-tries budget as the shipped protocol. */
export function tryOnAtRackWithProbe(
  start: number,
  stock: number[],
  measure: (strength: number) => TryOnMeasurement,
  assess: (t: TryOnMeasurement) => TryOnResult,
  maxTries = 3,
): Decision {
  let idx = nearestIndex(stock, start, 0);
  const tried: { idx: number; off: number }[] = [];
  const uncertain = new Set<number>(); // pairs that were 'good' only in the best case
  let trusted = false; // current pair was suggested by a fully measured clear range
  for (let k = 0; k < maxTries; k++) {
    const t = measure(stock[idx]);
    const r = assess(t);
    if (r.verdict === 'good') {
      if (t.farLimitMm !== null || trusted) return readers(stock[idx], false, k + 1);
      // Best-case 'good' only. If an earlier pair was already best-case 'good', probing further taught us
      // nothing: keep the weakest such pair (least plus). Otherwise probe one 0.50 D step stronger.
      if (uncertain.size > 0) return readers(stock[Math.min(...uncertain)], false, k + 1);
      const probe = nearestIndex(stock, stock[idx] + 0.5, 1);
      if (k === maxTries - 1 || probe === idx) return readers(stock[idx], false, k + 1);
      uncertain.add(idx);
      tried.push({ idx, off: 0 });
      idx = probe;
      continue;
    }
    trusted = t.farLimitMm !== null;
    tried.push({ idx, off: Math.abs(offFromMiddle(t)) });
    let next = nearestIndex(stock, stock[idx] + r.change, r.change);
    if (next === idx) next += Math.sign(r.change);
    if (next < 0) return none(k + 1);
    if (next >= stock.length) return refer(k + 1);
    if (uncertain.has(next)) return readers(stock[next], false, k + 1); // measured range confirms the earlier pair
    if (tried.some((x) => x.idx === next)) break;
    idx = next;
  }
  const best = tried.reduce((a, b) => (b.off < a.off ? b : a));
  return readers(stock[best.idx], false, tried.length);
}

/** Reference only: the true ideal pair, if the shop stocks 0.50 steps (ceiling for "exact" with that stock). */
export function oracle050(p: Person): Decision {
  if (p.truth === 'refer') return refer();
  if (p.truth === 'none') return none();
  return readers(Math.min(READERS_MAX_D, Math.max(READERS_MIN_D, Math.round(p.idealRoundedD * 2) / 2)));
}
