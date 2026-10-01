// Camera distance bench, step 1 of 2: collect. Needs a non-brotli build served on port 4180:
//   node scripts/copy-mediapipe.mjs && npx vite build && npx vite preview --port 4180 --strictPort
// then:  npx tsx bench-camera/run.ts       (about 12 minutes; writes raw.json, see RAW in config.ts)
//        npx tsx bench-camera/report.ts    (step 2: statistics, public/data/camera-bench.json, chart)
//
// Scales: s = S_REF × 300 / D for target distances D. S_REF is the scale at which the uncalibrated
// reading is about 30 cm (pilot run: iris 0.02715 of frame width at s = 1, i.e. 30.8 cm), so the
// reference scale plays the role of the app's one-time 30 cm camera calibration.

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BASE_URL, RAW, REF_MM, S_REF, TARGETS_MM, WORK_DIR, scaleFor, type RawFile } from './config';
import { makeScaledVideos } from './video';
import { measure, readScreen } from './measure';

const REPEATS = Number(process.env.BENCH_REPEATS ?? 3);
const WARMUP_MS = 2500; // the tracker settles within ~2 s of the face first appearing (pilot run)
const COLLECT_MS = 3000;

function machineInfo(): Record<string, string> {
  const ps = (cmd: string) => {
    try {
      return execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  };
  return {
    os: ps('(Get-CimInstance Win32_OperatingSystem).Caption'),
    cpu: ps('(Get-CimInstance Win32_Processor).Name'),
    gpu: ps('(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join \', \''),
    model: ps('$c = Get-CimInstance Win32_ComputerSystem; \\"$($c.Manufacturer) $($c.Model)\\"'),
    node: process.version,
  };
}

async function main(): Promise<void> {
  mkdirSync(WORK_DIR, { recursive: true });
  const scales = TARGETS_MM.map(scaleFor);
  const videos = await makeScaledVideos(scales, WORK_DIR);
  const raw: RawFile = {
    generatedAt: new Date().toISOString(),
    machine: machineInfo(),
    screen: null,
    sRef: S_REF,
    refMm: REF_MM,
    warmupMs: WARMUP_MS,
    collectMs: COLLECT_MS,
    runs: [],
  };
  // Interleave the scales across repeats, so slow drift (thermal, background load) doesn't line up with distance.
  for (let rep = 0; rep < REPEATS; rep++) {
    for (const [i, mm] of TARGETS_MM.entries()) {
      const s = scales[i];
      const r = await measure(BASE_URL, videos.get(s)!, { warmupMs: WARMUP_MS, collectMs: COLLECT_MS });
      raw.runs.push({ ...r, scale: s, targetMm: mm, repeat: rep, videoFps: 30 });
      const med = [...r.iris].sort((a, b) => a - b)[r.iris.length >> 1];
      console.log(`rep ${rep} D=${mm / 10} cm s=${s}: ${r.iris.length} frames, median iris ${med?.toFixed(6)}, fps ${r.fps.join(',')}`);
      writeFileSync(RAW, JSON.stringify(raw));
    }
  }
  // Throughput headroom: the same face at the reference scale, fed at 60 fps instead of 30.
  const v60 = await makeScaledVideos([S_REF], WORK_DIR, 60);
  for (let rep = 0; rep < 2; rep++) {
    const r = await measure(BASE_URL, v60.get(S_REF)!, { warmupMs: WARMUP_MS, collectMs: COLLECT_MS });
    raw.runs.push({ ...r, scale: S_REF, targetMm: REF_MM, repeat: rep, videoFps: 60 });
    console.log(`60 fps feed rep ${rep}: ${r.iris.length} frames in ${COLLECT_MS} ms, fps ${r.fps.join(',')}`);
  }
  raw.screen = await readScreen();
  writeFileSync(RAW, JSON.stringify(raw));
  console.log(`wrote ${RAW}`);
}

await main();
