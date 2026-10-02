// Lighthouse (mobile form factor, simulated throttling = Lighthouse defaults: Moto G Power class device,
// 4× CPU slowdown, ~1.6 Mbps / 150 ms RTT "slow 4G") against the LIVE site, using the installed Chrome.
// Runs each page RUNS times and keeps the run with the median performance score.
//
//   node quality/lighthouse.mjs                      # default: live CloudFront site, 3 runs per page
//   LH_BASE=https://example.com LH_RUNS=1 node quality/lighthouse.mjs
//
// CHROME_PATH defaults to the standard Windows install path. Writes quality/results/lighthouse.json
// (summary) and quality/results/lighthouse/<page>-<run>.json (full reports, git-ignored size).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.LH_BASE ?? 'https://dxug72099q2ay.cloudfront.net';
const RUNS = Number(process.env.LH_RUNS ?? 3);
const PAGES = ['/', '/judges.html', '/test.html', '/validation.html'];
const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'quality/results/lighthouse');
mkdirSync(outDir, { recursive: true });

const CHROME = process.env.CHROME_PATH
  ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
    .find((p) => existsSync(p));
const env = { ...process.env, ...(CHROME ? { CHROME_PATH: CHROME } : {}) };
const lhBin = resolve(root, 'node_modules/lighthouse/cli/index.js');

function runOnce(path, i) {
  const name = path === '/' ? 'index' : path.replace(/^\//, '').replace(/\.html$/, '');
  const file = resolve(outDir, `${name}-${i}.json`);
  execFileSync(process.execPath, [lhBin, BASE + path, '--quiet', '--output=json', `--output-path=${file}`,
    '--form-factor=mobile', '--throttling-method=simulate', '--chrome-flags=--headless=new --no-first-run',
    '--only-categories=performance,accessibility,best-practices,seo'], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  return JSON.parse(readFileSync(file, 'utf8'));
}

function summarise(lhr) {
  const a = lhr.audits;
  const num = (id) => a[id]?.numericValue ?? null;
  const opportunities = Object.values(a)
    .filter((x) => x.details?.type === 'opportunity' && (x.details.overallSavingsMs > 0 || x.details.overallSavingsBytes > 0))
    .sort((x, y) => (y.details.overallSavingsMs ?? 0) - (x.details.overallSavingsMs ?? 0) || (y.details.overallSavingsBytes ?? 0) - (x.details.overallSavingsBytes ?? 0))
    .slice(0, 5)
    .map((x) => ({ id: x.id, title: x.title, savingsMs: Math.round(x.details.overallSavingsMs ?? 0), savingsKiB: Math.round((x.details.overallSavingsBytes ?? 0) / 1024) }));
  const failed = (cat) => lhr.categories[cat].auditRefs
    .filter((r) => r.weight > 0 && a[r.id]?.score !== null && a[r.id]?.score < 1)
    .map((r) => ({ id: r.id, title: a[r.id].title, score: a[r.id].score }));
  return {
    url: lhr.finalDisplayedUrl,
    lighthouseVersion: lhr.lighthouseVersion,
    userAgent: lhr.environment?.hostUserAgent,
    scores: Object.fromEntries(Object.entries(lhr.categories).map(([k, c]) => [k, Math.round(c.score * 100)])),
    metrics: {
      fcpMs: Math.round(num('first-contentful-paint')), lcpMs: Math.round(num('largest-contentful-paint')),
      tbtMs: Math.round(num('total-blocking-time')), cls: Number((num('cumulative-layout-shift') ?? 0).toFixed(3)),
      speedIndexMs: Math.round(num('speed-index')), ttiMs: num('interactive') === null ? null : Math.round(num('interactive')),
      totalKiB: Math.round((num('total-byte-weight') ?? 0) / 1024),
    },
    opportunities,
    failedAudits: { accessibility: failed('accessibility'), 'best-practices': failed('best-practices'), seo: failed('seo') },
  };
}

const pages = {};
for (const path of PAGES) {
  const runs = [];
  for (let i = 1; i <= RUNS; i++) {
    const s = summarise(runOnce(path, i));
    console.log(`${path} run ${i}: ${JSON.stringify(s.scores)} LCP ${s.metrics.lcpMs} ms TBT ${s.metrics.tbtMs} ms CLS ${s.metrics.cls} ${s.metrics.totalKiB} KiB`);
    runs.push(s);
  }
  const sorted = [...runs].sort((x, y) => x.scores.performance - y.scores.performance);
  const median = sorted[Math.floor(sorted.length / 2)];
  pages[path] = { ...median, runs: RUNS, performanceScores: runs.map((r) => r.scores.performance) };
}
writeFileSync(resolve(root, 'quality/results/lighthouse.json'), JSON.stringify({
  at: new Date().toISOString(), base: BASE, settings: 'mobile, simulated throttling (Lighthouse defaults)', chrome: CHROME, pages,
}, null, 2));
console.log('wrote quality/results/lighthouse.json');
