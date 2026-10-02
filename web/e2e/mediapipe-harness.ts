// Browser-side harness for e2e/engines-mediapipe.spec.ts (bundled with esbuild at test time, not by Vite).
// Runs MediaPipe Face Landmarker in IMAGE mode on MediaPipe's test portrait with the app's own
// iris-width and distance functions, once per delegate, and reports what each engine supports.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { distanceFromIris, irisWidthNorm } from '../src/camera/distance';

export interface DelegateRun {
  delegate: 'GPU' | 'CPU';
  ok: boolean;
  /** createFromOptions resolved (the app keeps this delegate even if detection later fails). */
  created: boolean;
  error?: string;
  initMs?: number;
  firstDetectMs?: number;
  medianDetectMs?: number;
  landmarks?: number;
  irisLandmarks?: number;
  irisNorm?: number | null;
  distanceCm?: number | null;
}

export interface HarnessReport {
  userAgent: string;
  webgl2: boolean;
  webglRenderer: string | null;
  wasmSimd: boolean;
  wasmFile: string | null;
  image: { width: number; height: number };
  runs: DelegateRun[];
  /** VIDEO running mode (what the app uses) on a 640×480 canvas cut from the portrait, 30 frames. */
  video: VideoRun[];
  media: MediaSupport;
  /** What src/camera/distance.ts createLandmarker() ends up with: GPU if it can be created, else CPU. */
  appDelegate: 'GPU' | 'CPU' | 'none';
  /** The delegate the app would use also produced iris landmarks. */
  appDelegateWorks: boolean;
}

export interface VideoRun {
  delegate: 'GPU' | 'CPU';
  ok: boolean;
  error?: string;
  framesWithIris?: number;
  frames?: number;
  medianFrameMs?: number;
  /** 1000 / median frame time: the most frames per second the landmark step alone allows. */
  maxFps?: number;
  distanceCm?: number | null;
}

export interface MediaSupport {
  getUserMedia: boolean;
  mediaStream: boolean;
  canvasCaptureStream: boolean;
  canPlayWebm: string;
  /** A looping VP8 WebM (served at /__quality/portrait.webm) actually plays in a <video>. */
  webmPlays: boolean | null;
  webmError?: string;
}

async function mediaSupport(): Promise<MediaSupport> {
  const v = document.createElement('video');
  v.muted = true;
  const out: MediaSupport = {
    getUserMedia: !!navigator.mediaDevices?.getUserMedia,
    mediaStream: typeof MediaStream !== 'undefined',
    canvasCaptureStream: typeof (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream === 'function',
    canPlayWebm: v.canPlayType('video/webm; codecs="vp8"'),
    webmPlays: null,
  };
  try {
    const res = await fetch('/__quality/portrait.webm');
    if (!res.ok) return out;
    v.src = URL.createObjectURL(await res.blob());
    await Promise.race([v.play(), new Promise((_, no) => setTimeout(() => no(new Error('no frames within 8 s')), 8000))]);
    out.webmPlays = v.videoWidth > 0;
  } catch (e) {
    out.webmPlays = false;
    out.webmError = String((e as Error)?.message ?? e).slice(0, 200);
  }
  return out;
}

async function runVideoMode(img: HTMLImageElement, delegate: 'GPU' | 'CPU'): Promise<VideoRun> {
  let lm: FaceLandmarker | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    canvas.getContext('2d')!.drawImage(img, 80, 0, 640, 480, 0, 0, 640, 480);
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    lm = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
    });
    const times: number[] = [];
    let withIris = 0;
    let last: number | null = null;
    for (let i = 0; i < 30; i++) {
      const s = performance.now();
      const r = lm.detectForVideo(canvas, s);
      const ms = performance.now() - s;
      if (i > 0) times.push(ms); // the first frame includes shader/graph warm-up
      const face = r.faceLandmarks?.[0];
      const iris = face ? irisWidthNorm(face, 640, 480) : null;
      if (iris) { withIris++; last = iris; }
    }
    times.sort((a, b) => a - b);
    const med = times[Math.floor(times.length / 2)];
    return { delegate, ok: withIris === 30, framesWithIris: withIris, frames: 30, medianFrameMs: med, maxFps: 1000 / med,
      distanceCm: last ? distanceFromIris(last, 640 / 480).mm / 10 : null };
  } catch (e) {
    return { delegate, ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) };
  } finally {
    try { lm?.close(); } catch { /* ignore */ }
  }
}

function webglInfo(): { webgl2: boolean; renderer: string | null } {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return { webgl2: false, renderer: null };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { webgl2: true, renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) };
  } catch {
    return { webgl2: false, renderer: null };
  }
}

// Smallest SIMD module (same check MediaPipe's FilesetResolver uses).
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

async function runDelegate(img: HTMLImageElement, delegate: 'GPU' | 'CPU'): Promise<DelegateRun> {
  const t0 = performance.now();
  let lm: FaceLandmarker | null = null;
  let created = false;
  try {
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    lm = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
      runningMode: 'IMAGE',
      numFaces: 1,
    });
    created = true;
    const initMs = performance.now() - t0;
    const t1 = performance.now();
    const first = lm.detect(img);
    const firstDetectMs = performance.now() - t1;
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const s = performance.now();
      lm.detect(img);
      times.push(performance.now() - s);
    }
    times.sort((a, b) => a - b);
    const face = first.faceLandmarks?.[0] ?? [];
    const irisLandmarks = face.slice(468, 478).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).length;
    const irisNorm = face.length ? irisWidthNorm(face, img.naturalWidth, img.naturalHeight) : null;
    const distanceCm = irisNorm ? distanceFromIris(irisNorm, img.naturalWidth / img.naturalHeight).mm / 10 : null;
    return { delegate, ok: face.length >= 478 && irisLandmarks === 10, created, initMs, firstDetectMs, medianDetectMs: times[2], landmarks: face.length, irisLandmarks, irisNorm, distanceCm };
  } catch (e) {
    return { delegate, ok: false, created, error: String((e as Error)?.message ?? e).slice(0, 300) };
  } finally {
    try { lm?.close(); } catch { /* ignore */ }
  }
}

export async function runHarness(): Promise<HarnessReport> {
  const img = document.getElementById('portrait') as HTMLImageElement;
  await img.decode();
  const { webgl2, renderer } = webglInfo();
  const runs = [await runDelegate(img, 'GPU'), await runDelegate(img, 'CPU')];
  const video = [await runVideoMode(img, 'GPU'), await runVideoMode(img, 'CPU')];
  const media = await mediaSupport();
  const wasm = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.endsWith('.wasm')) ?? null;
  const gpu = runs[0], cpu = runs[1];
  return {
    userAgent: navigator.userAgent,
    webgl2,
    webglRenderer: renderer,
    wasmSimd: WebAssembly.validate(SIMD_PROBE),
    wasmFile: wasm ? new URL(wasm).pathname : null,
    image: { width: img.naturalWidth, height: img.naturalHeight },
    runs,
    video,
    media,
    appDelegate: gpu.created ? 'GPU' : cpu.created ? 'CPU' : 'none',
    appDelegateWorks: gpu.created ? gpu.ok : cpu.ok,
  };
}

(window as unknown as { runHarness: typeof runHarness }).runHarness = runHarness;
