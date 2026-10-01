// The test flow: safety → age → camera → calibration → working distance → small-print check →
// near point → result → (optional) try-on at the rack. One screen at a time, voice-guided.

import './styles/base.css';
import './styles/app.css';
import { CameraDistance, DemoDistance, type DistanceSample, type DistanceSource } from './camera/distance';
import { ID1_CARD, logMARForHeight, nPointHeightMm, optotypeHeightMm, TARGET_PRINT_N } from './core/optics';
import { recommend, type Recommendation } from './core/recommend';
import { assessTryOn, CONFIRM_STEP_D, type TryOnResult } from './core/tryon';
import { loadCalibration, median, saveCalibration, clearCalibration } from './camera/calibration';
import { LANGS, detectLang, formatPower, getLang, langName, setLang, t, type Lang } from './i18n';
import type { StringKey } from './i18n/en';
import { drawE, onDirection, randomDirection, type Direction } from './ui/optotype';
import { say, setVoice, stopVoice, voiceEnabled } from './ui/voice';
import { ageBand, deviceType, sendResult, trafficType, type ReferReasonApi, type ResultPayload } from './api';

/** The near-point E keeps the angular size of N6 print at 40 cm (logMAR ≈ 0.27) at every distance. */
const NEAR_LOGMAR = logMARForHeight(nPointHeightMm(TARGET_PRINT_N), 400);
const SMALL_PRINT_TRIALS = 5;
const SMALL_PRINT_PASS = 4;

type SafetyKey = 'sudden-change' | 'pain-redness' | 'diabetes' | 'glaucoma-family' | 'distance-blur' | 'distance-glasses';
const SAFETY: { key: SafetyKey; q: StringKey; stop: boolean }[] = [
  { key: 'sudden-change', q: 'q_sudden', stop: true },
  { key: 'pain-redness', q: 'q_pain', stop: true },
  { key: 'diabetes', q: 'q_diabetes', stop: false },
  { key: 'glaucoma-family', q: 'q_glaucoma', stop: false },
  { key: 'distance-blur', q: 'q_distance', stop: false },
  { key: 'distance-glasses', q: 'q_glasses', stop: false },
];

const state = {
  mode: 'camera' as 'camera' | 'demo',
  sessionId: crypto.randomUUID(),
  safety: new Map<SafetyKey, boolean>(),
  age: 50,
  workingMm: null as number | null,
  smallPrintCorrect: 0,
  nearPointMm: null as number | null,
  nearBeyond: false,
  maxMm: 0,
  /** Farthest distance reached during the no-glasses test, frozen when the near point is marked. */
  reachMm: 0,
  /** Farthest distance reached during the current try-on. */
  tryMaxMm: 0,
  rec: null as Recommendation | null,
  tryOns: [] as { strength: number; verdict: TryOnResult['verdict'] }[],
  existing: null as number | null,
  tryOnStrength: 1.5,
  tryOnNear: null as number | null,
  distanceMm: null as number | null,
  sample: null as DistanceSample | null,
};

const app = document.getElementById('app')!;
const video = document.getElementById('cam') as HTMLVideoElement;
let source: DistanceSource | null = null;
let cleanups: (() => void)[] = [];
let onDistance: ((mm: number | null) => void) | null = null;

// ---------- rendering helpers ----------

function show(html: string, voiceKey?: StringKey): void {
  cleanups.forEach((f) => f());
  cleanups = [];
  onDistance = null;
  app.innerHTML = html;
  app.querySelector<HTMLElement>('h1, h2')?.focus();
  window.scrollTo(0, 0);
  if (voiceKey) say(voiceKey);
}

const btn = (id: string, label: string, kind: 'primary' | 'secondary' | 'link' = 'primary') =>
  `<button type="button" class="btn btn-${kind}" id="${id}">${label}</button>`;

function on(id: string, handler: () => void): void {
  document.getElementById(id)?.addEventListener('click', handler);
}

const cm = (mm: number | null) => (mm === null ? '–' : t('cm', { n: Math.round(mm / 10) }));

/** The live distance read-out shown while the camera (or demo slider) is in use. */
function livePill(): string {
  return `<div class="live" aria-live="polite" title="${t('live_title')}"><span class="live-dot" data-face></span><span data-live>${cm(state.distanceMm)}</span></div>`;
}

