// Anonymous result reporting. No names, no images, no IP addresses stored; one random session id
// lets a later answer (try-on, existing readers) update the same record instead of double counting.

import type { Lang } from './i18n';

export type Traffic = 'real' | 'demo' | 'judge' | 'dev';
export type ReferReasonApi =
  | 'sudden-change' | 'pain-redness' | 'diabetes' | 'glaucoma-family' | 'distance-blur' | 'distance-glasses'
  | 'possible-myopia' | 'out-of-range' | 'inconsistent';

export interface ResultPayload {
  v: 1;
  sessionId: string;
  traffic: Traffic;
  mode: 'camera' | 'demo';
  lang: Lang;
  device: 'phone' | 'tablet' | 'desktop';
  ageBand: '<40' | '40-44' | '45-49' | '50-54' | '55-59' | '60-64' | '65+';
  outcome: 'readers' | 'no-readers' | 'refer';
  referReasons: ReferReasonApi[];
  startStrength: number | null;
  workingDistanceCm: number | null;
  nearPointCm: number | null;
  nearPointBeyondReach: boolean;
  calibrated: { screen: boolean; camera: boolean };
  tryOn: { strength: number; verdict: 'good' | 'stronger' | 'weaker' }[];
  existingReaders: number | null;
}

export function trafficType(mode: 'camera' | 'demo'): Traffic {
  const q = new URLSearchParams(location.search);
  if (q.has('dev') || ['localhost', '127.0.0.1'].includes(location.hostname) || location.hostname.endsWith('.local')) return 'dev';
  if (q.has('judge') || sessionStorage.getItem('small-print.judge') === '1') return 'judge';
  return mode === 'demo' ? 'demo' : 'real';
}

export function deviceType(): ResultPayload['device'] {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const short = Math.min(screen.width, screen.height);
  if (!coarse) return 'desktop';
  return short >= 600 ? 'tablet' : 'phone';
}

export function ageBand(age: number): ResultPayload['ageBand'] {
  if (age < 40) return '<40';
  if (age >= 65) return '65+';
  const lo = Math.floor(age / 5) * 5;
  return `${lo}-${lo + 4}` as ResultPayload['ageBand'];
}

const QUEUE_KEY = 'small-print.outbox.v1';

/** Results waiting to be sent, newest per session (a later answer replaces an earlier one). */
function outbox(): Record<string, ResultPayload> {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '{}') as Record<string, ResultPayload>;
  } catch {
    return {};
  }
}

async function post(p: ResultPayload): Promise<boolean> {
  try {
    const r = await fetch('/api/v1/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
      keepalive: true,
    });
    // 4xx means the server rejected this payload for good; only network errors and 5xx are retried.
    return r.ok || (r.status >= 400 && r.status < 500);
  } catch {
    return false;
  }
}

/** Sends a result. If the phone is offline (camps often are), it is kept and sent when the connection returns.
 *  Reporting is best-effort: the person's result never depends on it. */
export async function sendResult(p: ResultPayload): Promise<void> {
  const box = outbox();
  box[p.sessionId] = p;
  localStorage.setItem(QUEUE_KEY, JSON.stringify(box));
  await flushOutbox();
}

let flushing = false;
export async function flushOutbox(): Promise<void> {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    for (const [id, p] of Object.entries(outbox())) {
      if (!(await post(p))) break;
      const box = outbox();
      if (box[id] === undefined || JSON.stringify(box[id]) === JSON.stringify(p)) delete box[id];
      localStorage.setItem(QUEUE_KEY, JSON.stringify(box));
    }
  } finally {
    flushing = false;
  }
}

export const pendingResults = () => Object.keys(outbox()).length;

export interface TrafficStats {
  screenings: number;
  outcomes?: Record<string, number>;
  byStrength?: Record<string, number>;
  byAgeBand?: Record<string, number>;
  byLang?: Record<string, number>;
  agreement?: Record<string, number>;
  tryOnSessions?: number;
  [k: string]: unknown;
}

export async function fetchStats(): Promise<{ updatedAt?: string; traffic: Record<Traffic, TrafficStats> } | null> {
  try {
    const r = await fetch('/api/v1/stats');
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
