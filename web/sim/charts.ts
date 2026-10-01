// Hand-written, dependency-free SVG charts for the SIMULATED test bench. Light chart on a white rounded
// card so it also reads on dark pages. Every chart carries <title>/<desc> and per-mark <title> tooltips.

const FONT = 'system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, sans-serif';
const INK = '#0b0b0b';
const INK2 = '#52514e';
const MUTED = '#6b6a66';
const GRID = '#e1e0d9';
const AXIS = '#c3c2b7';
const BAND = '#f0efec';
/** Validated categorical order (dataviz reference palette): blue, orange, aqua, yellow. */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
const BLUE_DARK = '#2a78d6';
const BLUE_LIGHT = '#9ec5f4';
const NEUTRAL_BAR = '#b4b2a9';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = (x: number) => x.toFixed(1);

function frame(id: string, w: number, h: number, title: string, subtitle: string, desc: string, body: string, footer: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${id}-title ${id}-desc" font-family="${FONT}">
<title id="${id}-title">${esc(title)}</title>
<desc id="${id}-desc">${esc(desc)}</desc>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="#ffffff" stroke="${GRID}"/>
<text x="24" y="34" font-size="17" font-weight="600" fill="${INK}">${esc(title)}</text>
<text x="24" y="55" font-size="12.5" fill="${INK2}">${esc(subtitle)}</text>
${body}
<text x="24" y="${h - 16}" font-size="11" fill="${MUTED}">${esc(footer)}</text>
</svg>
`;
}

function simBadge(w: number): string {
  const bw = 92;
  return `<g aria-hidden="true"><rect x="${w - 24 - bw}" y="20" width="${bw}" height="22" rx="11" fill="${BAND}" stroke="${AXIS}"/>
<text x="${w - 24 - bw / 2}" y="35" font-size="11" font-weight="600" fill="${INK2}" text-anchor="middle" letter-spacing="0.6">SIMULATION</text></g>`;
}

// ---------------------------------------------------------------- (a) grouped bars

export interface AccuracyRow { label: string; group: string; within025: number; within050: number }

export function accuracyBars(rows: AccuracyRow[], footer: string): string {
  const w = 780;
  const left = 250;
  const right = 60;
  const top = 96;
  const rowH = 46;
  const groupGap = 26;
  const groups = [...new Set(rows.map((r) => r.group))];
  const plotW = w - left - right;
  const h = top + rows.length * rowH + groups.length * groupGap + 84;
  const x = (v: number) => left + (v / 100) * plotW;
  const bottom = h - 84;
  let body = simBadge(w);
  // legend
  body += `<g font-size="12" fill="${INK2}">
<rect x="${left}" y="70" width="12" height="12" rx="2" fill="${BLUE_LIGHT}"/><text x="${left + 18}" y="80">within ±0.50 D (one stocked step)</text>
<rect x="${left + 230}" y="70" width="12" height="12" rx="2" fill="${BLUE_DARK}"/><text x="${left + 248}" y="80">within ±0.25 D</text></g>`;
  // grid
  for (const t of [0, 25, 50, 75, 100]) {
    body += `<line x1="${x(t)}" y1="${top - 6}" x2="${x(t)}" y2="${bottom}" stroke="${t === 0 ? AXIS : GRID}" stroke-width="1"/>`;
    body += `<text x="${x(t)}" y="${bottom + 18}" font-size="11.5" fill="${INK2}" text-anchor="middle">${t}%</text>`;
  }
  body += `<text x="${left + plotW / 2}" y="${bottom + 38}" font-size="12" fill="${INK2}" text-anchor="middle">Share of in-scope virtual people whose chosen pair is within the tolerance of their ideal</text>`;
  let y = top;
  for (const g of groups) {
    body += `<text x="24" y="${y + 6}" font-size="11.5" font-weight="600" fill="${MUTED}" letter-spacing="0.4">${esc(g.toUpperCase())}</text>`;
    y += groupGap - 6;
    for (const r of rows.filter((q) => q.group === g)) {
      const bh = 15;
      body += `<text x="24" y="${y + bh + 5}" font-size="12.5" fill="${INK}">${esc(r.label)}</text>`;
      for (const [i, v, fill, tol] of [[0, r.within050, BLUE_LIGHT, '±0.50'], [1, r.within025, BLUE_DARK, '±0.25']] as const) {
        const by = y + i * (bh + 2);
        body += `<g><title>${esc(`${r.label}: ${f1(v)}% within ${tol} D`)}</title><rect x="${left}" y="${by}" width="${Math.max(1, x(v) - left)}" height="${bh}" rx="2" fill="${fill}"/>`;
        body += `<text x="${x(v) + 6}" y="${by + bh - 3}" font-size="11.5" fill="${INK2}">${f1(v)}%</text></g>`;
      }
      y += rowH;
    }
    y += 6;
  }
  const desc = rows.map((r) => `${r.label}: ${f1(r.within025)}% within ±0.25 D, ${f1(r.within050)}% within ±0.50 D`).join('; ') + '.';
  return frame('fig-bench-accuracy', w, h, 'How often each method picks the right reading glasses', 'Simulated people aged 40–70 who should get ready-made readers (+0.75 to +3.00). Higher is better.', `Grouped bar chart, simulation. ${desc}`, body, footer);
}

// ---------------------------------------------------------------- (b) error histograms (small multiples)

export interface HistogramPanel { label: string; bins: number[]; counts: number[]; noReaders: number; inScopeN: number; within025: number }

export function errorHistograms(panels: HistogramPanel[], footer: string): string {
  const cols = 2;
  const w = 780;
  const pw = 350;
  const ph = 150;
  const gapX = 32;
  const gapY = 58;
  const top = 92;
  const rows = Math.ceil(panels.length / cols);
  const h = top + rows * (ph + gapY) + 34;
  const yMax = Math.ceil(Math.max(...panels.flatMap((p) => [...p.counts, p.noReaders].map((c) => (100 * c) / p.inScopeN))) / 10) * 10;
  let body = simBadge(w);
  body += `<g font-size="12" fill="${INK2}"><rect x="24" y="66" width="12" height="12" rx="2" fill="${BLUE_DARK}"/><text x="42" y="76">chosen − ideal strength (D); shaded band = within ±0.25 D</text>
<rect x="420" y="66" width="12" height="12" rx="2" fill="${NEUTRAL_BAR}"/><text x="438" y="76">told no readers / referred</text></g>`;
  panels.forEach((p, k) => {
    const ox = 24 + (k % cols) * (pw + gapX);
    const oy = top + Math.floor(k / cols) * (ph + gapY) + 20;
    const plotL = ox + 34;
    const plotW = pw - 34 - 44;
    const nb = p.bins.length;
    const bw = plotW / nb;
    const yOf = (v: number) => oy + ph - (v / yMax) * ph;
    body += `<text x="${ox}" y="${oy - 8}" font-size="12.5" font-weight="600" fill="${INK}">${esc(p.label)}</text>`;
    body += `<text x="${ox + pw}" y="${oy - 8}" font-size="11.5" fill="${INK2}" text-anchor="end">${f1(p.within025)}% within ±0.25</text>`;
    // ±0.25 band (bins −0.25, 0, +0.25)
    const i0 = p.bins.findIndex((b) => Math.abs(b + 0.25) < 1e-9);
    body += `<rect x="${plotL + i0 * bw}" y="${oy}" width="${3 * bw}" height="${ph}" fill="${BAND}"/>`;
    for (const t of [0, yMax / 2, yMax]) {
      body += `<line x1="${plotL}" y1="${yOf(t)}" x2="${plotL + plotW + 40}" y2="${yOf(t)}" stroke="${t === 0 ? AXIS : GRID}"/>`;
      body += `<text x="${plotL - 6}" y="${yOf(t) + 4}" font-size="10.5" fill="${INK2}" text-anchor="end">${t}%</text>`;
    }
    p.counts.forEach((c, i) => {
      const v = (100 * c) / p.inScopeN;
      const b = p.bins[i];
      const name = i === 0 ? `≤ ${b.toFixed(2)}` : i === nb - 1 ? `≥ +${b.toFixed(2)}` : `${b > 0 ? '+' : ''}${b.toFixed(2)}`;
      body += `<rect x="${plotL + i * bw + 1}" y="${yOf(v)}" width="${bw - 2}" height="${Math.max(0, oy + ph - yOf(v))}" fill="${BLUE_DARK}"><title>${esc(`${p.label}: error ${name} D — ${f1(v)}%`)}</title></rect>`;
    });
    const nv = (100 * p.noReaders) / p.inScopeN;
    body += `<rect x="${plotL + plotW + 12}" y="${yOf(nv)}" width="${bw}" height="${Math.max(0, oy + ph - yOf(nv))}" fill="${NEUTRAL_BAR}"><title>${esc(`${p.label}: told no readers or referred — ${f1(nv)}%`)}</title></rect>`;
    for (const t of [-1.5, -1, -0.5, 0, 0.5, 1, 1.5]) {
      const i = p.bins.findIndex((b) => Math.abs(b - t) < 1e-9);
      if (i < 0) continue;
      body += `<text x="${plotL + (i + 0.5) * bw}" y="${oy + ph + 15}" font-size="10.5" fill="${INK2}" text-anchor="middle">${t > 0 ? '+' : ''}${t === 0 ? '0' : t.toFixed(1)}</text>`;
    }
    body += `<text x="${plotL + plotW + 12 + bw / 2}" y="${oy + ph + 15}" font-size="10.5" fill="${INK2}" text-anchor="middle">none</text>`;
  });
  const desc = panels.map((p) => `${p.label}: ${f1(p.within025)}% within ±0.25 D, ${f1((100 * p.noReaders) / p.inScopeN)}% given no pair`).join('; ') + '.';
  return frame('fig-bench-errors', w, h, 'Where each method goes wrong', 'Distribution of chosen minus ideal strength (D) for simulated in-scope people. Left of 0 = too weak, right = too strong.', `Small-multiple histograms, simulation. ${desc}`, body, footer);
}

// ---------------------------------------------------------------- (c) accuracy vs camera distance error

export interface SweepSeries { label: string; points: { x: number; y: number }[] }
export interface SweepPanel { title: string; series: SweepSeries[] }

const MARKERS = [
  (x: number, y: number, c: string) => `<circle cx="${x}" cy="${y}" r="4.5" fill="${c}" stroke="#fff" stroke-width="2"/>`,
  (x: number, y: number, c: string) => `<rect x="${x - 4.5}" y="${y - 4.5}" width="9" height="9" fill="${c}" stroke="#fff" stroke-width="2"/>`,
  (x: number, y: number, c: string) => `<path d="M${x} ${y - 6}L${x + 5.5} ${y + 4}L${x - 5.5} ${y + 4}Z" fill="${c}" stroke="#fff" stroke-width="2"/>`,
  (x: number, y: number, c: string) => `<path d="M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z" fill="${c}" stroke="#fff" stroke-width="2"/>`,
];

export function distanceSweep(panels: SweepPanel[], yLabel: string, footer: string): string {
  const w = 780;
  const h = 484;
  const top = 128;
  const pw = 300;
  const ph = 260;
  const gap = 70;
  const all = panels.flatMap((p) => p.series.flatMap((s) => s.points.map((q) => q.y)));
  const yMin = Math.max(0, Math.floor((Math.min(...all) - 5) / 10) * 10);
  const yMax = Math.min(100, Math.ceil((Math.max(...all) + 5) / 10) * 10);
  const xs = [...new Set(panels.flatMap((p) => p.series.flatMap((s) => s.points.map((q) => q.x))))].sort((a, b) => a - b);
  const xMax = Math.max(...xs);
  let body = simBadge(w);
  const series0 = panels[0].series;
  let lx = 24;
  body += `<g font-size="12" fill="${INK2}">`;
  series0.forEach((s, i) => {
    body += `<line x1="${lx}" y1="78" x2="${lx + 22}" y2="78" stroke="${SERIES[i]}" stroke-width="2"/>${MARKERS[i](lx + 11, 78, SERIES[i])}<text x="${lx + 30}" y="82">${esc(s.label)}</text>`;
    lx += 36 + s.label.length * 6.6;
  });
  body += `</g>`;
  panels.forEach((panel, k) => {
    const ox = 70 + k * (pw + gap);
    const xOf = (v: number) => ox + (v / xMax) * pw;
    const yOf = (v: number) => top + ph - ((v - yMin) / (yMax - yMin)) * ph;
    body += `<text x="${ox}" y="${top - 12}" font-size="12.5" font-weight="600" fill="${INK}">${esc(panel.title)}</text>`;
    for (let t = yMin; t <= yMax; t += 10) {
      body += `<line x1="${ox}" y1="${yOf(t)}" x2="${ox + pw}" y2="${yOf(t)}" stroke="${t === yMin ? AXIS : GRID}"/>`;
      body += `<text x="${ox - 8}" y="${yOf(t) + 4}" font-size="11" fill="${INK2}" text-anchor="end">${t}%</text>`;
    }
    for (const t of xs) body += `<text x="${xOf(t)}" y="${top + ph + 18}" font-size="11" fill="${INK2}" text-anchor="middle">${t}%</text>`;
    body += `<text x="${ox + pw / 2}" y="${top + ph + 38}" font-size="12" fill="${INK2}" text-anchor="middle">camera distance error (SD)</text>`;
    panel.series.forEach((s, i) => {
      const c = SERIES[i];
      const d = s.points.map((q, j) => `${j ? 'L' : 'M'}${xOf(q.x).toFixed(1)} ${yOf(q.y).toFixed(1)}`).join('');
      body += `<path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      for (const q of s.points) body += `<g><title>${esc(`${panel.title} — ${s.label}: ${f1(q.y)}% at ${q.x}% distance error`)}</title>${MARKERS[i](xOf(q.x), yOf(q.y), c)}</g>`;
    });
  });
  body += `<text transform="translate(22 ${top + ph / 2}) rotate(-90)" font-size="12" fill="${INK2}" text-anchor="middle">${esc(yLabel)}</text>`;
  const desc = panels.map((p) => `${p.title}: ` + p.series.map((s) => `${s.label} ${s.points.map((q) => `${f1(q.y)}% at ${q.x}%`).join(', ')}`).join('; ')).join('. ') + '.';
  return frame('fig-bench-distance', w, h, 'How much camera distance error matters', `${yLabel}, as the simulated camera distance error grows. Rack card and plain age table don't use the camera.`, `Line chart, simulation. ${desc}`, body, footer);
}
