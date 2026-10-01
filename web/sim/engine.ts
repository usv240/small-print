// SIMULATION ONLY. Runs virtual people through every strategy and scores them against the simulated truth.

import { type Measurements, recommend } from '../src/core/recommend';
import { assessTryOn } from '../src/core/tryon';
import {
  DEFAULT_NOISE, DEFAULT_POPULATION, type NoiseConfig, Observer, type Person, type PopulationConfig,
  blurAtD, makePopulation, measureWithReaders, measureWithoutGlasses, mixSeed, sharedDistanceError,
} from './model';
import {
  type Decision, STOCK_025, STOCK_050, ageTable40, ageTableAtDistance, assessTryOnWithFarEstimate, firstPair,
  fromRecommendation, oracle050, rackCard, startWithWeight, tryOnAtRack, tryOnAtRackWithProbe,
} from './strategies';

export const CARD_DISTANCE_M = 0.356; // 14 inches, the distance printed on rack cards

export interface StrategyInfo {
  id: StrategyId;
  label: string;
  group: 'baseline' | 'small-print' | 'what-if' | 'reference';
  description: string;
}

export const STRATEGIES = [
  { id: 'age40', label: 'Age table (40 cm)', group: 'baseline', description: 'Stevens 2019 age table for 40 cm; no measurement.' },
  { id: 'ageW', label: 'Age table + measured distance', group: 'baseline', description: 'Same table shifted to the camera-measured working distance; no near-point test.' },
  { id: 'card14', label: 'Rack card at 14 in', group: 'baseline', description: 'Printed card held exactly at 35.6 cm as instructed (ignores where the person actually reads).' },
  { id: 'cardOwn', label: 'Rack card where they read', group: 'baseline', description: 'Printed card held around the person\'s own reading distance (SD 10%), read as if at 14 in.' },
  { id: 'spStart', label: 'Small Print start', group: 'small-print', description: 'recommend() on simulated noisy camera measurements, buying that exact strength (0.25 stock).' },
  { id: 'spTry050', label: 'Small Print + try-on (0.50 stock)', group: 'small-print', description: 'recommend() then assessTryOn() at a rack with 0.50 steps, max 3 pairs.' },
  { id: 'spTry025', label: 'Small Print + try-on (0.25 stock)', group: 'small-print', description: 'recommend() then assessTryOn() at a rack with 0.25 steps, max 3 pairs.' },
  { id: 'wiProbe050', label: 'What-if: try-on + probe pair (0.50 stock)', group: 'what-if', description: 'NOT shipped. Shipped assessTryOn(); when the far end is out of reach, try a pair 0.50 D stronger to measure it before accepting.' },
  { id: 'wiProbe025', label: 'What-if: try-on + probe pair (0.25 stock)', group: 'what-if', description: 'NOT shipped. As above with 0.25 stock.' },
  { id: 'wiFarEst050', label: 'What-if: far end estimated from lens power (0.50 stock)', group: 'what-if', description: 'NOT shipped, rejected. assessTryOn() variant that estimates an out-of-reach far end as strength − DOF/2 (assumes no refractive error).' },
  { id: 'oracle050', label: 'Reference: ideal pair, 0.50 stock', group: 'reference', description: 'The true ideal snapped to 0.50 steps: the best any method can do with 0.50 stock.' },
] as const satisfies readonly { id: string; label: string; group: StrategyInfo['group']; description: string }[];

export type StrategyId = (typeof STRATEGIES)[number]['id'];
export const STRATEGY_IDS = STRATEGIES.map((s) => s.id) as StrategyId[];

export interface ScenarioConfig {
  seed: number;
  n: number;
  population: PopulationConfig;
  noise: NoiseConfig;
  /** Card labelling: suggested add = blur at the card + this reserve. Calibrated once (see calibrateCardReserve). */
  cardReserveD: number;
  maxTries: number;
  /** Near-point weights for the what-if sweep (empty = skip). */
  nearPointWeights: number[];
}

