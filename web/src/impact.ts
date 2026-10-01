// Live counters for /impact.html. The page is complete static HTML without this script: it only fills
// in numbers from the public stats API (GET /api/v1/stats) and refreshes them every minute.
// Any failure keeps the static explanation and the last good numbers on screen.
// Real traffic is shown on its own; judge, demo and dev traffic are shown separately and never added to it.

type Traffic = 'real' | 'demo' | 'judge' | 'dev';
type Hist = Record<string, number>;

interface TrafficStats {
  screenings: number;
  outcomes: Hist;
  byStrength: Hist;
  byAgeBand: Hist;
  byLang: Hist;
  byDevice: Hist;
  byMode: Hist;
  referReasons: Hist;
  agreement: Hist;
  tryOnSessions: number;
  calibrated: { screen: number; camera: number };
  updatedAt: string | null;
}

interface Stats {
  generatedAt: string | null;
  traffic: Record<Traffic, TrafficStats>;
}

interface BarRow {
  label: string;
  value: number;
}

const API_URL = '/api/v1/stats';
const REFRESH_MS = 60_000;
const TIMEOUT_MS = 10_000;

const TRAFFIC: Traffic[] = ['real', 'demo', 'judge', 'dev'];
const OTHER_TRAFFIC: [Traffic, string][] = [['judge', 'Judges'], ['demo', 'Demo (no camera)'], ['dev', 'Development']];
const OUTCOMES = ['readers', 'no-readers', 'refer'] as const;
const AGE_BANDS: [string, string][] = [
  ['<40', 'Under 40'], ['40-44', '40–44'], ['45-49', '45–49'], ['50-54', '50–54'],
  ['55-59', '55–59'], ['60-64', '60–64'], ['65+', '65 and over'],
];
/** Reasons always listed (so a zero is visible), in the order the person meets them. */
const REASONS: [string, string][] = [
  ['diabetes', 'Diabetes (exam advised)'],
  ['glaucoma-family', 'Glaucoma in the family (exam advised)'],
  ['distance-blur', 'Far-away things blurry (exam advised)'],
  ['distance-glasses', 'Wears distance glasses (exam advised)'],
  ['out-of-range', 'Needs more than +3.00 (referred)'],
  ['possible-myopia', 'Possible short sight (no readers)'],
  ['inconsistent', 'Estimates disagree (try-on advised)'],
];
/** Urgent answers stop the test before any result exists, so these are listed only if ever non-zero. */
const URGENT_REASONS: [string, string][] = [
  ['sudden-change', 'Sudden change, flashes or shadows'],
  ['pain-redness', 'Pain or redness'],
];
const AGREEMENT: [string, string][] = [['exact', 'Same strength'], ['within-half', 'Within 0.50'], ['further', 'Further apart']];
const DEVICES: [string, string][] = [['phone', 'Phone'], ['tablet', 'Tablet'], ['desktop', 'Laptop or desktop']];
const LANGS: [string, string][] = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['pt', 'Portuguese']];
/** Containers that show "Live data appears here…" in the static HTML. */
const LIVE_BOXES = ['real-strength', 'real-ages', 'real-reasons', 'real-agreement'];

const nf = new Intl.NumberFormat('en-US');
const fmt = (n: number) => nf.format(n);

// ---------- parsing: accept only what we expect, default everything else to zero ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function hist(v: unknown): Hist {
  const out: Hist = {};
  if (isObj(v)) for (const [k, n] of Object.entries(v)) out[k] = count(n);
  return out;
}

function parseTraffic(v: unknown): TrafficStats {
  const o = isObj(v) ? v : {};
  const cal = isObj(o.calibrated) ? o.calibrated : {};
  return {
    screenings: count(o.screenings),
    outcomes: hist(o.outcomes),
    byStrength: hist(o.byStrength),
    byAgeBand: hist(o.byAgeBand),
    byLang: hist(o.byLang),
    byDevice: hist(o.byDevice),
    byMode: hist(o.byMode),
    referReasons: hist(o.referReasons),
    agreement: hist(o.agreement),
    tryOnSessions: count(o.tryOnSessions),
    calibrated: { screen: count(cal.screen), camera: count(cal.camera) },
    updatedAt: str(o.updatedAt),
  };
}

function parseStats(v: unknown): Stats | null {
  if (!isObj(v) || !isObj(v.traffic)) return null;
  const raw = v.traffic;
  const traffic = Object.fromEntries(TRAFFIC.map((t) => [t, parseTraffic(raw[t])])) as Record<Traffic, TrafficStats>;
  return { generatedAt: str(v.generatedAt), traffic };
}

// ---------- rendering ----------

const byId = (id: string) => document.getElementById(id);

function setText(id: string, text: string): void {
  const el = byId(id);
  if (el) el.textContent = text;
}

const pct = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '–');

