# Small Print

**Everyone deserves to read the small print.**

Small Print is a free, two-minute test in the phone's browser. It tells people over about 40 which ready-made (non-prescription) reading glasses to buy, then checks the pair at the shop rack. The front camera measures the distance from the eyes to the screen on the device, so a tumbling-E test is always drawn at the right size. You swipe the way the E points, so no reading is needed. A voice guide speaks every step in English, Spanish, French or Portuguese.

- Live app: https://dxug72099q2ay.cloudfront.net
- Try it: [`/test.html`](https://dxug72099q2ay.cloudfront.net/test.html), or [`/test.html?demo`](https://dxug72099q2ay.cloudfront.net/test.html?demo) without a camera
- For judges: [`/judges.html`](https://dxug72099q2ay.cloudfront.net/judges.html), each step with its expected result
- Method: [`/how-it-works.html`](https://dxug72099q2ay.cloudfront.net/how-it-works.html) · Evidence: [`/validation.html`](https://dxug72099q2ay.cloudfront.net/validation.html) · Built on AWS: [`/evidence.html`](https://dxug72099q2ay.cloudfront.net/evidence.html)

> Small Print helps people choose ready-made reading glasses. It is **not an eye exam** and cannot detect eye disease. See [`/safety.html`](https://dxug72099q2ay.cloudfront.net/safety.html).

## Why

- 826 million people had near-vision impairment from uncorrected presbyopia (Fricke et al., *Ophthalmology* 2018).
- Effective near-vision correction among over-50s is 64.7% in high-income countries and 1.4% in sub-Saharan Africa (*Community Eye Health Journal* 2024).
- Reading glasses cost a few dollars. In randomised trials they raised productivity by 22% (PROSPER, *Lancet Global Health* 2018) and income by 33% (THRIVE, *PLOS ONE* 2024). Those trials measured giving people glasses, not using this app.
- The usual way to choose a strength is a printed chart on a shop rack. It only works at exactly the right distance and print size, and only for people who can read it.

## How it works (short version)

| Step | What happens |
|---|---|
| Distance | MediaPipe Face Landmarker runs in the browser (WebAssembly). The iris is about 11.7 mm wide in almost every adult, so its size in the image gives the distance. A one-time calibration at 30 cm cancels the camera's focal length and the person's own iris size. |
| Screen size | Browsers don't know the physical size of a CSS pixel, so the user matches a box to any ID-1 card (85.6 mm) once. |
| Test | A tumbling E is redrawn about 30 times a second at a constant visual angle (N6 at 40 cm, logMAR 0.27). |
| Estimate | An age table (Stevens 2019) is fused with the measured near point, corrected for depth of focus and for the bias of amplitude-based estimates (Panke 2019). |
| Try-on | With a candidate pair on, the app measures both ends of the clear range and checks that the reading distance sits in the middle (the clinical rule). It then says good fit, stronger or weaker. |

No generative AI is used in the decision. The core is deterministic optics in [`web/src/core`](web/src/core), and every constant cites its source.

## Repository

```
web/     Front end (Vite + TypeScript). Static content pages, the test app, the measurement lab
  src/core/     optics.ts, recommend.ts, tryon.ts (pure, unit-tested)
  src/camera/   iris-based distance, calibration
  sim/          simulated-eye test bench (20,000 virtual people), clearly labelled as simulation
  e2e/          Playwright tests, including a real MediaPipe run through Chrome's fake camera
  scripts/      Polly voice generation, MediaPipe copy, brotli compression
api/     Lambda handlers: anonymous results (idempotent per session), aggregate stats, health, uptime
infra/   AWS CDK: CloudFront + S3 (OAC), HTTP API, Lambda, DynamoDB, EventBridge uptime check,
         CloudWatch dashboard and alarms, AWS Budgets, cdk-nag (exceptions justified in lib/nag.ts)
```

## Run it

```bash
# front end
cd web && npm install
npm run dev          # http://localhost:5173/test.html?demo
npm test             # unit tests (optics, recommendation, try-on, simulation sanity)
npm run e2e          # Playwright, uses the installed Chrome; includes a fake-camera MediaPipe test
npm run sim          # simulated-eye test bench, writes public/data/bench.json and the figures

# API
cd api && npm install && npm test

# infrastructure (us-east-1)
cd infra && npm install
npx cdk deploy --profile <profile>
```

## Evidence, honestly labelled

| Kind | What | Where |
|---|---|---|
| Measured | Camera distance against a ruler at 25/40/60 cm, on a Google Pixel and a Windows laptop | `/validation.html` |
| Verified | Unit tests reproduce published values (Hofstetter at age 50: 2.5/3.5/5.0 D; N6 = 1.09 mm) | `web/tests`, `api/test` |
| Simulated | 20,000 virtual people: right call 84.9% with the try-on as shipped vs 42.0% for an age table | `web/sim`, `/validation.html` |
| Not done | Field validation. A pilot protocol is proposed on `/validation.html` | |

## Built with a coding agent

Built with Claude Code, connected to AWS through the AWS MCP Server (Agent Toolkit for AWS). The agent used a dedicated IAM role with read-only access plus permission to use the CDK deployment roles, so every change went through infrastructure code and CloudTrail records the agent separately. Details are on `/evidence.html`.

## Licence

MIT. MediaPipe (Apache 2.0) and its face landmarker model are © Google.
