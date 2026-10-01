import { describe, expect, it } from 'vitest';
import { buildStats, contributions, counterDeltas, toTrafficStats } from '../src/aggregates';
import { STRENGTH_BUCKETS } from '../src/contract';
import { validResult } from './fixtures';

describe('contributions', () => {
  it('counts one screening into every relevant bucket', () => {
    const c = contributions(validResult({ existingReaders: 1.75, calibrated: { screen: true, camera: true } }));
    expect(c).toEqual({
      screenings: 1,
      'outcome:readers': 1,
      'mode:camera': 1,
      'lang:en': 1,
      'device:phone': 1,
      'age:45-49': 1,
      'strength:1.50': 1,
      'agreement:within-half': 1,
      tryOnSessions: 1,
      'calibrated:screen': 1,
      'calibrated:camera': 1,
    });
  });

  it('skips strength, agreement and try-on when absent, and counts each refer reason', () => {
    const c = contributions(
      validResult({ outcome: 'refer', referReasons: ['diabetes', 'distance-blur'], startStrength: null, tryOn: [] }),
    );
    expect(c['refer:diabetes']).toBe(1);
    expect(c['refer:distance-blur']).toBe(1);
    expect(Object.keys(c).some((k) => k.startsWith('strength:') || k.startsWith('agreement:'))).toBe(false);
    expect(c.tryOnSessions).toBeUndefined();
  });
});

describe('counterDeltas', () => {
  it('first write adds the full contribution', () => {
    const r = validResult();
    expect(counterDeltas(undefined, r)).toEqual(new Map([['dev', contributions(r)]]));
  });

  it('an identical repeat changes nothing (no double counting)', () => {
    const r = validResult();
    expect(counterDeltas(r, r).size).toBe(0);
  });

  it('a changed repeat moves counts but never changes the screening total', () => {
    const prev = validResult({ outcome: 'readers', startStrength: 1.5 });
    const next = validResult({ outcome: 'no-readers', startStrength: null });
    const d = counterDeltas(prev, next).get('dev');
    expect(d).toEqual({ 'outcome:readers': -1, 'outcome:no-readers': 1, 'strength:1.50': -1 });
    expect(d?.screenings).toBeUndefined();
  });

  it('a traffic change moves the whole session between aggregate items', () => {
    const prev = validResult({ traffic: 'dev' });
    const next = validResult({ traffic: 'demo' });
    const deltas = counterDeltas(prev, next);
    expect(deltas.get('dev')?.screenings).toBe(-1);
    expect(deltas.get('demo')?.screenings).toBe(1);
  });
});

describe('stats shaping', () => {
  it('fills every bucket with zero when there is no data', () => {
    const s = toTrafficStats(undefined);
    expect(s.screenings).toBe(0);
    expect(Object.keys(s.byStrength)).toEqual(STRENGTH_BUCKETS);
    expect(STRENGTH_BUCKETS[0]).toBe('0.75');
    expect(STRENGTH_BUCKETS.at(-1)).toBe('3.00');
    expect(s.outcomes).toEqual({ readers: 0, 'no-readers': 0, refer: 0 });
    expect(s.updatedAt).toBeNull();
  });

  it('maps stored counters into the public shape for all traffic types', () => {
    const now = '2026-10-01T12:00:00.000Z';
    const stats = buildStats(
      { dev: { screenings: 2, 'outcome:refer': 1, 'strength:2.25': 2, 'calibrated:camera': 1, updatedAt: '2026-10-01T11:00:00.000Z' } },
      now,
    );
    expect(Object.keys(stats.traffic)).toEqual(['real', 'demo', 'judge', 'dev']);
    expect(stats.traffic.dev.screenings).toBe(2);
    expect(stats.traffic.dev.outcomes.refer).toBe(1);
    expect(stats.traffic.dev.byStrength['2.25']).toBe(2);
    expect(stats.traffic.dev.calibrated).toEqual({ screen: 0, camera: 1 });
    expect(stats.traffic.real.screenings).toBe(0);
    expect(stats.updatedAt).toBe('2026-10-01T11:00:00.000Z');
    expect(stats.generatedAt).toBe(now);
  });

  it('uses the generation time as updatedAt when nothing has been recorded', () => {
    expect(buildStats({}, '2026-10-01T12:00:00.000Z').updatedAt).toBe('2026-10-01T12:00:00.000Z');
  });
});
