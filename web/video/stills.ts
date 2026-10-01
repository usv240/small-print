// hero.png (1600×900) and result-card.png from the real result screen recorded by record.ts.
// Usage: npx tsx video/stills.ts
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HERE = import.meta.dirname;
const TMP = resolve(HERE, 'tmp');
const OUT = resolve(HERE, '../public/media');
const shot = resolve(TMP, 'result-card@3x.png');

// result-card.png: the real phone screenshot (390×760 CSS), saved at 2× (780×1520)
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', shot, '-vf', 'scale=780:1520:flags=lanczos', '-update', '1', resolve(OUT, 'result-card.png')]);

const img = `data:image/png;base64,${readFileSync(shot).toString('base64')}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root { --bg:#fbf8f3; --ink:#1a1917; --muted:#5d5a55; --line:#e4ded4; --accent:#b4410e; --accent-soft:#fbe9df;
    --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif; --sans:"Segoe UI",system-ui,sans-serif; }
  html,body { margin:0; width:1600px; height:900px; overflow:hidden; background:var(--bg); color:var(--ink); font-family:var(--sans); }
  .brand { position:absolute; left:110px; top:84px; font:700 34px var(--serif); }
  .brand span { color:var(--accent); }
  .text { position:absolute; left:110px; top:190px; width:800px; }
  .eyebrow { font:600 18px var(--sans); letter-spacing:.14em; text-transform:uppercase; color:var(--accent); margin:0 0 22px; }
  h1 { font:600 82px/1.04 var(--serif); margin:0 0 30px; letter-spacing:-.012em; }
  .sub { font:27px/1.45 var(--sans); color:var(--muted); margin:0 0 36px; width:740px; }
  .row { display:flex; align-items:center; gap:22px; }
  .url { font:600 24px var(--sans); color:var(--accent); border:2px solid var(--accent); background:#fff; border-radius:999px; padding:10px 24px; }
  .note { font:20px var(--sans); color:var(--muted); }
  .note b { color:var(--ink); }
  .glow { position:absolute; left:1050px; top:110px; width:520px; height:680px; border-radius:50%; background:radial-gradient(closest-side, rgba(180,65,14,.14), rgba(180,65,14,0)); }
  .phone { position:absolute; left:1104px; top:52px; width:390px; height:760px; border:13px solid #1a1917; border-radius:48px; overflow:hidden; background:#fff;
    box-shadow:0 34px 80px rgba(26,25,23,.25), 0 6px 18px rgba(26,25,23,.14); }
  .phone img { display:block; width:390px; height:760px; }
  .cap { position:absolute; left:1104px; width:416px; top:852px; text-align:center; font:15px var(--sans); color:var(--muted); }
</style></head><body>
  <div class="brand">Small <span>Print</span></div>
  <div class="text">
    <p class="eyebrow">Free · two minutes · no install</p>
    <h1>Everyone deserves to read the small print.</h1>
    <p class="sub">Your phone’s camera measures how far away you read, a letter E resizes to match, and you swipe the way it points. You get the ready-made reading-glasses strength to buy, then check the pair in the shop.</p>
    <div class="row"><span class="url">dxug72099q2ay.cloudfront.net</span><span class="note"><b>Not an eye exam.</b></span></div>
  </div>
  <div class="glow"></div>
  <div class="phone"><img src="${img}" alt=""></div>
  <p class="cap">Real result screen (demo mode)</p>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(OUT, 'hero.png') });
await browser.close();
console.log('wrote hero.png, result-card.png');
