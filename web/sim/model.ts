// SIMULATION ONLY. Virtual people for the Small Print test bench: not real participants, not clinical data.
// Every number below is either cited or labelled as an assumption in sim/README.md.
//
// Optics (derived in sim/README.md):
//   An eye with spherical refractive error RE (dioptres, + = long-sighted), accommodation AA and total
//   depth of focus DOF, wearing readers of power A, sees an object at distance d clearly iff its
//   vergence demand D = 1/d (dioptres) satisfies
//       A − RE − DOF/2  ≤  D  ≤  A − RE + AA + DOF/2.
//   Midpoint of that range = A − RE + AA/2, so the readers that centre the working distance W are
//       A* = 1/W + RE − AA/2   ("keep half the accommodation in reserve", Stevens 2019).

import type { Measurements } from '../src/core/recommend';
import type { TryOnMeasurement } from '../src/core/tryon';
import { hofstetter } from '../src/core/optics';

// ---------------------------------------------------------------- seeded randomness

export type Rng = () => number;

/** mulberry32: tiny, fast, seedable PRNG (public domain). Same seed → same sequence on every machine. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix a base seed with stream ids into an independent 32-bit seed (murmur3-style finaliser). */
export function mixSeed(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** Standard normal draw (Box–Muller). Always consumes exactly two uniforms, so streams stay aligned. */
export function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const round025 = (x: number) => Math.round(x * 4) / 4;

// ---------------------------------------------------------------- population

export type AmplitudeNorm = 'hofstetter-mean' | 'hofstetter-min';

export interface RefractionComponent { weight: number; meanD: number; sdD: number }

export interface PopulationConfig {
  ageMin: number;
  ageMax: number;
  /** Centre of the accommodation distribution for each age (Hofstetter 1950). */
  amplitudeNorm: AmplitudeNorm;
  /** Person-to-person SD of accommodation around that centre (D). Assumption. */
  amplitudeSdD: number;
  /** Mixture of normals for uncorrected spherical refractive error (D, + = hyperopia). Assumption. */
  refraction: RefractionComponent[];
  refractionClipD: [number, number];
  /** Total depth of focus, uniform in [min, max] D (set min = max for a fixed value). */
  dofMinD: number;
  dofMaxD: number;
  /** Habitual reading distance, normal, clipped (cm). */
  workingDistanceMeanCm: number;
  workingDistanceSdCm: number;
  workingDistanceClipCm: [number, number];
  /** Comfortable arm's reach for holding a phone, uniform (cm). */
  reachMinCm: number;
  reachMaxCm: number;
}

export const DEFAULT_POPULATION: PopulationConfig = {
  ageMin: 40,
  ageMax: 70,
  amplitudeNorm: 'hofstetter-mean',
  amplitudeSdD: 0.75,
  refraction: [
    { weight: 0.72, meanD: 0.25, sdD: 0.5 }, // near-emmetropic core, slight age-related hyperopic shift
    { weight: 0.16, meanD: 1.5, sdD: 1.0 }, // hyperopic tail
    { weight: 0.12, meanD: -2.0, sdD: 1.25 }, // myopic tail (people with distance glasses are screened out earlier)
  ],
  refractionClipD: [-6, 5],
  dofMinD: 0.3,
  dofMaxD: 1.0,
  workingDistanceMeanCm: 37,
  workingDistanceSdCm: 5,
  workingDistanceClipCm: [25, 55],
  reachMinCm: 55,
  reachMaxCm: 70,
};

/** Who should get what. Readers can only serve people in scope; everyone else should be referred. */
export const SCOPE = {
  /** Uncorrected myopia worse than this: readers do not fix distance blur; a myopic shift after 60 can
   *  also signal cataract. Rule set for this bench (assumption, following the task brief). */
  referMyopiaBelowD: -1.0,
  /** Ideal power (rounded) below this: does not need readers yet. */
  minUsefulD: 0.75,
  /** Ideal power (rounded) above this: beyond ready-made readers (Stevens 2019). */
  maxReadersD: 3.0,
} as const;

export type Truth = 'readers' | 'none' | 'refer';
export type ReferReason = 'myopia' | 'above-range' | null;

export interface Person {
  id: number;
  age: number;
  amplitudeD: number;
  refractiveErrorD: number;
  depthOfFocusD: number;
  workingDistanceM: number;
  reachM: number;
  /** A* before rounding. */
  idealD: number;
  /** A* rounded to 0.25 D: the target every strategy is scored against. */
  idealRoundedD: number;
  truth: Truth;
  referReason: ReferReason;
}

/** True ideal readers: centre the working distance in the clear range. */
export const idealReaders = (workingDistanceM: number, refractiveErrorD: number, amplitudeD: number) =>
  1 / workingDistanceM + refractiveErrorD - amplitudeD / 2;

export function classify(refractiveErrorD: number, idealRoundedD: number): { truth: Truth; referReason: ReferReason } {
  if (refractiveErrorD < SCOPE.referMyopiaBelowD) return { truth: 'refer', referReason: 'myopia' };
  if (idealRoundedD > SCOPE.maxReadersD) return { truth: 'refer', referReason: 'above-range' };
  if (idealRoundedD < SCOPE.minUsefulD) return { truth: 'none', referReason: null };
  return { truth: 'readers', referReason: null };
}

/** Person i of a seeded population. Draw order is fixed, so person i is the same in every scenario that
 *  shares the seed (common random numbers: sensitivity runs differ only by the parameter being varied). */
export function makePerson(cfg: PopulationConfig, seed: number, id: number): Person {
  const rng = mulberry32(mixSeed(seed, 1, id));
  const age = cfg.ageMin + rng() * (cfg.ageMax - cfg.ageMin);
  const zAmp = gaussian(rng);
  const uMix = rng();
  const zRe = gaussian(rng);
  const uDof = rng();
  const zW = gaussian(rng);
  const uReach = rng();

  const h = hofstetter(age);
  const centre = cfg.amplitudeNorm === 'hofstetter-mean' ? h.mean : h.min;
  const amplitudeD = clamp(centre + zAmp * cfg.amplitudeSdD, 0, h.max);

  let acc = 0;
  let comp = cfg.refraction[cfg.refraction.length - 1];
  for (const c of cfg.refraction) {
    acc += c.weight;
    if (uMix < acc) { comp = c; break; }
  }
  const refractiveErrorD = clamp(comp.meanD + zRe * comp.sdD, cfg.refractionClipD[0], cfg.refractionClipD[1]);

  const depthOfFocusD = cfg.dofMinD + uDof * (cfg.dofMaxD - cfg.dofMinD);
  const workingDistanceM = clamp(cfg.workingDistanceMeanCm + zW * cfg.workingDistanceSdCm, cfg.workingDistanceClipCm[0], cfg.workingDistanceClipCm[1]) / 100;
  const reachM = (cfg.reachMinCm + uReach * (cfg.reachMaxCm - cfg.reachMinCm)) / 100;

  const idealD = idealReaders(workingDistanceM, refractiveErrorD, amplitudeD);
  const idealRoundedD = round025(idealD);
  return { id, age, amplitudeD, refractiveErrorD, depthOfFocusD, workingDistanceM, reachM, idealD, idealRoundedD, ...classify(refractiveErrorD, idealRoundedD) };
}

export function makePopulation(cfg: PopulationConfig, seed: number, n: number): Person[] {
  return Array.from({ length: n }, (_, i) => makePerson(cfg, seed, i));
}

/** Clear range (vergence demand, D) of a person wearing readers of power A (A = 0: no glasses). */
export function clearRange(p: Person, readersD: number) {
  return {
    farD: readersD - p.refractiveErrorD - p.depthOfFocusD / 2,
    nearD: readersD - p.refractiveErrorD + p.amplitudeD + p.depthOfFocusD / 2,
  };
}

// ---------------------------------------------------------------- measurement noise

export interface NoiseConfig {
  /** Relative camera-distance error shared by every reading of one person (calibration / iris-size error). */
  distanceSharedSd: number;
  /** Relative camera-distance error drawn afresh for every reading (landmark jitter). */
  distanceReadingSd: number;
  /** SD (D) of the subjective judgement of where the E blurs, drawn independently for every limit. */
  blurJudgementSdD: number;
  /** Relative SD between where someone holds the phone when asked and where they really read. */
  holdingVariabilitySd: number;
  /** Fraction of the way toward their no-glasses near point that people push the phone out when the
   *  working distance is captured without glasses (0 = they hold it where they would like to read). */
  armStretch: number;
  /** Closest distance the camera can measure (the face must stay in frame), cm. Assumption. */
  minDistanceCm: number;
  /** Relative SD of where people hold a printed rack card when nothing checks the distance. */
  cardHoldingSd: number;
}

export const DEFAULT_NOISE: NoiseConfig = {
  distanceSharedSd: 0.04,
  distanceReadingSd: 0.01,
  blurJudgementSdD: 0.25,
  holdingVariabilitySd: 0,
  armStretch: 0,
  minDistanceCm: 12,
  cardHoldingSd: 0.1,
};

/** Shared (per-person) relative distance error, from its own stream so it is the same in every session. */
export const sharedDistanceError = (seed: number, id: number, noise: NoiseConfig) =>
  gaussian(mulberry32(mixSeed(seed, 2, id))) * noise.distanceSharedSd;

/** One measuring session for one person: camera readings and blur judgements with seeded noise. */
export class Observer {
  private readonly rng: Rng;
  constructor(private readonly noise: NoiseConfig, seed: number, private readonly shared: number) {
    this.rng = mulberry32(seed);
  }
  /** What the camera reports (mm) for a true eye-to-screen distance in metres. */
  cameraMm(trueM: number): number {
    return trueM * 1000 * (1 + this.shared + gaussian(this.rng) * this.noise.distanceReadingSd);
  }
  /** Error (D) in judging where the E blurs. */
  judgement(): number {
    return gaussian(this.rng) * this.noise.blurJudgementSdD;
  }
  z(): number {
    return gaussian(this.rng);
  }
}

// ---------------------------------------------------------------- simulated app measurements

export interface NoGlassesSession {
  measurements: Measurements;
  /** Where the phone was actually held for the working-distance capture (m). */
  heldWorkingDistanceM: number;
}

/** Simulates the no-glasses part of the app: working distance, push-up near point, N6 check. */
export function measureWithoutGlasses(p: Person, obs: Observer, noise: NoiseConfig): NoGlassesSession {
  const { nearD, farD } = clearRange(p, 0);
  const minM = noise.minDistanceCm / 100;
  const reachD = 1 / p.reachM;
  // Draw everything up front so the stream stays aligned whatever branch is taken.
  const zHold = obs.z();
  const eNear = obs.judgement();
  const eFar = obs.judgement();
  const eSpNear = obs.judgement();
  const eSpFar = obs.judgement();

  let held = p.workingDistanceM * (1 + zHold * noise.holdingVariabilitySd);
  if (noise.armStretch > 0 && nearD < 1 / held) {
    const nearM = nearD > reachD ? 1 / nearD : p.reachM;
    held += noise.armStretch * (nearM - held);
  }
  held = clamp(held, minM, p.reachM);
  const workingDistanceMm = obs.cameraMm(held);

  // Push-up near point with a constant-angle E: the closest distance where it still looks clear.
  const nearJ = nearD + eNear;
  const farJ = farD + eFar;
  let nearPointMm: number | null = null;
  let nearPointBeyondReach = false;
  if (nearJ <= reachD || nearJ <= farJ) nearPointBeyondReach = true;
  else nearPointMm = obs.cameraMm(Math.max(minM, 1 / nearJ));
  const reachMm = obs.cameraMm(p.reachM);

  // N6-size E's at the working distance: readable if it falls inside the (judged) clear range.
  const dW = 1 / held;
  const smallPrintAtWorkingDistance = dW <= nearD + eSpNear && dW >= farD + eSpFar;

  return {
    measurements: { age: p.age, workingDistanceMm, nearPointMm, nearPointBeyondReach, reachMm, smallPrintAtWorkingDistance },
    heldWorkingDistanceM: held,
  };
}

/** Simulates the try-on check: near and far limits of clear vision while wearing a pair. */
export function measureWithReaders(p: Person, obs: Observer, noise: NoiseConfig, strength: number, workingDistanceMm: number): TryOnMeasurement {
  const { nearD, farD } = clearRange(p, strength);
  const minM = noise.minDistanceCm / 100;
  const reachD = 1 / p.reachM;
  let nearJ = nearD + obs.judgement();
  let farJ = farD + obs.judgement();
  if (farJ > nearJ) nearJ = farJ = (nearJ + farJ) / 2; // judgement noise crossed the limits: a single clear point
  const reachMm = obs.cameraMm(p.reachM);
  if (nearJ <= reachD) {
    // Never clear anywhere within reach: the closest "clear" point is reported as arm's length.
    return { strength, workingDistanceMm, nearLimitMm: reachMm, farLimitMm: null, reachMm };
  }
  const nearLimitMm = obs.cameraMm(Math.max(minM, 1 / nearJ));
  const farLimitMm = farJ < reachD ? null : obs.cameraMm(Math.max(minM, 1 / farJ));
  return { strength, workingDistanceMm, nearLimitMm, farLimitMm, reachMm };
}

/** Dioptres of blur when looking at print at holdM without glasses (the printed card can't tell
 *  "too close" from "too far", so myopic blur reads as a need for plus). */
export function blurAtD(p: Person, obs: Observer, holdM: number): number {
  const { nearD, farD } = clearRange(p, 0);
  const nearJ = nearD + obs.judgement();
  const farJ = farD + obs.judgement();
  const d = 1 / holdM;
  return Math.max(0, d - nearJ) + Math.max(0, farJ - d);
}
