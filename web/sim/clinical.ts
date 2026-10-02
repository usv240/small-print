// REAL PEOPLE, PUBLISHED DATA. Not a simulation, and not people we recruited.
// Runs the shipped recommend() (imported, unmodified) on per-person rows from open clinical datasets that
// other research groups published, and scores its starting strength against the clinician's near
// prescription. The named baseline is the age table (ageTableAdd40 + addForWorkingDistance) on the same people.
// Sources, every assumption and the limitations: sim/CLINICAL.md.
//
// Run:  npx tsx sim/clinical.ts
// The first run downloads three open spreadsheets (~200 KB in total, CC BY 4.0) to %TEMP%/clinical
// (override with CLINICAL_DIR). Writes public/data/clinical.json and public/figures/clinical-accuracy.svg.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { recommend, WORKING_DISTANCE_MM, type Measurements, type Outcome, type ReferReason as AppFlag } from '../src/core/recommend';
import {
  DEPTH_OF_FOCUS_D, READERS_MAX_D, READERS_MIN_D, TARGET_PRINT_N, addForWorkingDistance, ageTableAdd40,
  logMARForHeight, nPointHeightMm, roundTo,
} from '../src/core/optics';
import { SCOPE, classify, round025, type ReferReason, type Truth } from './model';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.CLINICAL_DIR ?? join(process.env.TEMP ?? tmpdir(), 'clinical');

// ---------------------------------------------------------------- sources

type DatasetKey = 'india' | 'madrid' | 'phakic';

const SOURCES: Record<DatasetKey, { label: string; short: string; file: string; url: string; citation: string; doi: string; license: string; reference: 'clinical' | 'rule' }> = {
  india: {
    label: 'Pondicherry, India: push-up near point + clinical add',
    short: 'Pondicherry, India',
    file: 'sciRep_supp.xlsx',
    url: 'https://static-content.springer.com/esm/art%3A10.1038%2Fs41598-023-50288-w/MediaObjects/41598_2023_50288_MOESM1_ESM.xlsx',
    citation: 'Khurana DA, Swathi N, Rajalakshmi AR. Factors influencing the need and willingness for presbyopic correction: a cross sectional study from south India. Sci Rep 2023;13:22906 (Supplementary Information xlsx).',
    doi: '10.1038/s41598-023-50288-w',
    license: 'CC BY 4.0 (article and supplementary material)',
    reference: 'clinical',
  },
  madrid: {
    label: 'Madrid, Spain: defocus-curve near point + clinical add',
    short: 'Madrid, Spain',
    file: 'z22013721.xlsx',
    url: 'https://zenodo.org/api/records/22013721/files/BBDD%20Binocular%20ZENODO.xlsx/content',
    citation: 'García-del-Castillo V, Álamo-Peña M, Albarrán-Diego C, Arnaiz-Schmitz C, Garzón N, García-Montero M. Binocular Summation in Healthy Presbyopic Adults: Contrast Sensitivity and Defocus Curves. J Pers Med 2026;16(9):465. Data: Zenodo 10.5281/zenodo.22013721 (UCM Optometry and Vision).',
    doi: '10.3390/jpm16090465',
    license: 'CC BY 4.0 (dataset and article)',
    reference: 'clinical',
  },
  phakic: {
    label: 'Madrid phakic 45–65: push-up amplitude, rule-derived reference',
    short: 'Madrid phakic 45–65',
    file: 'z19482311.xlsx',
    url: 'https://zenodo.org/api/records/19482311/files/Zenodo_database_phakic_defocus_accommodation.xlsx/content',
    citation: 'Baoud-Ould-Haddi I, Sierra Á, Garzón N, Albarrán-Diego C, Vargas J, García-Montero M. Subjective Accommodative Function and Defocus Curve Metrics in Phakic Adults Aged 45–65 Years (dataset; manuscript under review). Zenodo 2026, 10.5281/zenodo.19482311.',
    doi: '10.5281/zenodo.19482311',
    license: 'CC BY 4.0',
    reference: 'rule',
  },
};

