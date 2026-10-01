// SIMULATION ONLY. Runs the full bench (main run + sensitivity sweeps + what-ifs) and returns plain data.
// No file I/O here, so tests can call it; sim/bench.ts writes the outputs.

import { DEPTH_OF_FOCUS_D, READERS_MAX_D, READERS_MIN_D } from '../src/core/optics';
import { DISAGREEMENT_D, NEAR_POINT_WEIGHT } from '../src/core/recommend';
import { CENTRE_TOLERANCE_D } from '../src/core/tryon';
import {
  AGE_BANDS, CARD_DISTANCE_M, DEFAULT_SCENARIO, type ErrorHistogram, type Metrics, REFRACTION_GROUPS, STRATEGIES,
  type ScenarioConfig, type ScenarioRun, type StrategyId, calibrateCardReserve, computeMetrics, errorHistogram,
  runScenario, summarisePopulation,
} from './engine';
import type { NoiseConfig, PopulationConfig } from './model';
import { SCOPE } from './model';
import { type Decision, STOCK_025, STOCK_050, flaggedMyopiaAtMargin, refer } from './strategies';

export const BENCH_VERSION = '1.0.0';
export const LABEL = 'SIMULATION: virtual people generated from published norms and stated assumptions. Not clinical validation; no real participants.';

/** Strategies shown in the sensitivity tables. */
export const KEY_STRATEGIES: StrategyId[] = ['age40', 'ageW', 'card14', 'cardOwn', 'spStart', 'spTry050', 'spTry025', 'wiProbe050', 'wiProbe025'];
export const NEAR_POINT_WEIGHTS = [0, 0.2, 0.4, 0.6, 0.8, 1.0];

export interface Assumption { id: string; assumption: string; source: string }

