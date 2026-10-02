// Negative controls for the recommendation logic: red flags must never become a readers recommendation.
// Pure and deterministic (seeded). Used by tests/negative.test.ts (assertions) and by
// bench-camera/negative-report.ts (writes the same counts to public/data/negative-controls.json).
//
// Inputs: a full grid over everything recommend() reads, plus three seeded random samples (general,
// myopia-targeted, out-of-range-targeted). Each property is checked on every input that meets its
// precondition; the precondition is worked out here from the raw inputs and the published formulas
// (src/core/optics.ts), not read back from recommend()'s own flags.

import { MYOPIA_CHECK_MIN_AGE, NEAR_POINT_WEIGHT, WORKING_DISTANCE_MM, recommend, type Measurements, type Recommendation } from '../src/core/recommend';
import { DEPTH_OF_FOCUS_D, READERS_MAX_D, READERS_MIN_D, addForWorkingDistance, ageTableAdd40, hofstetter, roundTo } from '../src/core/optics';

/** Ages the app accepts (src/app.ts age slider). */
export const APP_AGES = { min: 18, max: 90 } as const;
/** recommend() flags possible myopia when the measured amplitude exceeds Hofstetter's maximum by this much. */
export const MYOPIA_MARGIN_D = 1.5;
export const SEED = 20261003;
export const RANDOM_N = 100_000;

