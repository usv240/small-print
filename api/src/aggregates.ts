import { computeAgreement } from './agreement';
import {
  AGE_BANDS,
  AGREEMENTS,
  DEVICES,
  LANGS,
  MODES,
  OUTCOMES,
  REFER_REASONS,
  STRENGTH_BUCKETS,
  TRAFFIC,
  strengthKey,
  type ScreeningResult,
  type Traffic,
} from './contract';

/**
 * Flat counter attributes on an aggregate item, e.g. { screenings: 1, "outcome:readers": 1 }.
 * Counters are top-level attributes (not nested maps) so DynamoDB `ADD` works on a brand-new item.
 */
export type Counters = Record<string, number>;

type Countable = Pick<
  ScreeningResult,
  | 'traffic'
  | 'mode'
  | 'lang'
  | 'device'
  | 'ageBand'
  | 'outcome'
  | 'referReasons'
  | 'startStrength'
  | 'existingReaders'
  | 'tryOn'
  | 'calibrated'
>;

/** The counters one screening adds to its traffic type's aggregate item. */
export function contributions(r: Countable): Counters {
  const c: Counters = {
    screenings: 1,
    [`outcome:${r.outcome}`]: 1,
    [`mode:${r.mode}`]: 1,
    [`lang:${r.lang}`]: 1,
    [`device:${r.device}`]: 1,
    [`age:${r.ageBand}`]: 1,
  };
  if (r.startStrength !== null) c[`strength:${strengthKey(r.startStrength)}`] = 1;
  for (const reason of r.referReasons) c[`refer:${reason}`] = 1;
  const agreement = computeAgreement(r.startStrength, r.existingReaders);
  if (agreement) c[`agreement:${agreement}`] = 1;
  if (r.tryOn.length > 0) c.tryOnSessions = 1;
  if (r.calibrated.screen) c['calibrated:screen'] = 1;
  if (r.calibrated.camera) c['calibrated:camera'] = 1;
  return c;
}

/**
 * Per-traffic counter changes needed to replace `prev` (the stored version of a session, if any)
 * with `next`. A first write adds `next`; a repeat POST moves counts from the old version to the
 * new one, so a session is never counted twice. Zero deltas are dropped.
 */
export function counterDeltas(prev: Countable | undefined, next: Countable): Map<Traffic, Counters> {
  const out = new Map<Traffic, Counters>();
  const apply = (traffic: Traffic, counters: Counters, sign: 1 | -1) => {
    const d = out.get(traffic) ?? {};
    for (const [k, v] of Object.entries(counters)) d[k] = (d[k] ?? 0) + sign * v;
    out.set(traffic, d);
  };
  if (prev) apply(prev.traffic, contributions(prev), -1);
  apply(next.traffic, contributions(next), 1);
  for (const [traffic, d] of out) {
    for (const k of Object.keys(d)) if (d[k] === 0) delete d[k];
    if (Object.keys(d).length === 0) out.delete(traffic);
  }
  return out;
}

export interface TrafficStats {
  screenings: number;
  outcomes: Record<string, number>;
  byStrength: Record<string, number>;
  byAgeBand: Record<string, number>;
  byLang: Record<string, number>;
  byDevice: Record<string, number>;
  byMode: Record<string, number>;
  referReasons: Record<string, number>;
  agreement: Record<string, number>;
  tryOnSessions: number;
  calibrated: { screen: number; camera: number };
  updatedAt: string | null;
}

export interface Stats {
  updatedAt: string;
  generatedAt: string;
  traffic: Record<Traffic, TrafficStats>;
}

/** Shapes a raw aggregate item into the public stats object, filling every known bucket with 0. */
export function toTrafficStats(item: Record<string, unknown> | undefined): TrafficStats {
  const n = (key: string): number => {
    const v = item?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };
  const hist = (prefix: string, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, n(`${prefix}:${k}`)]));
  return {
    screenings: n('screenings'),
    outcomes: hist('outcome', OUTCOMES),
    byStrength: hist('strength', STRENGTH_BUCKETS),
    byAgeBand: hist('age', AGE_BANDS),
    byLang: hist('lang', LANGS),
    byDevice: hist('device', DEVICES),
    byMode: hist('mode', MODES),
    referReasons: hist('refer', REFER_REASONS),
    agreement: hist('agreement', AGREEMENTS),
    tryOnSessions: n('tryOnSessions'),
    calibrated: { screen: n('calibrated:screen'), camera: n('calibrated:camera') },
    updatedAt: typeof item?.updatedAt === 'string' ? item.updatedAt : null,
  };
}

/** Builds the GET /api/v1/stats body from the aggregate items (keyed by traffic type). */
export function buildStats(items: Partial<Record<Traffic, Record<string, unknown>>>, now: string): Stats {
  const traffic = Object.fromEntries(TRAFFIC.map((t) => [t, toTrafficStats(items[t])])) as Record<Traffic, TrafficStats>;
  const latest = Object.values(traffic)
    .map((s) => s.updatedAt)
    .filter((u): u is string => u !== null)
    .sort()
    .pop();
  return { updatedAt: latest ?? now, generatedAt: now, traffic };
}