function updateLive(): void {
  const el = app.querySelector('[data-live]');
  if (el) el.textContent = state.distanceMm === null ? t('no_face') : cm(state.distanceMm);
  app.querySelector('[data-face]')?.classList.toggle('ok', state.distanceMm !== null);
}

async function startSource(): Promise<void> {
  if (source) return;
  if (state.mode === 'demo') {
    const slider = document.getElementById('demo-range') as HTMLInputElement;
    source = new DemoDistance(() => Number(slider.value) * 10);
  } else {
    const cam = new CameraDistance(video);
    await cam.open();
    source = cam;
  }
  await source.start((s) => {
    state.sample = s;
    state.distanceMm = s.distanceMm;
    if (s.distanceMm !== null) {
      state.maxMm = Math.max(state.maxMm, s.distanceMm);
      state.tryMaxMm = Math.max(state.tryMaxMm, s.distanceMm);
    }
    updateLive();
    onDistance?.(s.distanceMm);
  });
}

/** An E that keeps a constant angular size as the distance changes. */
function liveE(canvas: HTMLCanvasElement, dir: Direction = 'right'): void {
  let last = 0;
  const draw = (mm: number | null) => {
    if (mm === null) return;
    const now = performance.now();
    if (now - last < 30) return;
    last = now;
    drawE(canvas, optotypeHeightMm(mm, NEAR_LOGMAR), dir);
  };
  draw(state.distanceMm ?? 400);
  onDistance = draw;
}

/** A small ⓘ toggle under a heading: what this step is, why we ask, and how it works. */
function info(key: StringKey): string {
  return `<details class="info"><summary aria-label="${t('info_label')}"><span aria-hidden="true">i</span> ${t('info_label')}</summary><div class="info-body">${t(key)}</div></details>`;
}

const TOTAL_STEPS = 8;
/** "Step 3 of 8" plus a thin progress bar, so first-time users know how long is left. */
function progress(step: number): string {
  const pct = Math.round((step / TOTAL_STEPS) * 100);
  return `<div class="progress"><span class="progress-text">${t('step_of', { n: step, total: TOTAL_STEPS })}</span><span class="progress-track" aria-hidden="true"><span class="progress-fill" style="width:${pct}%"></span></span></div>`;
}

// ---------- screens ----------

function welcome(): void {
  const langs = LANGS.map((l) => `<option value="${l}" ${l === getLang() ? 'selected' : ''}>${langName(l)}</option>`).join('');
  show(`
    <section class="screen">
      <div class="row-between">
        <label class="lang">${t('language')} <select id="lang">${langs}</select></label>
        <button type="button" class="chip" id="voice" aria-pressed="${voiceEnabled()}">${voiceEnabled() ? t('voice_on') : t('voice_off')}</button>
      </div>
      <h1 tabindex="-1">${t('welcome_h')}</h1>
      <p class="lead">${t('welcome_p')}</p>
      <ul class="ticks">
        <li>${t('welcome_b1')}</li><li>${t('welcome_b2')}</li><li>${t('welcome_b3')}</li>
      </ul>
      <p class="how">${t('welcome_how')}</p>
      <div class="stack">${btn('start', t('welcome_start'))}${btn('demo', t('welcome_demo'), 'secondary')}</div>
      ${t('translation_note') ? `<p class="small muted">${t('translation_note')}</p>` : ''}
    </section>`, 'welcome_say');
  document.getElementById('lang')!.addEventListener('change', (e) => { setLang((e.target as HTMLSelectElement).value as Lang); syncDemoBar(); welcome(); });
  on('voice', () => { setVoice(!voiceEnabled()); welcome(); });
  on('start', () => { state.mode = 'camera'; safety(); });
  on('demo', () => enterDemo());
}

function enterDemo(): void {
  state.mode = 'demo';
  document.body.classList.add('demo');
  document.getElementById('demo-bar')!.hidden = false;
  safety();
}