/** Every dataset we looked at, usable or not (search of 2 Oct 2026; see sim/CLINICAL.md). */
const CANDIDATES = [
  { name: 'Khurana et al. 2023, Sci Rep (south India clinic)', url: 'https://doi.org/10.1038/s41598-023-50288-w', license: 'CC BY 4.0', n: 342, variables: 'age; right-eye far refraction; right-eye near add; push-up NPA (RAF rule, cm) and AA; presenting near VA (N); previous near Rx; decision on near correction', usable: 'primary', reason: 'Only open dataset found with a push-up near point AND a clinically determined add per person. Caveats: right eye only; add test distance and whether NPA was taken through the distance Rx not reported; NPA looks capped at the 50 cm ruler in some rows (AA ≠ 100/NPA in 66 rows).' },
  { name: 'García-del-Castillo et al. 2026, J Pers Med (Madrid presbyopes)', url: 'https://doi.org/10.5281/zenodo.22013721', license: 'CC BY 4.0', n: 30, variables: 'age; full subjective refraction per eye; subjective add (fused cross-cylinder, 40 cm); habitual Rx; uncorrected near VA (some); monocular and binocular defocus curves −3.50 to +1.50 D', usable: 'primary', reason: 'Clinical add + full refraction; the binocular defocus curve gives the raw near limit of clear vision at a chosen acuity, i.e. what a push-up with a constant-angle E measures. Small n.' },
  { name: 'Baoud-Ould-Haddi et al. 2026, Zenodo (Madrid phakic 45–65)', url: 'https://doi.org/10.5281/zenodo.19482311', license: 'CC BY 4.0', n: 77, variables: 'age; spherical equivalent; amplitude of accommodation (values are 100/cm, i.e. a push-type near point); defocus curves; accommodative lag', usable: 'secondary', reason: 'Real measured amplitudes and refractive errors but no add: reference must be rule-derived (1/WD + SE − AA/2), which partly shares the app\'s own rule. Used for refusal behaviour and as a weaker check.' },
  { name: 'CHRISTMAS study, Harvard Dataverse', url: 'https://doi.org/10.7910/DVN/XQWEIT', license: 'CC0 1.0', n: 70, variables: 'age at first request of reading glasses; prescribed add; mean sphere and cylinder; reading distance; arm length', usable: 'no', reason: 'No near point or amplitude. Without one, the app falls back to the age table, so app and baseline are identical here; nothing to compare.' },
  { name: 'Ayaki/Negishi group, PLOS ONE 2025 (S1 Table, n≈1,147), 2021 (pone.0259142, n=339; pone.0250087), 2019 (pone.0211631, glaucoma)', url: 'https://doi.org/10.1371/journal.pone.0334117', license: 'CC BY 4.0', n: 1147, variables: 'age; refraction; minimum near add for 20/25 at 30 cm; dry-eye measures', usable: 'no', reason: 'No accommodation or near-point measure (age path only, where app = age table); add is a threshold (minimum) add at 30 cm, not a comfort add; dry-eye/glaucoma clinic populations.' },
  { name: 'PLOS ONE 2019 diurnal amplitude (pone.0225754)', url: 'https://doi.org/10.1371/journal.pone.0225754', license: 'CC BY 4.0', n: 154, variables: 'push-up AA at six times of day; age as decade group only', usable: 'no', reason: 'No individual age (decade groups), no add, mostly young.' },
  { name: 'PLOS ONE 2020 autorefractor amplitude (pone.0224733)', url: 'https://doi.org/10.1371/journal.pone.0224733', license: 'CC BY 4.0', n: 35, variables: 'age; objective AA (autorefractor); pupil; SE', usable: 'no', reason: 'Objective (not push-up) amplitude, no add, ages 30–47 mostly myopes.' },
  { name: 'Rwanda national eye-care survey, Dryad', url: 'https://doi.org/10.5061/dryad.p6qb650', license: 'CC0 1.0', n: null, variables: 'population survey incl. near vision (per abstract)', usable: 'no', reason: 'No accommodation measure described; not downloaded (1.3 MB) because it could at most test the age path.' },
  { name: 'WE-ACE Zanzibar craftswomen, Zenodo', url: 'https://doi.org/10.5281/zenodo.13749309', license: 'CC BY 4.0', n: 209, variables: 'age group; distance VA/Rx; near VA at N8', usable: 'no', reason: 'Age only as groups; no add values or near point.' },
  { name: 'Red-light therapy for presbyopia trial, Ann Med 2026 (figshare supplements)', url: 'https://doi.org/10.6084/m9.figshare.32111816', license: 'CC BY 4.0', n: null, variables: 'protocol and summary tables', usable: 'no', reason: 'Supplements are a protocol and summary content; no per-person rows.' },
  { name: 'Preoperative binocular vision in age-related cataract, BMC Ophthalmol 2022', url: 'https://europepmc.org/article/PMC/PMC9047293', license: 'CC BY 4.0', n: null, variables: 'near point measures (per text) in cataract patients', usable: 'no', reason: 'Cataract population (not ready-made-reader users); supplement download failed; not pursued.' },
  { name: 'Other 2024–2026 accommodation/presbyopia papers (BMC Ophthalmol 2025 x2, Eye 2024 nine-country near-vision data, Front Ophthalmol 2026 digital near-glasses tool)', url: 'https://europepmc.org/', license: 'various', n: null, variables: 'various', usable: 'no', reason: 'Data "on request", controlled access or not shared.' },
  { name: 'NHANES 2005–2006 vision examination (VIX_D)', url: 'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2005/DataFiles/VIX_D.htm', license: 'public domain', n: null, variables: 'distance VA, objective refraction, keratometry, near-card line read and test distance, glasses Rx', usable: 'no', reason: 'No near point, amplitude or near add.' },
  { name: 'Duane 1922 / Hofstetter 1950 age–amplitude tables', url: 'https://en.wikipedia.org/wiki/Amplitude_of_accommodation', license: 'published tables', n: null, variables: 'grouped amplitude by age', usable: 'no', reason: 'Grouped, not individual; the app already uses Hofstetter as its plausibility norm, so a group check would be circular. Not needed once individual data was found.' },
];

// ---------------------------------------------------------------- tiny dependency-free xlsx reader

type Cell = string | number | null;

