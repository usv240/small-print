import type { ScreeningResult } from '../src/contract';

/** A valid v1 body. Tests clone and mutate it. */
export function validBody(): Record<string, unknown> {
  return {
    v: 1,
    sessionId: '3f2c9a4e-8b1d-4c7a-9e2f-5a6b7c8d9e0f',
    traffic: 'dev',
    mode: 'camera',
    lang: 'en',
    device: 'phone',
    ageBand: '45-49',
    outcome: 'readers',
    referReasons: [],
    startStrength: 1.5,
    workingDistanceCm: 38,
    nearPointCm: 52.5,
    nearPointBeyondReach: false,
    calibrated: { screen: true, camera: false },
    tryOn: [
      { strength: 1.5, verdict: 'good' },
      { strength: 1.75, verdict: 'stronger' },
    ],
    existingReaders: null,
  };
}

export function validResult(overrides: Partial<ScreeningResult> = {}): ScreeningResult {
  return { ...(validBody() as unknown as ScreeningResult), ...overrides };
}
