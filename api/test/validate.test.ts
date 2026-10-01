import { describe, expect, it } from 'vitest';
import { validateResult } from '../src/validate';
import { validBody } from './fixtures';

function withField(field: string, value: unknown): Record<string, unknown> {
  return { ...validBody(), [field]: value };
}

function expectInvalid(input: unknown, messagePart: string): void {
  const res = validateResult(input);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toContain(messagePart);
}

describe('validateResult: accepts', () => {
  it('a complete valid body and returns only contract fields', () => {
    const res = validateResult(validBody());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual(validBody());
  });

  it('nulls for every nullable number', () => {
    const body = { ...validBody(), startStrength: null, workingDistanceCm: null, nearPointCm: null, existingReaders: null };
    expect(validateResult(body).ok).toBe(true);
  });

  it('range edges', () => {
    const body = {
      ...validBody(),
      startStrength: 3.0,
      workingDistanceCm: 15,
      nearPointCm: 120,
      existingReaders: 4.0,
      tryOn: [{ strength: 0.75, verdict: 'weaker' }],
    };
    expect(validateResult(body).ok).toBe(true);
  });

  it('a refer outcome with all nine distinct reasons', () => {
    const body = {
      ...validBody(),
      outcome: 'refer',
      referReasons: [
        'sudden-change',
        'pain-redness',
        'diabetes',
        'glaucoma-family',
        'distance-blur',
        'distance-glasses',
        'possible-myopia',
        'out-of-range',
        'inconsistent',
      ],
    };
    expect(validateResult(body).ok).toBe(true);
  });

  it('six try-on entries and the "<40" and "65+" age bands', () => {
    const tryOn = Array.from({ length: 6 }, () => ({ strength: 2, verdict: 'good' }));
    expect(validateResult({ ...validBody(), tryOn, ageBand: '<40' }).ok).toBe(true);
    expect(validateResult({ ...validBody(), ageBand: '65+' }).ok).toBe(true);
  });

  it('normalises the session id to lower case', () => {
    const res = validateResult(withField('sessionId', '3F2C9A4E-8B1D-4C7A-9E2F-5A6B7C8D9E0F'));
    expect(res.ok && res.value.sessionId).toBe('3f2c9a4e-8b1d-4c7a-9e2f-5a6b7c8d9e0f');
  });
});

describe('validateResult: rejects', () => {
  it('non-objects', () => {
    for (const input of [null, 42, 'x', [], true]) expectInvalid(input, 'JSON object');
  });

  it('wrong or missing version', () => {
    expectInvalid(withField('v', 2), 'unsupported version');
    expectInvalid(withField('v', '1'), 'unsupported version');
    const { v: _v, ...noVersion } = validBody();
    expectInvalid(noVersion, 'unsupported version');
  });

  it('unknown top-level fields, including __proto__ and ip/userAgent', () => {
    expectInvalid(withField('email', 'a@b.c'), 'unknown field "email"');
    expectInvalid(withField('ip', '1.2.3.4'), 'unknown field "ip"');
    expectInvalid(JSON.parse(JSON.stringify(validBody()).replace('{', '{"__proto__":{"x":1},')), 'unknown field');
  });

  it('does not echo unsafe key names', () => {
    const res = validateResult(withField('<script>', 1));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).not.toContain('<script>');
  });

  it('missing required fields (nullable fields must be sent as null)', () => {
    for (const field of ['sessionId', 'existingReaders', 'tryOn', 'calibrated', 'nearPointBeyondReach']) {
      const body = validBody();
      delete body[field];
      expectInvalid(body, `${field}: is required`);
    }
  });

  it('invalid session ids', () => {
    expectInvalid(withField('sessionId', 'not-a-uuid'), 'UUID v4');
    expectInvalid(withField('sessionId', '3f2c9a4e-8b1d-1c7a-9e2f-5a6b7c8d9e0f'), 'UUID v4'); // v1
    expectInvalid(withField('sessionId', 123), 'UUID v4');
  });

  it('values outside each enum', () => {
    expectInvalid(withField('traffic', 'prod'), 'traffic');
    expectInvalid(withField('mode', 'video'), 'mode');
    expectInvalid(withField('lang', 'de'), 'lang');
    expectInvalid(withField('device', 'tv'), 'device');
    expectInvalid(withField('ageBand', '70+'), 'ageBand');
    expectInvalid(withField('outcome', 'glasses'), 'outcome');
    expectInvalid(withField('outcome', null), 'outcome');
  });

  it('bad refer reasons', () => {
    expectInvalid(withField('referReasons', 'diabetes'), 'must be an array');
    expectInvalid(withField('referReasons', ['headache']), 'referReasons[0]');
    expectInvalid(withField('referReasons', ['diabetes', 'diabetes']), 'duplicates');
    expectInvalid(withField('referReasons', Array(10).fill('diabetes')), 'at most 9');
  });

  it('start strength out of range or off the 0.25 grid', () => {
    expectInvalid(withField('startStrength', 0.5), 'between 0.75 and 3');
    expectInvalid(withField('startStrength', 3.25), 'between 0.75 and 3');
    expectInvalid(withField('startStrength', 1.1), 'multiple of 0.25');
    expectInvalid(withField('startStrength', '1.50'), 'must be a number');
  });

  it('distances out of range and non-finite numbers', () => {
    expectInvalid(withField('workingDistanceCm', 14.9), 'between 15 and 90');
    expectInvalid(withField('workingDistanceCm', 91), 'between 15 and 90');
    expectInvalid(withField('nearPointCm', 4), 'between 5 and 120');
    expectInvalid(withField('nearPointCm', 121), 'between 5 and 120');
    // JSON cannot carry NaN/Infinity, but guard anyway.
    expectInvalid(withField('nearPointCm', Number.NaN), 'must be a number');
  });

  it('wrong booleans and calibrated shape', () => {
    expectInvalid(withField('nearPointBeyondReach', 'false'), 'must be a boolean');
    expectInvalid(withField('calibrated', true), 'calibrated: must be an object');
    expectInvalid(withField('calibrated', { screen: true }), 'calibrated.camera: is required');
    expectInvalid(withField('calibrated', { screen: true, camera: false, extra: 1 }), 'unknown field "calibrated.extra"');
    expectInvalid(withField('calibrated', { screen: 1, camera: false }), 'calibrated.screen: must be a boolean');
  });

  it('bad try-on entries', () => {
    expectInvalid(withField('tryOn', Array(7).fill({ strength: 2, verdict: 'good' })), 'at most 6');
    expectInvalid(withField('tryOn', [{ strength: 4.25, verdict: 'good' }]), 'tryOn[0].strength');
    expectInvalid(withField('tryOn', [{ strength: 2.1, verdict: 'good' }]), 'multiple of 0.25');
    expectInvalid(withField('tryOn', [{ strength: 2, verdict: 'ok' }]), 'tryOn[0].verdict');
    expectInvalid(withField('tryOn', [{ strength: 2, verdict: 'good', photo: 'x' }]), 'unknown field "tryOn[0].photo"');
    expectInvalid(withField('tryOn', ['good']), 'tryOn[0]: must be an object');
  });

  it('existing readers out of range or off grid', () => {
    expectInvalid(withField('existingReaders', 4.5), 'between 0.75 and 4');
    expectInvalid(withField('existingReaders', 2.3), 'multiple of 0.25');
  });

  it('reports a loggable field path, never a value', () => {
    const res = validateResult(withField('startStrength', 9.99));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.field).toBe('startStrength');
      expect(res.error).not.toContain('9.99');
    }
  });
});
