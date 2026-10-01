import { describe, expect, it } from 'vitest';
import { computeAgreement } from '../src/agreement';

describe('computeAgreement', () => {
  it('is null unless both strengths are known', () => {
    expect(computeAgreement(null, 1.5)).toBeNull();
    expect(computeAgreement(1.5, null)).toBeNull();
    expect(computeAgreement(null, null)).toBeNull();
  });

  it('exact when the difference is at most 0.125', () => {
    expect(computeAgreement(1.5, 1.5)).toBe('exact');
    expect(computeAgreement(2.0, 2.125)).toBe('exact');
    expect(computeAgreement(2.125, 2.0)).toBe('exact');
  });

  it('within-half when the difference is above 0.125 and at most 0.5', () => {
    expect(computeAgreement(1.5, 1.75)).toBe('within-half');
    expect(computeAgreement(1.75, 1.5)).toBe('within-half');
    expect(computeAgreement(1.0, 1.5)).toBe('within-half');
    expect(computeAgreement(3.0, 2.5)).toBe('within-half');
  });

  it('further when the difference is above 0.5', () => {
    expect(computeAgreement(1.0, 1.75)).toBe('further');
    expect(computeAgreement(3.0, 0.75)).toBe('further');
    expect(computeAgreement(0.75, 4.0)).toBe('further');
  });
});
