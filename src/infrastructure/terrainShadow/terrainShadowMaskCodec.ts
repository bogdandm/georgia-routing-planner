import { deflateSync, inflateSync } from 'fflate';

import {
  type ShadeMask,
  sunlightGridSize,
} from '@/infrastructure/terrainShadow/terrainShadowShaders';
import { terrainShadowTileSize } from '@/infrastructure/terrainShadow/terrainShadowTiles';

const tilePixels = terrainShadowTileSize * terrainShadowTileSize;
const sourceBytes = tilePixels * 4;
/**
 * `full` keeps every binary16 bit for interactively shown tiles. `playback` rounds away
 * three mantissa bits for day-animation frames: real lighting carries per-pixel DEM
 * normal noise, so full binary16 compresses to ~500 KiB per mask, while seven mantissa
 * bits measured ~374 KiB (worst 554 KiB) on z10–z12 day and sunset tiles.
 */
export type ShadeMaskPrecision = 'full' | 'playback';
const playbackDroppedMantissaBits = 3;
const playbackRoundingHalf = 1 << (playbackDroppedMantissaBits - 1);

/** Nonnegative binary16 bits rounded to nearest at seven mantissa bits. */
function playbackHalfBits(bits: number): number {
  // Adding into the mantissa carries into the exponent, which stays monotonic for
  // nonnegative finite values; energies below 20 never round toward infinity.
  return (
    ((bits + playbackRoundingHalf) >>> playbackDroppedMantissaBits) <<
    playbackDroppedMantissaBits
  );
}

/**
 * Cached energies use binary16, not a brightness/color lookup. Model energies stay below
 * 20, far below binary16 overflow. `full` normal values have at most 1/2048 relative
 * error and subnormals 2^-25 absolute; `playback` at most 9/2048 (≈0.44%) and
 * 2^-22 + 2^-25 after its second rounding. Zero stays exact. Four byte planes (direct
 * low/high, sky low/high) keep spatial coherence for DEFLATE; the coarse sunlight grid
 * follows unchanged. GPU computation and colorizing remain float32.
 */
export function compressShadeMask(
  mask: ShadeMask,
  precision: ShadeMaskPrecision,
): Uint8Array {
  const bytes = new Uint8Array(sourceBytes + sunlightGridSize * sunlightGridSize);
  // Reuse one conversion cell instead of allocating a full intermediate half buffer.
  const half = new Float16Array(1);
  const word = new Uint16Array(half.buffer);
  for (let index = 0; index < tilePixels; index += 1) {
    half[0] = mask.direct[index] ?? 0;
    const directBits = word[0] ?? 0;
    const direct = precision === 'full' ? directBits : playbackHalfBits(directBits);
    bytes[index] = direct & 0xff;
    bytes[tilePixels + index] = direct >>> 8;
    half[0] = mask.sky[index] ?? 0;
    const skyBits = word[0] ?? 0;
    const sky = precision === 'full' ? skyBits : playbackHalfBits(skyBits);
    bytes[tilePixels * 2 + index] = sky & 0xff;
    bytes[tilePixels * 3 + index] = sky >>> 8;
  }
  bytes.set(mask.sunlight, sourceBytes);
  return deflateSync(bytes, { level: 1 });
}

/** Restores unclamped source energies, with the sunlight grid preserved losslessly. */
export function expandCompressedShadeMask(compressed: Uint8Array): ShadeMask {
  const bytes = inflateSync(compressed);
  const direct = new Float32Array(tilePixels);
  const sky = new Float32Array(tilePixels);
  const half = new Float16Array(1);
  const word = new Uint16Array(half.buffer);
  for (let index = 0; index < tilePixels; index += 1) {
    word[0] = (bytes[index] ?? 0) | ((bytes[tilePixels + index] ?? 0) << 8);
    direct[index] = half[0] ?? 0;
    word[0] =
      (bytes[tilePixels * 2 + index] ?? 0) |
      ((bytes[tilePixels * 3 + index] ?? 0) << 8);
    sky[index] = half[0] ?? 0;
  }
  // Copy only the small grid, so it never retains the inflated source planes.
  return { direct, sky, sunlight: bytes.slice(sourceBytes) };
}
