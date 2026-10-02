// Live face-to-screen distance from the front camera, computed on the device.
// MediaPipe Face Landmarker gives 478 landmarks; 468–477 are the two irises (centre + 4 ring points).
// The iris is close to the same size in every adult, so its size in the image gives the distance
// (pinhole camera: distance = focal length × real size ÷ image size). Video frames never leave the browser.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { IRIS_DIAMETER_MM } from '../core/optics';
import { loadCalibration } from './calibration';

export interface DistanceSample {
  /** Smoothed distance from the eyes to the camera, in mm (null when no face is visible). */
  distanceMm: number | null;
  /** Mean horizontal iris diameter as a fraction of the video width (raw measurement). */
  irisNorm: number | null;
  calibrated: boolean;
  fps: number;
}

export interface DistanceSource {
  start(onSample: (s: DistanceSample) => void): Promise<void>;
  stop(): void;
  /** Most recent raw iris size, for calibration. */
  readonly lastIrisNorm: number | null;
  readonly kind: 'camera' | 'demo';
}

// Ring points: 469/471 are the horizontal ends of one iris, 474/476 of the other.
const IRIS_PAIRS: [number, number][] = [[469, 471], [474, 476]];

/** Horizontal field of view assumed before camera calibration (typical front cameras: 60–80°). */
export const UNCALIBRATED_HFOV_DEG = 70;

// Eye-visibility check. Once the landmark model has found a face it always returns iris points, even
// when the eyes are covered (it invents them from the rest of the face), so the distance would be a
// guess. For each eye, a square 3 iris radii wide around the iris centre is copied from the video
// frame to a tiny canvas. A visible eye has a dark iris and pupil inside lighter white of the eye and
// lids; a covered eye (black bar, sunglasses, a hand) has no such dark centre. Checked every few
// frames, so the cost is two 24×24 reads about 10 times a second.
const IRIS_CENTRES = [468, 473] as const;
/** Patch resolution (px). The iris disc is the central 2/3 of the patch. */
export const EYE_PATCH_PX = 24;
/** Re-check the eyes on every Nth processed frame; reuse the last verdict in between. */
export const EYE_CHECK_EVERY = 3;
/** An eye counts as visible when (mean luminance of the ring around the iris − mean of the iris
 *  centre) ÷ mean luminance of the patch is at least this. Relative, so it does not depend on the
 *  light level. Fake-camera bench (bench-camera/negative.ts --set=eyecheck; public/data/
 *  negative-controls.json → eyeCheck), better eye of each check: real eyes 0.45–0.87 (lowest:
 *  3 px blur 0.45; at 22–70 cm, 30–50% brightness, warm/cool tint, turned 90°: 0.62 or more);
 *  covered eyes −0.08 to 0.12 (hand 0.12, sunglasses 0.04, black bars 0). 0.25 sits about 2× from
 *  both. Luminance SD was not used: a hand over the eyes (SD 12.6–14.4) overlaps real eyes at 30%
 *  brightness (SD 12.4–12.8). */
export const EYE_MIN_CONTRAST = 0.25;

/** (ring mean − centre mean) ÷ patch mean of the luminance of a square RGBA patch centred on the iris:
 *  centre = within 0.75 iris radii, ring = beyond 1.15 iris radii (the patch is 3 radii wide). */
export function eyePatchContrast(rgba: ArrayLike<number>, size = EYE_PATCH_PX): number {
  const c = (size - 1) / 2;
  const discR = size / 4, ringR = size * 0.3833;
  let sum = 0, disc = 0, nd = 0, ring = 0, nr = 0;
  for (let i = 0; i < size * size; i++) {
    const p = i * 4;
    const y = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    sum += y;
    const r = Math.hypot((i % size) - c, Math.floor(i / size) - c);
    if (r < discR) { disc += y; nd++; } else if (r > ringR) { ring += y; nr++; }
  }
  const mean = sum / (size * size);
  return mean < 1 ? 0 : (ring / nr - disc / nd) / mean;
}

export class CameraDistance implements DistanceSource {
  readonly kind = 'camera' as const;
  lastIrisNorm: number | null = null;
  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private history: number[] = [];
  private smoothed: number | null = null;
  private frameTimes: number[] = [];
  private lastVideoTime = -1;
  private eyeCtx: CanvasRenderingContext2D | null = null;
  private eyeCheckIn = 0;
  private eyesVisible = true;

  constructor(private video: HTMLVideoElement) {}

  /** Ask for the camera. Throws if permission is denied or no camera exists. */
  async open(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
  }