export const DEFAULT_SCENARIO: Omit<ScenarioConfig, 'cardReserveD'> = {
  seed: 20261003,
  n: 20000,
  population: DEFAULT_POPULATION,
  noise: DEFAULT_NOISE,
  maxTries: 3,
  nearPointWeights: [],
};

export interface ScenarioRun {
  config: ScenarioConfig;
  people: Person[];
  /** Simulated no-glasses measurements fed to recommend() (index = person id). */
  measurements: Measurements[];
  decisions: Record<StrategyId, Decision[]>;
  weightSweep: { weight: number; decisions: Decision[] }[];
  /** Share of try-on measurements (0.50 stock, shipped) whose far end was beyond reach. */
  farBeyondReachShare: number;
}

export function runScenario(config: ScenarioConfig): ScenarioRun {
  const { seed, n, population, noise, cardReserveD, maxTries, nearPointWeights } = config;
  const people = makePopulation(population, seed, n);
  const decisions = Object.fromEntries(STRATEGY_IDS.map((id) => [id, [] as Decision[]])) as Record<StrategyId, Decision[]>;
  const weightSweep = nearPointWeights.map((weight) => ({ weight, decisions: [] as Decision[] }));
  const measurements: Measurements[] = [];
  let farNull = 0;
  let farTotal = 0;

  for (const p of people) {
    const shared = sharedDistanceError(seed, p.id, noise);
    const session = measureWithoutGlasses(p, new Observer(noise, mixSeed(seed, 11, p.id), shared), noise);
    const m = session.measurements;
    measurements.push(m);
    const r = recommend(m);
    const start = fromRecommendation(r);

    decisions.age40.push(ageTable40(p));
    decisions.ageW.push(ageTableAtDistance(p, m));

    const cardObs = new Observer(noise, mixSeed(seed, 21, p.id), 0);
    decisions.card14.push(rackCard(blurAtD(p, cardObs, CARD_DISTANCE_M), cardReserveD));
    const ownObs = new Observer(noise, mixSeed(seed, 22, p.id), 0);
    const hold = Math.min(p.reachM, p.workingDistanceM * (1 + ownObs.z() * noise.cardHoldingSd));
    decisions.cardOwn.push(rackCard(blurAtD(p, ownObs, hold), cardReserveD));

    decisions.spStart.push(start);

    const rack = (stock: number[], stream: number, protocol: typeof tryOnAtRack, assess: typeof assessTryOn, countFar = false): Decision => {
      if (start.kind !== 'readers') return start;
      const obs = new Observer(noise, mixSeed(seed, stream, p.id), shared);
      const measure = (s: number) => {
        const t = measureWithReaders(p, obs, noise, s, m.workingDistanceMm);
        if (countFar) { farTotal++; if (t.farLimitMm === null) farNull++; }
        return t;
      };
      const d = protocol(firstPair(r, stock), stock, measure, assess, maxTries);
      return { ...d, flagged: d.flagged || start.flagged };
    };
    // Shipped and what-if try-ons share a noise stream (paired comparison: only the algorithm differs).
    decisions.spTry050.push(rack(STOCK_050, 31, tryOnAtRack, assessTryOn, true));
    decisions.spTry025.push(rack(STOCK_025, 32, tryOnAtRack, assessTryOn));
    decisions.wiProbe050.push(rack(STOCK_050, 31, tryOnAtRackWithProbe, assessTryOn));
    decisions.wiProbe025.push(rack(STOCK_025, 32, tryOnAtRackWithProbe, assessTryOn));
    decisions.wiFarEst050.push(rack(STOCK_050, 31, tryOnAtRack, assessTryOnWithFarEstimate));
    decisions.oracle050.push(oracle050(p));

    for (const w of weightSweep) w.decisions.push(startWithWeight(m, w.weight));
  }
  return { config, people, measurements, decisions, weightSweep, farBeyondReachShare: farTotal ? farNull / farTotal : 0 };
}