export const ASSUMPTIONS: Assumption[] = [
  { id: 'age', assumption: 'Age uniform 40–70 years (supplementary run: 35–39).', source: 'Assumption (the app targets people over about 40).' },
  { id: 'amplitude', assumption: 'Accommodation ~ Normal(Hofstetter mean 18.5 − 0.3·age, SD 0.75 D), clipped to [0, Hofstetter max 25 − 0.4·age].', source: 'Hofstetter HW. A useful age-amplitude formula. Optom World 1950;38:42–45 (fitted to Duane 1912/1922). SD is an assumption: ±2 SD roughly spans Hofstetter\'s min–max envelope at ages 45–50.' },
  { id: 'amplitude-norm-caveat', assumption: 'Hofstetter/Duane norms come from subjective push-up tests, which already include part of the depth of focus, so the main population may have slightly too much accommodation. A lower-amplitude population (centred on Hofstetter\'s minimum 15 − 0.25·age) is run as a sensitivity case.', source: 'Assumption, stated as a limitation.' },
  { id: 'refraction', assumption: 'Uncorrected spherical refractive error: mixture 72% N(+0.25, 0.5), 16% N(+1.5, 1.0), 12% N(−2.0, 1.25) D, clipped to [−6, +5]. Gives ≈10% below −1.00 D and ≈1% at or above +3.00 D.', source: 'Assumption. Context: Kempen JH et al. Arch Ophthalmol 2004;122:495–505 (adults 40+: myopia ≤ −1 D ≈ 25%, hyperopia ≥ +3 D ≈ 10% in the US). We use a lower myopia share because people who already wear distance glasses are routed to an eye doctor by the safety questions; the high-hyperopia share is lower than Kempen\'s.' },
  { id: 'dof', assumption: 'Total depth of focus uniform 0.3–1.0 D per person (pupil-dependent). The app assumes 0.50 D.', source: 'Wang B, Ciuffreda KJ. Depth-of-focus of the human eye: theory and clinical implications. Surv Ophthalmol 2006;51:75–85.' },
  { id: 'working-distance', assumption: 'Habitual reading distance ~ Normal(37, 5) cm, clipped to 25–55 cm.', source: 'Bababekova Y et al. Font size and viewing distance of handheld smart phones. Optom Vis Sci 2011;88:795–797 (mean 36.2 cm for messages, 32.2 cm for web pages). SD is an assumption.' },
  { id: 'reach', assumption: 'Arm\'s reach for holding a phone uniform 55–70 cm; nothing beyond it can be measured. Closest measurable distance 12 cm (face must stay in frame).', source: 'Assumption.' },
  { id: 'optics', assumption: 'Clear iff A − RE − DOF/2 ≤ 1/d ≤ A − RE + AA + DOF/2 (thin lens at the eye, vertex distance ignored, both eyes equal, no astigmatism, normal acuity, no eye disease). The constant-angle E removes letter-size cues, so only blur matters.', source: 'Standard geometric optics; derivation in sim/README.md.' },
  { id: 'ideal', assumption: 'Ideal readers A* = 1/W + RE − AA/2 (working distance in the middle of the clear range), rounded to 0.25 D.', source: 'Stevens S. How to prescribe spectacles for near vision. Community Eye Health J 2019;32(107):47 ("keep half the accommodation in reserve").' },
  { id: 'scope', assumption: `Refer if RE < ${SCOPE.referMyopiaBelowD.toFixed(2)} D (readers don't fix distance blur; a myopic shift after 60 can signal cataract) or ideal > +${SCOPE.maxReadersD.toFixed(2)}; "no readers yet" if ideal < +${SCOPE.minUsefulD.toFixed(2)}; otherwise in scope.`, source: 'Bench rule (task brief). Ready-made range +1.00..+3.00 from Stevens 2019.' },
  { id: 'camera-noise', assumption: 'Camera distance relative error: shared per person (calibration / iris size) SD 4% + per reading SD 1%. Swept 0–8%, both shared and fully independent per reading.', source: 'Google MediaPipe Iris (2020) reports 4.3% mean relative depth error (SD 2.4%) before calibration; ruler calibration should reduce the shared part. Split into shared/per-reading parts is an assumption.' },
  { id: 'blur-noise', assumption: 'Each judged limit of clear vision (and each N6 check) has independent error SD 0.25 D. Swept 0–0.5 D.', source: 'Assumption.' },
  { id: 'rack-protocol', assumption: 'At the rack: first pair = weaker of the app\'s two "try first" pairs (0.50 stock) or the starting strength (0.25 stock); follow assessTryOn()\'s suggested change, snapped to stock (at least one step); stop at "good" or after 3 pairs and keep the best-centred. "Weaker" on +1.00 → no readers; "stronger" on +3.00 → refer.', source: 'Assumption about how people use the try-on screen.' },
  { id: 'age-table', assumption: 'Age table = Stevens 2019 Table 2 for 40 cm (as in src/core/optics.ts); the W-adjusted variant adds 1/W − 2.5 D using the camera-measured W. Neither can refer.', source: 'Stevens 2019.' },
  { id: 'rack-card', assumption: `Rack card = an ideal blur meter: the smallest readable line reports the dioptres of blur where it is held, labelled blur + a fixed reserve (smallest line = +1.00; past +3.00 counted as refer). The reserve is chosen to maximise the card's own score at 14 in on this population (best case for the card). Held exactly at ${(CARD_DISTANCE_M * 100).toFixed(1)} cm, or at the person's own distance with 10% SD. Myopic blur reads as a need for plus. Change of letter angular size with distance is ignored.`, source: 'Assumption, deliberately generous to the card.' },
  { id: 'independence', assumption: 'No learning, fatigue or lighting effects; noise is independent between limits and pairs; people follow instructions.', source: 'Assumption.' },
];

export interface StrategyResult {
  id: StrategyId;
  label: string;
  group: string;
  description: string;
  overall: Metrics;
  byAge: ({ band: string } & Metrics)[];
  byRefraction: ({ group: string } & Metrics)[];
  errorHistogram: ErrorHistogram;
}

export interface SensitivityRow {
  group: string;
  label: string;
  value: number | string;
  farBeyondReachShare: number;
  metrics: Partial<Record<StrategyId, Metrics>>;
}

export interface WeightRow { weight: number; population: string; metrics: Metrics }
export interface MyopiaMarginRow { marginD: number; start: Metrics; tryOn050: Metrics }

