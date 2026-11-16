import { describe, expect, it } from 'vitest';

import { horizonAirMass } from '@/domain/terrain/atmosphericSunlight';
import {
  createFlatShadeMask,
  createShadeLookupTable,
  defaultShadeLighting,
  expandShadeMask,
  shadeNeutralBrightness,
  shadeBrightnessScale,
  type ShadePalette,
  shadeMaskBytes,
  sunlightAirMassMaximumCode,
  sunlightGridSize,
  sunlightMinimumAirMass,
  sunlightNightCode,
  terrainShadeNightSkyLight,
  terrainShadeSkyLightShare,
} from '@/infrastructure/terrainShadow/terrainShadowShaders';
import { terrainShadowTileSize } from '@/infrastructure/terrainShadow/terrainShadowTiles';

const palette: ShadePalette = {
  shadowColor: [27, 36, 51],
  highlightColor: [255, 247, 230],
  highlightOpacity: 0.6,
  goldenShadowColor: [70, 53, 110],
  lowSunShadowColor: [46, 63, 122],
  lowSunShadowLift: 0.4,
  lowSunGlowOpacity: 0.35,
  alpenglowColor: [240, 163, 184],
  alpenglowOpacity: 0.4,
  neutralBrightness: shadeNeutralBrightness,
  sunlightTintStrength: 0.75,
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
  const table = createShadeLookupTable(palette, terrainShadeSkyLightShare);
  const neutralByte = Math.round(shadeNeutralBrightness * shadeBrightnessScale);

  it('keeps the plain shadow and highlight for a high Sun around a neutral above full sun', () => {
    // The neutral falls between two bytes, so its nearest byte is clear to one unit.
    expect(entryBytes(table, zenithCode, neutralByte)[3]).toBeLessThanOrEqual(1);
    // Flat ground in full sun keeps a light shade, so lit slopes can still brighten.
    const [, , , flatAlpha = 0] = entryBytes(table, zenithCode, shadeBrightnessScale);
    expect(flatAlpha).toBeGreaterThan(0);
    expect(flatAlpha).toBeLessThanOrEqual(
      Math.ceil(255 * (1 - 1 / shadeNeutralBrightness)),
    );
    expect(entryBytes(table, zenithCode, 0)).toEqual([...palette.shadowColor, 255]);
    expect(entryBytes(table, zenithCode, 254)).toEqual([
      ...palette.highlightColor,
      Math.round(0.6 * 255),
    ]);
  });

  it('lifts shadows and turns them lilac when the Sun is on the horizon', () => {
    const [red = 0, green = 0, blue = 0, alpha = 0] = entryBytes(table, horizonCode, 0);

    expect(alpha).toBeLessThan(255 * 0.65);
    expect(alpha).toBeGreaterThan(255 * 0.55);
    expect(
      largestByteDifference([red, green, blue], palette.goldenShadowColor),
    ).toBeLessThanOrEqual(1);
  });

  it('turns shadows deep blue in the middle of civil twilight', () => {
    // The twilight codes span an even count, so the nearest code is half a step away.
    const middleTwilightCode = Math.round((horizonCode + 1 + sunlightNightCode) / 2);
    const [red = 0, green = 0, blue = 0] = entryBytes(table, middleTwilightCode, 0);

    expect(
      largestByteDifference([red, green, blue], palette.lowSunShadowColor),
    ).toBeLessThanOrEqual(2);
  });

  it('warms slopes lit by a low Sun and their highlights', () => {
    const [litRed = 0, , litBlue = 0, litAlpha = 0] = entryBytes(
      table,
      horizonCode,
      neutralByte,
    );
    const [highlightRed = 0, , highlightBlue = 0, highlightAlpha = 0] = entryBytes(
      table,
      horizonCode,
      254,
    );

    expect(litAlpha).toBeGreaterThan(0);
    expect(litRed).toBeGreaterThan(200);
    expect(litRed - litBlue).toBeGreaterThan(120);
    expect(highlightRed).toBeGreaterThan(200);
    expect(highlightRed - highlightBlue).toBeGreaterThan(120);
    expect(highlightAlpha).toBeGreaterThan(litAlpha);
  });

  it('keeps shadow lit only by the sky free of the warm sunlight glow', () => {
    const skyOnly = Math.floor(terrainShadeSkyLightShare * shadeBrightnessScale);
    const [red = 0, green = 0, blue = 0] = entryBytes(table, horizonCode, skyOnly);

    expect(
      largestByteDifference([red, green, blue], palette.goldenShadowColor),
    ).toBeLessThanOrEqual(1);
  });

  it('glows rose on open slopes in early twilight but not in gorges or at night', () => {
    const earlyTwilightCode =
      horizonCode + 1 + Math.round(0.15 * (sunlightNightCode - horizonCode - 1));
    const openSlope = Math.floor(terrainShadeSkyLightShare * shadeBrightnessScale);
    const redOverBlue = (code: number, shade: number) => {
      const [red = 0, , blue = 0] = entryBytes(table, code, shade);
      return red - blue;
    };

    // Rose is composited over the twilight shade, so it shifts the hue rather than replacing it.
    expect(redOverBlue(earlyTwilightCode, openSlope)).toBeGreaterThan(
      redOverBlue(earlyTwilightCode, 4) + 25,
    );
    expect(redOverBlue(earlyTwilightCode, openSlope)).toBeGreaterThan(
      redOverBlue(sunlightNightCode, openSlope) + 25,
    );
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
    expect(entryBytes(table, sunlightNightCode, neutralByte)[3]).toBeLessThanOrEqual(1);
  });

  it('moves the untouched neutral and the sky-only shade with the tuned values', () => {
    const tuned = createShadeLookupTable({ ...palette, neutralBrightness: 1 }, 0.5);
    // A neutral at full sun leaves flat ground in full sun untouched.
    expect(entryBytes(tuned, zenithCode, shadeBrightnessScale)[3]).toBe(0);
    // Half of full sun is now lit by the sky alone, so the low Sun adds no warm glow.
    const halfSun = Math.floor(0.5 * shadeBrightnessScale);
    const [red = 0, green = 0, blue = 0] = entryBytes(tuned, horizonCode, halfSun);
    expect(
      largestByteDifference([red, green, blue], palette.goldenShadowColor),
    ).toBeLessThanOrEqual(1);
    const [defaultRed = 0, , defaultBlue = 0] = entryBytes(table, horizonCode, halfSun);
    expect(defaultRed - defaultBlue).toBeGreaterThan(red - blue);
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

describe('createFlatShadeMask', () => {
  // The z6 tile around Tbilisi: 39.4°–45° E, 41°–45.1° N.
  const tile = { z: 6, x: 39, y: 23 };
  const tilePixels = terrainShadowTileSize * terrainShadowTileSize;
  const codes = (mask: Uint8Array) => [...mask.subarray(tilePixels)];
  const brightness = (mask: Uint8Array) => [...mask.subarray(0, tilePixels)];

  it('shades flat ground in full sun as the neutral level and night by the night sky', () => {
    const noon = createFlatShadeMask(
      tile,
      Date.UTC(2026, 6, 1, 8, 30),
      defaultShadeLighting,
    );
    expect(new Set(brightness(noon))).toEqual(new Set([shadeBrightnessScale]));
    expect(Math.max(...codes(noon))).toBeLessThan(sunlightAirMassMaximumCode / 2);

    const night = createFlatShadeMask(
      tile,
      Date.UTC(2026, 6, 1, 22),
      defaultShadeLighting,
    );
    expect(new Set(brightness(night))).toEqual(
      new Set([
        Math.round(
          terrainShadeSkyLightShare * terrainShadeNightSkyLight * shadeBrightnessScale,
        ),
      ]),
    );
    expect(new Set(codes(night))).toEqual(new Set([sunlightNightCode]));
  });

  it('darkens and reddens toward the east while the Sun sets across the tile', () => {
    const mask = createFlatShadeMask(
      tile,
      Date.UTC(2026, 6, 1, 17),
      defaultShadeLighting,
    );
    const middleRow = (terrainShadowTileSize / 2) * terrainShadowTileSize;
    const middleGridRow = tilePixels + (sunlightGridSize / 2) * sunlightGridSize;

    // The western edge still has a low Sun; the eastern one is past the sea-level sunset.
    expect(mask[middleRow] ?? 0).toBeGreaterThan(terrainShadeSkyLightShare * 127);
    expect(mask[middleRow + terrainShadowTileSize - 1] ?? 255).toBeLessThan(
      terrainShadeSkyLightShare * 127,
    );
    expect(mask[middleGridRow] ?? 255).toBeLessThanOrEqual(sunlightAirMassMaximumCode);
    expect(mask[middleGridRow + sunlightGridSize - 1] ?? 0).toBeGreaterThan(
      sunlightAirMassMaximumCode,
    );
  });

  it('takes the night sky and the sky-light share from the given lighting', () => {
    const nightMs = Date.UTC(2026, 6, 1, 22);
    const dark = createFlatShadeMask(tile, nightMs, {
      skyLightShare: terrainShadeSkyLightShare,
      nightSkyLight: 0,
    });
    expect(new Set(brightness(dark))).toEqual(new Set([0]));
    const brighter = createFlatShadeMask(tile, nightMs, {
      skyLightShare: 0.5,
      nightSkyLight: 1,
    });
    expect(new Set(brightness(brighter))).toEqual(
      new Set([Math.round(0.5 * shadeBrightnessScale)]),
    );
  });
});
