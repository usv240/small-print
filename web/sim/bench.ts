// SIMULATION ONLY. Entry point: `npm run sim` (or `npx tsx sim/bench.ts`).
// Writes public/data/bench.json, public/data/bench-summary.md and three SVG figures in public/figures/.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { accuracyBars, distanceSweep, errorHistograms } from './charts';
import type { Metrics, StrategyId } from './engine';
import { type BenchResult, runBench } from './suite';

const ROOT = resolve(import.meta.dirname, '..');
const CORE_FILES = ['optics.ts', 'recommend.ts', 'tryon.ts'];

/** Git-free algorithm version: hash of the src/core files the bench exercised (line endings normalised). */
function coreFingerprint(): string {
  const h = createHash('sha256');
  for (const f of CORE_FILES) h.update(readFileSync(resolve(ROOT, 'src/core', f), 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 12);
}

const p1 = (x: number | null | undefined) => (x === null || x === undefined ? '–' : `${x.toFixed(1)}%`);
const d2 = (x: number | null | undefined) => (x === null || x === undefined ? '–' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`);
const a2 = (x: number | null | undefined) => (x === null || x === undefined ? '–' : x.toFixed(2));

const HEADLINE: StrategyId[] = ['age40', 'ageW', 'card14', 'cardOwn', 'spStart', 'spTry050', 'spTry025'];
const WHATIF: StrategyId[] = ['wiProbe050', 'wiProbe025', 'wiFarEst050', 'oracle050'];

function summaryMarkdown(r: BenchResult, version: string, generatedAt: string): string {
  const s = (id: StrategyId) => r.strategies.find((x) => x.id === id)!;
  const row = (id: StrategyId) => {
    const m = s(id).overall;
    return `| ${s(id).label} | ${p1(m.appropriatePct)} | ${p1(m.within025Pct)} | ${p1(m.within050Pct)} | ${p1(m.exactPct)} | ${d2(m.biasD)} | ${a2(m.maeD)} | ${p1(m.referSafePct)} | ${p1(m.myopiaMissedPct)} | ${p1(m.noneGivenReadersPct)} |`;
  };
  const pop = r.population;
  const sens = (g: string, ids: StrategyId[]) => {
    const rows = r.sensitivity.filter((x) => x.group === g);
    const head = `| Scenario | ${ids.map((id) => `${s(id).label} ±0.25 / ±0.50`).join(' | ')} |\n|---|${ids.map(() => '---').join('|')}|`;
    return head + '\n' + rows.map((x) => `| ${x.label} | ${ids.map((id) => { const m = x.metrics[id] as Metrics; return `${p1(m.within025Pct)} / ${p1(m.within050Pct)}`; }).join(' | ')} |`).join('\n');
  };
  const sensIds: StrategyId[] = ['age40', 'spStart', 'spTry050', 'spTry025'];
  const w = (pop: string) => r.nearPointWeight.filter((x) => x.population === pop);
  const weightRows = w('main').map((x, i) => {
    const y = w('lower-amplitude')[i];
    return `| ${x.weight.toFixed(1)}${Math.abs(x.weight - r.coreConstants.NEAR_POINT_WEIGHT) < 1e-9 ? ' (shipped)' : ''} | ${p1(x.metrics.within025Pct)} / ${p1(x.metrics.within050Pct)} / ${d2(x.metrics.biasD)} | ${p1(y.metrics.within025Pct)} / ${p1(y.metrics.within050Pct)} / ${d2(y.metrics.biasD)} |`;
  });
  return `# Simulated-eye test bench: summary

> **${r.label}**
> Full method, equations and every assumption: \`sim/README.md\`. Raw numbers: \`/data/bench.json\`.

${version} · seed ${r.config.seed} · ${r.config.n.toLocaleString('en-US')} virtual people aged 40–70 · generated ${generatedAt}

Population: ${pop.truth.readers.toLocaleString('en-US')} in scope for ready-made readers (ideal +0.75 to +3.00), ${pop.truth.none.toLocaleString('en-US')} don't need readers yet, ${pop.truth.referMyopia.toLocaleString('en-US')} should be referred for myopia (< −1.00 D), ${pop.truth.referAboveRange.toLocaleString('en-US')} need more than +3.00.

## Headline (main scenario)

"Right call, everyone" is over **all** virtual people: a pair within ±0.50 D of ideal if they need one, no readers if they should be referred or don't need readers yet. The other accuracy columns are over **in-scope** people (anyone told "no readers" or referred counts as a miss). Bias and mean |error| are over in-scope people who were given a pair (+ = too strong). Referral sensitivity = share of people who should be referred who were **not** handed readers.

| Method | right call, everyone (±0.50) | within ±0.25 | within ±0.50 | exact | bias (D) | mean abs. error (D) | referral sensitivity | myopes handed readers | handed readers but don't need them yet |
|---|---|---|---|---|---|---|---|---|---|
${HEADLINE.map(row).join('\n')}

What-if variants (**not shipped**) and a reference ceiling:

| Method | right call, everyone (±0.50) | within ±0.25 | within ±0.50 | exact | bias (D) | mean abs. error (D) | referral sensitivity | myopes handed readers | handed readers but don't need them yet |
|---|---|---|---|---|---|---|---|---|---|
${WHATIF.map(row).join('\n')}

With the shipped try-on, ${p1(100 * r.farBeyondReachShare)} of try-on measurements had the far end of clear vision beyond arm's reach, where \`assessTryOn()\` can only answer "good" or "stronger".

## Sensitivity

${sens('distance-shared', sensIds)}

${sens('distance-independent', sensIds)}

${sens('depth-of-focus', sensIds)}

${sens('blur-judgement', sensIds)}

${sens('population', sensIds)}

${sens('behaviour', sensIds)}

${sens('sanity', sensIds)}

## Breakdown by age (main scenario)

Cells: right call for everyone (±0.50) · in-scope within ±0.50.

| Age | ${HEADLINE.map((id) => s(id).label).join(' | ')} |
|---|${HEADLINE.map(() => '---').join('|')}|
${s('age40').byAge.map((b, i) => `| ${b.band} | ${HEADLINE.map((id) => { const m = s(id).byAge[i]; return `${p1(m.appropriatePct)} · ${p1(m.within050Pct)}`; }).join(' | ')} |`).join('\n')}

## Breakdown by uncorrected refractive error (main scenario)

Cells: in-scope within ±0.25 / ±0.50 (bias D); for the myopia group: referral sensitivity.

| Refractive error | n in scope | ${HEADLINE.map((id) => s(id).label).join(' | ')} |
|---|---|${HEADLINE.map(() => '---').join('|')}|
${s('age40').byRefraction.map((g, i) => `| ${g.group} | ${g.inScopeN} | ${HEADLINE.map((id) => { const m = s(id).byRefraction[i]; return g.inScopeN === 0 ? `refer-sens ${p1(m.referSafePct)}` : `${p1(m.within025Pct)} / ${p1(m.within050Pct)} (${d2(m.biasD)})`; }).join(' | ')} |`).join('\n')}

## What-if: possible-myopia threshold in \`recommend()\`

Refer when measured amplitude > Hofstetter maximum + margin (shipped margin 1.5 D). Tuned against our own simulated truth.

| Margin (D) | Myopes handed readers (start / after try-on) | Referral sensitivity after try-on | In-scope wrongly referred after try-on | Right call, everyone, after try-on |
|---|---|---|---|---|
${r.myopiaMargin.map((x) => `| ${x.marginD.toFixed(2)}${x.marginD === 1.5 ? ' (shipped)' : ''} | ${p1(x.start.myopiaMissedPct)} / ${p1(x.tryOn050.myopiaMissedPct)} | ${p1(x.tryOn050.referSafePct)} | ${p1(x.tryOn050.falseReferPct)} | ${p1(x.tryOn050.appropriatePct)} |`).join('\n')}

## Ages 35–39 (supplementary, ${r.config.nUnder40.toLocaleString('en-US')} virtual people)

${r.under40.population.truth.none.toLocaleString('en-US')} don't need readers yet, ${r.under40.population.truth.readers} in scope (mostly uncorrected long sight), ${r.under40.population.truth.referMyopia} myopic. Share of people who don't need readers who were handed a pair anyway: ${(['age40', 'spStart', 'spTry050'] as StrategyId[]).map((id) => `${s(id).label} ${p1(r.under40.metrics[id]!.noneGivenReadersPct)}`).join(', ')}.

## What-if: near-point weight in \`recommend()\` (start only)

Tuned against our own simulated truth: if a new weight is adopted, say so. Cells: within ±0.25 / within ±0.50 / bias.

| Weight on near point | Main population | Lower-amplitude population |
|---|---|---|
${weightRows.join('\n')}
`;
}

function main() {
  const t0 = Date.now();
  const result = runBench();
  const fingerprint = coreFingerprint();
  const version = `bench ${result.benchVersion} · core sha256:${fingerprint}`;
  const generatedAt = new Date().toISOString();
  const dataDir = resolve(ROOT, 'public/data');
  const figDir = resolve(ROOT, 'public/figures');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(figDir, { recursive: true });

  writeFileSync(resolve(dataDir, 'bench.json'), JSON.stringify({ ...result, version, coreFingerprint: fingerprint, generatedAt }, null, 1) + '\n');
  writeFileSync(resolve(dataDir, 'bench-summary.md'), summaryMarkdown(result, version, generatedAt));

  const footer = `Simulation, not clinical data · ${result.config.n.toLocaleString('en-US')} virtual people, seed ${result.config.seed} · ${version} · source: sim/ (Small Print)`;
  const by = (id: StrategyId) => result.strategies.find((s) => s.id === id)!;
  const groupName = (g: string) => (g === 'baseline' ? 'Without Small Print' : 'Small Print');
  writeFileSync(resolve(figDir, 'bench-accuracy.svg'), accuracyBars(
    HEADLINE.map((id) => ({ label: by(id).label, group: groupName(by(id).group), within025: by(id).overall.within025Pct, within050: by(id).overall.within050Pct })),
    footer,
  ));
  writeFileSync(resolve(figDir, 'bench-error-distribution.svg'), errorHistograms(
    HEADLINE.map((id) => ({ label: by(id).label, ...by(id).errorHistogram, within025: by(id).overall.within025Pct })),
    footer,
  ));
  const sweepIds: StrategyId[] = ['spTry050', 'spStart', 'ageW', 'age40'];
  const sweep = (group: string) => ({
    series: sweepIds.map((id) => ({
      label: by(id).label,
      points: result.sensitivity.filter((x) => x.group === group).map((x) => ({ x: Math.round(Number(x.value) * 100), y: (x.metrics[id] as Metrics).within025Pct })),
    })),
  });
  writeFileSync(resolve(figDir, 'bench-distance-error.svg'), distanceSweep(
    [
      { title: 'Shared per person (calibration error)', ...sweep('distance-shared') },
      { title: 'Independent for every reading', ...sweep('distance-independent') },
    ],
    'Within ±0.25 D of ideal',
    footer,
  ));

  const s = (id: StrategyId) => by(id).overall;
  console.log(`SIMULATION ${version} · n=${result.config.n} seed=${result.config.seed} · ${Date.now() - t0} ms`);
  for (const id of [...HEADLINE, ...WHATIF]) {
    const m = s(id);
    console.log(`${by(id).label.padEnd(58)} ±0.25 ${p1(m.within025Pct).padStart(6)}  ±0.50 ${p1(m.within050Pct).padStart(6)}  bias ${d2(m.biasD)}  refer-sens ${p1(m.referSafePct)}`);
  }
  console.log(`replica mismatches (must be 0): ${result.replicaMismatches}`);
  console.log(`wrote public/data/bench.json, public/data/bench-summary.md, public/figures/bench-*.svg`);
}

main();
