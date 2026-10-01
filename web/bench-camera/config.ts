// Shared settings for the camera distance bench (run.ts collects, report.ts analyses).

import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { RunResult } from './measure';

export const BASE_URL = process.env.BENCH_URL ?? 'http://localhost:4180';
export const WORK_DIR = process.env.BENCH_DIR ?? resolve(tmpdir(), 'small-print-bench-camera');
export const RAW = resolve(WORK_DIR, 'raw.json');

export const S_REF = 1.0257;
export const REF_MM = 300;
export const TARGETS_MM = [220, 250, 300, 350, 400, 450, 500, 550, 600, 700];
export const scaleFor = (mm: number) => Number(((S_REF * REF_MM) / mm).toFixed(4));

export interface RawFile {
  generatedAt: string;
  machine: Record<string, string>;
  screen: { devicePixelRatio: number; screen: string; availScreen: string; userAgent: string } | null;
  sRef: number;
  refMm: number;
  warmupMs: number;
  collectMs: number;
  runs: (RunResult & { scale: number; targetMm: number; repeat: number; videoFps: number })[];
}