function when(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Horizontal bars scaled to the largest value; the count is always shown as text beside the bar. */
function renderBars(id: string, rows: BarRow[], emptyText: string): void {
  const box = byId(id);
  if (!box) return;
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (max === 0) {
    box.replaceChildren(el('p', 'empty-note', emptyText));
    return;
  }
  box.replaceChildren(
    ...rows.map((r) => {
      const row = el('div', 'bar-row');
      const track = el('div', 'bar-track');
      track.setAttribute('aria-hidden', 'true');
      const fill = el('div', 'bar-fill');
      fill.style.width = `${(r.value / max) * 100}%`;
      track.append(fill);
      row.append(el('span', '', r.label), track, el('span', 'bar-value', fmt(r.value)));
      return row;
    }),
  );
}

const strengthLabel = (key: string) => `+${Number(key).toFixed(2)}`;

function renderReal(s: TrafficStats): void {
  const total = s.screenings;
  setText('real-screenings', fmt(total));
  for (const o of OUTCOMES) {
    const n = s.outcomes[o] ?? 0;
    setText(`real-${o}`, fmt(n));
    setText(`real-${o}-pct`, total > 0 ? `(${pct(n, total)})` : '');
  }
  setText('real-tryon', fmt(s.tryOnSessions));
  const last = when(s.updatedAt);
  setText('real-updated', last ? `Last real result recorded ${last}.` : '');

  // The app's lowest starting strength is +1.00, so the +0.75 bucket is only shown if it is ever used.
  const strengths = Object.keys(s.byStrength)
    .filter((k) => Number.isFinite(Number(k)) && (Number(k) >= 1 || s.byStrength[k] > 0))
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => ({ label: strengthLabel(k), value: s.byStrength[k] }));
  renderBars('real-strength', strengths, 'No real screenings have suggested a strength yet.');

  renderBars('real-ages', AGE_BANDS.map(([k, label]) => ({ label, value: s.byAgeBand[k] ?? 0 })), 'No real screenings yet.');

  const reasons = [
    ...REASONS.map(([k, label]) => ({ label, value: s.referReasons[k] ?? 0 })),
    ...URGENT_REASONS.filter(([k]) => (s.referReasons[k] ?? 0) > 0).map(([k, label]) => ({ label, value: s.referReasons[k] })),
  ];
  renderBars('real-reasons', reasons, 'No referral or advice reasons recorded yet.');

  const agreeTotal = AGREEMENT.reduce((sum, [k]) => sum + (s.agreement[k] ?? 0), 0);
  renderBars('real-agreement', AGREEMENT.map(([k, label]) => ({ label, value: s.agreement[k] ?? 0 })), 'Nobody has told us the strength of readers they already own yet.');
  const exact = s.agreement.exact ?? 0;
  const withinHalf = exact + (s.agreement['within-half'] ?? 0);
  setText(
    'real-agreement-summary',
    agreeTotal === 0
      ? ''
      : `${fmt(agreeTotal)} ${agreeTotal === 1 ? 'person' : 'people'} told us the strength of readers they already own. ` +
        `Small Print suggested the same strength for ${pct(exact, agreeTotal)}, and within 0.50 (including the same) for ${pct(withinHalf, agreeTotal)}.` +
        (agreeTotal < 30 ? ' That is too few to draw conclusions.' : ''),
  );

  const details = byId('real-details');
  if (details) {
    const parts = (pairs: [string, string][], h: Hist) => pairs.map(([k, label]) => `${label} ${fmt(h[k] ?? 0)}`).join(' · ');
    const items = [
      `Devices: ${parts(DEVICES, s.byDevice)}.`,
      `Languages: ${parts(LANGS, s.byLang)}.`,
      `Screen calibrated with a card: ${fmt(s.calibrated.screen)} of ${fmt(total)}. Camera calibrated at 30 cm: ${fmt(s.calibrated.camera)} of ${fmt(total)}.`,
    ];
    details.replaceChildren(...items.map((t) => el('li', '', t)));
  }
}

function renderOther(stats: Stats): void {
  const body = byId('other-traffic');
  if (!body) return;
  body.replaceChildren(
    ...OTHER_TRAFFIC.map(([t, label]) => {
      const s = stats.traffic[t];
      const tr = el('tr');
      tr.append(el('td', '', label));
      for (const n of [s.screenings, s.outcomes.readers ?? 0, s.outcomes['no-readers'] ?? 0, s.outcomes.refer ?? 0, s.tryOnSessions]) {
        tr.append(el('td', 'num', fmt(n)));
      }
      return tr;
    }),
  );
}

// ---------- fetching ----------

let inFlight = false;
let lastAttempt = 0;
let lastSuccess: string | null = null;

async function refresh(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  lastAttempt = Date.now();
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stats = parseStats(await res.json());
    if (!stats) throw new Error('unexpected response');
    renderReal(stats.traffic.real);
    renderOther(stats);
    lastSuccess = when(stats.generatedAt) ?? when(new Date().toISOString());
    setText('stats-status', `Live from /api/v1/stats, as of ${lastSuccess}. Refreshes every minute.`);
  } catch {
    if (!lastSuccess) {
      for (const id of LIVE_BOXES) byId(id)?.replaceChildren(el('p', 'empty-note', 'Live counts are unavailable right now.'));
      byId('real-details')?.replaceChildren(el('li', '', 'Live counts are unavailable right now.'));
    }
    setText(
      'stats-status',
      lastSuccess
        ? `Couldn't refresh just now; showing the counts as of ${lastSuccess}. Trying again in a minute.`
        : 'Live counts are unavailable right now; trying again in a minute. Nothing else on this page depends on them.',
    );
  } finally {
    window.clearTimeout(timer);
    inFlight = false;
  }
}

void refresh();
window.setInterval(() => {
  if (!document.hidden) void refresh();
}, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastAttempt >= REFRESH_MS) void refresh();
});
