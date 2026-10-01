// FIELD CHECK. Compares the SIMULATED population and Small Print's simulated recommendations with PUBLISHED
// field data on the reading-glasses powers that real community programmes found people needed, by age.
// Population-level plausibility check only: no real person was tested by us, and no individual is matched.
//
// Run:  npx tsx sim/fieldcheck.ts
// Writes public/data/fieldcheck.json and public/figures/fieldcheck-*.svg. Method and caveats: sim/FIELDCHECK.md.
//
// Nothing in sim/model.ts, sim/strategies.ts, sim/engine.ts or src/** is modified. Shipped functions are
// imported and called unchanged; the sensitivity population is built by wrapping makePerson().

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hofstetter } from '../src/core/optics';
import { recommend } from '../src/core/recommend';
import { assessTryOn } from '../src/core/tryon';
import { CARD_DISTANCE_M, DEFAULT_SCENARIO, type ScenarioConfig, calibrateCardReserve, computeMetrics, runScenario } from './engine';
import {
  DEFAULT_POPULATION, Observer, type Person, type PopulationConfig, blurAtD, clamp, classify, clearRange, gaussian, idealReaders,
  makePerson, measureWithReaders, measureWithoutGlasses, mixSeed, mulberry32, round025, sharedDistanceError,
} from './model';
import {
  type Decision, STOCK_025, STOCK_050, ageTable40, ageTableAtDistance, firstPair, fromRecommendation, oracle050, rackCard, tryOnAtRack,
} from './strategies';

const ROOT = resolve(import.meta.dirname, '..');

// =====================================================================================================
// 1. FIELD DATA (transcribed from the sources; figure values digitised from pixel positions, see notes)
// =====================================================================================================

export const SOURCES = {
  kenya: {
    id: 'katibeh2024-eye',
    citation:
      'Katibeh M, Watts E, Gichangi M, Latorre-Arteaga S, Bolster NM, Bastawrous A. Near vision data and near correction requirements from community eye health programmes in nine countries. Eye (Lond). 2024;38(11):2150–2155. doi:10.1038/s41433-023-02910-4. PMCID: PMC11269744. Open access, CC BY 4.0.',
    url: 'https://doi.org/10.1038/s41433-023-02910-4',
    accessed: 'Europe PMC full-text XML (PMC11269744) and the publisher figure image, 2026-10-01',
    population:
      'Peek-powered community eye health programmes (door-to-door and primary-care screening), Jan 2022–Jun 2023. 388,939 people aged 35+ screened in 9 countries; 146,801 failed near screening. Required near power was recorded ONLY in Kenya (n = 34,328; 34,283 with power data). Table 4 is restricted to non-owners of reading glasses (n = 31,474).',
    measure:
      '"Power of ready readers identified at triage" by trained ophthalmic clinical officers with ready-made readers (spherical, same power both eyes) after a near-vision chart in N notation. Stock range +1.00 to +4.00.',
  },
  india: {
    id: 'katibeh2026-frontiers',
    citation:
      'Katibeh M, Sabherwal S, Javed M, Watts E, Latorre-Arteaga S, Bolster NM, Coverley D, Pintus A, Hewitt V, Thaker N, Bastawrous A. A novel digital tool to guide provision of near vision glasses for presbyopia correction in the community. Front Ophthalmol. 2026;6:1891054. doi:10.3389/fopht.2026.1891054. PMCID: PMC13500277. Open access, CC BY 4.0.',
    url: 'https://doi.org/10.3389/fopht.2026.1891054',
    accessed: 'Europe PMC full-text XML (PMC13500277), 2026-10-01',
    population:
      'Door-to-door programme, Khiri district, Uttar Pradesh, India. 378 adults aged 35–80 (mean 45.7 ± 6.7), uncorrected distance VA 6/12 or better in both eyes AND near VA worse than N6 at 40 cm. 96% owned no glasses.',
    measure: 'Power of ready-made near glasses prescribed by a single optometrist in a clinic (gold standard), Table 2.',
  },
  asmara: {
    id: 'smret2023-clinoptom',
    citation:
      'Smret TM, Weldegergis RK, Achila OO, Tekle AM. Understanding Presbyopia in Asmara: Prevalence, Association with Refractive Error, and Age-Based Addition. Clin Optom (Auckl). 2023;15:191–203 (as indexed). doi:10.2147/OPTO.S421366. PMCID: PMC10516207. Open access.',
    url: 'https://doi.org/10.2147/OPTO.S421366',
    accessed: 'Europe PMC full-text XML (PMC10516207), 2026-10-01',
    population: 'All eye-centre visitors in Asmara, Eritrea, aged 35–60, best-corrected VA 6/9 or better (n = 1,310). Clinic sample, not a community programme.',
    measure:
      'Near ADDITION over full distance correction: dynamic retinoscopy (MEM) − 0.75 D, then "the minimum plus" that reads 0.00 logMAR at 40 cm (Table 4). NOT ready-reader power: hyperopia and myopia are already corrected.',
  },
  thrive: {
    id: 'sehrin2024-plosone',
    citation:
      'Sehrin F, Jin L, Naher K, Das NC, Chan VF, Li DF, Bergson S, Gudwin E, Clarke M, Stephan T, Congdon N. The effect on income of providing near vision correction to workers in Bangladesh: The THRIVE randomized controlled trial. PLoS One. 2024;19(4):e0296115. doi:10.1371/journal.pone.0296115. PMCID: PMC10990163.',
    url: 'https://doi.org/10.1371/journal.pone.0296115',
    accessed: 'Europe PMC full-text XML (PMC10990163), 2026-10-01',
    population: '824 presbyopic workers aged 35–65 in rural Bangladesh (mean age ≈ 47).',
    measure:
      'Power ASSIGNED by a rule from unaided near acuity (1.2M→+1.0 … <4.0M→+3.0), not measured. Baseline median +1.00 (IQR +1.00 to +1.50) in both arms (Table 1). Context only: not used quantitatively.',
  },
  panke: {
    id: 'panke2019-spie',
    citation:
      'Panke K, Kassaliete E, Ikaunieks G, Svede A, Krumina G. Limitation of tables indicating the relation between age and reading addition for presbyopia correction. Proc SPIE 11207, Fourth International Conference on Applications of Optics and Photonics; 112070Y (2019). doi:10.1117/12.2527291.',
    url: 'https://doi.org/10.1117/12.2527291',
    accessed: 'Abstract only (full text paywalled), via web search, 2026-10-01',
    population: '216 adults aged 35–80, Latvia.',
    measure: 'Near add at 40 cm, plus build-up. Abstract reports age vs add r = 0.73 and large individual spread. No per-age values available to us: context only.',
  },
} as const;

export interface FieldBand { band: string; lo: number; hi: number }

/** Kenya, Eye 2024, Table 4 (non-glasses-owners, n = 31,474): mean power of ready readers by age, 95% CI. Exact. */
export const KENYA_TABLE4: (FieldBand & { n: number; meanD: number; ci: [number, number] })[] = [
  { band: '40–44', lo: 40, hi: 45, n: 3538, meanD: 1.50, ci: [1.49, 1.52] },
  { band: '45–49', lo: 45, hi: 50, n: 5745, meanD: 1.83, ci: [1.82, 1.84] },
  { band: '50–54', lo: 50, hi: 55, n: 7251, meanD: 2.19, ci: [2.18, 2.20] },
  { band: '55–59', lo: 55, hi: 60, n: 4399, meanD: 2.51, ci: [2.50, 2.52] },
  { band: '60–64', lo: 60, hi: 65, n: 4863, meanD: 2.81, ci: [2.80, 2.82] },
  { band: '65–69', lo: 65, hi: 70, n: 2410, meanD: 2.90, ci: [2.88, 2.91] },
  { band: '70–74', lo: 70, hi: 75, n: 2064, meanD: 3.05, ci: [3.03, 3.07] },
  { band: '75–79', lo: 75, hi: 80, n: 750, meanD: 3.06, ci: [3.03, 3.10] },
  { band: '80–84', lo: 80, hi: 85, n: 317, meanD: 3.13, ci: [3.08, 3.19] },
  { band: '≥85', lo: 85, hi: 120, n: 137, meanD: 3.11, ci: [3.02, 3.20] },
];

