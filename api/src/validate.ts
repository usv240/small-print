import {
  AGE_BANDS,
  DEVICES,
  LANGS,
  MAX_TRY_ON,
  MODES,
  NEAR_POINT_CM,
  OUTCOMES,
  READER_STRENGTH,
  REFER_REASONS,
  START_STRENGTH,
  TRAFFIC,
  VERDICTS,
  WORKING_DISTANCE_CM,
  type ScreeningResult,
  type TryOn,
} from './contract';

export type Validation =
  | { ok: true; value: ScreeningResult }
  /** `field` is a known field path (safe to log); `error` may echo a client-supplied key name. */
  | { ok: false; error: string; field: string };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_KEY = /^[A-Za-z0-9_-]{1,32}$/;
const ROOT = '(root)';

const RESULT_FIELDS = [
  'v',
  'sessionId',
  'traffic',
  'mode',
  'lang',
  'device',
  'ageBand',
  'outcome',
  'referReasons',
  'startStrength',
  'workingDistanceCm',
  'nearPointCm',
  'nearPointBeyondReach',
  'calibrated',
  'tryOn',
  'existingReaders',
] as const;

class Invalid extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(field === ROOT ? message : `${field}: ${message}`);
  }
}

type Obj = Record<string, unknown>;

function isPlainObject(value: unknown): value is Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Rejects unknown keys and requires every allowed key to be present (nullable fields must be sent as null). */
function exactKeys(obj: Obj, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      const where = path ? `${path}.` : '';
      throw new Invalid(path || ROOT, SAFE_KEY.test(key) ? `unknown field "${where}${key}"` : 'unknown field');
    }
  }
  for (const key of allowed) {
    if (!Object.hasOwn(obj, key)) throw new Invalid(path ? `${path}.${key}` : key, 'is required');
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Invalid(field, `must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Invalid(field, 'must be a boolean');
  return value;
}

function num(value: unknown, field: string, range: { min: number; max: number }, quarterSteps = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Invalid(field, 'must be a number');
  if (value < range.min || value > range.max) throw new Invalid(field, `must be between ${range.min} and ${range.max}`);
  if (quarterSteps && !Number.isInteger(value * 4)) throw new Invalid(field, 'must be a multiple of 0.25');
  return value;
}

function nullableNum(value: unknown, field: string, range: { min: number; max: number }, quarterSteps = false): number | null {
  return value === null ? null : num(value, field, range, quarterSteps);
}

function array(value: unknown, field: string, maxLength: number): unknown[] {
  if (!Array.isArray(value)) throw new Invalid(field, 'must be an array');
  if (value.length > maxLength) throw new Invalid(field, `must have at most ${maxLength} items`);
  return value;
}

function parse(input: unknown): ScreeningResult {
  if (!isPlainObject(input)) throw new Invalid(ROOT, 'body must be a JSON object');
  // Check the version first so a future v2 client gets a clear error rather than a field error.
  if (input.v !== 1) throw new Invalid('v', 'unsupported version (expected 1)');
  exactKeys(input, RESULT_FIELDS, '');

  if (typeof input.sessionId !== 'string' || !UUID_V4.test(input.sessionId)) {
    throw new Invalid('sessionId', 'must be a UUID v4');
  }

  const referReasons = array(input.referReasons, 'referReasons', REFER_REASONS.length).map((reason, i) =>
    oneOf(reason, REFER_REASONS, `referReasons[${i}]`),
  );
  if (new Set(referReasons).size !== referReasons.length) throw new Invalid('referReasons', 'must not contain duplicates');

  if (!isPlainObject(input.calibrated)) throw new Invalid('calibrated', 'must be an object');
  exactKeys(input.calibrated, ['screen', 'camera'], 'calibrated');

  const tryOn: TryOn[] = array(input.tryOn, 'tryOn', MAX_TRY_ON).map((entry, i) => {
    const path = `tryOn[${i}]`;
    if (!isPlainObject(entry)) throw new Invalid(path, 'must be an object');
    exactKeys(entry, ['strength', 'verdict'], path);
    return {
      strength: num(entry.strength, `${path}.strength`, READER_STRENGTH, true),
      verdict: oneOf(entry.verdict, VERDICTS, `${path}.verdict`),
    };
  });

  // Build a fresh object so nothing from the request is stored unless it was validated.
  return {
    v: 1,
    sessionId: input.sessionId.toLowerCase(),
    traffic: oneOf(input.traffic, TRAFFIC, 'traffic'),
    mode: oneOf(input.mode, MODES, 'mode'),
    lang: oneOf(input.lang, LANGS, 'lang'),
    device: oneOf(input.device, DEVICES, 'device'),
    ageBand: oneOf(input.ageBand, AGE_BANDS, 'ageBand'),
    outcome: oneOf(input.outcome, OUTCOMES, 'outcome'),
    referReasons,
    startStrength: nullableNum(input.startStrength, 'startStrength', START_STRENGTH, true),
    workingDistanceCm: nullableNum(input.workingDistanceCm, 'workingDistanceCm', WORKING_DISTANCE_CM),
    nearPointCm: nullableNum(input.nearPointCm, 'nearPointCm', NEAR_POINT_CM),
    nearPointBeyondReach: bool(input.nearPointBeyondReach, 'nearPointBeyondReach'),
    calibrated: {
      screen: bool(input.calibrated.screen, 'calibrated.screen'),
      camera: bool(input.calibrated.camera, 'calibrated.camera'),
    },
    tryOn,
    existingReaders: nullableNum(input.existingReaders, 'existingReaders', READER_STRENGTH, true),
  };
}

/** Strictly validates a POST /api/v1/results body against the v1 contract. */
export function validateResult(input: unknown): Validation {
  try {
    return { ok: true, value: parse(input) };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message, field: err.field };
    throw err;
  }
}