export interface BenchResult {
  label: string;
  benchVersion: string;
  config: { seed: number; n: number; nUnder40: number; population: PopulationConfig; noise: NoiseConfig; cardReserveD: number; maxTries: number; stock050: number[]; stock025: number[]; cardDistanceM: number; scope: typeof SCOPE };
  coreConstants: { NEAR_POINT_WEIGHT: number; DISAGREEMENT_D: number; DEPTH_OF_FOCUS_D: number; CENTRE_TOLERANCE_D: number; READERS_MIN_D: number; READERS_MAX_D: number };
  assumptions: Assumption[];
  population: ReturnType<typeof summarisePopulation>;
  farBeyondReachShare: number;
  strategies: StrategyResult[];
  sensitivity: SensitivityRow[];
  nearPointWeight: WeightRow[];
  /** What-if: refer as possible myopia when measured amplitude exceeds Hofstetter max + margin (shipped 1.5 D). */
  myopiaMargin: MyopiaMarginRow[];
  /** Must be 0: the what-if replica of recommend() at the shipped weight disagrees with recommend() this many times. */
  replicaMismatches: number;
  under40: { population: ReturnType<typeof summarisePopulation>; metrics: Partial<Record<StrategyId, Metrics>> };
}

export interface BenchOptions { seed?: number; n?: number; nUnder40?: number }

function keyMetrics(run: ScenarioRun): Partial<Record<StrategyId, Metrics>> {
  return Object.fromEntries(KEY_STRATEGIES.map((id) => [id, computeMetrics(run.people, run.decisions[id])]));
}

