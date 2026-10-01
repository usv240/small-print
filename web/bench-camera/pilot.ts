// Quick check of one scale: prints the raw iris-width time series and fps for a single run.
// Usage: npx tsx bench-camera/pilot.ts <scale> [warmupMs] [collectMs]
import { BASE_URL, WORK_DIR } from './config';
import { makeScaledVideos } from './video';
import { measure } from './measure';

const s = Number(process.argv[2] ?? 1);
const warmupMs = Number(process.argv[3] ?? 1000);
const collectMs = Number(process.argv[4] ?? 3000);
const vids = await makeScaledVideos([s], WORK_DIR);
const r = await measure(BASE_URL, vids.get(s)!, { warmupMs, collectMs });
console.log(`n=${r.iris.length} unique=${new Set(r.iris).size} vsize=${r.vsize} live=${r.live} fps=${r.fps.join(',')}`);
const t0 = r.t[0];
for (let i = 0; i < r.iris.length; i += 5) console.log(`${((r.t[i] - t0) / 1000).toFixed(2)}s ${r.iris[i].toFixed(6)}`);
