// Measurement lab: records camera distance against ruler distances and reports the screen-size finding.
import { CameraDistance, type DistanceSample } from './camera/distance';
import { loadCalibration, median, NOMINAL_CSS_PX_PER_MM } from './camera/calibration';

interface Row { refMm: number; measuredMm: number; errorPct: number; calibrated: boolean; frames: number; at: string }

const $ = (id: string) => document.getElementById(id)!;
const video = $('cam') as HTMLVideoElement;
const cam = new CameraDistance(video);
const rows: Row[] = [];
let last: DistanceSample | null = null;
let collecting: number[] | null = null;

$('dpr').textContent = String(window.devicePixelRatio);
const cal = loadCalibration();
$('calscreen').textContent = cal.screen ? `yes (${cal.screen.at.slice(0, 16)})` : 'no';
$('calcam').textContent = cal.camera ? `yes, at ${cal.camera.refMm / 10} cm (${cal.camera.at.slice(0, 16)})` : 'no';

if (cal.screen) {
  const realMmPerPx = 1 / cal.screen.cssPxPerMm;
  const nominal = 1 / NOMINAL_CSS_PX_PER_MM;
  const diff = ((nominal - realMmPerPx) / nominal) * 100;
  $('screen-finding').textContent =
    `On this screen one CSS pixel is ${realMmPerPx.toFixed(3)} mm, not the nominal ${nominal.toFixed(3)} mm. ` +
    `An un-calibrated on-screen chart would draw letters ${Math.abs(diff).toFixed(0)}% ${diff > 0 ? 'too small' : 'too large'}.`;
} else {
  $('screen-finding').textContent = 'Not calibrated yet: run the card step in the test first (open the test with ?recalibrate).';
}

$('startcam').addEventListener('click', async () => {
  try {
    await cam.start((s) => {
      last = s;
      $('live').textContent = s.distanceMm === null ? 'no face' : `${(s.distanceMm / 10).toFixed(1)} cm`;
      $('iris').textContent = s.irisNorm === null ? '–' : s.irisNorm.toFixed(5);
      $('fps').textContent = String(s.fps);
      $('vsize').textContent = `${video.videoWidth}×${video.videoHeight}`;
      if (collecting && s.distanceMm !== null) collecting.push(s.distanceMm);
    });
  } catch (e) {
    $('live').textContent = `camera unavailable: ${(e as Error).message}`;
  }
});

document.querySelectorAll<HTMLButtonElement>('[data-ref]').forEach((b) => b.addEventListener('click', () => {
  const refMm = Number(b.dataset.ref);
  if (!last) { $('rec-status').textContent = 'Start the camera first.'; return; }
  $('rec-status').textContent = `Hold still at ${refMm / 10} cm…`;
  collecting = [];
  setTimeout(() => {
    const samples = collecting ?? [];
    collecting = null;
    if (samples.length < 5) { $('rec-status').textContent = 'Could not see your face clearly. Try again in better light.'; return; }
    const measuredMm = median(samples);
    rows.push({ refMm, measuredMm, errorPct: ((measuredMm - refMm) / refMm) * 100, calibrated: !!last?.calibrated, frames: samples.length, at: new Date().toISOString() });
    $('rec-status').textContent = 'Recorded.';
    render();
  }, 2000);
}));

function render(): void {
  const tbody = document.querySelector('#rows tbody')!;
  tbody.innerHTML = rows.map((r) => `<tr><td>${r.refMm / 10} cm</td><td>${(r.measuredMm / 10).toFixed(1)} cm</td><td>${r.errorPct >= 0 ? '+' : ''}${r.errorPct.toFixed(1)}%</td><td>${r.calibrated ? 'yes' : 'no'}</td><td>${r.frames}</td></tr>`).join('');
  const abs = rows.map((r) => Math.abs(r.errorPct));
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  $('summary').textContent = `Mean absolute error ${mean.toFixed(1)}% over ${rows.length} readings (max ${Math.max(...abs).toFixed(1)}%).`;
  ($('json') as HTMLTextAreaElement).value = JSON.stringify({
    device: { ua: navigator.userAgent, dpr: devicePixelRatio, screen: `${screen.width}x${screen.height}`, video: `${video.videoWidth}x${video.videoHeight}` },
    calibration: loadCalibration(),
    rows,
  }, null, 2);
}

$('copy').addEventListener('click', () => navigator.clipboard.writeText(($('json') as HTMLTextAreaElement).value));
