// CMDP validation, step 1 of 2: collect. Runs the app's face landmark model + iris code on every
// original CMDP portrait (Caltech Multi-Distance Portraits; see README.md) and writes raw numbers to
// %TEMP%/cmdp/raw.json (outside the repo). No image or crop is ever written anywhere.
//
//   npx tsx bench-camera/cmdp/run.ts            (≈ 3–6 min for 357 photos)
//   CMDP_DELEGATE=CPU npx tsx bench-camera/cmdp/run.ts   (force the CPU delegate)
//
// Then: npx tsx bench-camera/cmdp/report.ts

import { execSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { readExif } from './exif';
import { CMDP_DIR, CMDP_PORT, RAW_PATH } from './vite.config';
import type { ImageResult } from './harness';

const DELEGATE = process.env.CMDP_DELEGATE === 'CPU' ? 'CPU' : 'GPU';

/** Original (unstandardised) portraits: <CMDP_DIR>/CMDP_<1|2>/<n>_<id>/<id>_<feet>.jpg */
function listImages(): { subject: number; feet: number; rel: string }[] {
  const out: { subject: number; feet: number; rel: string }[] = [];
  for (const part of readdirSync(CMDP_DIR).filter((d) => /^CMDP_\d$/.test(d))) {
    for (const dir of readdirSync(resolve(CMDP_DIR, part)).filter((d) => /^\d+_/.test(d))) {
      const subject = Number(dir.split('_')[0]);
      for (const f of readdirSync(resolve(CMDP_DIR, part, dir))) {
        const m = /_(\d+)\.jpg$/i.exec(f);
        if (m) out.push({ subject, feet: Number(m[1]), rel: `${part}/${dir}/${f}` });
      }
    }
  }
  return out.sort((a, b) => a.subject - b.subject || a.feet - b.feet);
}

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
    gpu: ps("(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join ', '"),
    node: process.version,
  };
}

async function main(): Promise<void> {
  const images = listImages();
  console.log(`${images.length} photos in ${CMDP_DIR}`);
  const server = await createServer({ configFile: resolve(import.meta.dirname, 'vite.config.ts') });
  await server.listen();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const logs: string[] = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    await page.goto(`http://127.0.0.1:${CMDP_PORT}/bench-camera/cmdp/harness.html${DELEGATE === 'CPU' ? '?delegate=CPU' : ''}`);
    const delegate = await page.evaluate(() => window.cmdpReady);
    const info = await page.evaluate(() => window.cmdpInfo());
    console.log('delegate', delegate, info.webgl);
    const rows: (typeof images[number] & { exif: ReturnType<typeof readExif>; result: ImageResult })[] = [];
    const t0 = Date.now();
    for (const [i, im] of images.entries()) {
      const url = `/cmdp-img/${im.rel.split('/').map(encodeURIComponent).join('/')}`;
      const result = await page.evaluate((u) => window.cmdpRun(u), url);
      rows.push({ ...im, exif: readExif(resolve(CMDP_DIR, im.rel)), result });
      if (i % 25 === 0) console.log(`${i + 1}/${images.length}  subject ${im.subject} ${im.feet} ft  iris ${result.irisNorm?.toFixed(5) ?? 'no face'}  ${(result.ms | 0)} ms`);
    }
    writeFileSync(
      RAW_PATH,
      JSON.stringify({ generatedAt: new Date().toISOString(), cmdpDir: CMDP_DIR, seconds: (Date.now() - t0) / 1000, info, machine: machineInfo(), console: logs.slice(0, 60), rows }, null, 1),
    );
    console.log(`wrote ${RAW_PATH} (${rows.length} rows, ${rows.filter((r) => r.result.irisNorm !== null).length} with a face)`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