/** Best-case labelling for the rack card: the reserve that maximises its share within ±0.25 D when held
 *  exactly at 14 in by our simulated population. Calibrating the baseline on our own truth is deliberately
 *  generous to it. */
export function calibrateCardReserve(base: Omit<ScenarioConfig, 'cardReserveD'>): number {
  const people = makePopulation(base.population, base.seed, base.n);
  let best = { reserve: 0, score: -1, mae: Infinity };
  for (let reserve = 0; reserve <= 2.0001; reserve += 0.25) {
    const ds = people.map((p) => rackCard(blurAtD(p, new Observer(base.noise, mixSeed(base.seed, 21, p.id), 0), CARD_DISTANCE_M), reserve));
    const m = computeMetrics(people, ds);
    if (m.within025Pct > best.score + 1e-9 || (Math.abs(m.within025Pct - best.score) <= 1e-9 && (m.maeD ?? Infinity) < best.mae)) {
      best = { reserve, score: m.within025Pct, mae: m.maeD ?? Infinity };
    }
  }
  return best.reserve;
}

// ---------------------------------------------------------------- metrics

export interface Metrics {
  /** Everyone in the subset: % who got an appropriate outcome (a pair within ±0.50 D of ideal if they need
   *  one; no readers if they should be referred or don't need them yet). */
  appropriatePct: number;
  /** Same with ±0.25 D. */
  appropriate025Pct: number;
  allN: number;
  /** People whose ideal readers are within +0.75..+3.00 and who are not significantly short-sighted. */
  inScopeN: number;
  /** Of in-scope people, % given any readers. */
  givenReadersPct: number;
  /** Of in-scope people (not just those given readers): % with |error| ≤ 0.125, ≤ 0.25, ≤ 0.50 D. */
  exactPct: number;
  within025Pct: number;
  within050Pct: number;
  /** Of in-scope people: % wrongly told no readers / wrongly referred. */
  falseNonePct: number;
  falseReferPct: number;
  /** Among in-scope people given readers: mean signed error (+ = too strong) and mean |error|, D. */
  biasD: number | null;
  maeD: number | null;
  /** Mean pairs tried at the rack (try-on strategies), among in-scope people given readers. */
  meanTries: number | null;
  /** People who should be referred (myopia < −1.00 D, or ideal > +3.00). */
  referN: number;
  /** % of them not handed readers (referred or told no readers) = referral sensitivity. */
  referSafePct: number | null;
  /** % explicitly referred / flagged. */
  referExplicitPct: number | null;
  /** % handed readers anyway = missed referrals. */
  referMissedPct: number | null;
  /** Of missed referrals, % that at least carried a caution flag. */
  missedButFlaggedPct: number | null;
  myopiaN: number;
  myopiaMissedPct: number | null;
  aboveRangeN: number;
  aboveRangeMissedPct: number | null;
  /** Above-range people handed readers although their ideal is +3.50 or more (more than one step past the rack). */
  aboveRangeMissedFarPct: number | null;
  /** People who don't need readers yet (ideal < +0.75): % handed readers anyway. */
  noneN: number;
  noneGivenReadersPct: number | null;
}

const pct = (a: number, b: number) => (b === 0 ? null : (100 * a) / b);
const pct0 = (a: number, b: number) => (b === 0 ? 0 : (100 * a) / b);