  async start(onSample: (s: DistanceSample) => void): Promise<void> {
    if (!this.stream) await this.open();
    if (!this.landmarker) this.landmarker = await createLandmarker();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const v = this.video;
      if (v.readyState < 2 || v.currentTime === this.lastVideoTime || !this.landmarker) return;
      this.lastVideoTime = v.currentTime;
      const now = performance.now();
      let result;
      try {
        result = this.landmarker.detectForVideo(v, now);
      } catch {
        return; // a dropped frame is fine; the next one will be processed
      }
      this.frameTimes.push(now);
      while (this.frameTimes.length && now - this.frameTimes[0] > 1000) this.frameTimes.shift();
      const lm = result.faceLandmarks?.[0];
      let irisNorm = lm ? irisWidthNorm(lm, v.videoWidth, v.videoHeight) : null;
      // Covered eyes count as no face, exactly like the no-face path.
      if (irisNorm !== null && !this.checkEyes(v, lm!)) irisNorm = null;
      if (!lm) this.eyeCheckIn = 0; // check straight away when a face comes back
      this.lastIrisNorm = irisNorm;
      onSample(this.toSample(irisNorm, v.videoWidth / v.videoHeight));
    };
    loop();
  }

  /** True if at least one eye is visible (re-checked every EYE_CHECK_EVERY frames). */
  private checkEyes(v: HTMLVideoElement, lm: { x: number; y: number }[]): boolean {
    if (this.eyeCheckIn > 0) {
      this.eyeCheckIn--;
      return this.eyesVisible;
    }
    this.eyeCheckIn = EYE_CHECK_EVERY - 1;
    try {
      if (!this.eyeCtx) {
        const c = document.createElement('canvas');
        c.width = c.height = EYE_PATCH_PX;
        this.eyeCtx = c.getContext('2d', { willReadFrequently: true });
      }
      const ctx = this.eyeCtx;
      if (!ctx) return (this.eyesVisible = true); // no canvas: behave as before rather than block the test
      const w = v.videoWidth, h = v.videoHeight;
      // Both eyes every time (no short-circuit), so the bench can record both patches.
      this.eyesVisible = IRIS_CENTRES.map((c, i) => {
        const [a, b] = IRIS_PAIRS[i];
        const r = Math.hypot((lm[a].x - lm[b].x) * w, (lm[a].y - lm[b].y) * h) / 2;
        const side = Math.max(6, 3 * r);
        const x = lm[c].x * w - side / 2, y = lm[c].y * h - side / 2;
        if (x < 0 || y < 0 || x + side > w || y + side > h) return false; // eye outside the picture
        ctx.drawImage(v, x, y, side, side, 0, 0, EYE_PATCH_PX, EYE_PATCH_PX);
        return eyePatchContrast(ctx.getImageData(0, 0, EYE_PATCH_PX, EYE_PATCH_PX).data) >= EYE_MIN_CONTRAST;
      }).some(Boolean);
    } catch {
      this.eyesVisible = true; // canvas read failed: fall back to the old behaviour
    }
    return this.eyesVisible;
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private toSample(irisNorm: number | null, aspect: number): DistanceSample {
    const fps = this.frameTimes.length;
    if (irisNorm === null) {
      this.history = [];
      this.smoothed = null;
      return { distanceMm: null, irisNorm: null, calibrated: !!loadCalibration().camera, fps };
    }
    const { mm, calibrated } = distanceFromIris(irisNorm, aspect);
    // Median of the last 5 frames removes single-frame landmark glitches; a light exponential
    // filter then steadies the number without making it feel laggy.
    this.history.push(mm);
    if (this.history.length > 5) this.history.shift();
    const median = [...this.history].sort((a, b) => a - b)[Math.floor(this.history.length / 2)];
    this.smoothed = this.smoothed === null ? median : this.smoothed + 0.35 * (median - this.smoothed);
    return { distanceMm: this.smoothed, irisNorm, calibrated, fps };
  }
}

/** Distance in mm from the iris size, using the stored calibration when there is one. */
export function distanceFromIris(irisNorm: number, aspect: number): { mm: number; calibrated: boolean } {
  const cal = loadCalibration().camera;
  if (cal && Math.abs(cal.aspect - aspect) < 0.05) {
    // Calibrated at a known distance: distance × iris size is constant, so the assumed
    // 11.7 mm iris and the unknown focal length both cancel out.
    return { mm: cal.k / irisNorm, calibrated: true };
  }
  const focalNorm = 0.5 / Math.tan(((UNCALIBRATED_HFOV_DEG / 2) * Math.PI) / 180);
  return { mm: (focalNorm * IRIS_DIAMETER_MM) / irisNorm, calibrated: false };
}

/** Mean horizontal iris diameter of both eyes as a fraction of the image width. */
export function irisWidthNorm(lm: { x: number; y: number }[], width: number, height: number): number | null {
  if (lm.length < 478) return null;
  const sizes = IRIS_PAIRS.map(([a, b]) => Math.hypot((lm[a].x - lm[b].x) * width, (lm[a].y - lm[b].y) * height) / width);
  // If the head is turned, one iris foreshortens; the larger one is closer to its true size.
  return Math.max(...sizes) * 0.5 + (sizes[0] + sizes[1]) * 0.25;
}

async function createLandmarker(): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
    runningMode: 'VIDEO' as const,
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
  try {
    return await FaceLandmarker.createFromOptions(fileset, options('GPU'));
  } catch {
    return FaceLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

/** Demo mode: a slider stands in for the camera, so the whole flow works without one. */
export class DemoDistance implements DistanceSource {
  readonly kind = 'demo' as const;
  lastIrisNorm: number | null = null;
  private timer = 0;
  constructor(private read: () => number) {}
  async start(onSample: (s: DistanceSample) => void): Promise<void> {
    this.timer = window.setInterval(() => onSample({ distanceMm: this.read(), irisNorm: null, calibrated: true, fps: 30 }), 33);
  }
  stop(): void {
    clearInterval(this.timer);
  }
}
