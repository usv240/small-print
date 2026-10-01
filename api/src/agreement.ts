import type { Agreement } from './contract';

/**
 * How closely the recommended start strength matches the readers the person already owns.
 * Returns null unless both are known.
 */
export function computeAgreement(startStrength: number | null, existingReaders: number | null): Agreement | null {
  if (startStrength === null || existingReaders === null) return null;
  const diff = Math.abs(startStrength - existingReaders);
  if (diff <= 0.125) return 'exact';
  if (diff <= 0.5) return 'within-half';
  return 'further';
}