export function computeMetrics(people: Person[], decisions: Decision[], subset?: (p: Person) => boolean): Metrics {
  let inScopeN = 0, given = 0, exact = 0, w25 = 0, w50 = 0, falseNone = 0, falseRefer = 0, errSum = 0, absSum = 0, triesSum = 0, triesN = 0;
  let referN = 0, referSafe = 0, referExplicit = 0, referMissed = 0, missedFlagged = 0;
  let myopiaN = 0, myopiaMissed = 0, aboveN = 0, aboveMissed = 0, aboveMissedFar = 0, noneN = 0, noneGiven = 0;
  let allN = 0, ok50 = 0, ok25 = 0;
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    if (subset && !subset(p)) continue;
    const d = decisions[i];
    allN++;
    if (p.truth === 'refer') { if (d.kind !== 'readers') { ok50++; ok25++; } }
    else if (d.kind === 'readers') {
      const e = Math.abs(d.strength! - p.idealRoundedD);
      if (e <= 0.5 + 1e-9) ok50++;
      if (e <= 0.25 + 1e-9) ok25++;
    } else if (p.truth === 'none' && d.kind === 'none') { ok50++; ok25++; }
    if (p.truth === 'readers') {
      inScopeN++;
      if (d.kind === 'readers') {
        given++;
        const e = d.strength! - p.idealRoundedD;
        errSum += e;
        absSum += Math.abs(e);
        if (Math.abs(e) <= 0.125) exact++;
        if (Math.abs(e) <= 0.25 + 1e-9) w25++;
        if (Math.abs(e) <= 0.5 + 1e-9) w50++;
        if (d.tries > 0) { triesSum += d.tries; triesN++; }
      } else if (d.kind === 'none') falseNone++;
      else falseRefer++;
    } else if (p.truth === 'refer') {
      referN++;
      if (d.kind === 'readers') { referMissed++; if (d.flagged) missedFlagged++; } else referSafe++;
      if (d.kind === 'refer') referExplicit++;
      if (p.referReason === 'myopia') { myopiaN++; if (d.kind === 'readers') myopiaMissed++; }
      else {
        aboveN++;
        if (d.kind === 'readers') { aboveMissed++; if (p.idealRoundedD >= 3.5) aboveMissedFar++; }
      }
    } else {
      noneN++;
      if (d.kind === 'readers') noneGiven++;
    }
  }
  return {
    appropriatePct: pct0(ok50, allN),
    appropriate025Pct: pct0(ok25, allN),
    allN,
    inScopeN,
    givenReadersPct: pct0(given, inScopeN),
    exactPct: pct0(exact, inScopeN),
    within025Pct: pct0(w25, inScopeN),
    within050Pct: pct0(w50, inScopeN),
    falseNonePct: pct0(falseNone, inScopeN),
    falseReferPct: pct0(falseRefer, inScopeN),
    biasD: given ? errSum / given : null,
    maeD: given ? absSum / given : null,
    meanTries: triesN ? triesSum / triesN : null,
    referN,
    referSafePct: pct(referSafe, referN),
    referExplicitPct: pct(referExplicit, referN),
    referMissedPct: pct(referMissed, referN),
    missedButFlaggedPct: pct(missedFlagged, referMissed),
    myopiaN,
    myopiaMissedPct: pct(myopiaMissed, myopiaN),
    aboveRangeN: aboveN,
    aboveRangeMissedPct: pct(aboveMissed, aboveN),
    aboveRangeMissedFarPct: pct(aboveMissedFar, aboveN),
    noneN,
    noneGivenReadersPct: pct(noneGiven, noneN),
  };
}

export const AGE_BANDS: { label: string; lo: number; hi: number }[] = [
  { label: '35–39', lo: 35, hi: 40 },
  { label: '40–44', lo: 40, hi: 45 },
  { label: '45–49', lo: 45, hi: 50 },
  { label: '50–54', lo: 50, hi: 55 },
  { label: '55–59', lo: 55, hi: 60 },
  { label: '60–64', lo: 60, hi: 65 },
  { label: '65–70', lo: 65, hi: 70.0001 },
];