function safety(): void {
  const rows = SAFETY.map(({ key, q }) => {
    const v = state.safety.get(key);
    return `<fieldset class="q"><legend>${t(q)}</legend>
      <div class="yn">
        <label><input type="radio" name="${key}" value="yes" ${v === true ? 'checked' : ''}> ${t('yes')}</label>
        <label><input type="radio" name="${key}" value="no" ${v === false ? 'checked' : ''}> ${t('no')}</label>
      </div></fieldset>`;
  }).join('');
  show(`<section class="screen">${progress(1)}<h1 tabindex="-1">${t('safety_h')}</h1>${info('info_safety')}<p>${t('safety_p')}</p>
    <form id="sf">${rows}</form><div class="stack">${btn('next', t('continue'))}</div></section>`, 'safety_say');
  const form = document.getElementById('sf') as HTMLFormElement;
  const next = document.getElementById('next') as HTMLButtonElement;
  const sync = () => {
    for (const { key } of SAFETY) {
      const v = (form.elements.namedItem(key) as RadioNodeList).value;
      if (v) state.safety.set(key, v === 'yes');
    }
    next.disabled = SAFETY.some(({ key }) => !state.safety.has(key));
  };
  form.addEventListener('change', sync);
  sync();
  on('next', () => {
    if (SAFETY.some((s) => s.stop && state.safety.get(s.key))) return stopScreen();
    if (SAFETY.some((s) => state.safety.get(s.key))) return adviseScreen();
    age();
  });
}

function stopScreen(): void {
  show(`<section class="screen warn"><h1 tabindex="-1">${t('stop_h')}</h1><p class="lead">${t('stop_p')}</p>
    <div class="stack">${btn('back', t('back'), 'secondary')}</div></section>`, 'stop_say');
  on('back', safety);
}

function adviseScreen(): void {
  show(`<section class="screen warn"><h1 tabindex="-1">${t('advise_h')}</h1><p class="lead">${t('advise_p')}</p>
    <div class="stack">${btn('go', t('advise_continue'))}${btn('back', t('back'), 'secondary')}</div></section>`);
  on('go', age);
  on('back', safety);
}

function age(): void {
  show(`<section class="screen">${progress(2)}<h1 tabindex="-1">${t('age_h')}</h1>${info('info_age')}
    <div class="stepper">
      <button type="button" class="round" id="minus" aria-label="−1">−</button>
      <output id="age" class="big">${state.age}</output><span class="unit">${t('age_unit')}</span>
      <button type="button" class="round" id="plus" aria-label="+1">+</button>
    </div>
    <input type="range" id="ager" min="18" max="90" value="${state.age}" aria-label="${t('age_h')}">
    <div class="stack">${btn('next', t('continue'))}</div></section>`, 'age_say');
  const out = document.getElementById('age')!;
  const range = document.getElementById('ager') as HTMLInputElement;
  const set = (v: number) => { state.age = Math.min(90, Math.max(18, v)); out.textContent = String(state.age); range.value = String(state.age); };
  on('minus', () => set(state.age - 1));
  on('plus', () => set(state.age + 1));
  range.addEventListener('input', () => set(Number(range.value)));
  on('next', () => (state.mode === 'demo' ? startSource().then(working) : cameraScreen()));
}

function cameraScreen(): void {
  show(`<section class="screen">${progress(3)}<h1 tabindex="-1">${t('camera_h')}</h1>${info('info_camera')}<p class="lead">${t('camera_p')}</p>
    <p id="cam-msg" class="muted" role="status"></p>
    <div class="stack">${btn('allow', t('camera_allow'))}${btn('demo', t('welcome_demo'), 'secondary')}</div></section>`, 'camera_say');
  on('demo', () => { state.mode = 'demo'; document.body.classList.add('demo'); document.getElementById('demo-bar')!.hidden = false; startSource().then(working); });
  on('allow', async () => {
    const msg = document.getElementById('cam-msg')!;
    msg.textContent = t('camera_loading');
    try {
      await startSource();
      const cal = loadCalibration();
      if (!cal.screen) calScreen();
      else if (!cal.camera) calCamera();
      else working();
    } catch {
      source = null;
      msg.textContent = t('camera_denied');
    }
  });
}

