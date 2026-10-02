// PNG copies of the architecture diagram and the real-patient chart, for the Builder Center write-up.
// Usage: npx tsx video/figs.ts
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../public/media');
const SITE = 'https://dxug72099q2ay.cloudfront.net';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
await p.goto(`${SITE}/evidence.html?dev`, { waitUntil: 'networkidle' });
// Render the diagram alone, so no page container clips it.
const svg = await p.locator('svg.arch').first().evaluate((el) => {
  const css = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText); } catch { return []; } }).join(' ');
  return { html: el.outerHTML, css };
});
await p.setContent(`<!doctype html><html><head><style>${svg.css}</style><style>html,body{margin:0;background:#fff}.figwrap{padding:28px;display:inline-block;background:#fff}svg.arch{width:1200px !important;max-width:none !important;height:auto !important}</style></head><body><div class="figwrap">${svg.html}</div></body></html>`);
await p.locator('.figwrap').screenshot({ path: resolve(OUT, 'architecture.png') });
await p.goto(`${SITE}/figures/clinical-accuracy.svg`);
await p.setViewportSize({ width: 1000, height: 700 });
await p.locator('svg').first().screenshot({ path: resolve(OUT, 'clinical-accuracy.png') });
await b.close();