/** Kenya, Eye 2024, Fig. 1d box plot (all with power data). Box edges and whisker caps read from pixel rows of the
 *  publisher image (they sit exactly on the 0.25 D grid). Where no separate median line is drawn, the median
 *  coincides with a box edge; we then take the value the authors state in the Discussion ("1.50 D for people aged
 *  40–44 years, 2.00 D for 45–54 years, 2.50 D for 55–59 years and 3.00 D for over 60"), and null if not stated. */
export const KENYA_FIG1D: (FieldBand & { q1: number; q3: number; whiskerLo: number; whiskerHi: number; medianD: number | null; medianSource: string })[] = [
  { band: '35–39', lo: 35, hi: 40, q1: 1.0, q3: 1.5, whiskerLo: 1.0, whiskerHi: 2.0, medianD: null, medianSource: 'on a box edge; not stated' },
  { band: '40–44', lo: 40, hi: 45, q1: 1.0, q3: 2.0, whiskerLo: 1.0, whiskerHi: 3.5, medianD: 1.5, medianSource: 'median line visible' },
  { band: '45–49', lo: 45, hi: 50, q1: 1.5, q3: 2.0, whiskerLo: 1.0, whiskerHi: 2.75, medianD: 2.0, medianSource: 'box edge; authors\' text' },
  { band: '50–54', lo: 50, hi: 55, q1: 2.0, q3: 2.5, whiskerLo: 1.25, whiskerHi: 3.25, medianD: 2.0, medianSource: 'box edge; authors\' text' },
  { band: '55–59', lo: 55, hi: 60, q1: 2.5, q3: 2.75, whiskerLo: 2.25, whiskerHi: 3.0, medianD: 2.5, medianSource: 'box edge; authors\' text' },
  { band: '60–64', lo: 60, hi: 65, q1: 2.5, q3: 3.0, whiskerLo: 1.75, whiskerHi: 3.75, medianD: 3.0, medianSource: 'box edge; authors\' text ("over 60")' },
  { band: '65–69', lo: 65, hi: 70, q1: 2.75, q3: 3.0, whiskerLo: 2.5, whiskerHi: 3.25, medianD: 3.0, medianSource: 'box edge; authors\' text ("over 60")' },
  { band: '70–74', lo: 70, hi: 75, q1: 3.0, q3: 3.25, whiskerLo: 2.75, whiskerHi: 3.5, medianD: 3.0, medianSource: 'box edge; authors\' text ("over 60")' },
  { band: '75–79', lo: 75, hi: 80, q1: 3.0, q3: 3.5, whiskerLo: 2.25, whiskerHi: 4.0, medianD: 3.0, medianSource: 'box edge; authors\' text ("over 60")' },
  { band: '80–84', lo: 80, hi: 85, q1: 3.0, q3: 3.5, whiskerLo: 2.25, whiskerHi: 4.0, medianD: 3.0, medianSource: 'box edge; authors\' text ("over 60")' },
  { band: '≥85', lo: 85, hi: 120, q1: 3.0, q3: 3.5, whiskerLo: 2.25, whiskerHi: 4.0, medianD: 3.0, medianSource: 'box edge; authors\' text ("over 60")' },
];

/** Kenya, Eye 2024, Fig. 1c: number of people at each required power, all ages (35 to ≥85). DIGITISED from bar
 *  heights in the 2000 px publisher image (1 px ≈ 24 people), so each count is ±~25. Digitised total 34,022 vs
 *  34,283 reported with power data (99.2%). The authors' text confirms the three modes (+2.00, +2.50, +3.00). */
export const KENYA_FIG1C: { powerD: number; n: number }[] = [
  { powerD: 1.0, n: 1810 }, { powerD: 1.25, n: 190 }, { powerD: 1.5, n: 4024 }, { powerD: 1.75, n: 452 },
  { powerD: 2.0, n: 9024 }, { powerD: 2.25, n: 476 }, { powerD: 2.5, n: 7619 }, { powerD: 2.75, n: 571 },
  { powerD: 3.0, n: 7833 }, { powerD: 3.25, n: 476 }, { powerD: 3.5, n: 1167 }, { powerD: 3.75, n: 190 },
  { powerD: 4.0, n: 190 },
];

/** India, Frontiers 2026, Table 2: optometrist-prescribed power by age (mean, median). Per-band n not reported in
 *  the text (Fig. 2 gives percentages only). The 40–44 upper CI is printed as 2.26 (likely 1.26); not used. */
export const INDIA_TABLE2: (FieldBand & { meanD: number; medianD: number; se: number })[] = [
  { band: '35–39', lo: 35, hi: 40, meanD: 1.0, medianD: 1.0, se: 0 },
  { band: '40–44', lo: 40, hi: 45, meanD: 1.21, medianD: 1.0, se: 0.028 },
  { band: '45–49', lo: 45, hi: 50, meanD: 1.57, medianD: 1.5, se: 0.025 },
  { band: '50–54', lo: 50, hi: 55, meanD: 2.05, medianD: 2.0, se: 0.022 },
  { band: '55–59', lo: 55, hi: 60, meanD: 2.24, medianD: 2.0, se: 0.062 },
  { band: '60–64', lo: 60, hi: 65, meanD: 2.58, medianD: 2.5, se: 0.083 },
  { band: '≥65', lo: 65, hi: 120, meanD: 2.78, medianD: 3.0, se: 0.101 },
];

/** Asmara, Clin Optom 2023, Table 4 ("All" rows): near ADD over full distance correction, mean ± SD. Ages are
 *  inclusive whole years (41–45 = 41.0 to 45.99 here). */
export const ASMARA_TABLE4: (FieldBand & { n: number; meanD: number; sdD: number })[] = [
  { band: '35–40', lo: 35, hi: 41, n: 292, meanD: 0.70, sdD: 0.46 },
  { band: '41–45', lo: 41, hi: 46, n: 312, meanD: 1.30, sdD: 0.32 },
  { band: '46–50', lo: 46, hi: 51, n: 336, meanD: 1.77, sdD: 0.29 },
  { band: '51–55', lo: 51, hi: 56, n: 194, meanD: 2.15, sdD: 0.26 },
  { band: '56–60', lo: 56, hi: 61, n: 176, meanD: 2.37, sdD: 0.31 },
];

// =====================================================================================================
// 2. HELPERS
// =====================================================================================================

const SIM_BANDS: FieldBand[] = [
  { band: '40–44', lo: 40, hi: 45 },
  { band: '45–49', lo: 45, hi: 50 },
  { band: '50–54', lo: 50, hi: 55 },
  { band: '55–59', lo: 55, hi: 60 },
  { band: '60–64', lo: 60, hi: 65 },
  { band: '65–69', lo: 65, hi: 70.0001 }, // sim ages run to 70.0; the top sim band is 65–70
];

const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;
const clip = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const snap050 = (x: number) => Math.round(x * 2) / 2;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * q;
  const a = Math.floor(i);
  const b = Math.ceil(i);
  return sorted[a] + (sorted[b] - sorted[a]) * (i - a);
}

interface Stats { n: number; meanD: number | null; medianD: number | null; q1: number | null; q3: number | null }
function stats(xs: number[]): Stats {
  if (xs.length === 0) return { n: 0, meanD: null, medianD: null, q1: null, q3: null };
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, meanD: r2(mean(s)), medianD: quantile(s, 0.5), q1: quantile(s, 0.25), q3: quantile(s, 0.75) };
}

/** Field programmes only measure people who struggle with near print. Mirror that in the sim: without glasses an
 *  N6 target at 40 cm (2.5 D) lies outside the clear range. */