function calScreen(): void {
  const start = loadCalibration().screen?.cssPxPerMm ?? 96 / 25.4;
  show(`<section class="screen">${progress(4)}<h1 tabindex="-1">${t('calscreen_h')}</h1>${info('info_calscreen')}<p>${t('calscreen_p')}</p>
    <div class="card-box-wrap"><div class="card-box" id="cardbox"></div></div>
    <input type="range" id="cardr" min="150" max="900" step="1" value="${Math.round(start * ID1_CARD.widthMm)}" aria-label="${t('calscreen_h')}">
    <div class="stack">${btn('done', t('calscreen_done'))}${btn('skip', t('calscreen_skip'), 'link')}</div></section>`, 'calscreen_say');
  const box = document.getElementById('cardbox')!;
  const r = document.getElementById('cardr') as HTMLInputElement;
  const size = () => { const w = Number(r.value); box.style.width = `${w}px`; box.style.height = `${(w * ID1_CARD.heightMm) / ID1_CARD.widthMm}px`; };
  r.addEventListener('input', size);
  size();
  on('done', () => { saveCalibration({ screen: { cssPxPerMm: Number(r.value) / ID1_CARD.widthMm, at: new Date().toISOString() } }); calCamera(); });
  on('skip', calCamera);
}

function calCamera(): void {
  show(`<section class="screen">${livePill()}${progress(4)}<h1 tabindex="-1">${t('calcam_h')}</h1>${info('info_calcam')}<p>${t('calcam_p')}</p>
    <div class="ruler" aria-hidden="true"><span>0</span><span>30 cm</span></div>
    <p id="hold" class="muted" role="status"></p>
    <div class="stack">${btn('cap', t('calcam_capture'))}${btn('skip', t('calcam_skip'), 'link')}</div></section>`, 'calcam_say');
  on('skip', working);
  on('cap', () => {
    const hold = document.getElementById('hold')!;
    hold.textContent = t('calcam_hold');
    const samples: number[] = [];
    let aspect = 16 / 9;
    // Collect the raw iris size from every processed frame for 1.5 s, then take the median.
    onDistance = () => {
      const cam = source as CameraDistance;
      if (cam?.lastIrisNorm) samples.push(cam.lastIrisNorm);
      aspect = video.videoWidth / video.videoHeight || aspect;
    };
    setTimeout(() => {
      onDistance = null;
      if (samples.length < 8) { hold.textContent = t('no_face'); return; }
      saveCalibration({ camera: { k: 300 * median(samples), aspect, refMm: 300, at: new Date().toISOString() } });
      working();
    }, 1500);
  });
}

function working(): void {
  show(`<section class="screen">${livePill()}${progress(5)}<h1 tabindex="-1">${t('working_h')}</h1>${info('info_working')}<p class="lead">${t('working_p')}</p>
    <div class="meter"><div class="meter-fill" id="fill"></div></div>
    <p id="got" class="ok-text" role="status"></p>
    <div class="stack">${btn('use', t('continue'))}</div></section>`, 'working_say');
  const useBtn = document.getElementById('use') as HTMLButtonElement;
  useBtn.disabled = true;
  // Steady = every reading in the last second within ±3% of their median. Time-based, so slow
  // phones (few frames per second) and fast ones behave the same.
  const recent: { at: number; mm: number }[] = [];
  let stableSince = 0;
  onDistance = (mm) => {
    const now = performance.now();
    if (mm === null) { recent.length = 0; stableSince = 0; return; }
    recent.push({ at: now, mm });
    while (recent.length > 1 && now - recent[1].at >= 1000) recent.shift();
    const values = recent.map((r) => r.mm);
    const mid = median(values);
    const covered = values.length >= 2 && now - recent[0].at >= 900;
    const steady = covered && values.every((v) => Math.abs(v - mid) / mid < 0.03);
    stableSince = steady ? stableSince || now : 0;
    const progress = steady ? Math.min(1, (now - stableSince) / 1500) : 0;
    document.getElementById('fill')!.style.width = `${Math.round(progress * 100)}%`;
    if (progress >= 1 && state.workingMm === null) {
      state.workingMm = mid;
      document.getElementById('got')!.textContent = t('working_got', { cm: Math.round(state.workingMm / 10) });
      useBtn.disabled = false;
      useBtn.focus();
    }
  };
  state.workingMm = null;
  on('use', smallPrint);
}

