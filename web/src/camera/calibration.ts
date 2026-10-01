// Per-device calibration, kept only in this browser's local storage.
//
// Screen: browsers do not report the physical size of a CSS pixel (on a phone it is often ~0.16 mm,
// not the nominal 0.26 mm), so the person matches an on-screen box to any ID-1 card (85.6 mm).
// Camera: the person holds the screen at a known distance once; distance × iris size is then a
// constant for this camera, which removes both the unknown focal length and their own iris size.

export interface Calibration {
  screen?: { cssPxPerMm: number; at: string };
  camera?: { k: number; aspect: number; refMm: number; at: string };
}

const KEY = 'small-print.calibration.v1';

/** Nominal CSS pixel (1/96 inch), used only when the screen has not been calibrated. */
export const NOMINAL_CSS_PX_PER_MM = 96 / 25.4;

export function loadCalibration(): Calibration {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Calibration;
  } catch {
    return {};
  }
}

export function saveCalibration(update: Partial<Calibration>): void {
  localStorage.setItem(KEY, JSON.stringify({ ...loadCalibration(), ...update }));
}

export function clearCalibration(): void {
  localStorage.removeItem(KEY);
}

export function cssPxPerMm(): number {
  return loadCalibration().screen?.cssPxPerMm ?? NOMINAL_CSS_PX_PER_MM;
}

/** Median, robust to a few bad frames while the person settles. */
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
