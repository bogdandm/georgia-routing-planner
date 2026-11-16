import { describe, expect, it } from 'vitest';

import type { TerrainShadowTileRequest } from '@/infrastructure/terrainShadow/TerrainShadowProtocol';
import { terrainShadowMaskKey } from '@/infrastructure/terrainShadow/TerrainShadowRenderer';

const request: TerrainShadowTileRequest = {
  z: 12,
  x: 2_541,
  y: 1_514,
  instantMs: Date.UTC(2026, 5, 21, 8, 30),
  tileSize: 512,
  demTileUrl: 'https://tiles.example/{z}/{x}/{y}.webp',
  demMinZoom: 0,
  demMaxZoom: 12,
  shadowColor: [28, 42, 64],
  highlightColor: [255, 247, 230],
  highlightOpacity: 0.6,
  goldenShadowColor: [70, 53, 110],
  lowSunShadowColor: [46, 63, 122],
  lowSunShadowLift: 0.25,
  lowSunGlowOpacity: 0.5,
  alpenglowColor: [240, 163, 184],
  alpenglowOpacity: 0.6,
  neutralBrightness: 1.45,
  sunlightTintStrength: 0.75,
  lighting: {
    skyLightShare: 0.35,
    skyOcclusionStrength: 1.75,
    nightSkyLight: 0.6,
    diffuseSkyFraction: 0.5,
    softEdgeSigmaPixels: 1,
  },
};

describe('terrainShadowMaskKey', () => {
  it('reuses a mask for every palette, since colors only change the lookup table', () => {
    const recolored: TerrainShadowTileRequest = {
      ...request,
      shadowColor: [0, 0, 0],
      highlightOpacity: 0.1,
      lowSunShadowLift: 0.9,
      alpenglowOpacity: 0,
      neutralBrightness: 1.1,
      sunlightTintStrength: 0,
    };
    expect(terrainShadowMaskKey(recolored, false)).toBe(
      terrainShadowMaskKey(request, false),
    );
  });

  it.each([
    'skyLightShare',
    'skyOcclusionStrength',
    'nightSkyLight',
    'diffuseSkyFraction',
    'softEdgeSigmaPixels',
  ] as const)('recomputes a mask when the shade-pass %s changes', (name) => {
    const relit = { ...request, lighting: { ...request.lighting, [name]: 0.42 } };
    expect(terrainShadowMaskKey(relit, false)).not.toBe(
      terrainShadowMaskKey(request, false),
    );
  });

  it('keys masks by minute by day and shares one mask across the night', () => {
    const later = { ...request, instantMs: request.instantMs + 30_000 };
    const nextMinute = { ...request, instantMs: request.instantMs + 60_000 };
    expect(terrainShadowMaskKey(later, false)).toBe(
      terrainShadowMaskKey(request, false),
    );
    expect(terrainShadowMaskKey(nextMinute, false)).not.toBe(
      terrainShadowMaskKey(request, false),
    );
    expect(terrainShadowMaskKey(nextMinute, true)).toBe(
      terrainShadowMaskKey(request, true),
    );
  });
});
