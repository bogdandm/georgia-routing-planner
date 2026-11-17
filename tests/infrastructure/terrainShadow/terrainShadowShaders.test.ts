import { describe, expect, it } from 'vitest';

import { horizonAirMass } from '@/domain/terrain/atmosphericSunlight';
import {
  createFlatShadeMask,
  createShadeColorizer,
  defaultShadeLighting,
  expandShadeMask,
  type ShadeMask,
  type ShadePalette,
  sunlightAirMassMaximumCode,
  sunlightGridSize,
  sunlightMinimumAirMass,
  sunlightNightCode,
} from '@/infrastructure/terrainShadow/terrainShadowShaders';
import { terrainShadowTileSize } from '@/infrastructure/terrainShadow/terrainShadowTiles';

const tilePixels = terrainShadowTileSize ** 2;
const zenithCode = Math.round(
  (sunlightAirMassMaximumCode * Math.log(1 / sunlightMinimumAirMass)) /
    Math.log(horizonAirMass / sunlightMinimumAirMass),
);
const palette: ShadePalette = {
  shadowColor: [255, 255, 255],
  highlightColor: [255, 255, 255],
  highlightOpacity: 0.8,
  goldenShadowColor: [255, 255, 255],
  lowSunShadowColor: [255, 255, 255],
  alpenglowColor: [240, 163, 184],
  alpenglowOpacity: 0,
  neutralBrightness: 1,
  exposure: 0,
  shadowStrength: 2,
  highlightRolloff: 2,
};

function uniformMask(direct: number, sky: number, code = zenithCode): ShadeMask {
  return {
    direct: new Float32Array(tilePixels).fill(direct),
    sky: new Float32Array(tilePixels).fill(sky),
    sunlight: new Uint8Array(sunlightGridSize ** 2).fill(code),
  };
}

/** Actual straight-alpha composition over the model's reference grey surface. */
function composite(mask: ShadeMask, colors: ShadePalette = palette): number[] {
  const [red = 0, green = 0, blue = 0, alphaByte = 0] = expandShadeMask(
    mask,
    createShadeColorizer(colors, defaultShadeLighting.skyLightShare),
  );
  const alpha = alphaByte / 255;
  return [red, green, blue].map((value) => value * alpha + 127.5 * (1 - alpha));
}

describe('separated linear lighting composition', () => {
  it('renders no illumination black and unit neutral illumination as reference grey', () => {
    expect(composite(uniformMask(0, 0))).toEqual([0, 0, 0]);
    for (const channel of composite(uniformMask(0, 1))) {
      expect(channel).toBeCloseTo(127.5, 0);
    }
  });

  it('keeps open flat daylight neutral with a colored sky instead of dimming plains', () => {
    const colors = {
      ...palette,
      shadowColor: [25, 53, 93] as const,
      highlightColor: [255, 247, 230] as const,
    };
    const open = uniformMask(0.55, 0.45);
    const shaded = uniformMask(0, 0.45);
    for (const channel of composite(open, colors)) {
      expect(Math.abs(channel - 127.5)).toBeLessThan(1);
    }
    expect(composite(shaded, colors)[0]).toBeLessThan(100);
  });

  it('keeps solar color only in the actual direct contribution, even for equal total energy', () => {
    const skyOnly = composite(uniformMask(0, 1, sunlightAirMassMaximumCode));
    const sunOnly = composite(uniformMask(1, 0, sunlightAirMassMaximumCode));
    const mixed = composite(uniformMask(0.5, 0.5, sunlightAirMassMaximumCode));
    expect(skyOnly[0]).toBeCloseTo(skyOnly[2] ?? 0, 0);
    expect(sunOnly[0]).toBeGreaterThan((sunOnly[2] ?? 0) + 80);
    expect(mixed[2]).toBeGreaterThan(sunOnly[2] ?? 0);
    expect(mixed[2]).toBeLessThan(skyOnly[2] ?? 0);
  });

  it('adds source energies before applying the nonlinear display transfer', () => {
    const direct = uniformMask(0.5, 0, sunlightAirMassMaximumCode);
    const sky = uniformMask(0, 0.5, sunlightAirMassMaximumCode);
    const together = composite(uniformMask(0.5, 0.5, sunlightAirMassMaximumCode));
    const separateSun = composite(direct);
    const separateSky = composite(sky);
    expect(
      Math.abs((together[0] ?? 0) - (separateSun[0] ?? 0) - (separateSky[0] ?? 0)),
    ).toBeGreaterThan(10);
  });

  it('applies a common fixed EV exposure to both sources, without clipping HDR energies', () => {
    const mask = uniformMask(0.7, 0.3, sunlightAirMassMaximumCode);
    expect(composite(mask, { ...palette, exposure: 1 })).toEqual(
      composite(uniformMask(1.4, 0.6, sunlightAirMassMaximumCode)),
    );
    const highlights = [1, 2, 8, 64].map(
      (energy) => composite(uniformMask(0, energy))[0] ?? 0,
    );
    for (let index = 1; index < highlights.length; index += 1) {
      expect(highlights[index]).toBeGreaterThan(highlights[index - 1] ?? 0);
    }
    expect(highlights[3]).toBeLessThan(255);
  });

  it('keeps twilight alpenglow in the occluded sky source instead of creating a fill', () => {
    const code = sunlightAirMassMaximumCode + 6;
    const rose = { ...palette, alpenglowOpacity: 1 };
    expect(composite(uniformMask(0, 0, code), rose)).toEqual([0, 0, 0]);
    const neutral = composite(uniformMask(0, 0.5, code));
    const open = composite(uniformMask(0, 0.5, code), rose);
    expect(open[1]).toBeLessThan(neutral[1] ?? 0);
    expect(open[0]).toBeCloseTo(neutral[0] ?? 0, 0);
    expect(composite(uniformMask(0.5, 0, code), rose)).toEqual(
      composite(uniformMask(0.5, 0, code)),
    );
    expect(composite(uniformMask(0, 0.5, sunlightNightCode), rose)).toEqual(
      composite(uniformMask(0, 0.5, sunlightNightCode)),
    );
  });

  it('crosses neutral continuously rather than cutting out the sunset chromaticity', () => {
    let previous = composite(uniformMask(0.8, 0.2, sunlightAirMassMaximumCode));
    for (let direct = 0.81; direct < 1.2; direct += 0.01) {
      const next = composite(uniformMask(direct, 0.2, sunlightAirMassMaximumCode));
      expect(next[0]).toBeGreaterThan((next[2] ?? 0) + 30);
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs((next[channel] ?? 0) - (previous[channel] ?? 0))).toBeLessThan(
          4,
        );
      }
      previous = next;
    }
  });
});

