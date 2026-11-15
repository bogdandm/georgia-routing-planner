import { describe, expect, it } from 'vitest';

import { horizonAirMass } from '@/domain/terrain/atmosphericSunlight';
import {
  createShadeLookupTable,
  expandShadeMask,
  shadeBrightnessScale,
  type ShadePalette,
  shadeMaskBytes,
  sunlightAirMassMaximumCode,
  sunlightGridSize,
  sunlightMinimumAirMass,
  sunlightNightCode,
  terrainShadeSkyLightShare,
} from '@/infrastructure/terrainShadow/terrainShadowShaders';
import { terrainShadowTileSize } from '@/infrastructure/terrainShadow/terrainShadowTiles';

const palette: ShadePalette = {
  shadowColor: [27, 36, 51],
  highlightColor: [255, 247, 230],
  highlightOpacity: 0.6,
  lowSunShadowColor: [46, 63, 122],
  lowSunShadowLift: 0.4,
  lowSunGlowOpacity: 0.35,
};
/** Sunlight code of the zenith Sun at sea level (relative air mass 1). */
const zenithCode = Math.round(
  (sunlightAirMassMaximumCode * Math.log(1 / sunlightMinimumAirMass)) /
    Math.log(horizonAirMass / sunlightMinimumAirMass),
);
const horizonCode = sunlightAirMassMaximumCode;

function entryBytes(table: Uint32Array, code: number, shade: number): number[] {
  return [...new Uint8Array(table.buffer, (code * 256 + shade) * 4, 4)];
}

function largestByteDifference(
  left: readonly number[],
  right: readonly number[],
): number {
  return Math.max(...left.map((value, index) => Math.abs(value - (right[index] ?? 0))));
}

describe('createShadeLookupTable', () => {
  const table = createShadeLookupTable(palette);

  it('keeps the plain shadow and highlight for a high Sun', () => {
    expect(entryBytes(table, zenithCode, 127)[3]).toBe(0);
    expect(entryBytes(table, zenithCode, 0)).toEqual([...palette.shadowColor, 255]);
    expect(entryBytes(table, zenithCode, 254)).toEqual([
      ...palette.highlightColor,
      Math.round(0.6 * 255),
    ]);
  });

  it('lifts and cools shadows when the Sun is on the horizon', () => {
    const [red = 0, green = 0, blue = 0, alpha = 0] = entryBytes(table, horizonCode, 0);

    expect(alpha).toBeLessThan(255 * 0.65);
    expect(alpha).toBeGreaterThan(255 * 0.55);
    expect(
      largestByteDifference([red, green, blue], palette.lowSunShadowColor),
    ).toBeLessThanOrEqual(1);
  });

  it('warms sunlit ground and highlights when the Sun is low', () => {
    const [flatRed = 0, , flatBlue = 0, flatAlpha = 0] = entryBytes(
      table,
      horizonCode,
      127,
    );
    const [highlightRed = 0, , highlightBlue = 0, highlightAlpha = 0] = entryBytes(
      table,
      horizonCode,
      254,
    );

    expect(flatAlpha).toBeGreaterThan(0);
    expect(flatRed).toBeGreaterThan(200);
    expect(flatRed - flatBlue).toBeGreaterThan(120);
    expect(highlightRed).toBeGreaterThan(200);
    expect(highlightRed - highlightBlue).toBeGreaterThan(120);
    expect(highlightAlpha).toBeGreaterThan(Math.round(0.6 * 255));
  });

  it('keeps shadow lit only by the sky free of the warm sunlight glow', () => {
    const skyOnly = Math.floor(terrainShadeSkyLightShare * shadeBrightnessScale);
    const [red = 0, green = 0, blue = 0] = entryBytes(table, horizonCode, skyOnly);

    expect(
      largestByteDifference([red, green, blue], palette.lowSunShadowColor),
    ).toBeLessThanOrEqual(1);
  });

  it('continues across the sea-level horizon and returns to the plain night shade', () => {
    expect(
      largestByteDifference(
        entryBytes(table, horizonCode + 1, 60),
        entryBytes(table, horizonCode, 60),
      ),
    ).toBeLessThanOrEqual(3);
    expect(entryBytes(table, sunlightNightCode, 0)).toEqual([
      ...palette.shadowColor,
      255,
    ]);
    expect(entryBytes(table, sunlightNightCode, 127)[3]).toBe(0);
  });
});

describe('expandShadeMask', () => {
  it('pairs each pixel brightness with its bilinearly interpolated sunlight code', () => {
    // An identity table makes every output pixel read back as code × 256 + brightness.
    const identity = Uint32Array.from({ length: 256 * 256 }, (_, index) => index);
    const tilePixels = terrainShadowTileSize * terrainShadowTileSize;
    const mask = new Uint8Array(shadeMaskBytes).fill(7, 0, tilePixels);
    for (let row = 0; row < sunlightGridSize; row += 1) {
      for (let column = 0; column < sunlightGridSize; column += 1) {
        mask[tilePixels + row * sunlightGridSize + column] = 2 * column;
      }
    }
    mask[2] = 200;

    const pixels = new Uint32Array(expandShadeMask(mask, identity).buffer);
    const rowStart = 100 * terrainShadowTileSize;

    expect(pixels).toHaveLength(tilePixels);
    expect(pixels[2]).toBe(200);
    expect(
      [0, 2, 4, 6, 509, 510, 511].map(
        (column) => (pixels[rowStart + column] ?? 0) >> 8,
      ),
    ).toEqual([0, 0, 1, 2, 254, 254, 254]);
    expect((pixels[rowStart + 4] ?? 0) & 0xff).toBe(7);
  });
});
