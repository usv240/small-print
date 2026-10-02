// CMDP harness page (bench only). Runs the model the app ships (MediaPipe Face Landmarker,
// /models/face_landmarker.task) in IMAGE mode on one still photo at a time, and measures it with the
// app's own code imported from src/camera/distance.ts: irisWidthNorm() for the iris size and
// eyePatchContrast() + EYE_PATCH_PX + EYE_MIN_CONTRAST for the eye-visibility check.
//
// The eye check below repeats CameraDistance.checkEyes() (a private method) line for line, with the
// photo instead of the video frame as the drawImage source. Landmark indices are the app's:
// iris ring pairs 469/471 and 474/476, iris centres 468 and 473.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { EYE_MIN_CONTRAST, EYE_PATCH_PX, eyePatchContrast, irisWidthNorm } from '../../src/camera/distance';

const IRIS_PAIRS: [number, number][] = [[469, 471], [474, 476]];
const IRIS_CENTRES = [468, 473] as const;

export interface ImageResult {
  url: string;
  width: number;
  height: number;
  faces: number;
  landmarks: number;
  /** irisWidthNorm(): mean horizontal iris diameter, fraction of image width (null = no face). */
  irisNorm: number | null;
  /** Each iris (469/471, 474/476) in image pixels. */
  irisPx: [number, number] | null;
  /** Inter-pupil distance (468–473) in image pixels, for a sanity check. */
  ipdPx: number | null;
  /** eyePatchContrast() per eye (null if the patch fell outside the image). */
  eyeContrast: [number | null, number | null] | null;
  /** The app's verdict: at least one eye with contrast ≥ EYE_MIN_CONTRAST. */
  eyesVisible: boolean | null;
  ms: number;
}

let landmarker: FaceLandmarker | null = null;
let delegate: 'GPU' | 'CPU' = 'GPU';

async function init(): Promise<string> {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  // Same options as the app's createLandmarker(), except runningMode IMAGE (still photos).
  const options = (d: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: d },
    runningMode: 'IMAGE' as const,
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
  const want = new URLSearchParams(location.search).get('delegate');
  if (want !== 'CPU') {
    try {
      landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'));
      delegate = 'GPU';
    } catch {
      landmarker = null;
    }
  }
  if (!landmarker) {
    landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'));
    delegate = 'CPU';
  }
  return delegate;
}

const eyeCanvas = document.createElement('canvas');
eyeCanvas.width = eyeCanvas.height = EYE_PATCH_PX;
const eyeCtx = eyeCanvas.getContext('2d', { willReadFrequently: true })!;

async function run(url: string): Promise<ImageResult> {
  const t0 = performance.now();
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const res = landmarker!.detect(img);
  const lm = res.faceLandmarks?.[0];
  const base = { url, width: w, height: h, faces: res.faceLandmarks?.length ?? 0, landmarks: lm?.length ?? 0 };
  if (!lm) return { ...base, irisNorm: null, irisPx: null, ipdPx: null, eyeContrast: null, eyesVisible: null, ms: performance.now() - t0 };
  const irisNorm = irisWidthNorm(lm, w, h);
  const irisPx = IRIS_PAIRS.map(([a, b]) => Math.hypot((lm[a].x - lm[b].x) * w, (lm[a].y - lm[b].y) * h)) as [number, number];
  const ipdPx = Math.hypot((lm[468].x - lm[473].x) * w, (lm[468].y - lm[473].y) * h);
  // CameraDistance.checkEyes(), with the photo as the source.
  const eyeContrast = IRIS_CENTRES.map((c, i) => {
    const [a, b] = IRIS_PAIRS[i];
    const r = Math.hypot((lm[a].x - lm[b].x) * w, (lm[a].y - lm[b].y) * h) / 2;
    const side = Math.max(6, 3 * r);
    const x = lm[c].x * w - side / 2, y = lm[c].y * h - side / 2;
    if (x < 0 || y < 0 || x + side > w || y + side > h) return null; // eye outside the picture
    eyeCtx.drawImage(img, x, y, side, side, 0, 0, EYE_PATCH_PX, EYE_PATCH_PX);
    return eyePatchContrast(eyeCtx.getImageData(0, 0, EYE_PATCH_PX, EYE_PATCH_PX).data);
  }) as [number | null, number | null];
  const eyesVisible = eyeContrast.some((c) => c !== null && c >= EYE_MIN_CONTRAST);
  return { ...base, irisNorm, irisPx, ipdPx, eyeContrast, eyesVisible, ms: performance.now() - t0 };
}

declare global {
  interface Window {
    cmdpReady: Promise<string>;
    cmdpRun: (url: string) => Promise<ImageResult>;
    cmdpInfo: () => { delegate: string; eyeMinContrast: number; eyePatchPx: number; userAgent: string; webgl: string };
  }
}

window.cmdpReady = init().then((d) => {
  document.getElementById('status')!.textContent = `ready (${d})`;
  return d;
});
window.cmdpRun = run;
window.cmdpInfo = () => {
  const gl = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null;
  let webgl = 'no WebGL2';
  if (gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    webgl = ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)} | ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : String(gl.getParameter(gl.RENDERER));
  }
  return { delegate, eyeMinContrast: EYE_MIN_CONTRAST, eyePatchPx: EYE_PATCH_PX, userAgent: navigator.userAgent, webgl };
};