export const REFRACTION_GROUPS: { label: string; lo: number; hi: number }[] = [
  { label: 'myopia < −1.00 (refer)', lo: -Infinity, hi: -1.0 },
  { label: 'low myopia −1.00 to −0.26', lo: -1.0, hi: -0.25 },
  { label: 'near zero −0.25 to +0.75', lo: -0.25, hi: 0.7501 },
  { label: 'low hyperopia +0.76 to +2.00', lo: 0.7501, hi: 2.0001 },
  { label: 'hyperopia > +2.00', lo: 2.0001, hi: Infinity },
];

export interface ErrorHistogram {
  /** Bin centres in D (errors are multiples of 0.25; the end bins collect everything beyond). */
  bins: number[];
  counts: number[];
  /** In-scope people told "no readers" or referred (they get no pair to score). */
  noReaders: number;
  inScopeN: number;
}

export function errorHistogram(people: Person[], decisions: Decision[], lim = 1.5): ErrorHistogram {
  const bins: number[] = [];
  for (let x = -lim; x <= lim + 1e-9; x += 0.25) bins.push(Math.round(x * 100) / 100);
  const counts = bins.map(() => 0);
  let noReaders = 0;
  let inScopeN = 0;
  for (let i = 0; i < people.length; i++) {
    if (people[i].truth !== 'readers') continue;
    inScopeN++;
    const d = decisions[i];
    if (d.kind !== 'readers') { noReaders++; continue; }
    const e = Math.max(-lim, Math.min(lim, d.strength! - people[i].idealRoundedD));
    counts[Math.round((e + lim) / 0.25)]++;
  }
  return { bins, counts, noReaders, inScopeN };
}

export interface PopulationSummary {
  n: number;
  truth: { readers: number; none: number; referMyopia: number; referAboveRange: number };
  meanAge: number;
  meanAmplitudeD: number;
  meanWorkingDistanceCm: number;
  meanDepthOfFocusD: number;
  refraction: { meanD: number; pctBelowMinus1: number; pctMinus1To0: number; pct0To1: number; pct1To2: number; pctAbove2: number; pctAtLeastPlus3: number };
  idealRoundedDistribution: Record<string, number>;
}

export function summarisePopulation(people: Person[]): PopulationSummary {
  const n = people.length;
  const mean = (f: (p: Person) => number) => people.reduce((s, p) => s + f(p), 0) / n;
  const share = (f: (p: Person) => boolean) => (100 * people.filter(f).length) / n;
  const dist: Record<string, number> = {};
  for (const p of people) if (p.truth === 'readers') dist[p.idealRoundedD.toFixed(2)] = (dist[p.idealRoundedD.toFixed(2)] ?? 0) + 1;
  const sorted = Object.fromEntries(Object.entries(dist).sort((a, b) => Number(a[0]) - Number(b[0])));
  return {
    n,
    truth: {
      readers: people.filter((p) => p.truth === 'readers').length,
      none: people.filter((p) => p.truth === 'none').length,
      referMyopia: people.filter((p) => p.referReason === 'myopia').length,
      referAboveRange: people.filter((p) => p.referReason === 'above-range').length,
    },
    meanAge: mean((p) => p.age),
    meanAmplitudeD: mean((p) => p.amplitudeD),
    meanWorkingDistanceCm: mean((p) => p.workingDistanceM * 100),
    meanDepthOfFocusD: mean((p) => p.depthOfFocusD),
    refraction: {
      meanD: mean((p) => p.refractiveErrorD),
      pctBelowMinus1: share((p) => p.refractiveErrorD < -1),
      pctMinus1To0: share((p) => p.refractiveErrorD >= -1 && p.refractiveErrorD < 0),
      pct0To1: share((p) => p.refractiveErrorD >= 0 && p.refractiveErrorD < 1),
      pct1To2: share((p) => p.refractiveErrorD >= 1 && p.refractiveErrorD <= 2),
      pctAbove2: share((p) => p.refractiveErrorD > 2),
      pctAtLeastPlus3: share((p) => p.refractiveErrorD >= 3),
    },
    idealRoundedDistribution: sorted,
  };
}
