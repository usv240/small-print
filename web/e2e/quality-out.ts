// Measurement specs (engines-mediapipe, axe, lowend-perf) save their numbers here for
// quality/build-report.ts, which merges them into public/data/quality.json. Only when QUALITY=1,
// so an ordinary `npx playwright test` run leaves the committed results alone.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const QUALITY_RESULTS = resolve(import.meta.dirname, '../quality/results');

export function saveQuality(name: string, data: unknown): void {
  if (!process.env.QUALITY) return;
  mkdirSync(QUALITY_RESULTS, { recursive: true });
  writeFileSync(resolve(QUALITY_RESULTS, `${name}.json`), JSON.stringify({ at: new Date().toISOString(), ...(data as object) }, null, 2));
}
