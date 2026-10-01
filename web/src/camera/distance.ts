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
      const irisNorm = lm ? irisWidthNorm(lm, v.videoWidth, v.videoHeight) : null;
      this.lastIrisNorm = irisNorm;
      onSample(this.toSample(irisNorm, v.videoWidth / v.videoHeight));
    };
    loop();
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