export interface PropertyResult {
  id: string;
  property: string;
  cases: number;
  violations: number;
  /** Up to 5 violating inputs with what recommend() returned. */
  examples: { input: Measurements; outcome: string; strength: number | null; flags: string[] }[];
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Measured accommodation (D) from a push-up near point, as recommend() defines it; null if not measured. */
export function measuredAmplitude(m: Measurements): number | null {
  if (m.nearPointMm === null || m.nearPointBeyondReach) return null;
  return Math.max(0, 1000 / m.nearPointMm - DEPTH_OF_FOCUS_D / 2);
}

/** Starting estimate (D, before rounding) from the published method: age table shifted to the working
 *  distance, blended with the near-point estimate (60/40), or at least the age table when out of reach. */
export function estimateD(m: Measurements): number {
  const wm = Math.min(WORKING_DISTANCE_MM.max, Math.max(WORKING_DISTANCE_MM.min, m.workingDistanceMm));
  const dWork = 1000 / wm;
  const fromAge = addForWorkingDistance(ageTableAdd40(m.age), wm);
  const a = measuredAmplitude(m);
  if (a !== null) return NEAR_POINT_WEIGHT * (dWork - a / 2) + (1 - NEAR_POINT_WEIGHT) * fromAge;
  if (m.nearPointBeyondReach) {
    const maxA = Math.max(0, 1000 / m.reachMm - DEPTH_OF_FOCUS_D / 2);
    return Math.max(fromAge, dWork - maxA / 2);
  }
  return fromAge;
}

export const isPossibleMyopia = (m: Measurements) => {
  const a = measuredAmplitude(m);
  return a !== null && a > hofstetter(m.age).max + MYOPIA_MARGIN_D + 1e-9;
};
/** Rounded starting strength above the +3.00 that ready-made readers cover. */
export const isOutOfRange = (m: Measurements) => roundTo(estimateD(m), 0.25) > READERS_MAX_D + 1e-9;

// ---------- inputs ----------

function* gridInputs(): Generator<Measurements> {
  const nearPoints: (number | 'beyond' | 'none')[] = ['beyond', 'none'];
  for (let i = 0; i < 40; i++) nearPoints.push(Math.round(50 * (2000 / 50) ** (i / 39))); // 50 mm … 2 m, log-spaced
  for (let age = APP_AGES.min; age <= APP_AGES.max; age++) {
    for (let wd = 100; wd <= 900; wd += 50) {
      for (const np of nearPoints) {
        for (const sp of [true, false, null]) {
          for (const reach of [Math.max(wd, 450), 1000]) {
            yield {
              age, workingDistanceMm: wd,
              nearPointMm: typeof np === 'number' ? np : null,
              nearPointBeyondReach: np === 'beyond',
              reachMm: reach,
              smallPrintAtWorkingDistance: sp,
            };
          }
        }
      }
    }
  }
}

function randomInput(rand: () => number, target: 'general' | 'myopia' | 'out-of-range'): Measurements {
  const age = target === 'out-of-range'
    ? 50 + Math.floor(rand() * (APP_AGES.max - 50 + 1))
    : APP_AGES.min + Math.floor(rand() * (APP_AGES.max - APP_AGES.min + 1));
  const workingDistanceMm = target === 'out-of-range' ? 120 + rand() * 330 : 100 + rand() * 800;
  const reachMm = Math.max(workingDistanceMm, 300 + rand() * 700);
  const r = rand();
  const smallPrintAtWorkingDistance = r < 0.45 ? true : r < 0.9 ? false : null;
  let nearPointMm: number | null = null;
  let nearPointBeyondReach = false;
  if (target === 'myopia') {
    // Measured amplitude 0.01–12 D above the possible-myopia threshold for this age.
    const a = hofstetter(age).max + MYOPIA_MARGIN_D + 0.01 + rand() * 12;
    nearPointMm = 1000 / (a + DEPTH_OF_FOCUS_D / 2);
  } else if (target === 'out-of-range') {
    const m = rand();
    if (m < 0.5) nearPointBeyondReach = true;
    else if (m < 0.9) nearPointMm = 400 + rand() * 1600; // far near point: little accommodation left
  } else {
    const m = rand();
    if (m < 0.6) nearPointMm = 50 * (2000 / 50) ** rand();
    else if (m < 0.85) nearPointBeyondReach = true;
  }
  return { age, workingDistanceMm, nearPointMm, nearPointBeyondReach, reachMm, smallPrintAtWorkingDistance };
}

export function* allInputs(randomN: number, seed: number): Generator<{ m: Measurements; source: string }> {
  for (const m of gridInputs()) yield { m, source: 'grid' };
  const rand = mulberry32(seed);
  for (const target of ['general', 'myopia', 'out-of-range'] as const) {
    for (let i = 0; i < randomN; i++) yield { m: randomInput(rand, target), source: `random-${target}` };
  }
}

// ---------- properties ----------

interface Prop {
  id: string;
  property: string;
  applies: (m: Measurements) => boolean;
  holds: (r: Recommendation, m: Measurements) => boolean;
}

const inStock = (d: number) => d >= READERS_MIN_D - 1e-9 && d <= READERS_MAX_D + 1e-9;

export const PROPERTIES: Prop[] = [
  {
    id: 'myopia-40plus',
    property: 'Possible myopia (measured amplitude > Hofstetter max for age + 1.5 D), ages 40–90 → outcome is never readers',
    applies: (m) => m.age >= 40 && isPossibleMyopia(m),
    holds: (r) => r.outcome !== 'readers',
  },
  {
    id: 'myopia-all-ages',
    property: 'Possible myopia (measured amplitude > Hofstetter max for age + 1.5 D), every age the app accepts (18–90) → outcome is never readers',
    applies: (m) => isPossibleMyopia(m),
    holds: (r) => r.outcome !== 'readers',
  },
  {
    id: 'out-of-range-never-readers',
    property: 'Out of range (starting estimate rounds above +3.00) → outcome is never readers',
    applies: isOutOfRange,
    holds: (r) => r.outcome !== 'readers',
  },
  {
    id: 'out-of-range-refer',
    property: "Out of range (starting estimate rounds above +3.00) → outcome is exactly 'refer' with the out-of-range flag",
    applies: isOutOfRange,
    holds: (r) => r.outcome === 'refer' && r.flags.includes('out-of-range'),
  },
  {
    id: 'out-of-range-refer-unless-myopia',
    property: "Out of range and no possible-myopia flag → outcome 'refer' with the out-of-range flag",
    applies: (m) => isOutOfRange(m) && !(m.age >= MYOPIA_CHECK_MIN_AGE && isPossibleMyopia(m)),
    holds: (r) => r.outcome === 'refer' && r.flags.includes('out-of-range'),
  },
  {
    id: 'readers-in-stock-range',
    property: 'Whenever the outcome is readers: strength and every try-first pair are within +1.00…+3.00 and on 0.25 D steps',
    applies: () => true, // filtered on the outcome below
    holds: (r) => r.outcome !== 'readers' || (
      r.strength !== null && inStock(r.strength) && Math.abs(r.strength * 4 - Math.round(r.strength * 4)) < 1e-9 &&
      r.tryFirst.length > 0 && r.tryFirst.every(inStock)
    ),
  },
];

export function checkRecommendProperties(randomN = RANDOM_N, seed = SEED): { inputs: number; bySource: Record<string, number>; results: PropertyResult[] } {
  const results: PropertyResult[] = PROPERTIES.map((p) => ({ id: p.id, property: p.property, cases: 0, violations: 0, examples: [] }));
  const bySource: Record<string, number> = {};
  let inputs = 0;
  for (const { m, source } of allInputs(randomN, seed)) {
    inputs++;
    bySource[source] = (bySource[source] ?? 0) + 1;
    const r = recommend(m);
    PROPERTIES.forEach((p, i) => {
      if (!p.applies(m)) return;
      if (p.id === 'readers-in-stock-range' && r.outcome !== 'readers') return; // cases = readers outcomes
      const res = results[i];
      res.cases++;
      if (!p.holds(r, m)) {
        res.violations++;
        if (res.examples.length < 5) res.examples.push({ input: m, outcome: r.outcome, strength: r.strength, flags: r.flags });
      }
    });
  }
  return { inputs, bySource, results };
}

/** Breaks the violations of one property down by age (for the report). */
export function violationsByAge(id: string, randomN = RANDOM_N, seed = SEED): Record<number, number> {
  const p = PROPERTIES.find((x) => x.id === id)!;
  const out: Record<number, number> = {};
  for (const { m } of allInputs(randomN, seed)) {
    if (!p.applies(m)) continue;
    const r = recommend(m);
    if (p.id === 'readers-in-stock-range' && r.outcome !== 'readers') continue;
    if (!p.holds(r, m)) out[m.age] = (out[m.age] ?? 0) + 1;
  }
  return out;
}
