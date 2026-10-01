// The POST /api/v1/results contract (v1). Every enum here is also the full key set of the
// matching histogram in GET /api/v1/stats, so the dashboard always gets a stable shape.

export const TRAFFIC = ['real', 'demo', 'judge', 'dev'] as const;
export const MODES = ['camera', 'demo'] as const;
export const LANGS = ['en', 'es', 'fr', 'pt'] as const;
export const DEVICES = ['phone', 'tablet', 'desktop'] as const;
export const AGE_BANDS = ['<40', '40-44', '45-49', '50-54', '55-59', '60-64', '65+'] as const;
export const OUTCOMES = ['readers', 'no-readers', 'refer'] as const;
export const REFER_REASONS = [
  'sudden-change',
  'pain-redness',
  'diabetes',
  'glaucoma-family',
  'distance-blur',
  'distance-glasses',
  'possible-myopia',
  'out-of-range',
  'inconsistent',
] as const;
export const VERDICTS = ['good', 'stronger', 'weaker'] as const;
export const AGREEMENTS = ['exact', 'within-half', 'further'] as const;

export type Traffic = (typeof TRAFFIC)[number];
export type Mode = (typeof MODES)[number];
export type Lang = (typeof LANGS)[number];
export type Device = (typeof DEVICES)[number];
export type AgeBand = (typeof AGE_BANDS)[number];
export type Outcome = (typeof OUTCOMES)[number];
export type ReferReason = (typeof REFER_REASONS)[number];
export type Verdict = (typeof VERDICTS)[number];
export type Agreement = (typeof AGREEMENTS)[number];

export interface TryOn {
  strength: number;
  verdict: Verdict;
}

/** A validated, anonymous screening result. Contains no personal data and no images. */
export interface ScreeningResult {
  v: 1;
  sessionId: string;
  traffic: Traffic;
  mode: Mode;
  lang: Lang;
  device: Device;
  ageBand: AgeBand;
  outcome: Outcome;
  referReasons: ReferReason[];
  startStrength: number | null;
  workingDistanceCm: number | null;
  nearPointCm: number | null;
  nearPointBeyondReach: boolean;
  calibrated: { screen: boolean; camera: boolean };
  tryOn: TryOn[];
  existingReaders: number | null;
}

export const MAX_BODY_BYTES = 4096;
export const MAX_TRY_ON = 6;

/** Recommended start strengths: +0.75 to +3.00 in 0.25 steps (the histogram buckets). */
export const START_STRENGTH = { min: 0.75, max: 3.0 } as const;
/** Strengths a person may try on or already own: +0.75 to +4.00. */
export const READER_STRENGTH = { min: 0.75, max: 4.0 } as const;
export const WORKING_DISTANCE_CM = { min: 15, max: 90 } as const;
export const NEAR_POINT_CM = { min: 5, max: 120 } as const;

/** Histogram key for a strength, e.g. 1.5 -> "1.50". */
export function strengthKey(strength: number): string {
  return strength.toFixed(2);
}

export const STRENGTH_BUCKETS: string[] = (() => {
  const out: string[] = [];
  for (let q = START_STRENGTH.min * 4; q <= START_STRENGTH.max * 4; q++) out.push(strengthKey(q / 4));
  return out;
})();
