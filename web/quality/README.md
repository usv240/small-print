# Quality evidence

Everything here produces measured numbers for `public/data/quality.json`: cross-browser results (including
Safari's engine), accessibility, Lighthouse, readability, and performance on a throttled "cheap phone".
Each check writes a file to `quality/results/`. `build-report.ts` merges them.

Run all commands from `web/`. Only one Playwright run at a time, because the e2e web server uses port 4173.

## One-time setup

```bash
npm install                                   # includes @axe-core/playwright and lighthouse (dev deps)
npx playwright install webkit firefox ffmpeg  # Safari engine, Firefox, ffmpeg (used to build the test video)
```

Chrome projects use the installed Google Chrome (`channel: 'chrome'`).

## 1. Cross-browser (WebKit = Safari's engine, Firefox)

```bash
npx playwright test --project=webkit-iphone --project=firefox-desktop
```

- `webkit-iphone` runs the iPhone 15 profile. `firefox-desktop` runs the Desktop Firefox profile. Both run demo-flow, safety, camp, a11y and `engines-mediapipe`.
- **WebKit caveat:** Playwright's WebKit on Windows is the Safari engine, but not iOS Safari. It has no `MediaStream`, no `canvas.captureStream`, and can't decode video (`MEDIA_ERR_SRC_NOT_SUPPORTED`). WebGL reports "Apple GPU" but runs on the host GPU.
- `e2e/engines-mediapipe.spec.ts` checks that the camera pipeline runs on each engine:
  1. Face Landmarker runs in IMAGE mode and VIDEO mode with the GPU and CPU delegates. It uses MediaPipe's test portrait, the app's WASM and model, and the app's `irisWidthNorm` / `distanceFromIris` (bundled with esbuild at test time). It checks that there are 478 landmarks and 10 iris points, and that the distance is a finite number.
  2. The app's real camera code runs on `lab.html` and `test.html`, with `getUserMedia` stubbed to play a looping WebM of the same portrait (`e2e/fake-camera-webm.ts`). This is skipped on Windows WebKit because it can't play video.
- The offline test runs on every engine against a real outage, not Playwright's `setOffline`:
  ```bash
  npx vite build && node quality/offline-engines.mjs   # serves dist/ on port 4181, then kills the server
  ```
  `e2e/offline.spec.ts` stays Chrome-only. In WebKit, Playwright's `setOffline()` also blocks responses the service worker serves from its cache.
- To save the numbers, run with `QUALITY=1`. For JSON results across all projects, see "Everything" below.

## 2. Accessibility (axe-core, WCAG 2.2 AA)

```bash
QUALITY=1 npx playwright test axe --project=phone
```

`e2e/axe.spec.ts` checks all 10 content pages, plus 17 test screens reachable in demo mode (welcome through the try-on verdict, stop/advise and camp summary). It runs each one in the light and the dark theme, at Pixel 7 size. It also tabs through long demo screens to check WCAG 2.4.11 Focus Not Obscured, because of the fixed demo bar. Known app bugs are listed in `KNOWN_SEVERE` / `KNOWN_OBSCURED`, so any new serious or critical violation fails the test.

## 3. Lighthouse (live site)

```bash
node quality/lighthouse.mjs                       # mobile, simulated throttling, 3 runs per page, median kept
LH_RUNS=1 LH_BASE=https://… node quality/lighthouse.mjs
```

Uses the installed Chrome. Set `CHROME_PATH` to override it. It covers `/`, `/judges.html`, `/test.html` and `/validation.html`. Full reports go to `quality/results/lighthouse/` (git-ignored).

## 4. Readability

```bash
npx tsx quality/readability.ts
```

Scores every string in `src/i18n/{en,es,fr,pt}.ts`, in three groups: core screen text, voice-guide `_say` text, and `info_*` explanations. It also scores the landing page `<main>` text. The formulas are written in the script, with no library:

- English: Flesch reading ease and Flesch–Kincaid grade
- Spanish: Fernández-Huerta
- French: Kandel–Moles
- Portuguese: Martins et al. 1996

Syllables are counted with rules, not a dictionary. The script also lists the 10 hardest English strings, with suggested rewrites scored by the same formula. The rewrites are not applied to the app.

## 5. Low-end phone performance

```bash
QUALITY=1 QUALITY_PERF=1 npx playwright test --project=lowend-perf     # ~8 min, against the live site
PERF_BASE=http://localhost:4173 QUALITY=1 QUALITY_PERF=1 npx playwright test --project=lowend-perf
```

Runs Chrome at Pixel 7 size, with CDP CPU throttling at 1×, 4× and 6×. The network uses the DevTools Fast 4G and Slow 4G presets (Slow 4G was called "Fast 3G" before Chrome 125). The camera is Chrome's fake camera playing the portrait. It measures:

- time to interactive of `/test.html` from a cold cache, and the time from the first tap to the next screen
- time from tapping "Allow camera" to the first distance on screen, from a cold cache (includes downloading the 2.4 MB brotli WASM and the 3.7 MB model)
- landmark-loop fps on `lab.html`, with the GPU delegate and with WebGL disabled (which forces the CPU delegate)

CPU throttling slows only the main thread. GPU work isn't slowed, so the GPU-delegate fps flatters a cheap phone's GPU.

## Everything → `public/data/quality.json`

```bash
QUALITY=1 PLAYWRIGHT_JSON_OUTPUT_NAME=quality/results/e2e.json npx playwright test --reporter=list,json
QUALITY=1 QUALITY_PERF=1 npx playwright test --project=lowend-perf
node quality/offline-engines.mjs
node quality/lighthouse.mjs
npx tsx quality/readability.ts
npx tsx quality/build-report.ts
```
