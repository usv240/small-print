// YouTube thumbnail (1280×720): a short headline and the real result screen. Usage: npx tsx video/thumb.ts
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HERE = import.meta.dirname;
const card = readFileSync(resolve(HERE, '../public/media/result-card.png')).toString('base64');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#fbf8f3;color:#1a1917;font-family:"Segoe UI",system-ui,sans-serif}
  .brand{position:absolute;left:72px;top:52px;font:700 40px "Palatino Linotype",Georgia,serif}
  .brand span,.accent{color:#b4410e}
  h1{position:absolute;left:72px;top:150px;width:720px;margin:0;font:700 92px/1.02 "Palatino Linotype",Georgia,serif;letter-spacing:-.015em}
  .tag{position:absolute;left:72px;bottom:64px;font:600 34px "Segoe UI",sans-serif;background:#b4410e;color:#fff;padding:14px 28px;border-radius:999px}
  .phone{position:absolute;right:86px;top:34px;width:300px;height:652px;border-radius:44px;background:#1a1917;padding:12px;box-sizing:border-box;transform:rotate(4deg);box-shadow:0 30px 70px rgba(26,25,23,.28)}
  .phone div{width:100%;height:100%;border-radius:33px;overflow:hidden;background:#fff url(data:image/png;base64,${card}) top center/100% auto no-repeat}
</style></head><body>
  <div class="brand">Small <span>Print</span></div>
  <h1>Which reading glasses <span class="accent">should you buy?</span></h1>
  <div class="tag">Your phone camera tells you</div>
  <div class="phone"><div></div></div>
</body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.setContent(html);
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: resolve(HERE, '../public/media/youtube-thumbnail.jpg'), type: 'jpeg', quality: 92 });
await b.close();
