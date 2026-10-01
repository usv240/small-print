// Screen-size finding, computed from published specs (no measurement): how big one CSS pixel really is.
// Browsers assume 1 CSS px = 1/96 inch = 0.2646 mm. Physically it is devicePixelRatio ÷ PPI inches.
// Only devices whose PPI and default CSS viewport / devicePixelRatio could be checked in at least two
// public sources are listed. Phones use their default display-size / zoom settings.

export interface ScreenSpec {
  device: string;
  ppi: number;
  dpr: number;
  cssWidth: number;
  physicalWidthPx: number;
  sources: { what: string; url: string }[];
}

export const NOMINAL_MM = 25.4 / 96;

const laptopPpi = Math.hypot(1920, 1080) / 15.6;

export const SCREEN_SPECS: ScreenSpec[] = [
  {
    device: 'Google Pixel 7',
    ppi: 416,
    dpr: 2.625,
    cssWidth: 412,
    physicalWidthPx: 1080,
    sources: [
      { what: 'PPI (6.3", 1080×2400, ~416 ppi)', url: 'https://www.gsmarena.com/google_pixel_7-11903.php' },
      { what: 'Viewport 412×915, DPR 2.625, 416 PPI', url: 'https://blisk.io/devices/details/google-pixel-7' },
      { what: 'DPR 2.625, 412 CSS px wide (Chrome DevTools / Playwright device list)', url: 'https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/emulation/EmulatedDevices.ts' },
    ],
  },
  {
    device: 'Google Pixel 8',
    ppi: 428,
    dpr: 2.625,
    cssWidth: 412,
    physicalWidthPx: 1080,
    sources: [
      { what: 'PPI (6.2", 1080×2400, ~428 ppi)', url: 'https://www.gsmarena.com/google_pixel_8-12546.php' },
      { what: 'Viewport 412×915, DPR 2.625, 428 PPI', url: 'https://blisk.io/devices/details/google-pixel-8' },
      { what: 'DPR 2.625, 412 CSS px wide (Playwright device list)', url: 'https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/deviceDescriptorsSource.json' },
    ],
  },
  {
    device: 'Apple iPhone 15',
    ppi: 460,
    dpr: 3,
    cssWidth: 393,
    physicalWidthPx: 1179,
    sources: [
      { what: 'PPI (6.1", 2556×1179 at 460 ppi, Apple tech specs)', url: 'https://support.apple.com/en-us/111831' },
      { what: 'Logical 393×852, scale factor 3', url: 'https://www.ios-resolution.com/' },
      { what: 'DPR 3, 393 CSS px wide (Playwright device list)', url: 'https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/deviceDescriptorsSource.json' },
    ],
  },
  {
    device: 'Samsung Galaxy S23',
    ppi: 425,
    dpr: 3,
    cssWidth: 360,
    physicalWidthPx: 1080,
    sources: [
      { what: 'PPI (6.1", 1080×2340, ~425 ppi)', url: 'https://www.gsmarena.com/samsung_galaxy_s23-12082.php' },
      { what: 'Viewport 360×780, DPR 3, 425 PPI', url: 'https://blisk.io/devices/details/galaxy-s23' },
    ],
  },
  {
    device: 'Motorola Moto G4 (budget Android, 2016)',
    ppi: 401,
    dpr: 3,
    cssWidth: 360,
    physicalWidthPx: 1080,
    sources: [
      { what: 'PPI (5.5", 1080×1920, ~401 ppi)', url: 'https://www.gsmarena.com/motorola_moto_g4-8103.php' },
      { what: 'Viewport 360×640, DPR 3 (Chrome DevTools device list)', url: 'https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/emulation/EmulatedDevices.ts' },
      { what: 'Viewport 360×640, DPR 3 (Playwright device list)', url: 'https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/deviceDescriptorsSource.json' },
    ],
  },
  {
    device: 'Typical 15.6" 1920×1080 Windows laptop at 125% scaling',
    ppi: laptopPpi,
    dpr: 1.25,
    cssWidth: 1536,
    physicalWidthPx: 1920,
    sources: [
      { what: 'PPI from geometry: √(1920² + 1080²) ÷ 15.6 in = 141.2', url: '' },
      { what: 'devicePixelRatio = physical pixels per CSS pixel, so 125% Windows scaling gives 1.25 (on the bench laptop, 200% scaling of its 2880×1800 panel reads as DPR 2 and a 1440×900 CSS screen in Chrome)', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio' },
    ],
  },
];

export interface ScreenRow extends ScreenSpec {
  cssPxMm: number;
  ratioToNominal: number;
  /** Positive = letters drawn too small by this %, negative = too large. */
  lettersTooSmallPct: number;
}

export function screenRows(): ScreenRow[] {
  return SCREEN_SPECS.map((s) => {
    const cssPxMm = (s.dpr / s.ppi) * 25.4;
    const ratioToNominal = cssPxMm / NOMINAL_MM;
    // Consistency check: CSS width × DPR should be the physical width (within rounding).
    if (Math.abs(s.cssWidth * s.dpr - s.physicalWidthPx) > 3) throw new Error(`${s.device}: CSS width × DPR ≠ physical width`);
    return { ...s, cssPxMm, ratioToNominal, lettersTooSmallPct: (1 - ratioToNominal) * 100 };
  });
}