function smallPrint(): void {
  let trial = 0;
  let dir: Direction = randomDirection();
  state.smallPrintCorrect = 0;
  show(`<section class="screen">${livePill()}${progress(6)}<h1 tabindex="-1">${t('sp_h')}</h1>${info('info_sp')}<p>${t('sp_p')}</p>
    <div class="stage" id="stage"><canvas id="e"></canvas></div>
    ${arrows()}
    <p class="muted" id="count" aria-live="polite">${t('sp_count', { n: 1, total: SMALL_PRINT_TRIALS })}</p>
    <p class="hint" id="hint" role="status"></p></section>`, 'sp_say');
  const canvas = document.getElementById('e') as HTMLCanvasElement;
  drawE(canvas, nPointHeightMm(TARGET_PRINT_N), dir);
  const answer = (d: Direction) => {
    if (d === dir) state.smallPrintCorrect++;
    trial++;
    if (trial >= SMALL_PRINT_TRIALS) return nearCheck();
    dir = randomDirection(dir);
    drawE(canvas, nPointHeightMm(TARGET_PRINT_N), dir);
    document.getElementById('count')!.textContent = t('sp_count', { n: trial + 1, total: SMALL_PRINT_TRIALS });
  };
  bindArrows(answer);
  cleanups.push(onDirection(document.getElementById('stage')!, answer));
  onDistance = (mm) => {
    const w = state.workingMm;
    const hint = document.getElementById('hint');
    if (hint && w && mm) hint.textContent = Math.abs(mm - w) / w > 0.2 ? t('sp_hold', { cm: Math.round(w / 10) }) : '';
  };
}

function arrows(): string {
  return `<div class="arrows" role="group">
    <button type="button" class="arrow" data-d="up" aria-label="${t('arrow_up')}">↑</button>
    <button type="button" class="arrow" data-d="left" aria-label="${t('arrow_left')}">←</button>
    <button type="button" class="arrow" data-d="right" aria-label="${t('arrow_right')}">→</button>
    <button type="button" class="arrow" data-d="down" aria-label="${t('arrow_down')}">↓</button></div>`;
}

function bindArrows(cb: (d: Direction) => void): void {
  app.querySelectorAll<HTMLButtonElement>('.arrow').forEach((b) => b.addEventListener('click', () => cb(b.dataset.d as Direction)));
}

function nearCheck(): void {
  show(`<section class="screen">${livePill()}${progress(7)}<h1 tabindex="-1">${t('near_h')}</h1>${info('info_near')}<p>${t('near_p')}</p>
    <div class="stage"><canvas id="e"></canvas></div>
    <div class="stack two">${btn('sharp', t('sharp'))}${btn('blurry', t('blurry'), 'secondary')}</div></section>`, 'near_say');
  liveE(document.getElementById('e') as HTMLCanvasElement, randomDirection());
  on('sharp', () => nearMove('in'));
  on('blurry', () => nearMove('out'));
}

function nearMove(direction: 'in' | 'out'): void {
  const k = direction === 'in' ? { h: 'nearin_h', p: 'nearin_p', say: 'nearin_say', b: 'nearin_btn' } : { h: 'nearout_h', p: 'nearout_p', say: 'nearout_say', b: 'nearout_btn' };
  show(`<section class="screen">${livePill()}${progress(7)}<h1 tabindex="-1">${t(k.h as StringKey)}</h1>${info('info_near')}<p>${t(k.p as StringKey)}</p>
    <div class="stage"><canvas id="e"></canvas></div>
    <div class="stack">${btn('mark', t(k.b as StringKey))}${direction === 'out' ? btn('never', t('nearout_never'), 'secondary') : ''}</div></section>`, k.say as StringKey);
  liveE(document.getElementById('e') as HTMLCanvasElement, randomDirection());
  on('mark', () => {
    if (state.distanceMm === null) return;
    state.nearPointMm = state.distanceMm;
    state.nearBeyond = false;
    state.reachMm = Math.max(state.maxMm, state.workingMm ?? 0);
    result();
  });
  on('never', () => { state.nearPointMm = null; state.nearBeyond = true; state.reachMm = Math.max(state.maxMm, state.workingMm ?? 0); result(); });
}

function computeRec(): Recommendation {
  return recommend({
    age: state.age,
    workingDistanceMm: state.workingMm ?? 400,
    nearPointMm: state.nearPointMm,
    nearPointBeyondReach: state.nearBeyond,
    reachMm: Math.max(state.reachMm, state.workingMm ?? 400),
    smallPrintAtWorkingDistance: state.smallPrintCorrect >= SMALL_PRINT_PASS,
  });
}

function safetyReasons(): ReferReasonApi[] {
  return SAFETY.filter((s) => state.safety.get(s.key)).map((s) => s.key);
}

