// Camp mode: a health worker or volunteer screens a queue of people on one device.
// Each person is a separate anonymous session; this device keeps a running tally so the worker knows
// which strengths to bring next time. The tally never leaves the device unless the worker exports it.

export interface CampTally {
  startedAt: string;
  people: number;
  readers: Record<string, number>;
  noReaders: number;
  referred: number;
  /** Strength confirmed in the try-on, when one was done (overrides the starting estimate in the stock list). */
  confirmed: Record<string, number>;
}

const KEY = 'small-print.camp.v1';

export const campActive = () => new URLSearchParams(location.search).has('camp') || sessionStorage.getItem('small-print.camp') === '1';

export function enableCamp(): void {
  sessionStorage.setItem('small-print.camp', '1');
}

export function loadTally(): CampTally {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? 'null') as CampTally | null;
    if (t) return t;
  } catch { /* start fresh */ }
  return { startedAt: new Date().toISOString(), people: 0, readers: {}, noReaders: 0, referred: 0, confirmed: {} };
}

function save(t: CampTally): void {
  localStorage.setItem(KEY, JSON.stringify(t));
}

export function resetTally(): void {
  localStorage.removeItem(KEY);
}

/** Add one finished person. `strength` is the starting estimate; `confirmed` the strength that passed the try-on. */
export function recordPerson(outcome: 'readers' | 'no-readers' | 'refer', strength: number | null, confirmed: number | null): CampTally {
  const t = loadTally();
  t.people++;
  if (outcome === 'refer') t.referred++;
  else if (outcome === 'no-readers' || strength === null) t.noReaders++;
  else {
    const s = (confirmed ?? strength).toFixed(2);
    t.readers[s] = (t.readers[s] ?? 0) + 1;
    if (confirmed !== null) t.confirmed[s] = (t.confirmed[s] ?? 0) + 1;
  }
  save(t);
  return t;
}

/** Suggested stock for a camp of `forPeople`, scaled from this tally, with one spare per strength used. */
export function stockList(t: CampTally, forPeople = 100): { strength: string; count: number }[] {
  const total = Object.values(t.readers).reduce((a, b) => a + b, 0);
  if (!total || !t.people) return [];
  return Object.entries(t.readers)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([strength, n]) => ({ strength, count: Math.ceil((n / t.people) * forPeople) + 1 }));
}

export function tallyCsv(t: CampTally): string {
  const rows = [['strength', 'people', 'confirmed_by_try_on']];
  for (const [s, n] of Object.entries(t.readers).sort(([a], [b]) => Number(a) - Number(b))) rows.push([`+${s}`, String(n), String(t.confirmed[s] ?? 0)]);
  rows.push(['no readers yet', String(t.noReaders), '']);
  rows.push(['referred to eye care', String(t.referred), '']);
  rows.push(['total people', String(t.people), '']);
  return rows.map((r) => r.join(',')).join('\n');
}