describe('flat-ground linear masks', () => {
  const tile = { z: 6, x: 39, y: 23 };
  const noonMs = Date.UTC(2026, 6, 1, 8, 30);
  const nightMs = Date.UTC(2026, 6, 1, 22);

  it('preserves separate full-day sources and zero direct sunlight at night', () => {
    const noon = createFlatShadeMask(tile, noonMs, defaultShadeLighting);
    expect(noon.direct[0]).toBeCloseTo(1 - defaultShadeLighting.skyLightShare, 6);
    expect(noon.sky[0]).toBeCloseTo(defaultShadeLighting.skyLightShare, 6);
    const night = createFlatShadeMask(tile, nightMs, defaultShadeLighting);
    expect(night.direct.every((value) => value === 0)).toBe(true);
    expect(night.sky[0]).toBeCloseTo(
      defaultShadeLighting.skyLightShare * defaultShadeLighting.nightSkyLight +
        defaultShadeLighting.nightTopLight,
      6,
    );
    expect(night.sunlight.every((code) => code === sunlightNightCode)).toBe(true);
  });

  it('sets the direct source across the local sunset while keeping sky illumination', () => {
    const mask = createFlatShadeMask(
      tile,
      Date.UTC(2026, 6, 1, 17),
      defaultShadeLighting,
    );
    const row = (terrainShadowTileSize / 2) * terrainShadowTileSize;
    expect(mask.direct[row]).toBeGreaterThan(0);
    expect(mask.direct[row + terrainShadowTileSize - 1]).toBe(0);
    expect(mask.sky[row + terrainShadowTileSize - 1]).toBeGreaterThan(0);
  });

  it('retains overhead energy above one without changing daylight illumination', () => {
    const lighting = { skyLightShare: 0.5, nightSkyLight: 0, nightTopLight: 8 };
    const night = createFlatShadeMask(tile, nightMs, lighting);
    expect(night.sky.every((value) => value === 8)).toBe(true);
    expect(createFlatShadeMask(tile, noonMs, lighting)).toEqual(
      createFlatShadeMask(tile, noonMs, { ...lighting, nightTopLight: 0 }),
    );
  });

  it('supports isolated sources at both sky-share endpoints', () => {
    const direct = createFlatShadeMask(tile, noonMs, {
      ...defaultShadeLighting,
      skyLightShare: 0,
    });
    const sky = createFlatShadeMask(tile, noonMs, {
      ...defaultShadeLighting,
      skyLightShare: 1,
    });
    expect(direct.sky.every((value) => value === 0)).toBe(true);
    expect(direct.direct.every((value) => value === 1)).toBe(true);
    expect(sky.direct.every((value) => value === 0)).toBe(true);
    expect(sky.sky.every((value) => value === 1)).toBe(true);
  });
});
