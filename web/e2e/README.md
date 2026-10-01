# End-to-end tests (Playwright)

```bash
cd web
npm run e2e                       # all tests (~1 min, includes a production build)
npx playwright test demo-flow     # one file
npx playwright test --project=phone        # everything except the real-camera tests
npx playwright show-trace e2e/test-results/<test>/trace.zip   # after a failure
```

- **Browser:** the installed Google Chrome (`channel: 'chrome'`), so no browser download is needed.
  If Chrome isn't installed, remove `channel` from `playwright.config.ts` and run `npx playwright install chromium`.
- **Server:** Playwright builds the app (`copy-mediapipe` + `vite build`) and serves it with `vite preview` on
  port 4173. It skips `scripts/compress-dist.mjs` on purpose: that step rewrites the MediaPipe `.wasm` files as
  brotli bytes, which `vite preview` serves without a `Content-Encoding` header, so MediaPipe would fail to load.
  An already running server on 4173 is reused, so don't leave a preview of an `npm run build` output running there.
- **API:** `/api/v1/**` isn't served locally. Each test mocks it with `page.route` and checks the posted
  results against the 16-field contract in `src/api.ts`.

## What's covered

| File | Project | What it checks |
| --- | --- | --- |
| `demo-flow.spec.ts` | phone (Pixel 7) | Full demo-mode flow: age 52, reads at 38 cm, near point 60 cm. Expects +2.00, eye age 57, and the exact POST payload. Then checks the existing-readers update (same session) and a try-on verdict. |
| `safety.spec.ts` | phone | A red flag (sudden change) shows the stop screen and posts nothing. Diabetes alone shows the advice screen, which offers "Continue anyway". |
| `a11y.spec.ts` | phone | A single h1, accessible names on buttons and radios, and `<html lang>` following the language picker. |
| `camera-fake.spec.ts` | fake-camera (desktop) | The real MediaPipe path. On `lab.html`, the live distance and iris width appear. On `test.html`, the camera flow runs to a result. |

Tests marked `test.fixme` document known app bugs (see the comment above each one). Remove `.fixme` once
the bug is fixed.

## Fake camera

`camera-fake.spec.ts` uses Chrome's fake webcam (`--use-fake-device-for-media-stream`,
`--use-file-for-fake-video-capture`), which plays **MediaPipe's own test portrait**:
`fixtures/portrait.jpg`, downloaded from Google's MediaPipe asset bucket
(<https://storage.googleapis.com/mediapipe-assets/portrait.jpg>, a public-domain official portrait used in
MediaPipe's tests).

Chrome only plays `.y4m` or `.mjpeg` files here, and it rejects this progressive JPEG renamed to `.mjpeg`
("Requested device not found"). So `e2e/fake-camera.ts` (run from `global-setup.ts`) decodes the JPEG in Chrome,
crops a 640×480 webcam-like frame around the face, and writes a one-frame I420 `fixtures/portrait.y4m`.
Chrome loops that frame. The `.y4m` file is generated on first run and git-ignored. Delete it to regenerate.

There's no calibration in the fresh test profile, so the measured distance uses the uncalibrated 70° field
of view. It measures about 31 cm (iris ≈ 0.027 of the frame width). The tests only require a steady,
finite reading between 10 and 200 cm. A still image is perfectly steady, so the working-distance step completes.
