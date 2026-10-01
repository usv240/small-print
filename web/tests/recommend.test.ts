import { describe, expect, it } from 'vitest';
import { bracket, recommend } from '../src/core/recommend';
import { assessTryOn } from '../src/core/tryon';
import { DEPTH_OF_FOCUS_D } from '../src/core/optics';

/** Near point (mm) that a push-up test would give for a true amplitude, including depth of focus. */
const pushUpNearPoint = (amplitudeD: number) => 1000 / (amplitudeD + DEPTH_OF_FOCUS_D / 2);

describe('recommend', () => {
  it('a typical 52-year-old reading at 40 cm with 2 D of accommodation starts near +1.75 to +2.00', () => {
    const r = recommend({ age: 52, workingDistanceMm: 400, nearPointMm: pushUpNearPoint(2), nearPointBeyondReach: false, reachMm: 650, smallPrintAtWorkingDistance: false });
    expect(r.outcome).toBe('readers');
    expect(r.strength).toBeGreaterThanOrEqual(1.5);
    expect(r.strength).toBeLessThanOrEqual(2.0);
    expect(r.tryFirst.length).toBeGreaterThan(0);
  });

  it('when the E is never clear at arm\'s length, never recommends less than the age table', () => {
    const r = recommend({ age: 60, workingDistanceMm: 380, nearPointMm: null, nearPointBeyondReach: true, reachMm: 600, smallPrintAtWorkingDistance: false });
    expect(r.outcome).toBe('readers');
    expect(r.strength!).toBeGreaterThanOrEqual(2.5);
    expect(r.detail.nearPointIsLowerBound).toBe(true);
  });

  it('a 30-year-old who reads small print gets no readers and a young eye age', () => {
    const r = recommend({ age: 30, workingDistanceMm: 350, nearPointMm: 110, nearPointBeyondReach: false, reachMm: 600, smallPrintAtWorkingDistance: true });
    expect(r.outcome).toBe('no-readers');
    expect(r.eyeAge!).toBeLessThan(40);
  });

  it('flags likely short-sightedness when close-up focus is far beyond what is possible at that age', () => {
    const r = recommend({ age: 55, workingDistanceMm: 300, nearPointMm: 120, nearPointBeyondReach: false, reachMm: 600, smallPrintAtWorkingDistance: true });
    expect(r.flags).toContain('possible-myopia');
    expect(r.outcome).toBe('no-readers');
  });

  it('refers when the estimate is above the +3.00 that ready-made readers cover', () => {
    const r = recommend({ age: 70, workingDistanceMm: 250, nearPointMm: null, nearPointBeyondReach: true, reachMm: 500, smallPrintAtWorkingDistance: false });
    expect(r.outcome).toBe('refer');
    expect(r.flags).toContain('out-of-range');
  });

  it('brackets to stocked 0.50 steps', () => {
    expect(bracket(1.75)).toEqual([1.5, 2.0]);
    expect(bracket(2.0)).toEqual([2.0]);
    expect(bracket(1.0)).toEqual([1.0]);
  });
});

describe('try-on: working distance should sit mid-range (Stevens 2019)', () => {
  // Simulated eye: true amplitude 1.5 D, reads at 40 cm (2.5 D). Ideal readers = 2.5 − 0.75 = 1.75 D.
  const AA = 1.5;
  const wearing = (A: number) => ({
    strength: A, workingDistanceMm: 400,
    nearLimitMm: 1000 / (A + AA + DEPTH_OF_FOCUS_D / 2),
    farLimitMm: A - DEPTH_OF_FOCUS_D / 2 > 1000 / 700 ? 1000 / (A - DEPTH_OF_FOCUS_D / 2) : null,
    reachMm: 700,
  });

  it('accepts the ideal pair', () => expect(assessTryOn(wearing(1.75)).verdict).toBe('good'));
  it('asks for stronger when the pair is clearly too weak', () => expect(assessTryOn(wearing(1.0)).verdict).toBe('stronger'));
  it('asks for weaker when the pair is clearly too strong', () => expect(assessTryOn(wearing(2.75)).verdict).toBe('weaker'));
  it('suggests a correction that points toward the ideal', () => {
    const r = assessTryOn(wearing(1.0));
    expect(1.0 + r.change).toBeGreaterThanOrEqual(1.5);
    expect(1.0 + r.change).toBeLessThanOrEqual(2.0);
  });
  it('is unaffected by depth of focus because it widens both ends equally', () => {
    const wide = (dof: number) => assessTryOn({
      strength: 1.75, workingDistanceMm: 400, nearLimitMm: 1000 / (1.75 + AA + dof / 2), farLimitMm: 1000 / (1.75 - dof / 2), reachMm: 1000,
    });
    expect(wide(0.2).verdict).toBe('good');
    expect(wide(1.0).verdict).toBe('good');
  });
});
