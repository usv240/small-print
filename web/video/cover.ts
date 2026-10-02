// Builder Center cover image (1200×675, almost no text): the real result screen on a phone, next to the E.
// Usage: npx tsx video/cover.ts
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HERE = import.meta.dirname;
const card = readFileSync(resolve(HERE, '../public/media/result-card.png')).toString('base64');
const E = (s: number, rot: number, o: number) => `<svg width="${s}" height="${s}" viewBox="0 0 5 5" style="transform:rotate(${rot}deg);opacity:${o}"><path d="M0 0H5V1H1V2H5V3H1V4H5V5H0Z" fill="#1a1917"/></svg>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1200px;height:675px;overflow:hidden;background:#fbf8f3}
  .row{position:absolute;left:90px;top:0;bottom:0;display:flex;align-items:center;gap:56px}
  .glow{position:absolute;left:-140px;top:-120px;width:760px;height:760px;border-radius:50%;background:radial-gradient(#fbe9df,transparent 68%)}
  .phone{position:absolute;right:120px;top:40px;width:276px;height:596px;border-radius:42px;background:#1a1917;padding:11px;box-sizing:border-box;transform:rotate(4deg);box-shadow:0 30px 70px rgba(26,25,23,.28)}
  .phone div{width:100%;height:100%;border-radius:32px;overflow:hidden;background:#fff url(data:image/png;base64,${card}) top center/100% auto no-repeat}
  .bar{position:absolute;left:90px;bottom:120px;width:120px;height:8px;border-radius:8px;background:#b4410e}
</style></head><body>
  <div class="glow"></div>
  <div class="row">${E(190, 0, 1)}${E(120, 90, .75)}${E(72, 180, .5)}${E(40, 270, .3)}</div>
  <div class="bar"></div>
  <div class="phone"><div></div></div>
</body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 675 } });
await p.setContent(html);
await p.screenshot({ path: resolve(HERE, '../public/media/cover.jpg'), type: 'jpeg', quality: 92 });
await b.close();
