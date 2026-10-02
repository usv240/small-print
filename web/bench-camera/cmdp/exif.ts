// Minimal JPEG EXIF reader (no dependency): camera model, focal length and focal-plane resolution.
// Reads the APP1 "Exif" segment, IFD0 and the Exif sub-IFD. Enough for the CMDP photos.

import { readFileSync } from 'node:fs';

export interface Exif {
  make?: string;
  model?: string;
  software?: string;
  dateTimeOriginal?: string;
  focalLengthMm?: number;
  /** Pixels per FocalPlaneResolutionUnit on the sensor (horizontal / vertical). */
  focalPlaneXRes?: number;
  focalPlaneYRes?: number;
  /** 2 = inch, 3 = cm, 4 = mm. */
  focalPlaneResUnit?: number;
  pixelXDimension?: number;
  pixelYDimension?: number;
  orientation?: number;
}

export function readExif(path: string): Exif | null {
  const buf = readFileSync(path);
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 < buf.length) {
    if (buf[p] !== 0xff) return null;
    const marker = buf[p + 1];
    if (marker === 0xda || marker === 0xd9) return null; // start of scan: no EXIF before the image data
    const len = buf.readUInt16BE(p + 2);
    if (marker === 0xe1 && buf.toString('latin1', p + 4, p + 10) === 'Exif\0\0') return parseTiff(buf.subarray(p + 10, p + 2 + len));
    p += 2 + len;
  }
  return null;
}

function parseTiff(t: Buffer): Exif {
  const le = t.toString('latin1', 0, 2) === 'II';
  const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const out: Exif = {};
  const readIfd = (off: number): Map<number, { type: number; count: number; valOff: number }> => {
    const m = new Map<number, { type: number; count: number; valOff: number }>();
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      m.set(u16(e), { type: u16(e + 2), count: u32(e + 4), valOff: e + 8 });
    }
    return m;
  };
  const sizeOf: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const value = (en: { type: number; count: number; valOff: number }): number | string => {
    const bytes = (sizeOf[en.type] ?? 1) * en.count;
    const at = bytes > 4 ? u32(en.valOff) : en.valOff;
    switch (en.type) {
      case 2: return t.toString('latin1', at, at + en.count).replace(/\0+$/, '').trim();
      case 3: return u16(at);
      case 4: return u32(at);
      case 5: return u32(at) / u32(at + 4);
      case 10: return (le ? t.readInt32LE(at) : t.readInt32BE(at)) / (le ? t.readInt32LE(at + 4) : t.readInt32BE(at + 4));
      default: return NaN;
    }
  };
  const ifd0 = readIfd(u32(4));
  const get = (m: Map<number, { type: number; count: number; valOff: number }>, tag: number) => (m.has(tag) ? value(m.get(tag)!) : undefined);
  out.make = get(ifd0, 0x010f) as string | undefined;
  out.model = get(ifd0, 0x0110) as string | undefined;
  out.software = get(ifd0, 0x0131) as string | undefined;
  out.orientation = get(ifd0, 0x0112) as number | undefined;
  const exifOff = get(ifd0, 0x8769) as number | undefined;
  if (exifOff) {
    const ex = readIfd(exifOff);
    out.dateTimeOriginal = get(ex, 0x9003) as string | undefined;
    out.focalLengthMm = get(ex, 0x920a) as number | undefined;
    out.focalPlaneXRes = get(ex, 0xa20e) as number | undefined;
    out.focalPlaneYRes = get(ex, 0xa20f) as number | undefined;
    out.focalPlaneResUnit = get(ex, 0xa210) as number | undefined;
    out.pixelXDimension = get(ex, 0xa002) as number | undefined;
    out.pixelYDimension = get(ex, 0xa003) as number | undefined;
  }
  return out;
}

/** Sensor pixels per mm from the EXIF focal-plane resolution (null if absent). */
export function pxPerMm(e: Exif | null): number | null {
  if (!e?.focalPlaneXRes || !e.focalPlaneResUnit) return null;
  const mmPerUnit = e.focalPlaneResUnit === 2 ? 25.4 : e.focalPlaneResUnit === 3 ? 10 : e.focalPlaneResUnit === 4 ? 1 : NaN;
  return e.focalPlaneXRes / mmPerUnit;
}