function report(): void {
  const rec = state.rec;
  if (!rec) return;
  const advised = safetyReasons();
  const cal = loadCalibration();
  const payload: ResultPayload = {
    v: 1,
    sessionId: state.sessionId,
    traffic: trafficType(state.mode),
    mode: state.mode,
    lang: getLang(),
    device: deviceType(),
    ageBand: ageBand(state.age),
    outcome: advised.length ? 'refer' : rec.outcome,
    referReasons: [...advised, ...rec.flags],
    startStrength: rec.strength,
    workingDistanceCm: state.workingMm === null ? null : Math.round(state.workingMm / 10),
    nearPointCm: state.nearPointMm === null ? null : Math.round(state.nearPointMm / 10),
    nearPointBeyondReach: state.nearBeyond,
    calibrated: { screen: state.mode === 'camera' && !!cal.screen, camera: state.mode === 'camera' && !!cal.camera },
    tryOn: state.tryOns.slice(-6),
    existingReaders: state.existing,
  };
  void sendResult(payload);
}

function result(recompute = true): void {
  const rec = recompute || !state.rec ? (state.rec = computeRec()) : state.rec;
  const advised = safetyReasons().length > 0;
  let main = '';
  if (rec.outcome === 'readers' && rec.strength !== null) {
    const ask = rec.tryFirst.length > 1 ? t('result_or', { a: formatPower(rec.tryFirst[0]), b: formatPower(rec.tryFirst[1]) }) : formatPower(rec.tryFirst[0]);
    main = `<p class="muted">${t('result_readers')}</p><p class="power">${formatPower(rec.strength)}</p><p class="lead">${t('result_ask', { a: ask })}</p>`;
  } else if (rec.outcome === 'no-readers') {
    main = `<h2>${t('result_none_h')}</h2><p class="lead">${rec.flags.includes('possible-myopia') ? t('result_myopia') : t('result_none_p')}</p>`;
  } else {
    main = `<h2>${t('result_refer_h')}</h2><p class="lead">${t('result_refer_p')}</p>`;
  }
  const eyeAge = rec.eyeAge === null
    ? (state.nearBeyond ? t('result_eyeage_out') : '')
    : rec.eyeAge <= 34 ? t('result_eyeage_young', { age: 34 }) : t('result_eyeage', { age: rec.eyeAge });
  const why = [
    t('result_why_wd', { cm: Math.round((state.workingMm ?? 400) / 10) }),
    t('result_why_age', { a: formatPower(Math.max(0, rec.detail.fromAge)) }),
    rec.detail.fromNearPoint === null ? '' : rec.detail.nearPointIsLowerBound
      ? t('result_why_np_out', { cm: Math.round(Math.max(state.reachMm, state.workingMm ?? 0) / 10), a: formatPower(Math.max(0, rec.detail.fromNearPoint)) })
      : t('result_why_np', { cm: Math.round((state.nearPointMm ?? 0) / 10), a: formatPower(Math.max(0, rec.detail.fromNearPoint)) }),
  ].filter(Boolean).map((s) => `<li>${s}</li>`).join('');
  const powers = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 4];
  const existingOpts = powers.map((p) => `<option value="${p}">${formatPower(p)}</option>`).join('');
  show(`<section class="screen result">
      ${advised ? `<div class="banner warn">${t('advise_p')}</div>` : ''}
      ${progress(8)}<h1 tabindex="-1">${t('result_h')}</h1>${info('info_result')}
      <div class="result-card">${main}</div>
      ${rec.flags.includes('inconsistent') ? `<p class="banner">${t('result_inconsistent')}</p>` : ''}
      ${eyeAge ? `<p class="eyeage">${eyeAge}</p>` : ''}
      <details><summary>${t('result_why')}</summary><ul>${why}</ul></details>
      <p class="small muted">${t('result_note')}</p>
      <div class="stack">
        ${rec.outcome === 'readers' ? btn('tryon', t('tryon_cta')) : ''}
        ${btn('share', t('share'), 'secondary')}
      </div>
      <div class="card">
        <h2>${t('existing_h')}</h2><p class="small">${t('existing_p')}</p>
        <select id="existing"><option value="">—</option><option value="none">${t('existing_none')}</option><option value="unsure">${t('existing_unsure')}</option>${existingOpts}</select>
        <p id="existing-thanks" class="ok-text" role="status"></p>
      </div>
      ${btn('again', t('start_again'), 'link')}
    </section>`, 'result_say');
  report();
  on('tryon', () => tryOnPick(rec.tryFirst[0] ?? rec.strength ?? 1.5));
  on('share', () => share(rec));
  on('again', () => location.reload());
  document.getElementById('existing')!.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    state.existing = v && !Number.isNaN(Number(v)) ? Number(v) : null;
    if (v) document.getElementById('existing-thanks')!.textContent = t('existing_thanks');
    report();
  });
}