function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    out.set(name, method === 0 ? data : inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const attr = (s: string, a: string) => s.match(new RegExp(`(?:^|\\s)${a}="([^"]*)"`))?.[1] ?? '';
const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const textRuns = (s: string) => unescapeXml([...s.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
const colIndex = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function readXlsx(path: string): Map<string, Cell[][]> {
  const zip = unzip(readFileSync(path));
  const xml = (name: string) => zip.get(name)?.toString('utf8') ?? '';
  const shared = [...xml('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1]));
  const rels = new Map([...xml('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const sheets = new Map<string, Cell[][]>();
  for (const sm of xml('xl/workbook.xml').matchAll(/<sheet\s[^>]*>/g)) {
    const target = rels.get(attr(sm[0], 'r:id')) ?? '';
    const sheetXml = xml(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    const rows: Cell[][] = [];
    for (const rm of sheetXml.matchAll(/<row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const row: Cell[] = [];
      for (const cm of (rm[2] ?? '').matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = attr(cm[1], 't');
        const inner = cm[2] ?? '';
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value: Cell = null;
        if (type === 's' && v !== undefined) value = shared[Number(v)] ?? null;
        else if (type === 'inlineStr') value = textRuns(inner);
        else if (type === 'str' && v !== undefined) value = unescapeXml(v);
        else if (v !== undefined) value = Number(v);
        row[colIndex(attr(cm[1], 'r'))] = value;
      }
      rows[Number(attr(rm[1], 'r')) - 1] = row;
    }
    sheets.set(unescapeXml(attr(sm[0], 'name')), rows);
  }
  return sheets;
}

const num = (v: Cell | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const x = Number(v.trim().replace(',', '.'));
  return Number.isFinite(x) ? x : null;
};

function columns(header: Cell[]) {
  const names = header.map((h) => (typeof h === 'string' ? h.trim() : h));
  return (name: string) => {
    const i = names.indexOf(name);
    if (i < 0) throw new Error(`missing column "${name}"`);
    return i;
  };
}

async function ensureFile(key: DatasetKey): Promise<{ path: string; sha256: string }> {
  const { file, url } = SOURCES[key];
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) {
    mkdirSync(DATA_DIR, { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${file} from ${url}`);
  }
  return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
}

// ---------------------------------------------------------------- people

interface Person {
  dataset: DatasetKey;
  id: string;
  age: number;
  /** Distance refraction, spherical equivalent (D, + = long-sighted). The app sees the eye without it. */
  seD: number;
  /** Clinician's near addition (D), or null when the study has none. */
  addD: number | null;
  /** Without glasses: nearest clear point (raw, includes depth of focus) and farthest clear point, as vergence (D). */
  nearD: number;
  farD: number;
  /** Real measured "reads N6-size print without near glasses", when the study has it. */
  smallPrintMeasured: boolean | null;
  /** Reference readers power for a working distance (D). */
  refAt: (workingMm: number) => number;
  notes: string[];
}

/** Letter size of the app's E (N6 at 40 cm) as logMAR: about 0.27. */
export const APP_E_LOGMAR = logMARForHeight(nPointHeightMm(TARGET_PRINT_N), 400);

interface IndiaOptions { nearSource: 'AA' | 'NPA'; throughDistanceRx: boolean; excludeInconsistent: boolean; addDistanceMm: number }
const INDIA_DEFAULT: IndiaOptions = { nearSource: 'AA', throughDistanceRx: true, excludeInconsistent: false, addDistanceMm: 400 };

function indiaPeople(rows: Cell[][], o: IndiaOptions): Person[] {
  const col = columns(rows[0]);
  const c = {
    id: col('Sn no.'), age: col('Age'), prevNear: col('Previous refractive error for near'), presNear: col('Presenting VA near'),
    far: col('Present refrative error for far'), add: col('Present refractive error for near'), aa: col('AA'), npa: col('NPA'),
  };
  const out: Person[] = [];
  for (const r of rows.slice(1)) {
    if (!r) continue;
    const age = num(r[c.age]), se = num(r[c.far]), add = num(r[c.add]), aa = num(r[c.aa]), npa = num(r[c.npa]);
    if (age === null || se === null || add === null || aa === null || npa === null || npa <= 0 || aa <= 0) continue;
    const notes: string[] = [];
    const inconsistent = Math.abs(100 / npa - aa) > 0.06;
    if (inconsistent) notes.push('AA ≠ 100/NPA');
    if (o.excludeInconsistent && inconsistent) continue;
    const rawD = o.nearSource === 'AA' ? aa : 100 / npa;
    const prev = num(r[c.prevNear]);
    const pres = num(r[c.presNear]);
    // Presenting near acuity (N-notation) is an uncorrected near test only for people without near glasses.
    const smallPrintMeasured = prev === 0 && pres !== null && pres >= 5 ? pres <= 6 : null;
    out.push({
      dataset: 'india', id: String(r[c.id]), age, seD: se, addD: add,
      nearD: rawD - (o.throughDistanceRx ? se : 0),
      farD: -se - DEPTH_OF_FOCUS_D / 2,
      smallPrintMeasured,
      refAt: (w) => se + add + 1000 / w - 1000 / o.addDistanceMm,
      notes,
    });
  }
  return out;
}

const DEFOCUS = [-3.5, -3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5];
const defocusName = (d: number) => `AV ${d === 0 ? '0.00' : `${d > 0 ? '+' : ''}${d.toFixed(2)}`} bin`;

/** Contiguous defocus range around the best acuity where logMAR ≤ threshold; ends by linear interpolation.
 *  An end that never crosses is censored at the last lens tested. */
export function clearZone(va: (number | null)[], threshold: number) {
  const pts = DEFOCUS.map((d, i) => ({ d, v: va[i] })).filter((p): p is { d: number; v: number } => p.v !== null);
  if (!pts.length) return null;
  let b = 0;
  pts.forEach((p, i) => {
    if (p.v < pts[b].v - 1e-9 || (Math.abs(p.v - pts[b].v) < 1e-9 && Math.abs(p.d) < Math.abs(pts[b].d))) b = i;
  });
  if (pts[b].v > threshold) return null;
  const cross = (clear: { d: number; v: number }, blur: { d: number; v: number }) => clear.d + ((blur.d - clear.d) * (threshold - clear.v)) / (blur.v - clear.v);
  let dNear = pts[0].d, nearCensored = true;
  for (let i = b; i > 0; i--) if (pts[i - 1].v > threshold) { dNear = cross(pts[i], pts[i - 1]); nearCensored = false; break; }
  let dFar = pts[pts.length - 1].d, farCensored = true;
  for (let i = b; i < pts.length - 1; i++) if (pts[i + 1].v > threshold) { dFar = cross(pts[i], pts[i + 1]); farCensored = false; break; }
  return { dNear, dFar, nearCensored, farCensored };
}

/** Linear interpolation of the defocus curve (clamped to the lenses tested). */
function vaAt(va: (number | null)[], d: number): number | null {
  const pts = DEFOCUS.map((x, i) => ({ x, v: va[i] })).filter((p): p is { x: number; v: number } => p.v !== null);
  if (!pts.length) return null;
  if (d <= pts[0].x) return pts[0].v;
  if (d >= pts[pts.length - 1].x) return pts[pts.length - 1].v;
  for (let i = 0; i < pts.length - 1; i++) {
    if (d >= pts[i].x && d <= pts[i + 1].x) return pts[i].v + ((pts[i + 1].v - pts[i].v) * (d - pts[i].x)) / (pts[i + 1].x - pts[i].x);
  }
  return null;
}

interface MadridRow { id: string; age: number; seD: number; seOD: number; seOS: number; cylMax: number; addD: number; curve: (number | null)[]; uncorrectedNearVA: number | null; notes: string[] }

function madridRows(rows: Cell[][]): MadridRow[] {
  const col = columns(rows[0]);
  const c = {
    id: col('ID'), age: col('Edad'), sOD: col('Esf_OD_Sub'), cOD: col('Cil_OD_Sub'), sOS: col('Esf_OS_Sub'), cOS: col('Cil_OS_Sub'),
    add: col('Ad_Sub'), nearVA: col('AVVP_AO_bruta'),
  };
  const curveCols = DEFOCUS.map((d) => col(defocusName(d)));
  const out: MadridRow[] = [];
  for (const r of rows.slice(1)) {
    if (!r || typeof r[c.id] !== 'string' || !/^\d+-\d+$/.test(String(r[c.id]).trim())) continue;
    const age = num(r[c.age]), add = num(r[c.add]);
    if (age === null || add === null) continue;
    const notes: string[] = [];
    const eye = (s: number, cy: number) => {
      const sph = num(r[s]), cyl = num(r[cy]);
      if (sph === null) notes.push('blank subjective sphere read as plano');
      return { se: (sph ?? 0) + (cyl ?? 0) / 2, cyl: Math.abs(cyl ?? 0) };
    };
    const od = eye(c.sOD, c.cOD), os = eye(c.sOS, c.cOS);
    const nv = num(r[c.nearVA]);
    out.push({
      id: String(r[c.id]).trim(), age, seD: (od.se + os.se) / 2, seOD: od.se, seOS: os.se, cylMax: Math.max(od.cyl, os.cyl), addD: add,
      curve: curveCols.map((i) => num(r[i])), uncorrectedNearVA: nv !== null && nv > -0.5 && nv < 1.5 ? nv : null, notes,
    });
  }
  return out;
}

function madridPeople(rows: MadridRow[], threshold: number): Person[] {
  return rows.map((m) => {
    const zone = clearZone(m.curve, threshold);
    const notes = [...m.notes];
    if (m.cylMax > 1.0) notes.push('astigmatism > 1.00 D (ready-mades not advised)');
    if (Math.abs(m.seOD - m.seOS) > 1.0) notes.push('anisometropia > 1.00 D (ready-mades not advised)');
    if (zone?.nearCensored) notes.push('near limit beyond −3.50 D lens (censored)');
    // A lens of power d on the corrected eye is equivalent to the uncorrected eye viewing vergence −(d + SE).
    return {
      dataset: 'madrid' as const, id: m.id, age: m.age, seD: m.seD, addD: m.addD,
      nearD: zone ? -zone.dNear - m.seD : -Infinity,
      farD: zone ? -zone.dFar - m.seD : Infinity,
      smallPrintMeasured: null,
      refAt: (w: number) => m.seD + m.addD + 1000 / w - 2.5,
      notes,
    };
  });
}

function phakicPeople(sheets: Map<string, Cell[][]>): Person[] {
  const subjects = sheets.get('subjects')!;
  const aaRows = sheets.get('aa')!;
  const sc = columns(subjects[0]);
  const ac = columns(aaRows[0]);
  const aaById = new Map(aaRows.slice(1).filter(Boolean).map((r) => [String(r[ac('subject_id')]), num(r[ac('amplitude_accommodation_d')])]));
  const out: Person[] = [];
  for (const r of subjects.slice(1)) {
    if (!r) continue;
    const id = String(r[sc('subject_id')]);
    const age = num(r[sc('age_years')]), se = num(r[sc('spherical_equiv_d')]), aa = aaById.get(id) ?? null;
    if (age === null || se === null || aa === null || aa <= 0) continue;
    out.push({
      dataset: 'phakic', id, age, seD: se, addD: null,
      nearD: aa - se, farD: -se - DEPTH_OF_FOCUS_D / 2, smallPrintMeasured: null,
      // Standard clinical rule on the measured amplitude: keep half in reserve.
      refAt: (w) => se + 1000 / w - aa / 2,
      notes: [],
    });
  }
  return out;
}

// ---------------------------------------------------------------- what the app would measure, and both methods

/** Closest distance the camera can measure (face must stay in frame), as in sim/model.ts. */
const MIN_DISTANCE_MM = 120;

type SmallPrintMode = 'measured-else-derived' | 'derived' | 'not-tested';

function measure(p: Person, workingMm: number, reachMm: number, mode: SmallPrintMode): Measurements {
  const reachD = 1000 / reachMm;
  // Same rule as sim/model.ts: never clear within reach (or no clear range at all) → "beyond reach".
  const beyond = !(p.nearD > reachD && p.nearD > p.farD);
  const dW = 1000 / workingMm;
  const derived = dW <= p.nearD && dW >= p.farD;
  const smallPrint = mode === 'not-tested' ? null : mode === 'derived' ? derived : (p.smallPrintMeasured ?? derived);
  return {
    age: p.age,
    workingDistanceMm: workingMm,
    nearPointMm: beyond ? null : Math.max(MIN_DISTANCE_MM, 1000 / p.nearD),
    nearPointBeyondReach: beyond,
    reachMm,
    smallPrintAtWorkingDistance: smallPrint,
  };
}

/** Named baseline: the age table shifted to the working distance (no measurement at all). */
function ageTable(age: number, workingMm: number): { outcome: Outcome; strength: number | null } {
  const w = Math.min(WORKING_DISTANCE_MM.max, Math.max(WORKING_DISTANCE_MM.min, workingMm));
  const s = roundTo(addForWorkingDistance(ageTableAdd40(age), w), 0.25);
  if (s < READERS_MIN_D) return { outcome: 'no-readers', strength: null };
  if (s > READERS_MAX_D) return { outcome: 'refer', strength: null };
  return { outcome: 'readers', strength: s };
}

interface Result {
  person: Person;
  refD: number;
  truth: Truth;
  referReason: ReferReason;
  m: Measurements;
  app: { outcome: Outcome; strength: number | null; flags: AppFlag[]; fromNearPoint: number | null; lowerBound: boolean };
  table: { outcome: Outcome; strength: number | null };
}

function run(p: Person, workingMm: number, reachMm: number, mode: SmallPrintMode): Result {
  const refD = p.refAt(workingMm);
  const { truth, referReason } = classify(p.seD, round025(refD));
  const m = measure(p, workingMm, reachMm, mode);
  const rec = recommend(m);
  return {
    person: p, refD, truth, referReason, m,
    app: { outcome: rec.outcome, strength: rec.strength, flags: rec.flags, fromNearPoint: rec.detail.fromNearPoint, lowerBound: rec.detail.nearPointIsLowerBound },
    table: ageTable(p.age, workingMm),
  };
}

// ---------------------------------------------------------------- scoring

const EPS = 1e-9;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const pct = (k: number, n: number) => (n ? Math.round((1000 * k) / n) / 10 : null);

function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (!n) return null;
  const p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.round(1000 * Math.max(0, c - h)) / 10, Math.round(1000 * Math.min(1, c + h)) / 10];
}

function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (!n) return 1;
  let s = 0;
  for (let i = 0, term = 1; i <= Math.min(b, c); i++) {
    s += term;
    term = (term * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * s) / 2 ** n);
}

type Method = 'app' | 'table' | 'nearPointArm';

function pick(r: Result, method: Method): { outcome: Outcome | 'not-available'; strength: number | null } {
  if (method === 'app') return r.app;
  if (method === 'table') return r.table;
  // Diagnostic only: the app's own near-point estimate before the age-table blend (not shipped as a result).
  if (r.app.fromNearPoint === null || r.app.lowerBound) return { outcome: 'not-available', strength: null };
  return { outcome: 'readers', strength: roundTo(r.app.fromNearPoint, 0.25) };
}

function score(rows: Result[], method: Method) {
  const avail = rows.filter((r) => pick(r, method).outcome !== 'not-available');
  const offered = avail.filter((r) => pick(r, method).outcome === 'readers');
  const errs = offered.map((r) => pick(r, method).strength! - r.refD);
  const within = (t: number) => errs.filter((e) => Math.abs(e) <= t + EPS).length;
  const n = avail.length;
  return {
    n,
    offeredReaders: offered.length,
    toldNoReaders: avail.filter((r) => pick(r, method).outcome === 'no-readers').length,
    referred: avail.filter((r) => pick(r, method).outcome === 'refer').length,
    /** Shares of ALL n people (a wrong outcome counts as a miss). */
    exactPct: pct(within(0.125), n),
    within025Pct: pct(within(0.25), n),
    within050Pct: pct(within(0.5), n),
    within050CI95: wilson(within(0.5), n),
    /** Among people who were offered readers. */
    biasD: offered.length ? r3(mean(errs)) : null,
    maeD: offered.length ? r3(mean(errs.map(Math.abs))) : null,
    tooStrongBy075PlusPct: pct(errs.filter((e) => e >= 0.75 - EPS).length, n),
    tooWeakBy075PlusPct: pct(errs.filter((e) => e <= -0.75 + EPS).length, n),
  };
}

const hit050 = (r: Result, m: Method) => {
  const x = pick(r, m);
  return x.outcome === 'readers' && Math.abs(x.strength! - r.refD) <= 0.5 + EPS;
};

function paired(rows: Result[]) {
  const b = rows.filter((r) => hit050(r, 'app') && !hit050(r, 'table')).length;
  const c = rows.filter((r) => !hit050(r, 'app') && hit050(r, 'table')).length;
  return { appOnlyWithin050: b, tableOnlyWithin050: c, mcnemarExactP: r3(mcnemarExact(b, c)) };
}

const AGE_BANDS: [string, number, number][] = [['38–44', 0, 44.999], ['45–49', 45, 49.999], ['50–54', 50, 54.999], ['55–59', 55, 59.999], ['60+', 60, 200]];

function summarise(results: Result[]) {
  const inScope = results.filter((r) => r.truth === 'readers');
  const outcomes = (rows: Result[], m: 'app' | 'table') => ({
    readers: rows.filter((r) => r[m].outcome === 'readers').length,
    noReaders: rows.filter((r) => r[m].outcome === 'no-readers').length,
    refer: rows.filter((r) => r[m].outcome === 'refer').length,
  });
  const outOfScope = (pred: (r: Result) => boolean) => {
    const rows = results.filter(pred);
    return {
      n: rows.length, app: outcomes(rows, 'app'), table: outcomes(rows, 'table'),
      /** Offered readers that were nonetheless within ±0.50 D of the reference (e.g. +3.00 for a +3.25 need). */
      appReadersWithin050: rows.filter((r) => hit050(r, 'app')).length,
      tableReadersWithin050: rows.filter((r) => hit050(r, 'table')).length,
    };
  };
  return {
    n: results.length,
    inScope: {
      app: score(inScope, 'app'),
      ageTable: score(inScope, 'table'),
      paired: paired(inScope),
      nearPointArmDiagnostic: score(inScope, 'nearPointArm'),
      byAgeBand: AGE_BANDS.map(([label, lo, hi]) => {
        const rows = inScope.filter((r) => r.person.age >= lo && r.person.age <= hi);
        return { band: label, n: rows.length, app: score(rows, 'app'), ageTable: score(rows, 'table') };
      }).filter((b) => b.n > 0),
      appFlags: {
        inconsistent: inScope.filter((r) => r.app.flags.includes('inconsistent')).length,
        possibleMyopia: inScope.filter((r) => r.app.flags.includes('possible-myopia')).length,
        nearPointBeyondReach: inScope.filter((r) => r.m.nearPointBeyondReach).length,
      },
    },
    outOfScope: {
      myopiaRefer: outOfScope((r) => r.truth === 'refer' && r.referReason === 'myopia'),
      aboveRange: outOfScope((r) => r.truth === 'refer' && r.referReason === 'above-range'),
      notYet: outOfScope((r) => r.truth === 'none'),
    },
  };
}

// ---------------------------------------------------------------- scenarios

interface Scenario {
  key: string;
  label: string;
  workingMm: number;
  reachMm: number;
  threshold: number;
  india: IndiaOptions;
  smallPrint: SmallPrintMode;
}

const PRIMARY: Scenario = {
  key: 'primary', label: 'Primary: 40 cm, reach 62.5 cm, E clear at the app letter size (logMAR 0.27), India near point from AA through the distance Rx',
  workingMm: 400, reachMm: 625, threshold: APP_E_LOGMAR, india: INDIA_DEFAULT, smallPrint: 'measured-else-derived',
};

const SENSITIVITY: Scenario[] = [
  { ...PRIMARY, key: 'wd333', label: 'Working distance 33 cm (reference add shifted by +0.50 D)', workingMm: 1000 / 3 },
  { ...PRIMARY, key: 'wd450', label: 'Working distance 45 cm (reference add shifted by −0.28 D)', workingMm: 450 },
  { ...PRIMARY, key: 'reach550', label: 'Arm reach 55 cm', reachMm: 550 },
  { ...PRIMARY, key: 'reach700', label: 'Arm reach 70 cm', reachMm: 700 },
  { ...PRIMARY, key: 'va020', label: 'Madrid: "clear" = logMAR 0.20 (stricter)', threshold: 0.2 },
  { ...PRIMARY, key: 'va010', label: 'Madrid: "clear" = logMAR 0.10 (strictest)', threshold: 0.1 },
  { ...PRIMARY, key: 'indiaNPA', label: 'India: near point from the NPA column instead of AA', india: { ...INDIA_DEFAULT, nearSource: 'NPA' } },
  { ...PRIMARY, key: 'indiaConsistent', label: 'India: drop the 66 rows where AA ≠ 100/NPA', india: { ...INDIA_DEFAULT, excludeInconsistent: true } },
  { ...PRIMARY, key: 'indiaUncorrected', label: 'India: NPA was measured without distance glasses', india: { ...INDIA_DEFAULT, throughDistanceRx: false } },
  { ...PRIMARY, key: 'indiaAdd33', label: 'India: add was prescribed for 33 cm (app run at 33 cm, reference unshifted)', workingMm: 1000 / 3, india: { ...INDIA_DEFAULT, addDistanceMm: 1000 / 3 } },
  { ...PRIMARY, key: 'spDerived', label: 'Small-print answer derived from the clear range for everyone', smallPrint: 'derived' },
  { ...PRIMARY, key: 'spNotTested', label: 'Small-print check skipped (null) for everyone', smallPrint: 'not-tested' },
];

// ---------------------------------------------------------------- main

const files = {} as Record<DatasetKey, { path: string; sha256: string }>;
for (const k of Object.keys(SOURCES) as DatasetKey[]) files[k] = await ensureFile(k);

const indiaSheet = readXlsx(files.india.path).get('Sheet1')!;
const madridSheet = madridRows(readXlsx(files.madrid.path).get('BBDD')!);
const phakicSheets = readXlsx(files.phakic.path);

function scenarioResults(s: Scenario) {
  const people = {
    india: indiaPeople(indiaSheet, s.india),
    madrid: madridPeople(madridSheet, s.threshold),
    phakic: phakicPeople(phakicSheets),
  };
  const res = (ps: Person[]) => ps.map((p) => run(p, s.workingMm, s.reachMm, s.smallPrint));
  return { india: res(people.india), madrid: res(people.madrid), phakic: res(people.phakic) };
}

const primary = scenarioResults(PRIMARY);
const clinicalPooled = [...primary.india, ...primary.madrid];
const indiaEmmetropes = primary.india.filter((r) => r.person.seD === 0);
const madridSuitable = primary.madrid.filter((r) => !r.person.notes.some((n) => n.includes('not advised')));

const results = {
  india: summarise(primary.india),
  indiaEmmetropesOnly: summarise(indiaEmmetropes),
  madrid: summarise(primary.madrid),
  madridReadersSuitableOnly: summarise(madridSuitable),
  pooledClinical: summarise(clinicalPooled),
  phakicRuleDerived: summarise(primary.phakic),
};

const sensitivity = [PRIMARY, ...SENSITIVITY].map((s) => {
  const r = scenarioResults(s);
  const brief = (rows: Result[]) => {
    const inScope = rows.filter((x) => x.truth === 'readers');
    const a = score(inScope, 'app'), t = score(inScope, 'table');
    return { nInScope: inScope.length, appWithin050Pct: a.within050Pct, tableWithin050Pct: t.within050Pct, appWithin025Pct: a.within025Pct, tableWithin025Pct: t.within025Pct, appBiasD: a.biasD, appMaeD: a.maeD };
  };
  return { key: s.key, label: s.label, india: brief(r.india), madrid: brief(r.madrid), pooledClinical: brief([...r.india, ...r.madrid]), phakicRuleDerived: brief(r.phakic) };
});

// Checks of the mapping from published measurements to what the app would see.
const madridCheck = (() => {
  const rows = madridSheet.filter((m) => m.uncorrectedNearVA !== null);
  const pairs = rows.map((m) => ({ predicted: vaAt(m.curve, -(2.5 + m.seD))!, measured: m.uncorrectedNearVA! }));
  const agree = pairs.filter((p) => (p.predicted <= APP_E_LOGMAR) === (p.measured <= APP_E_LOGMAR)).length;
  return {
    what: 'Uncorrected binocular near VA at 40 cm: predicted from the binocular defocus curve and the distance Rx vs. measured (AVVP_AO_bruta)',
    n: pairs.length,
    meanDifferenceLogMAR: r3(mean(pairs.map((p) => p.predicted - p.measured))),
    meanAbsDifferenceLogMAR: r3(mean(pairs.map((p) => Math.abs(p.predicted - p.measured)))),
    sameN6VerdictPct: pct(agree, pairs.length),
  };
})();
const indiaCheck = (() => {
  const rows = primary.india.filter((r) => r.person.smallPrintMeasured !== null);
  const derived = (r: Result) => 2.5 <= r.person.nearD && 2.5 >= r.person.farD;
  const agree = rows.filter((r) => derived(r) === r.person.smallPrintMeasured).length;
  return {
    what: 'Reads N6 without near glasses: measured (presenting near VA ≤ N6, people with no previous near Rx) vs. derived from the push-up near point at 40 cm',
    n: rows.length,
    measuredYes: rows.filter((r) => r.person.smallPrintMeasured).length,
    derivedYes: rows.filter(derived).length,
    agreementPct: pct(agree, rows.length),
  };
})();

// How age-determined is the India reference? (If the clinic's adds were set by age alone, an age table is favoured.)
const corr = (x: number[], y: number[]) => {
  const mx = mean(x), my = mean(y);
  const sxy = x.reduce((a, xi, i) => a + (xi - mx) * (y[i] - my), 0);
  return sxy / Math.sqrt(x.reduce((a, xi) => a + (xi - mx) ** 2, 0) * y.reduce((a, yi) => a + (yi - my) ** 2, 0));
};
const indiaReference = (() => {
  const em = indiaPeople(indiaSheet, INDIA_DEFAULT).filter((p) => p.seD === 0);
  const ages = em.map((p) => p.age), adds = em.map((p) => p.addD!), table = em.map((p) => ageTableAdd40(p.age)), aa = em.map((p) => p.nearD);
  const slope = ages.reduce((a, x, i) => a + (x - mean(ages)) * (adds[i] - mean(adds)), 0) / ages.reduce((a, x) => a + (x - mean(ages)) ** 2, 0);
  const resid = adds.map((y, i) => y - (mean(adds) + slope * (ages[i] - mean(ages))));
  return {
    what: 'India, zero far refraction: how closely the clinic add follows age',
    n: em.length,
    addEqualsAgeTablePct: pct(em.filter((p, i) => p.addD === table[i]).length, em.length),
    rAddAge: r3(corr(adds, ages)),
    rAddAgeTable: r3(corr(adds, table)),
    rAddResidualGivenAgeVsAmplitude: r3(corr(resid, aa)),
  };
})();

const people = (Object.keys(primary) as DatasetKey[]).flatMap((k) => primary[k].map((r) => ({
  dataset: k,
  id: r.person.id,
  age: r.person.age,
  seD: r3(r.person.seD),
  addD: r.person.addD,
  referenceD: r3(r.refD),
  referenceKind: SOURCES[k].reference,
  truth: r.truth === 'refer' ? `refer:${r.referReason}` : r.truth,
  nearPointMm: r.m.nearPointMm === null ? null : Math.round(r.m.nearPointMm),
  nearPointBeyondReach: r.m.nearPointBeyondReach,
  smallPrint: r.m.smallPrintAtWorkingDistance,
  smallPrintSource: r.person.smallPrintMeasured !== null ? 'measured' : 'derived',
  app: { outcome: r.app.outcome, strength: r.app.strength, flags: r.app.flags },
  ageTable: { outcome: r.table.outcome, strength: r.table.strength },
  notes: r.person.notes,
})));

const out = {
  kind: 'REAL PEOPLE, PUBLISHED DATA (not a simulation; not people we recruited)',
  generated: new Date().toISOString(),
  reproduce: 'cd web && npx tsx sim/clinical.ts',
  algorithm: 'recommend() from src/core/recommend.ts, imported unmodified. Baseline: ageTableAdd40() + addForWorkingDistance() from src/core/optics.ts, rounded to 0.25 D.',
  scoring: {
    reference: 'Clinical datasets: clinician\'s near prescription for the uncorrected eye = distance spherical equivalent + near add (what a ready-made pair must supply). Phakic dataset: rule-derived = SE + 1/WD − AA/2 (no add was measured).',
    scope: `Same rules as the simulated bench (sim/model.ts SCOPE): refer if distance SE < ${SCOPE.referMyopiaBelowD} D (myopia) or reference > ${SCOPE.maxReadersD} D; no readers yet if reference < ${SCOPE.minUsefulD} D; otherwise in scope for readers.`,
    tolerances: 'exact = |error| ≤ 0.125 D; within ±0.25 D; within ±0.50 D. Shares are of ALL in-scope people: being told "no readers" or "see an optometrist" counts as a miss. Bias and MAE are over people who were offered readers.',
    appLetterLogMAR: r3(APP_E_LOGMAR),
  },
  sources: (Object.keys(SOURCES) as DatasetKey[]).map((k) => ({ key: k, ...SOURCES[k], sha256: files[k].sha256, nUsed: primary[k].length })),
  search: { date: '2026-10-02', where: 'DataCite API (covers Zenodo, figshare, Dryad, Mendeley Data, OSF, Harvard Dataverse, UK Data Service; 16 queries), Zenodo API, Europe PMC (5 open-access + supplementary-data queries, full text and supplement lists of 20 papers), figshare / Dataverse / Dryad APIs, PLOS ONE supplements, NHANES documentation. Not searched: Kaggle, PhysioNet (no relevant hits expected; no time).', candidates: CANDIDATES },
  assumptions: [
    'Working distance 40 cm for everyone (no study recorded habitual reading distance); sensitivity at 33 and 45 cm.',
    'India: the near add was prescribed for 40 cm (test distance not reported); sensitivity with 33 cm.',
    'India: AA (=100/NPA in 276 of 342 rows) is the push-up near point; NPA looks capped at ~50 cm (ruler end) in rows where AA < 2 D; sensitivities use the NPA column or drop those rows.',
    'India: NPA was measured through the distance refraction, so uncorrected near point = AA − SE (irrelevant for the 221 with zero far refraction); sensitivity without.',
    'India: right eye only (as reported by the study); the app is binocular.',
    'Madrid: the raw near limit is where binocular acuity on the distance-corrected defocus curve crosses the app letter size (logMAR 0.27); a lens d on the corrected eye equals the uncorrected eye viewing vergence −(d + SE). Sensitivity at logMAR 0.20 and 0.10.',
    'Madrid: binocular spherical equivalent = mean of both eyes; astigmatism ignored by the app (people with >1.00 D cylinder or anisometropia reported separately).',
    'Phakic dataset: amplitude was measured through the distance correction (not stated in the dataset).',
    `Far limit without glasses = −SE − depth of focus/2 (${DEPTH_OF_FOCUS_D / 2} D) where no defocus curve is used.`,
    'Arm reach 62.5 cm (middle of the 55–70 cm used by the simulated bench); sensitivity 55 and 70 cm. Camera minimum 12 cm.',
    'Small-print answer: measured where the study has an uncorrected near-acuity test (India, people without previous near glasses: presenting near VA ≤ N6); otherwise derived from the clear range.',
    'No measurement noise is added: the published measurements already contain clinical measurement error.',
  ],
  results,
  checks: { madridDefocusMapping: madridCheck, indiaSmallPrint: indiaCheck, indiaReferenceVsAge: indiaReference },
  sensitivity,
  people,
};

const jsonPath = join(ROOT, 'public', 'data', 'clinical.json');
writeFileSync(jsonPath, JSON.stringify(out, null, 1) + '\n');

// ---------------------------------------------------------------- figure (same visual language as bench-*.svg)

const FONT = 'system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, sans-serif';
const INK = '#0b0b0b', INK2 = '#52514e', MUTED = '#6b6a66', GRID = '#e1e0d9', AXIS = '#c3c2b7', BAND = '#f0efec';
const BLUE_DARK = '#2a78d6', BLUE_LIGHT = '#9ec5f4';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = (x: number | null) => (x === null ? '–' : x.toFixed(1));

function accuracyFigure(groups: { title: string; n: number; rows: { label: string; s: ReturnType<typeof score> }[] }[], note: string): string {
  const w = 780, left = 250, right = 60, top = 100, rowH = 46, groupGap = 26;
  const nRows = groups.reduce((a, g) => a + g.rows.length, 0);
  const h = top + nRows * rowH + groups.length * groupGap + 118;
  const plotW = w - left - right;
  const bottom = h - 118;
  const x = (v: number) => left + (v / 100) * plotW;
  const badgeW = 128;
  let body = `<g aria-hidden="true"><rect x="${w - 24 - badgeW}" y="20" width="${badgeW}" height="22" rx="11" fill="${BAND}" stroke="${AXIS}"/>
<text x="${w - 24 - badgeW / 2}" y="35" font-size="11" font-weight="600" fill="${INK2}" text-anchor="middle" letter-spacing="0.6">PUBLISHED DATA</text></g>`;
  body += `<g font-size="12" fill="${INK2}">
<rect x="${left}" y="74" width="12" height="12" rx="2" fill="${BLUE_LIGHT}"/><text x="${left + 18}" y="84">within ±0.50 D (one stocked step)</text>
<rect x="${left + 230}" y="74" width="12" height="12" rx="2" fill="${BLUE_DARK}"/><text x="${left + 248}" y="84">within ±0.25 D</text></g>`;
  for (const t of [0, 25, 50, 75, 100]) {
    body += `<line x1="${x(t)}" y1="${top - 6}" x2="${x(t)}" y2="${bottom}" stroke="${t === 0 ? AXIS : GRID}" stroke-width="1"/>`;
    body += `<text x="${x(t)}" y="${bottom + 18}" font-size="11.5" fill="${INK2}" text-anchor="middle">${t}%</text>`;
  }
  body += `<text x="${left + plotW / 2}" y="${bottom + 38}" font-size="12" fill="${INK2}" text-anchor="middle">Share of in-scope people whose starting pair is within the tolerance (wrong outcome = miss)</text>`;
  let y = top;
  const descParts: string[] = [];
  for (const g of groups) {
    body += `<text x="24" y="${y + 6}" font-size="11.5" font-weight="600" fill="${MUTED}" letter-spacing="0.4">${esc(g.title.toUpperCase())} <tspan font-weight="400" letter-spacing="0">(n=${g.n})</tspan></text>`;
    y += groupGap - 6;
    for (const r of g.rows) {
      const bh = 15;
      const v050 = r.s.within050Pct ?? 0, v025 = r.s.within025Pct ?? 0;
      body += `<text x="24" y="${y + bh + 5}" font-size="12.5" fill="${INK}">${esc(r.label)}</text>`;
      for (const [i, v, fill, tol] of [[0, v050, BLUE_LIGHT, '±0.50'], [1, v025, BLUE_DARK, '±0.25']] as const) {
        const by = y + i * (bh + 2);
        body += `<g><title>${esc(`${g.title}, ${r.label}: ${f1(v)}% of ${r.s.n} within ${tol} D`)}</title><rect x="${left}" y="${by}" width="${Math.max(1, x(v) - left)}" height="${bh}" rx="2" fill="${fill}"/>`;
        body += `<text x="${x(v) + 6}" y="${by + bh - 3}" font-size="11.5" fill="${INK2}">${f1(v)}%</text></g>`;
      }
      descParts.push(`${g.title} (n=${g.n}), ${r.label}: ${f1(r.s.within050Pct)}% within ±0.50 D, ${f1(r.s.within025Pct)}% within ±0.25 D`);
      y += rowH;
    }
    y += 6;
  }
  const title = 'Real people from published studies: Small Print vs the age table';
  const subtitle = 'Starting strength vs the clinician\'s near prescription (distance Rx + add), at 40 cm. Higher is better.';
  const footer1 = 'Data: Khurana et al., Sci Rep 2023 (CC BY 4.0); García-del-Castillo et al., J Pers Med 2026, Zenodo 10.5281/zenodo.22013721 (CC BY 4.0).';
  const footer2 = 'Near points from published push-up / defocus-curve measurements, not from the app. Reproduce: npx tsx sim/clinical.ts';
  const desc = `Grouped bar chart of real, published clinical data (not a simulation). ${descParts.join('; ')}. ${note}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="fig-clinical-title fig-clinical-desc" font-family="${FONT}">
<title id="fig-clinical-title">${esc(title)}</title>
<desc id="fig-clinical-desc">${esc(desc)}</desc>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="#ffffff" stroke="${GRID}"/>
<text x="24" y="34" font-size="17" font-weight="600" fill="${INK}">${esc(title)}</text>
<text x="24" y="55" font-size="12.5" fill="${INK2}">${esc(subtitle)}</text>
${body}
<text x="24" y="${h - 52}" font-size="11.5" fill="${INK2}">${esc(note)}</text>
<text x="24" y="${h - 34}" font-size="11" fill="${MUTED}">${esc(footer1)}</text>
<text x="24" y="${h - 16}" font-size="11" fill="${MUTED}">${esc(footer2)}</text>
</svg>
`;
}

const inScopeOf = (rows: Result[]) => rows.filter((r) => r.truth === 'readers');
const fig = accuracyFigure([
  { title: `${SOURCES.india.short} · push-up`, n: inScopeOf(primary.india).length, rows: [
    { label: 'Small Print start', s: score(inScopeOf(primary.india), 'app') },
    { label: 'Age table (40 cm)', s: score(inScopeOf(primary.india), 'table') },
  ] },
  { title: `${SOURCES.madrid.short} · defocus curve`, n: inScopeOf(primary.madrid).length, rows: [
    { label: 'Small Print start', s: score(inScopeOf(primary.madrid), 'app') },
    { label: 'Age table (40 cm)', s: score(inScopeOf(primary.madrid), 'table') },
  ] },
  { title: 'Both clinical datasets', n: inScopeOf(clinicalPooled).length, rows: [
    { label: 'Small Print start', s: score(inScopeOf(clinicalPooled), 'app') },
    { label: 'Age table (40 cm)', s: score(inScopeOf(clinicalPooled), 'table') },
  ] },
], (() => {
  const my = results.pooledClinical.outOfScope.myopiaRefer;
  return `Short-sighted people (distance SE below −1.00 D, n=${my.n}): the age table offered readers to ${my.table.readers}; Small Print withheld them from ${my.app.noReaders + my.app.refer}.`;
})());
const figPath = join(ROOT, 'public', 'figures', 'clinical-accuracy.svg');
writeFileSync(figPath, fig);

// ---------------------------------------------------------------- console report

const line = (name: string, s: ReturnType<typeof summarise>) => {
  const a = s.inScope.app, t = s.inScope.ageTable;
  return `| ${name} | ${s.n} | ${a.n} | ${f1(a.exactPct)} / ${f1(t.exactPct)} | ${f1(a.within025Pct)} / ${f1(t.within025Pct)} | ${f1(a.within050Pct)} / ${f1(t.within050Pct)} | ${a.biasD} / ${t.biasD} | ${a.maeD} / ${t.maeD} | ${a.offeredReaders}/${a.n} | ${s.inScope.paired.mcnemarExactP} |`;
};
console.log(`App letter size: logMAR ${APP_E_LOGMAR.toFixed(3)}`);
console.log('| Dataset | n | in scope | exact app/table % | ±0.25 app/table % | ±0.50 app/table % | bias app/table D | MAE app/table D | app offered readers | McNemar p (±0.50) |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const [k, s] of Object.entries(results)) console.log(line(k, s));
console.log('\nCI95 (±0.50):', Object.fromEntries(Object.entries(results).map(([k, s]) => [k, { app: s.inScope.app.within050CI95, table: s.inScope.ageTable.within050CI95 }])));
console.log('\nOut of scope:', JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, s]) => [k, s.outOfScope]))));
console.log('\nAge bands (in scope, ±0.50 app/table):');
for (const [k, s] of Object.entries(results)) console.log(k, s.inScope.byAgeBand.map((b) => `${b.band}: n=${b.n} ${f1(b.app.within050Pct)}/${f1(b.ageTable.within050Pct)} bias ${b.app.biasD}/${b.ageTable.biasD}`).join(' | '));
console.log('\nNear-point arm diagnostic (±0.50):', Object.fromEntries(Object.entries(results).map(([k, s]) => [k, `${s.inScope.nearPointArmDiagnostic.n}: ${f1(s.inScope.nearPointArmDiagnostic.within050Pct)}% bias ${s.inScope.nearPointArmDiagnostic.biasD}`])));
console.log('Flags:', Object.fromEntries(Object.entries(results).map(([k, s]) => [k, s.inScope.appFlags])));
console.log('\nSensitivity (in-scope n; app/table ±0.50 %):');
for (const s of sensitivity) console.log(`${s.key.padEnd(17)} india ${s.india.nInScope} ${f1(s.india.appWithin050Pct)}/${f1(s.india.tableWithin050Pct)} | madrid ${s.madrid.nInScope} ${f1(s.madrid.appWithin050Pct)}/${f1(s.madrid.tableWithin050Pct)} | pooled ${s.pooledClinical.nInScope} ${f1(s.pooledClinical.appWithin050Pct)}/${f1(s.pooledClinical.tableWithin050Pct)} | phakic ${s.phakicRuleDerived.nInScope} ${f1(s.phakicRuleDerived.appWithin050Pct)}/${f1(s.phakicRuleDerived.tableWithin050Pct)}`);
console.log('\nChecks:', JSON.stringify(out.checks, null, 1));
console.log(`\nwrote ${jsonPath}\nwrote ${figPath}`);
