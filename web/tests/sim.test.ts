// Tests for the SIMULATED test bench (sim/). Simulation, not clinical validation.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, computeMetrics, runScenario } from '../sim/engine';
import { DEFAULT_NOISE, DEFAULT_POPULATION, type NoiseConfig, clearRange, makePerson } from '../sim/model';
import { runBench } from '../sim/suite';

const PERFECT: NoiseConfig = { ...DEFAULT_NOISE, distanceSharedSd: 0, distanceReadingSd: 0, blurJudgementSdD: 0, holdingVariabilitySd: 0, cardHoldingSd: 0 };
const scenario = (population = DEFAULT_POPULATION, noise = DEFAULT_NOISE, n = 5000) =>
  runScenario({ ...DEFAULT_SCENARIO, n, population, noise, cardReserveD: 0.25 });

describe('simulated-eye bench', () => {
  it('is deterministic for a seed, and the seed matters', () => {
    const a = runBench({ n: 1500, nUnder40: 300 });
    const b = runBench({ n: 1500, nUnder40: 300 });
    expect(a).toEqual(b);
    const c = runBench({ seed: 7, n: 1500, nUnder40: 300 });
    expect(c.strategies[0].overall).not.toEqual(a.strategies[0].overall);
  });

  it('the ideal readers put the working distance exactly in the middle of the clear range', () => {
    for (let i = 0; i < 200; i++) {
      const p = makePerson(DEFAULT_POPULATION, 1, i);
      const { nearD, farD } = clearRange(p, p.idealD);
      expect((nearD + farD) / 2).toBeCloseTo(1 / p.workingDistanceM, 9);
    }
  });

  it('the what-if replica of recommend() matches recommend() at the shipped near-point weight', () => {
    expect(runBench({ n: 1500, nUnder40: 300 }).replicaMismatches).toBe(0);
  });

  // Model/algorithm consistency: when assessTryOn()'s assumptions hold (both ends of the clear range
  // measurable, perfect measurements, no refractive error), the try-on must land on the ideal pair.
  it('noise-free try-on is ≥ 95% within ±0.25 D when the far end is always measurable', () => {
    const run = scenario({ ...DEFAULT_POPULATION, reachMinCm: 500, reachMaxCm: 500, refraction: [{ weight: 1, meanD: 0, sdD: 0 }] }, PERFECT);
    expect(computeMetrics(run.people, run.decisions.spTry050).within025Pct).toBeGreaterThanOrEqual(95);
    expect(computeMetrics(run.people, run.decisions.spTry025).within025Pct).toBeGreaterThanOrEqual(95);
  });

  // KNOWN ISSUE (reported, src/core not changed): with realistic arm's reach and refractive error, the far
  // end of clear vision is beyond reach for about half of try-on measurements; assessTryOn() then answers
  // 'good' unless the pair is clearly too weak, so even perfect measurements reach only ~78%.
  // `it.fails` passes while the issue exists and will fail (prompting an update) once it is fixed.
  it.fails('noise-free try-on is ≥ 95% within ±0.25 D with realistic reach and refractive error', () => {
    const run = scenario(DEFAULT_POPULATION, PERFECT);
    expect(computeMetrics(run.people, run.decisions.spTry050).within025Pct).toBeGreaterThanOrEqual(95);
  });

  it('with default noise, the try-on beats the no-glasses start, which beats the age table (in scope, ±0.50)', () => {
    const run = scenario();
    const w = (id: 'age40' | 'spStart' | 'spTry050') => computeMetrics(run.people, run.decisions[id]).within050Pct;
    expect(w('spTry050')).toBeGreaterThan(w('spStart'));
    expect(w('spStart')).toBeGreaterThan(w('age40'));
  });
});