async function share(rec: Recommendation): Promise<void> {
  const text = t('share_text') + (rec.strength ? formatPower(rec.strength) : '');
  const url = location.origin + '/';
  try {
    if (navigator.share) await navigator.share({ title: t('app_title'), text, url });
    else await navigator.clipboard.writeText(`${text} ${url}`);
  } catch { /* cancelled */ }
}

function tryOnPick(initial: number): void {
  state.tryOnStrength = initial;
  const powers = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
  const opts = powers.map((p) => `<button type="button" class="chip power-chip ${p === initial ? 'on' : ''}" data-p="${p}">${formatPower(p)}</button>`).join('');
  show(`<section class="screen"><h1 tabindex="-1">${t('tryon_h')}</h1>${info('info_tryon')}<p class="lead">${t('tryon_p')}</p>
    <div class="chips" role="group">${opts}</div><div class="stack">${btn('next', t('continue'))}</div></section>`, 'tryon_say');
  app.querySelectorAll<HTMLButtonElement>('.power-chip').forEach((b) => b.addEventListener('click', () => {
    state.tryOnStrength = Number(b.dataset.p);
    app.querySelectorAll('.power-chip').forEach((c) => c.classList.toggle('on', c === b));
  }));
  on('next', tryOnSharp);
}

function tryOnSharp(): void {
  state.tryOnNear = null;
  state.tryMaxMm = 0;
  show(`<section class="screen">${livePill()}<h1 tabindex="-1">${t('tryon_sharp_h')}</h1>${info('info_tryon_range')}<p>${t('tryon_sharp_p')}</p>
    <div class="stage"><canvas id="e"></canvas></div>
    <div class="stack">${btn('ok', t('tryon_sharp_btn'))}${btn('never', t('tryon_never'), 'secondary')}</div></section>`, 'tryon_sharp_say');
  liveE(document.getElementById('e') as HTMLCanvasElement, randomDirection());
  on('ok', tryOnNear);
  on('never', () => tryOnVerdict(null));
}

function tryOnNear(): void {
  show(`<section class="screen">${livePill()}<h1 tabindex="-1">${t('tryon_near_h')}</h1>${info('info_tryon_range')}<p>${t('tryon_near_p')}</p>
    <div class="stage"><canvas id="e"></canvas></div><div class="stack">${btn('mark', t('nearin_btn'))}</div></section>`, 'tryon_near_say');
  liveE(document.getElementById('e') as HTMLCanvasElement, randomDirection());
  on('mark', () => { if (state.distanceMm === null) return; state.tryOnNear = state.distanceMm; state.tryMaxMm = state.distanceMm; tryOnFar(); });
}

function tryOnFar(): void {
  show(`<section class="screen">${livePill()}<h1 tabindex="-1">${t('tryon_far_h')}</h1>${info('info_tryon_range')}<p>${t('tryon_far_p')}</p>
    <div class="stage"><canvas id="e"></canvas></div>
    <div class="stack">${btn('mark', t('nearin_btn'))}${btn('never', t('tryon_far_never'), 'secondary')}</div></section>`, 'tryon_far_say');
  liveE(document.getElementById('e') as HTMLCanvasElement, randomDirection());
  on('mark', () => { if (state.distanceMm === null) return; tryOnVerdict(state.distanceMm); });
  on('never', () => tryOnVerdict(undefined));
}