export function runBench(opts: BenchOptions = {}): BenchResult {
  const seed = opts.seed ?? DEFAULT_SCENARIO.seed;
  const n = opts.n ?? DEFAULT_SCENARIO.n;
  const nUnder40 = opts.nUnder40 ?? 5000;
  const base0 = { ...DEFAULT_SCENARIO, seed, n };
  const cardReserveD = calibrateCardReserve(base0);
  const base: ScenarioConfig = { ...base0, cardReserveD };

  const variant = (population: Partial<PopulationConfig> = {}, noise: Partial<NoiseConfig> = {}, weights: number[] = []) =>
    runScenario({ ...base, population: { ...base.population, ...population }, noise: { ...base.noise, ...noise }, nearPointWeights: weights });

  // ---- main run
  const main = variant({}, {}, NEAR_POINT_WEIGHTS);
  const strategies: StrategyResult[] = STRATEGIES.map((s) => ({
    id: s.id,
    label: s.label,
    group: s.group,
    description: s.description,
    overall: computeMetrics(main.people, main.decisions[s.id]),
    byAge: AGE_BANDS.filter((b) => b.lo >= 40).map((b) => ({ band: b.label, ...computeMetrics(main.people, main.decisions[s.id], (p) => p.age >= b.lo && p.age < b.hi) })),
    byRefraction: REFRACTION_GROUPS.map((g) => ({ group: g.label, ...computeMetrics(main.people, main.decisions[s.id], (p) => p.refractiveErrorD >= g.lo && p.refractiveErrorD < g.hi) })),
    errorHistogram: errorHistogram(main.people, main.decisions[s.id]),
  }));

  const shipped = main.weightSweep.find((w) => Math.abs(w.weight - NEAR_POINT_WEIGHT) < 1e-9);
  const replicaMismatches = shipped
    ? shipped.decisions.filter((d, i) => d.kind !== main.decisions.spStart[i].kind || d.strength !== main.decisions.spStart[i].strength).length
    : -1;

  // ---- sensitivity sweeps (same seed → same virtual people; only the named parameter changes)
  const sensitivity: SensitivityRow[] = [];
  const add = (group: string, label: string, value: number | string, run: ScenarioRun) =>
    sensitivity.push({ group, label, value, farBeyondReachShare: run.farBeyondReachShare, metrics: keyMetrics(run) });

  for (const s of [0, 0.02, 0.04, 0.08]) add('distance-shared', `Shared camera distance error SD ${s * 100}% (+1% per reading)`, s, s === base.noise.distanceSharedSd ? main : variant({}, { distanceSharedSd: s }));
  for (const s of [0, 0.02, 0.04, 0.08]) add('distance-independent', `Independent per-reading distance error SD ${s * 100}%`, s, variant({}, { distanceSharedSd: 0, distanceReadingSd: s }));
  for (const d of [0.3, 0.5, 0.75, 1.0]) add('depth-of-focus', `Everyone's true depth of focus ${d.toFixed(2)} D (app assumes ${DEPTH_OF_FOCUS_D.toFixed(2)} D)`, d, variant({ dofMinD: d, dofMaxD: d }));
  for (const b of [0, 0.25, 0.5]) add('blur-judgement', `Blur-judgement error SD ${b.toFixed(2)} D`, b, b === base.noise.blurJudgementSdD ? main : variant({}, { blurJudgementSdD: b }));
  const lowAmp = variant({ amplitudeNorm: 'hofstetter-min' }, {}, NEAR_POINT_WEIGHTS);
  add('population', 'Lower-amplitude population (centred on Hofstetter minimum)', 'hofstetter-min', lowAmp);
  add('population', 'Accommodation SD 0.5 D', 0.5, variant({ amplitudeSdD: 0.5 }));
  add('population', 'Accommodation SD 1.0 D', 1.0, variant({ amplitudeSdD: 1.0 }));
  add('population', 'Everyone emmetropic (no refractive error)', 'emmetropic', variant({ refraction: [{ weight: 1, meanD: 0, sdD: 0 }] }));
  add('behaviour', 'Holding distance varies 5% between capture and real reading', 0.05, variant({}, { holdingVariabilitySd: 0.05 }));
  add('behaviour', 'Arm-stretch: phone held halfway out to the no-glasses near point during capture', 0.5, variant({}, { armStretch: 0.5 }));
  const perfect: Partial<NoiseConfig> = { distanceSharedSd: 0, distanceReadingSd: 0, blurJudgementSdD: 0, holdingVariabilitySd: 0, cardHoldingSd: 0 };
  add('sanity', 'Perfect measurements (no noise)', 'noise-free', variant({}, perfect));
  add('sanity', 'Perfect measurements + 5 m reach (far end always measurable)', 'noise-free-reach', variant({ reachMinCm: 500, reachMaxCm: 500 }, perfect));
  add('sanity', 'Perfect measurements + 5 m reach + no refractive error', 'consistency', variant({ reachMinCm: 500, reachMaxCm: 500, refraction: [{ weight: 1, meanD: 0, sdD: 0 }] }, perfect));

  // ---- what-if: near-point weight (tuned against our own simulated truth: disclose if adopted)
  const nearPointWeight: WeightRow[] = [];
  for (const [name, run] of [['main', main], ['lower-amplitude', lowAmp]] as const) {
    for (const w of run.weightSweep) nearPointWeight.push({ weight: w.weight, population: name, metrics: computeMetrics(run.people, w.decisions) });
  }

  // ---- what-if: possible-myopia margin (tuned against our own simulated truth: disclose if adopted)
  const myopiaMargin: MyopiaMarginRow[] = [0.5, 0.75, 1.0, 1.5].map((marginD) => {
    const flagged = main.measurements.map((m) => flaggedMyopiaAtMargin(m, marginD));
    const apply = (ds: Decision[]) => ds.map((d, i) => (flagged[i] ? refer() : d));
    return {
      marginD,
      start: computeMetrics(main.people, apply(main.decisions.spStart)),
      tryOn050: computeMetrics(main.people, apply(main.decisions.spTry050)),
    };
  });

  // ---- supplementary: 35–39
  const young = runScenario({ ...base, n: nUnder40, population: { ...base.population, ageMin: 35, ageMax: 40 } });

  return {
    label: LABEL,
    benchVersion: BENCH_VERSION,
    config: { seed, n, nUnder40, population: base.population, noise: base.noise, cardReserveD, maxTries: base.maxTries, stock050: STOCK_050, stock025: STOCK_025, cardDistanceM: CARD_DISTANCE_M, scope: SCOPE },
    coreConstants: { NEAR_POINT_WEIGHT, DISAGREEMENT_D, DEPTH_OF_FOCUS_D, CENTRE_TOLERANCE_D, READERS_MIN_D, READERS_MAX_D },
    assumptions: ASSUMPTIONS,
    population: summarisePopulation(main.people),
    farBeyondReachShare: main.farBeyondReachShare,
    strategies,
    sensitivity,
    nearPointWeight,
    myopiaMargin,
    replicaMismatches,
    under40: { population: summarisePopulation(young.people), metrics: keyMetrics(young) },
  };
}