export const failsN6At40 = (p: Person) => {
  const { nearD, farD } = clearRange(p, 0);
  return 2.5 > nearD || 2.5 < farD;
};
/** Sim people a field programme would hand readers: not significantly short-sighted (proxy for the "distance VA
 *  6/12 or better" entry rule) and ideal readers of at least +1.00 (the lowest stocked power). */
export const needsReaders = (p: Person) => p.refractiveErrorD >= -1.0 && p.idealRoundedD >= 1.0;

/** The field stocks +1.00 to +4.00, so a required power is never recorded outside that range. */
export const toFieldRange = (d: number) => clip(round025(d), 1.0, 4.0);
/** Ideal readers if everyone read at the field charts' 40 cm instead of their own distance. */
export const ideal40 = (p: Person) => idealReaders(0.4, p.refractiveErrorD, p.amplitudeD);
/** Asmara-style ADD at 40 cm (distance error fully corrected, so RE drops out), "half the accommodation in reserve". */
export const addHalfReserve40 = (amplitudeD: number) => Math.max(0, 2.5 - amplitudeD / 2);
/** Literal "minimum plus" ADD at 40 cm: just enough to bring 40 cm inside the near limit (mean DOF of the sim, 0.65 D). */
const MEAN_DOF_D = (DEFAULT_POPULATION.dofMinD + DEFAULT_POPULATION.dofMaxD) / 2;
export const addMinimumPlus40 = (amplitudeD: number) => Math.max(0, 2.5 - amplitudeD - MEAN_DOF_D / 2);
/** Asmara Table 2 definition of presbyopia: with distance correction, cannot read at 40 cm (sim: near limit < 2.5 D). */
export const presbyopicWithDistanceRx = (p: Person) => p.amplitudeD + p.depthOfFocusD / 2 < 2.5;

const inBand = (b: { lo: number; hi: number }) => (p: Person) => p.age >= b.lo && p.age < b.hi;

// =====================================================================================================
// 3. POPULATIONS: the shipped generator, and a wrapper that only moves the accommodation centre
// =====================================================================================================

type CentreFn = (age: number) => number;

/** makePerson() unchanged, then accommodation re-drawn with the SAME normal deviate makePerson used (replayed from
 *  the person's own seed stream), around a different age curve. Age, refraction, depth of focus, working distance
 *  and reach are identical, so any change in results comes from accommodation alone (common random numbers). */
export function personWithAmplitudeCentre(cfg: PopulationConfig, seed: number, id: number, centre: CentreFn): Person {
  const p = makePerson(cfg, seed, id);
  const rng = mulberry32(mixSeed(seed, 1, id));
  rng(); // age
  const z = gaussian(rng); // accommodation deviate (makePerson's 2nd draw)
  const amplitudeD = clamp(centre(p.age) + z * cfg.amplitudeSdD, 0, hofstetter(p.age).max);
  const idealD = idealReaders(p.workingDistanceM, p.refractiveErrorD, amplitudeD);
  const idealRoundedD = round025(idealD);
  return { ...p, amplitudeD, idealD, idealRoundedD, ...classify(p.refractiveErrorD, idealRoundedD) };
}

const Z = (() => { const rng = mulberry32(20261001); return Array.from({ length: 20000 }, () => gaussian(rng)); })();