/** farMm: number = measured far limit; undefined = still sharp at arm's length; null = never sharp. */
function tryOnVerdict(farMm: number | null | undefined): void {
  const s = state.tryOnStrength;
  if (farMm === null) {
    show(`<section class="screen"><h1 tabindex="-1">${t('tryon_h')}</h1><p class="lead">${t('tryon_neversharp')}</p>
      <div class="stack">${btn('another', t('tryon_another'))}${btn('done', t('tryon_done'), 'secondary')}</div></section>`);
    on('another', () => tryOnPick(s));
    on('done', () => result(false));
    return;
  }
  const wd = state.workingMm ?? 400;
  const r = assessTryOn({ strength: s, workingDistanceMm: wd, nearLimitMm: state.tryOnNear ?? wd * 0.7, farLimitMm: farMm ?? null, reachMm: Math.max(state.tryMaxMm, wd) });
  state.tryOns.push({ strength: s, verdict: r.verdict });
  report();
  const confirm = r.verdict === 'good' && r.farEndUnknown && s + CONFIRM_STEP_D <= 3.5;
  const next = confirm ? s + CONFIRM_STEP_D : Math.max(0.75, s + r.change);
  if (r.verdict === 'stronger' && next > 3) {
    // Ready-made readers stop at about +3.00 (Stevens 2019): beyond that, refer rather than sell.
    show(`<section class="screen warn"><h1 tabindex="-1">${t('result_refer_h')}</h1><p class="lead">${t('result_refer_p')}</p>
      <div class="stack">${btn('done', t('tryon_done'))}</div></section>`, 'stop_say');
    on('done', () => result(false));
    return;
  }
  const msg = r.verdict === 'good'
    ? t('tryon_good', { s: formatPower(s) }) + (confirm ? ` ${t('tryon_confirm', { s: formatPower(next) })}` : '')
    : t(r.verdict === 'stronger' ? 'tryon_stronger' : 'tryon_weaker', { s: formatPower(next) });
  const sayKey: StringKey = r.verdict === 'good' ? 'tryon_good_say' : r.verdict === 'stronger' ? 'tryon_stronger_say' : 'tryon_weaker_say';
  show(`<section class="screen result"><h1 tabindex="-1">${t('tryon_checking', { s: formatPower(s) })}</h1>${info('info_tryon_verdict')}
    <div class="result-card ${r.verdict}"><p class="lead">${msg}</p></div>
    ${rangeBar(state.tryOnNear ?? wd * 0.7, farMm ?? null, wd)}
    <p class="small muted">${t('tryon_range', { near: cm(state.tryOnNear), far: farMm ? cm(farMm) : t('armslength'), wd: cm(wd) })}</p>
    <div class="stack">${r.verdict === 'good' && !confirm ? '' : btn('another', t('tryon_another'), confirm ? 'secondary' : 'primary')}${btn('done', t('tryon_done'), r.verdict === 'good' ? 'primary' : 'secondary')}</div>
  </section>`, sayKey);
  on('another', () => tryOnPick(next));
  on('done', () => result(false));
}

/** A 10–80 cm scale with the sharp range shaded and the reading distance marked. */
function rangeBar(nearMm: number, farMm: number | null, wdMm: number): string {
  const pos = (mm: number) => `${Math.min(100, Math.max(0, ((mm / 10 - 10) / 70) * 100))}%`;
  const right = farMm === null ? '0%' : `${100 - parseFloat(pos(farMm))}%`;
  return `<div class="rangebar" aria-hidden="true">
    <div class="range-sharp" style="left:${pos(nearMm)};right:${right}"></div>
    <div class="range-wd" style="left:${pos(wdMm)}"></div>
    <span class="tick" style="left:0">10</span><span class="tick" style="left:${pos(400)}">40</span><span class="tick" style="left:100%">80 cm</span></div>`;
}

// ---------- boot ----------

function syncDemoBar(): void {
  const slider = document.getElementById('demo-range') as HTMLInputElement;
  document.getElementById('demo-value')!.textContent = t('cm', { n: slider.value });
  document.getElementById('demo-label')!.textContent = t('demo_slider');
  document.getElementById('demo-note')!.textContent = t('demo_banner');
}

function boot(): void {
  setLang(detectLang());
  const q = new URLSearchParams(location.search);
  if (q.has('judge')) sessionStorage.setItem('small-print.judge', '1');
  if (q.has('recalibrate')) clearCalibration();
  const slider = document.getElementById('demo-range') as HTMLInputElement;
  const label = document.getElementById('demo-value')!;
  slider.addEventListener('input', () => { label.textContent = t('cm', { n: slider.value }); });
  syncDemoBar();
  window.addEventListener('pagehide', () => { stopVoice(); source?.stop(); });
  if (q.has('demo')) enterDemo();
  else welcome();
}

boot();