/** Accommodation centre at `age` such that the sim's mean ADD (by `addOf`) equals the field mean `targetD`. */
function solveCentre(age: number, targetD: number, sdD: number, addOf: (aa: number) => number): number {
  const hmax = hofstetter(age).max;
  const meanAdd = (c: number) => mean(Z.map((z) => addOf(clamp(c + z * sdD, 0, hmax))));
  let lo = -3, hi = hmax;
  if (meanAdd(lo) < targetD) return lo; // field needs more than any amplitude can explain (never happens here)
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (meanAdd(mid) > targetD) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

interface Anchor { age: number; centreD: number; targetAddD: number }

/** Piecewise-linear centre through the anchors; past the last anchor, continue the last slope down to 0. */
function centreFromAnchors(anchors: Anchor[]): CentreFn {
  return (age: number) => {
    const a = anchors;
    if (age <= a[0].age) return a[0].centreD + ((a[1].centreD - a[0].centreD) / (a[1].age - a[0].age)) * (age - a[0].age);
    for (let i = 1; i < a.length; i++) {
      if (age <= a[i].age) return a[i - 1].centreD + ((a[i].centreD - a[i - 1].centreD) / (a[i].age - a[i - 1].age)) * (age - a[i - 1].age);
    }
    const n = a.length - 1;
    const slope = (a[n].centreD - a[n - 1].centreD) / (a[n].age - a[n - 1].age);
    return Math.max(0, a[n].centreD + slope * (age - a[n].age));
  };
}

function asmaraAnchors(addOf: (aa: number) => number): Anchor[] {
  return ASMARA_TABLE4.map((b) => {
    const age = (b.lo + b.hi) / 2;
    return { age, targetAddD: b.meanD, centreD: Math.max(-3, solveCentre(age, b.meanD, DEFAULT_POPULATION.amplitudeSdD, addOf)) };
  });
}

// =====================================================================================================
// 4. STRATEGIES on any population (replica of runScenario's loop, verified identical on the main population)
// =====================================================================================================

const IDS = ['age40', 'ageW', 'card14', 'cardOwn', 'spStart', 'spTry050', 'spTry025', 'oracle050'] as const;
type Id = (typeof IDS)[number];
const LABELS: Record<Id, string> = {
  age40: 'Age table (40 cm)', ageW: 'Age table + measured distance', card14: 'Rack card at 14 in', cardOwn: 'Rack card where they read',
  spStart: 'Small Print start', spTry050: 'Small Print + try-on (0.50 stock)', spTry025: 'Small Print + try-on (0.25 stock)', oracle050: 'Reference: ideal pair, 0.50 stock',
};

function runStrategies(people: Person[], cfg: ScenarioConfig): Record<Id, Decision[]> {
  const { seed, noise, cardReserveD, maxTries } = cfg;
  const out = Object.fromEntries(IDS.map((id) => [id, [] as Decision[]])) as Record<Id, Decision[]>;
  for (const p of people) {
    const shared = sharedDistanceError(seed, p.id, noise);
    const m = measureWithoutGlasses(p, new Observer(noise, mixSeed(seed, 11, p.id), shared), noise).measurements;
    const r = recommend(m);
    const start = fromRecommendation(r);
    out.age40.push(ageTable40(p));
    out.ageW.push(ageTableAtDistance(p, m));
    out.card14.push(rackCard(blurAtD(p, new Observer(noise, mixSeed(seed, 21, p.id), 0), CARD_DISTANCE_M), cardReserveD));
    const ownObs = new Observer(noise, mixSeed(seed, 22, p.id), 0);
    const hold = Math.min(p.reachM, p.workingDistanceM * (1 + ownObs.z() * noise.cardHoldingSd));
    out.cardOwn.push(rackCard(blurAtD(p, ownObs, hold), cardReserveD));
    out.spStart.push(start);
    const rack = (stock: number[], stream: number): Decision => {
      if (start.kind !== 'readers') return start;
      const obs = new Observer(noise, mixSeed(seed, stream, p.id), shared);
      const d = tryOnAtRack(firstPair(r, stock), stock, (s) => measureWithReaders(p, obs, noise, s, m.workingDistanceMm), assessTryOn, maxTries);
      return { ...d, flagged: d.flagged || start.flagged };
    };
    out.spTry050.push(rack(STOCK_050, 31));
    out.spTry025.push(rack(STOCK_025, 32));
    out.oracle050.push(oracle050(p));
  }
  return out;
}

// =====================================================================================================
// 5. COMPARISONS
// =====================================================================================================

const KENYA_BY_SIM_BAND = (band: string) => ({ t4: KENYA_TABLE4.find((x) => x.band === band)!, f1d: KENYA_FIG1D.find((x) => x.band === band)! });
const INDIA_BY_SIM_BAND = (band: string) => INDIA_TABLE2.find((x) => x.band === band) ?? INDIA_TABLE2.find((x) => x.band === '≥65')!;

/** Kenya Eye 2024 Table 2: % failing near-vision screening by age (all comers; informal tests; presenting vision,
 *  so people who brought their reading glasses could pass). Lower bound on unaided failure, poor at older ages. */
const KENYA_SCREEN_FAIL: { band: string; lo: number; hi: number; n: number; failPct: number }[] = [
  { band: '40–45', lo: 40, hi: 45, n: 95082, failPct: 27.73 },
  { band: '45–50', lo: 45, hi: 50, n: 77997, failPct: 34.35 },
  { band: '50–55', lo: 50, hi: 55, n: 67563, failPct: 39.60 },
  { band: '55–59', lo: 55, hi: 60, n: 43208, failPct: 38.89 },
  { band: '60–65', lo: 60, hi: 65, n: 37685, failPct: 47.04 },
  { band: '>65', lo: 65, hi: 70.0001, n: 61759, failPct: 51.23 },
];
/** Asmara Table 2: % presbyopic (cannot read 20/50 at 40 cm with distance correction, improves with +1.00). The
 *  41–45 row prints "702 (2.4%)" non-presbyopic next to 242 (77.6%) presbyopic of 312: a typo; 77.6% is used. */
const ASMARA_PRESBYOPIC_PCT: Record<string, number> = { '35–40': 10.7, '41–45': 77.6, '46–50': 98.2, '51–55': 100, '56–60': 98.3 };

function powerByBand(people: Person[], dec: Record<Id, Decision[]>) {
  return SIM_BANDS.map((b) => {
    const band = people.filter(inBand(b));
    const need = band.filter(needsReaders);
    const { t4, f1d } = KENYA_BY_SIM_BAND(b.band);
    const india = INDIA_BY_SIM_BAND(b.band);
    const ideal = stats(need.map((p) => toFieldRange(p.idealD)));
    const ideal40s = stats(need.map((p) => toFieldRange(ideal40(p))));
    const rec = (id: Id) => {
      const xs = band.filter((p) => dec[id][p.id].kind === 'readers').map((p) => dec[id][p.id].strength!);
      const s = stats(xs);
      return { givenReadersPctOfBand: r1((100 * xs.length) / band.length), ...s, meanMinusKenyaD: s.meanD === null ? null : r2(s.meanD - t4.meanD), medianMinusKenyaD: s.medianD === null || f1d.medianD === null ? null : r2(s.medianD - f1d.medianD) };
    };
    return {
      band: b.band,
      simN: band.length,
      needsReadersPctOfBand: r1((100 * need.length) / band.length),
      failsN6At40PctOfBand: r1((100 * band.filter(failsN6At40).length) / band.length),
      field: {
        kenya: { meanD: t4.meanD, n: t4.n, medianD: f1d.medianD, q1: f1d.q1, q3: f1d.q3 },
        india: { band: india.band, meanD: india.meanD, medianD: india.medianD },
      },
      simIdealOwnDistance: { ...ideal, meanMinusKenyaD: r2(ideal.meanD! - t4.meanD), meanMinusIndiaD: r2(ideal.meanD! - india.meanD) },
      simIdeal40cm: { ...ideal40s, meanMinusKenyaD: r2(ideal40s.meanD! - t4.meanD), meanMinusIndiaD: r2(ideal40s.meanD! - india.meanD), medianMinusKenyaD: f1d.medianD === null ? null : r2(ideal40s.medianD! - f1d.medianD) },
      recommended: Object.fromEntries((['spStart', 'spTry050', 'spTry025', 'age40'] as Id[]).map((id) => [id, rec(id)])),
    };
  });
}

function asmaraComparison(people: Person[]) {
  return ASMARA_TABLE4.filter((b) => b.lo >= 40).map((b) => {
    const band = people.filter(inBand(b));
    return {
      band: b.band,
      field: { addMeanD: b.meanD, addSdD: b.sdD, n: b.n, presbyopicPct: ASMARA_PRESBYOPIC_PCT[b.band] },
      sim: {
        n: band.length,
        addHalfReserveMeanD: r2(mean(band.map((p) => addHalfReserve40(p.amplitudeD)))),
        addMinimumPlusMeanD: r2(mean(band.map((p) => addMinimumPlus40(p.amplitudeD)))),
        presbyopicPct: r1((100 * band.filter(presbyopicWithDistanceRx).length) / band.length),
        meanAmplitudeD: r2(mean(band.map((p) => p.amplitudeD))),
      },
    };
  });
}

function screeningComparison(people: Person[]) {
  return KENYA_SCREEN_FAIL.map((b) => {
    const band = people.filter(inBand(b));
    return { band: b.band, fieldFailPct: b.failPct, fieldN: b.n, simFailsN6At40Pct: r1((100 * band.filter(failsN6At40).length) / band.length) };
  });
}

/** Overall power distribution, sim re-weighted to the Kenyan age mix (Table 4 counts). Our model gives everyone
 *  past ~62.5 zero accommodation, so its 70+ prediction equals its 65–70 band: Kenya's 70+ counts use that band. */
function overallDistribution(people: Person[], dec: Record<Id, Decision[]>) {
  const steps025 = Array.from({ length: 13 }, (_, i) => 1 + i * 0.25);
  const steps050 = Array.from({ length: 7 }, (_, i) => 1 + i * 0.5);
  const fieldTotal = KENYA_FIG1C.reduce((a, b) => a + b.n, 0);
  const field025 = steps025.map((s) => KENYA_FIG1C.find((x) => Math.abs(x.powerD - s) < 1e-9)!.n / fieldTotal);
  const field050 = steps050.map((s) => KENYA_FIG1C.filter((x) => snap050(x.powerD) === s).reduce((a, b) => a + b.n, 0) / fieldTotal);

  const kenyaN = (b: FieldBand) => KENYA_TABLE4.filter((k) => (b.band === '65–69' ? k.lo >= 65 : k.band === b.band)).reduce((a, k) => a + k.n, 0);
  const distOf = (pick: (p: Person) => number | null, steps: number[], snap: (x: number) => number) => {
    const acc = steps.map(() => 0);
    for (const b of SIM_BANDS) {
      const vals = people.filter(inBand(b)).map(pick).filter((v): v is number => v !== null);
      if (!vals.length) continue;
      const w = kenyaN(b) / vals.length;
      for (const v of vals) { const k = steps.findIndex((s) => Math.abs(s - snap(v)) < 1e-9); if (k >= 0) acc[k] += w; }
    }
    const tot = acc.reduce((a, b) => a + b, 0);
    return acc.map((a) => a / tot);
  };
  const cmp = (sim: number[], field: number[]) => {
    let cs = 0, cf = 0, ks = 0, overlap = 0;
    sim.forEach((s, i) => { cs += s; cf += field[i]; ks = Math.max(ks, Math.abs(cs - cf)); overlap += Math.min(s, field[i]); });
    return { ksDistance: r2(ks), overlapPct: r1(100 * overlap) };
  };
  const idealPick = (p: Person) => (needsReaders(p) ? toFieldRange(ideal40(p)) : null);
  const idealOwnPick = (p: Person) => (needsReaders(p) ? toFieldRange(p.idealD) : null);
  const recPick = (id: Id) => (p: Person) => (dec[id][p.id].kind === 'readers' ? dec[id][p.id].strength! : null);
  const pct = (xs: number[]) => xs.map((x) => r1(100 * x));
  const sim025 = distOf(idealPick, steps025, (x) => x);
  const sim050 = distOf(idealPick, steps050, snap050);
  const simOwn050 = distOf(idealOwnPick, steps050, snap050);
  const rec050 = distOf(recPick('spTry050'), steps050, snap050);
  const start050 = distOf(recPick('spStart'), steps050, snap050);
  const age050 = distOf(recPick('age40'), steps050, snap050);
  return {
    note: 'Shares (%) at each power, people given/needing readers, sim re-weighted to the Kenyan age mix (Table 4). Quarter steps are snapped up to the next 0.50 step for the 0.50 view, identically for field and sim.',
    steps025, steps050,
    field025Pct: pct(field025), field050Pct: pct(field050),
    simIdeal40cm025Pct: pct(sim025), simIdeal40cm050Pct: pct(sim050), simIdealOwnDistance050Pct: pct(simOwn050),
    spTry050Pct: pct(rec050), spStart050Pct: pct(start050), ageTable050Pct: pct(age050),
    fieldAbove3Pct: r1(100 * field025.slice(9).reduce((a, b) => a + b, 0)),
    simIdeal40cmAbove3Pct: r1(100 * sim025.slice(9).reduce((a, b) => a + b, 0)),
    vsField: {
      simIdeal40cm_025: cmp(sim025, field025),
      simIdeal40cm_050: cmp(sim050, field050),
      simIdealOwnDistance_050: cmp(simOwn050, field050),
      spTry050_050: cmp(rec050, field050),
      spStart_050: cmp(start050, field050),
      ageTable_050: cmp(age050, field050),
    },
  };
}

const HEADLINE_KEYS = ['appropriatePct', 'within025Pct', 'within050Pct', 'biasD', 'maeD', 'referSafePct', 'myopiaMissedPct', 'noneGivenReadersPct', 'falseNonePct', 'givenReadersPct', 'inScopeN', 'allN'] as const;
function headline(people: Person[], dec: Record<Id, Decision[]>) {
  return Object.fromEntries(IDS.map((id) => {
    const m = computeMetrics(people, dec[id]);
    return [id, Object.fromEntries(HEADLINE_KEYS.map((k) => [k, m[k] === null ? null : Math.round((m[k] as number) * 100) / 100]))];
  })) as Record<Id, Record<(typeof HEADLINE_KEYS)[number], number | null>>;
}
function rightCallByBand(people: Person[], dec: Record<Id, Decision[]>) {
  return SIM_BANDS.map((b) => ({ band: b.band, ...Object.fromEntries((['age40', 'spStart', 'spTry050'] as Id[]).map((id) => [id, r1(computeMetrics(people, dec[id], inBand(b)).appropriatePct)])) }));
}
function truthMix(people: Person[]) {
  const n = people.length;
  const c = (f: (p: Person) => boolean) => r1((100 * people.filter(f).length) / n);
  return { inScopePct: c((p) => p.truth === 'readers'), noneYetPct: c((p) => p.truth === 'none'), referMyopiaPct: c((p) => p.referReason === 'myopia'), referAboveRangePct: c((p) => p.referReason === 'above-range') };
}

/** Post-hoc reweighting of the upper tail. Our population has far more people needing more than +3.00 (at 40 cm)
 *  than Kenya dispensed. Weight those people by k so that, in the Kenyan age mix, their share among people needing
 *  readers equals the field share; everyone else keeps weight 1. Same right-call rule as computeMetrics(). */
function upperTailReweight(people: Person[], dec: Record<Id, Decision[]>, simAbove3Pct: number, fieldAbove3Pct: number) {
  const s = simAbove3Pct / 100, f = fieldAbove3Pct / 100;
  const k = (f * (1 - s)) / (s * (1 - f));
  const hi = (p: Person) => needsReaders(p) && toFieldRange(ideal40(p)) > 3.0;
  const w = (p: Person) => (hi(p) ? k : 1);
  const ok = (p: Person, d: Decision) => {
    if (p.truth === 'refer') return d.kind !== 'readers';
    if (d.kind === 'readers') return Math.abs(d.strength! - p.idealRoundedD) <= 0.5 + 1e-9;
    return p.truth === 'none' && d.kind === 'none';
  };
  const rightCall = (id: Id, weight: (p: Person) => number) => {
    let num = 0, den = 0;
    for (const p of people) { den += weight(p); if (ok(p, dec[id][p.id])) num += weight(p); }
    return (100 * num) / den;
  };
  for (const id of IDS) {
    const unweighted = rightCall(id, () => 1);
    if (Math.abs(unweighted - computeMetrics(people, dec[id]).appropriatePct) > 1e-9) throw new Error('weighted right-call replica mismatch');
  }
  return {
    k: r2(k), simAbove3Pct, fieldAbove3Pct, weightedPeoplePct: r1((100 * people.filter(hi).length) / people.length),
    rightCallPct: Object.fromEntries(IDS.map((id) => [id, r1(rightCall(id, w))])) as Record<Id, number>,
  };
}

// =====================================================================================================
// 6. FIGURES (same visual language as sim/charts.ts: white rounded card, <title>/<desc>, per-mark tooltips)
// =====================================================================================================

const FONT = 'system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, sans-serif';
const INK = '#0b0b0b', INK2 = '#52514e', MUTED = '#6b6a66', GRID = '#e1e0d9', AXIS = '#c3c2b7', BAND = '#f0efec';
const BLUE = '#2a78d6', ORANGE = '#eb6834', BLUE_LIGHT = '#9ec5f4', BLUE_DARK = '#184f93', NEUTRAL = '#8a8880';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fd = (x: number) => `+${x.toFixed(2)}`;

function frame(id: string, w: number, h: number, title: string, subtitle: string, desc: string, body: string, footer: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${id}-title ${id}-desc" font-family="${FONT}">
<title id="${id}-title">${esc(title)}</title>
<desc id="${id}-desc">${esc(desc)}</desc>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="#ffffff" stroke="${GRID}"/>
<text x="24" y="34" font-size="17" font-weight="600" fill="${INK}">${esc(title)}</text>
<text x="24" y="55" font-size="12.5" fill="${INK2}">${esc(subtitle)}</text>
${body}
${footer.map((f, i) => `<text x="24" y="${h - 16 - (footer.length - 1 - i) * 15}" font-size="11" fill="${MUTED}">${esc(f)}</text>`).join('\n')}
</svg>
`;
}
function badge(w: number, text: string, bw = 150): string {
  return `<g aria-hidden="true"><rect x="${w - 24 - bw}" y="20" width="${bw}" height="22" rx="11" fill="${BAND}" stroke="${AXIS}"/>
<text x="${w - 24 - bw / 2}" y="35" font-size="11" font-weight="600" fill="${INK2}" text-anchor="middle" letter-spacing="0.6">${esc(text)}</text></g>`;
}
const circle = (x: number, y: number, c: string, filled = true) => `<circle cx="${x}" cy="${y}" r="5" fill="${filled ? c : '#fff'}" stroke="${filled ? '#fff' : c}" stroke-width="${filled ? 2 : 1.8}"/>`;
const square = (x: number, y: number, c: string) => `<rect x="${x - 4.5}" y="${y - 4.5}" width="9" height="9" fill="#fff" stroke="${c}" stroke-width="1.8"/>`;
const diamond = (x: number, y: number, c: string) => `<path d="M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z" fill="#fff" stroke="${c}" stroke-width="1.8"/>`;

interface PowerFigData {
  bands: { band: string; mid: number; kenyaMean: number; kenyaQ1: number; kenyaQ3: number; indiaMean: number; simNeed40: number; simTry050: number; ageTable: number }[];
  asmara: { band: string; mid: number; field: number; simMain: number; simCalib: number }[];
}

function powerFigure(d: PowerFigData): string {
  const w = 780, h = 548;
  const panelW = 340, ph = 300, top = 150;
  const panels = [{ ox: 24 + 34, title: 'People handed readers (field: Kenya, India)' }, { ox: 24 + 34 + panelW + 40, title: 'Everyone, distance error corrected (field: Asmara)' }];
  const yMax = 3.5;
  const xOf = (ox: number, age: number) => ox + ((age - 40) / 30) * (panelW - 34);
  const yOf = (v: number) => top + ph - (v / yMax) * ph;
  let body = badge(w, 'REAL DATA vs SIMULATION', 190);
  // legend
  const lg = [
    [`<line x1="0" y1="0" x2="18" y2="0" stroke="${INK}" stroke-width="1.5"/>${circle(9, 0, INK)}`, 'Kenya mean, bar = IQR (field)'],
    [square(9, 0, INK), 'India mean (field)'],
    [diamond(9, 0, INK), 'Asmara add (field)'],
    [`<line x1="0" y1="0" x2="18" y2="0" stroke="${BLUE}" stroke-width="2.5"/>`, 'Sim ideal at 40 cm (our population)'],
    [`<line x1="0" y1="0" x2="18" y2="0" stroke="${ORANGE}" stroke-width="2.5"/>`, 'Small Print + try-on (sim)'],
    [`<line x1="0" y1="0" x2="18" y2="0" stroke="${NEUTRAL}" stroke-width="1.5" stroke-dasharray="4 3"/>`, 'Age table (40 cm)'],
    [`<line x1="0" y1="0" x2="18" y2="0" stroke="${BLUE}" stroke-width="2" stroke-dasharray="6 4"/>`, 'Sim, field-calibrated accommodation'],
  ] as const;
  lg.forEach(([mark, label], i) => {
    const lx = 24 + (i % 3) * 250, ly = 74 + Math.floor(i / 3) * 18;
    body += `<g transform="translate(${lx} ${ly})">${mark}<text x="26" y="4" font-size="11.5" fill="${INK2}">${esc(label)}</text></g>`;
  });
  for (const [pi, p] of panels.entries()) {
    const ox = p.ox;
    body += `<text x="${ox - 34}" y="${top - 14}" font-size="12.5" font-weight="600" fill="${INK}">${esc(p.title)}</text>`;
    for (const t of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) {
      body += `<line x1="${ox}" y1="${yOf(t)}" x2="${ox + panelW - 34}" y2="${yOf(t)}" stroke="${t === 0 ? AXIS : GRID}"/>`;
      body += `<text x="${ox - 6}" y="${yOf(t) + 4}" font-size="10.5" fill="${INK2}" text-anchor="end">${t === 0 ? '0' : fd(t)}</text>`;
    }
    for (const a of [40, 45, 50, 55, 60, 65, 70]) body += `<text x="${xOf(ox, a)}" y="${top + ph + 16}" font-size="10.5" fill="${INK2}" text-anchor="middle">${a}</text>`;
    body += `<text x="${ox + (panelW - 34) / 2}" y="${top + ph + 34}" font-size="11.5" fill="${INK2}" text-anchor="middle">Age (years)</text>`;
    if (pi === 0) {
      body += `<text transform="translate(${ox - 40} ${top + ph / 2}) rotate(-90)" font-size="11.5" fill="${INK2}" text-anchor="middle">Reading-glasses power (D)</text>`;
      const pts = (f: (b: PowerFigData['bands'][number]) => number) => d.bands.map((b) => `${xOf(ox, b.mid).toFixed(1)},${yOf(f(b)).toFixed(1)}`).join(' ');
      // age table as a step function
      const steps: [number, number][] = [[40, 1], [45.5, 1], [45.5, 1.5], [50.5, 1.5], [50.5, 2], [55.5, 2], [55.5, 2.5], [70, 2.5]];
      body += `<polyline points="${steps.map(([a, v]) => `${xOf(ox, a).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${NEUTRAL}" stroke-width="1.5" stroke-dasharray="4 3"><title>Age table (Stevens 2019, 40 cm): +1.00 to 45, +1.50 to 50, +2.00 to 55, +2.50 after</title></polyline>`;
      body += `<polyline points="${pts((b) => b.simNeed40)}" fill="none" stroke="${BLUE}" stroke-width="2.5"/>`;
      body += `<polyline points="${pts((b) => b.simTry050)}" fill="none" stroke="${ORANGE}" stroke-width="2.5"/>`;
      for (const b of d.bands) {
        const x = xOf(ox, b.mid);
        body += `<g><title>${esc(`${b.band}: sim ideal at 40 cm (people who need +1.00 or more) mean ${fd(b.simNeed40)}`)}</title><circle cx="${x}" cy="${yOf(b.simNeed40)}" r="3.5" fill="${BLUE}"/></g>`;
        body += `<g><title>${esc(`${b.band}: Small Print + try-on (0.50 stock) mean ${fd(b.simTry050)} among people handed readers`)}</title><circle cx="${x}" cy="${yOf(b.simTry050)}" r="3.5" fill="${ORANGE}"/></g>`;
        body += `<g><title>${esc(`${b.band}: Kenya field mean ${fd(b.kenyaMean)}, IQR ${fd(b.kenyaQ1)} to ${fd(b.kenyaQ3)}`)}</title><line x1="${x - 3}" y1="${yOf(b.kenyaQ1)}" x2="${x - 3}" y2="${yOf(b.kenyaQ3)}" stroke="${INK}" stroke-width="1.5"/>${circle(x - 3, yOf(b.kenyaMean), INK)}</g>`;
        body += `<g><title>${esc(`${b.band}: India field mean ${fd(b.indiaMean)}`)}</title>${square(x + 6, yOf(b.indiaMean), INK)}</g>`;
      }
      const last = d.bands[d.bands.length - 1];
      body += `<text x="${xOf(ox, last.mid) + 10}" y="${yOf(last.simNeed40) - 6}" font-size="11" fill="${INK2}">sim ideal</text>`;
      body += `<text x="${xOf(ox, last.mid) + 10}" y="${yOf(last.simTry050) + 26}" font-size="11" fill="${INK2}">Small Print</text>`;
    } else {
      const pts = (f: (b: PowerFigData['asmara'][number]) => number) => d.asmara.map((b) => `${xOf(ox, b.mid).toFixed(1)},${yOf(f(b)).toFixed(1)}`).join(' ');
      body += `<polyline points="${pts((b) => b.simMain)}" fill="none" stroke="${BLUE}" stroke-width="2.5"/>`;
      body += `<polyline points="${pts((b) => b.simCalib)}" fill="none" stroke="${BLUE}" stroke-width="2" stroke-dasharray="6 4"/>`;
      for (const b of d.asmara) {
        const x = xOf(ox, b.mid);
        body += `<g><title>${esc(`${b.band}: our population, mean add at 40 cm (half the accommodation in reserve) ${fd(b.simMain)}`)}</title><circle cx="${x}" cy="${yOf(b.simMain)}" r="3.5" fill="${BLUE}"/></g>`;
        body += `<g><title>${esc(`${b.band}: Asmara field mean add ${fd(b.field)}`)}</title>${diamond(x, yOf(b.field), INK)}</g>`;
      }
      const l = d.asmara[d.asmara.length - 1];
      body += `<text x="${xOf(ox, l.mid) + 10}" y="${yOf(l.simMain) + 4}" font-size="11" fill="${INK2}">our population</text>`;
      const f0 = d.asmara[0];
      body += `<text x="${xOf(ox, f0.mid) - 6}" y="${yOf(f0.field) - 12}" font-size="11" fill="${INK2}">Asmara (field)</text>`;
      body += `<text x="${xOf(ox, l.mid) + 10}" y="${yOf(l.simCalib) - 8}" font-size="11" fill="${INK2}">calibrated</text>`;
      body += `<text x="${xOf(ox, l.mid) + 10}" y="${yOf(l.simCalib) + 6}" font-size="11" fill="${INK2}">to fit field</text>`;
      body += `<text x="${xOf(ox, 64)}" y="${yOf(0.35)}" font-size="10.5" fill="${MUTED}" text-anchor="middle">Asmara sampled ages 35–60 only</text>`;
    }
  }
  const desc = 'Two-panel line and dot chart comparing published field data with the simulation. ' +
    d.bands.map((b) => `${b.band}: Kenya mean ${fd(b.kenyaMean)}, India ${fd(b.indiaMean)}, simulated ideal at 40 cm ${fd(b.simNeed40)}, Small Print plus try-on ${fd(b.simTry050)}`).join('; ') +
    '. Everyone, distance-corrected add: ' + d.asmara.map((b) => `${b.band}: Asmara ${fd(b.field)}, our population ${fd(b.simMain)}`).join('; ') + '.';
  return frame('fig-fieldcheck-power', w, h, 'Reading-glasses power by age: real programmes vs our simulation',
    'Field = published data (no new participants). Left: people who were handed readers. Right: everyone, distance error corrected.', desc, body,
    ['Field: Katibeh 2024 Eye (Kenya, Table 4 means, Fig 1d IQR); Katibeh 2026 Front Ophthalmol (India, Table 2); Smret 2023 Clin Optom (Asmara, Table 4).',
      'Sim: seed 20261003, n = 20,000, ages 40–70. Left: sim ideal = people needing at least +1.00 and not myopic, capped at +4.00. See sim/FIELDCHECK.md.']);
}

interface SensRow { label: string; values: { pop: string; v: number }[] }
function sensitivityFigure(rows: SensRow[], pops: string[], metricLabel: string): string {
  const w = 780, left = 250, right = 70, top = 104, rowH = 64;
  const h = top + rows.length * rowH + 70;
  const plotW = w - left - right;
  const x = (v: number) => left + (v / 100) * plotW;
  const fills = [BLUE_LIGHT, BLUE, BLUE_DARK];
  let body = badge(w, 'SIMULATION', 92);
  pops.forEach((p, i) => {
    const lx = 24 + i * 250;
    body += `<g font-size="11.5" fill="${INK2}"><rect x="${lx}" y="70" width="12" height="12" rx="2" fill="${fills[i]}"/><text x="${lx + 18}" y="80">${esc(p)}</text></g>`;
  });
  const bottom = top + rows.length * rowH - 6;
  for (const t of [0, 25, 50, 75, 100]) {
    body += `<line x1="${x(t)}" y1="${top - 6}" x2="${x(t)}" y2="${bottom}" stroke="${t === 0 ? AXIS : GRID}"/>`;
    body += `<text x="${x(t)}" y="${bottom + 16}" font-size="11" fill="${INK2}" text-anchor="middle">${t}%</text>`;
  }
  body += `<text x="${left + plotW / 2}" y="${bottom + 34}" font-size="11.5" fill="${INK2}" text-anchor="middle">${esc(metricLabel)}</text>`;
  rows.forEach((r, k) => {
    const y = top + k * rowH;
    body += `<text x="24" y="${y + 28}" font-size="12.5" fill="${INK}">${esc(r.label)}</text>`;
    r.values.forEach((v, i) => {
      const by = y + i * 17, bh = 14;
      body += `<g><title>${esc(`${r.label}, ${v.pop}: ${v.v.toFixed(1)}%`)}</title><rect x="${left}" y="${by}" width="${Math.max(1, x(v.v) - left)}" height="${bh}" rx="2" fill="${fills[i]}"/>`;
      body += `<text x="${x(v.v) + 6}" y="${by + bh - 3}" font-size="11" fill="${INK2}">${v.v.toFixed(1)}%</text></g>`;
    });
  });
  const desc = rows.map((r) => `${r.label}: ` + r.values.map((v) => `${v.pop} ${v.v.toFixed(1)}%`).join(', ')).join('; ') + '.';
  return frame('fig-fieldcheck-sensitivity', w, h, 'If our virtual people aged like the field data, how do the results move?',
    'Same 20,000 virtual people; only their accommodation changes, re-calibrated to the Asmara field adds (two readings of "add").', `Grouped bar chart, simulation sensitivity. ${desc}`, body,
    ['Right call = a pair within ±0.50 D of ideal if needed; no readers if they should be referred or don\'t need them yet. Over everyone, ages 40–70.']);
}

// =====================================================================================================
// 7. MAIN
// =====================================================================================================

function main() {
  const t0 = Date.now();
  const cardReserveD = calibrateCardReserve(DEFAULT_SCENARIO);
  const cfg: ScenarioConfig = { ...DEFAULT_SCENARIO, cardReserveD };
  const { seed, n, population } = cfg;

  // --- main population, and a check that our replica loop reproduces runScenario exactly
  const ref = runScenario(cfg);
  const people = ref.people;
  const dec = runStrategies(people, cfg);
  const mismatches = IDS.reduce((acc, id) => acc + dec[id].filter((d, i) => d.kind !== ref.decisions[id][i].kind || d.strength !== ref.decisions[id][i].strength).length, 0);
  if (mismatches) throw new Error(`replica loop differs from runScenario on ${mismatches} decisions`);
  const wrapCheck = people.filter((p) => Math.abs(personWithAmplitudeCentre(population, seed, p.id, (a) => hofstetter(a).mean).amplitudeD - p.amplitudeD) > 1e-12).length;
  if (wrapCheck) throw new Error(`generator wrapper differs from makePerson on ${wrapCheck} people`);

  // --- (a)+(b) main population vs field
  const mainPower = powerByBand(people, dec);
  const mainAsmara = asmaraComparison(people);
  const mainScreening = screeningComparison(people);
  const mainDist = overallDistribution(people, dec);

  // Post-hoc reweighting is not viable: in the youngest bands almost nobody in our population needs readers.
  const reweightFeasibility = SIM_BANDS.map((b) => {
    const band = people.filter(inBand(b));
    return { band: b.band, simN: band.length, simFailsN6At40N: band.filter(failsN6At40).length, simNeedsReadersN: band.filter(needsReaders).length };
  });

  // --- (c) sensitivity: accommodation re-centred so the sim's mean add matches Asmara's, two readings of "add"
  const anchorsHalf = asmaraAnchors(addHalfReserve40);
  const anchorsMin = asmaraAnchors(addMinimumPlus40);
  const variants = [
    { id: 'main', label: 'Shipped bench population (Hofstetter mean)', centre: (a: number) => hofstetter(a).mean, anchors: null as Anchor[] | null },
    { id: 'field-half-reserve', label: 'Field-calibrated: add = keep half in reserve', centre: centreFromAnchors(anchorsHalf), anchors: anchorsHalf },
    { id: 'field-minimum-plus', label: 'Field-calibrated: add = minimum plus', centre: centreFromAnchors(anchorsMin), anchors: anchorsMin },
  ];
  const sens = variants.map((v) => {
    const pop = v.id === 'main' ? people : Array.from({ length: n }, (_, id) => personWithAmplitudeCentre(population, seed, id, v.centre));
    const d = v.id === 'main' ? dec : runStrategies(pop, cfg);
    const dist = overallDistribution(pop, d);
    return {
      id: v.id,
      label: v.label,
      amplitudeCentreD: [40, 45, 50, 55, 60, 65, 70].map((a) => ({ age: a, centreD: r2(Math.max(0, v.centre(a))), hofstetterMeanD: r2(hofstetter(a).mean) })),
      anchors: v.anchors?.map((a) => ({ age: a.age, targetAddD: a.targetAddD, centreD: r2(a.centreD) })) ?? null,
      truthMix: truthMix(pop),
      headline: headline(pop, d),
      rightCallByBand: rightCallByBand(pop, d),
      fieldCheck: { powerByBand: powerByBand(pop, d), asmara: asmaraComparison(pop), screening: screeningComparison(pop), distribution: dist },
      upperTailReweighted: upperTailReweight(pop, d, dist.simIdeal40cmAbove3Pct, dist.fieldAbove3Pct),
      _pop: pop,
      _dec: d,
    };
  });

  // --- outputs
  const strip = ({ _pop, _dec, ...rest }: (typeof sens)[number]) => rest;
  const out = {
    label: 'FIELD CHECK: published real-world reading-glasses powers vs the SIMULATED bench population and Small Print\'s SIMULATED recommendations. Population-level plausibility only; no new participants.',
    generatedAt: new Date().toISOString(),
    config: { seed, n, ages: [population.ageMin, population.ageMax], cardReserveD, script: 'sim/fieldcheck.ts', replicaCheck: 'runStrategies() == runScenario() on all main decisions; personWithAmplitudeCentre(Hofstetter mean) == makePerson()' },
    sources: SOURCES,
    extracted: {
      kenyaTable4: KENYA_TABLE4,
      kenyaFig1d: KENYA_FIG1D,
      kenyaFig1c: { note: 'Digitised from bar heights (1 px ≈ 24 people); total 34,022 vs 34,283 reported.', counts: KENYA_FIG1C },
      kenyaTable2ScreeningFail: KENYA_SCREEN_FAIL,
      kenyaText: { screened: 388939, failedNearScreening: 146801, failedPct: 37.74, kenyaWithPower: 34328, mostCommonPowers: ['+2.00', '+2.50', '+3.00'], authorsStartingRule: '1.50 D for 40–44, 2.00 D for 45–54, 2.50 D for 55–59, 3.00 D for over 60 (Discussion)' },
      indiaTable2: INDIA_TABLE2,
      indiaText: { n: 378, meanAge: 45.7, sdAge: 6.7, calculatorExactAgreementPct: 92.9, within050Pct: 99.5 },
      asmaraTable4: ASMARA_TABLE4,
      asmaraTable2PresbyopicPct: ASMARA_PRESBYOPIC_PCT,
      asmaraText: { n: 1310, presbyopicPct: 74.1, addRiseNote: '"every five years age increase in given addition 0.4–0.5 DS" (Discussion)' },
      thriveTable1: { medianPowerD: 1.0, iqrD: [1.0, 1.5], meanAge: [46.9, 47.4], n: [423, 401], note: 'assigned by an NVA rule, not measured' },
      panke2019Abstract: { n: 216, ageRange: [35, 80], rAgeAdd: 0.73 },
    },
    comparisons: {
      definitions: {
        needsReaders: 'sim person with refractive error ≥ −1.00 D and ideal (rounded) ≥ +1.00 D; powers capped to the field stock range +1.00..+4.00',
        simIdeal40cm: 'A* = 2.5 + RE − AA/2 (field charts at 40 cm); simIdealOwnDistance uses the person\'s own reading distance (mean 37 cm)',
        failsN6At40: 'no glasses, 2.5 D outside the clear range [−RE − DOF/2, AA − RE + DOF/2]',
        asmaraAdd: 'distance error corrected (RE removed): half-reserve add = max(0, 2.5 − AA/2); minimum-plus add = max(0, 2.5 − AA − 0.325)',
      },
      powerByBand: mainPower,
      asmara: mainAsmara,
      screening: mainScreening,
      distribution: mainDist,
      reweightFeasibility,
    },
    sensitivity: sens.map(strip),
  };
  mkdirSync(resolve(ROOT, 'public/data'), { recursive: true });
  mkdirSync(resolve(ROOT, 'public/figures'), { recursive: true });
  writeFileSync(resolve(ROOT, 'public/data/fieldcheck.json'), JSON.stringify(out, null, 1));

  const calib = sens.find((s) => s.id === 'field-half-reserve')!;
  const figData: PowerFigData = {
    bands: mainPower.map((b, i) => ({
      band: b.band, mid: SIM_BANDS[i].lo + 2.5,
      kenyaMean: b.field.kenya.meanD, kenyaQ1: b.field.kenya.q1, kenyaQ3: b.field.kenya.q3, indiaMean: b.field.india.meanD,
      simNeed40: b.simIdeal40cm.meanD!, simTry050: (b.recommended as Record<string, Stats>).spTry050.meanD!, ageTable: (b.recommended as Record<string, Stats>).age40.meanD!,
    })),
    asmara: mainAsmara.map((b, i) => ({ band: b.band, mid: (ASMARA_TABLE4.filter((x) => x.lo >= 40)[i].lo + ASMARA_TABLE4.filter((x) => x.lo >= 40)[i].hi) / 2, field: b.field.addMeanD, simMain: b.sim.addHalfReserveMeanD, simCalib: calib.fieldCheck.asmara[i].sim.addHalfReserveMeanD })),
  };
  writeFileSync(resolve(ROOT, 'public/figures/fieldcheck-power-by-age.svg'), powerFigure(figData));
  const rowsFor = (ids: Id[]) => ids.map((id) => ({ label: LABELS[id], values: sens.map((s) => ({ pop: s.label, v: s.headline[id].appropriatePct! })) }));
  writeFileSync(resolve(ROOT, 'public/figures/fieldcheck-sensitivity.svg'),
    sensitivityFigure(rowsFor(['age40', 'card14', 'spStart', 'spTry050', 'spTry025']), ['Shipped population (Hofstetter mean)', 'Field-calibrated (half reserve)', 'Field-calibrated (minimum plus)'], 'Right call, everyone (higher is better)'));

  // --- console summary
  const f = (x: number | null | undefined) => (x === null || x === undefined ? '–' : x.toFixed(2));
  console.log(`fieldcheck: ${Date.now() - t0} ms, replica OK`);
  console.log('band  | sim need% fail% | Kenya mean/med [IQR] | India | sim ideal40 mean/med | own-W mean | SPstart mean/med g% | SP+try050 mean/med g% | age40');
  for (const b of mainPower) {
    const rc = b.recommended as Record<string, Stats & { givenReadersPctOfBand: number }>;
    console.log(`${b.band} | ${b.needsReadersPctOfBand} ${b.failsN6At40PctOfBand} | ${f(b.field.kenya.meanD)}/${f(b.field.kenya.medianD)} [${b.field.kenya.q1},${b.field.kenya.q3}] | ${f(b.field.india.meanD)} | ${f(b.simIdeal40cm.meanD)}/${f(b.simIdeal40cm.medianD)} | ${f(b.simIdealOwnDistance.meanD)} | ${f(rc.spStart.meanD)}/${f(rc.spStart.medianD)} ${rc.spStart.givenReadersPctOfBand} | ${f(rc.spTry050.meanD)}/${f(rc.spTry050.medianD)} ${rc.spTry050.givenReadersPctOfBand} | ${f(rc.age40.meanD)}`);
  }
  console.log('Asmara band | field add / presb% | sim half-reserve add / min-plus add / presb% / meanAA');
  for (const b of mainAsmara) console.log(`${b.band} | ${b.field.addMeanD} / ${b.field.presbyopicPct} | ${b.sim.addHalfReserveMeanD} / ${b.sim.addMinimumPlusMeanD} / ${b.sim.presbyopicPct} / ${b.sim.meanAmplitudeD}`);
  console.log('screening:', mainScreening.map((s) => `${s.band} field ${s.fieldFailPct} sim ${s.simFailsN6At40Pct}`).join(' | '));
  console.log('dist 0.50 steps', mainDist.steps050.join(' '), '\n field', mainDist.field050Pct.join(' '), '\n simIdeal40', mainDist.simIdeal40cm050Pct.join(' '), '\n spTry050', mainDist.spTry050Pct.join(' '), '\n', JSON.stringify(mainDist.vsField));
  console.log('reweight feasibility', JSON.stringify(reweightFeasibility));
  for (const s of sens) {
    console.log(`\n== ${s.label}: truth ${JSON.stringify(s.truthMix)} anchors ${JSON.stringify(s.anchors)}`);
    for (const id of ['age40', 'card14', 'spStart', 'spTry050', 'spTry025'] as Id[]) {
      const m = s.headline[id];
      console.log(`  ${LABELS[id].padEnd(36)} right ${f(m.appropriatePct)} | ±0.25 ${f(m.within025Pct)} | ±0.50 ${f(m.within050Pct)} | bias ${f(m.biasD)} | refer ${f(m.referSafePct)} | falseNone ${f(m.falseNonePct)}`);
    }
    console.log('  rightCallByBand', JSON.stringify(s.rightCallByBand));
    console.log('  upperTail', JSON.stringify(s.upperTailReweighted));
    console.log('  power check', s.fieldCheck.powerByBand.map((b) => `${b.band}: need ${b.needsReadersPctOfBand}% ideal40 ${f(b.simIdeal40cm.meanD)} vs K ${b.field.kenya.meanD} / I ${b.field.india.meanD}; SP ${f((b.recommended as Record<string, Stats>).spTry050.meanD)}`).join(' | '));
    console.log('  asmara', s.fieldCheck.asmara.map((b) => `${b.band} ${b.sim.addHalfReserveMeanD}/${b.sim.addMinimumPlusMeanD} presb ${b.sim.presbyopicPct}`).join(' | '));
  }
}

main();
