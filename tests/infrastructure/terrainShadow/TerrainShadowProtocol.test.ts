import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isTerrainShadowTileResult,
  type TerrainShadowTileMetrics,
  type TerrainShadowTileRequest,
  terrainShadowTileRequestSchema,
} from '@/infrastructure/terrainShadow/TerrainShadowProtocol';

const request: TerrainShadowTileRequest = {
  z: 12,
  x: 2_541,
  y: 1_514,
  instantMs: Date.UTC(2026, 5, 21, 8, 30),
  tileSize: 512,
  demTileUrl: 'https://tiles.example/{z}/{x}/{y}.webp',
  demMinZoom: 0,
  demMaxZoom: 12,
  shadowColor: [27, 36, 51],
  highlightColor: [255, 247, 230],
  highlightOpacity: 0.6,
  goldenShadowColor: [70, 53, 110],
  lowSunShadowColor: [46, 63, 122],
  lowSunShadowLift: 0.4,
  lowSunGlowOpacity: 0.35,
  alpenglowColor: [240, 163, 184],
  alpenglowOpacity: 0.4,
};

const metrics: TerrainShadowTileMetrics = {
  computeMs: 12,
  demFetchMs: 4,
  cacheHit: false,
  demTilesFetched: 9,
  memoryBytes: 1_048_576,
  cachedMasks: 1,
  cachedDemTiles: 27,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('terrainShadowTileRequestSchema', () => {
  it('accepts a complete tile request', () => {
    expect(terrainShadowTileRequestSchema.parse(request)).toEqual(request);
  });

  it('accepts flat-ground tiles below the DEM minimum zoom, which read no DEM', () => {
    const flat = { ...request, z: 3, x: 0, y: 0, demMinZoom: 5 };
    expect(terrainShadowTileRequestSchema.parse(flat)).toEqual(flat);
  });

  it.each([
    ['an unknown property', { ...request, debug: true }],
    [
      'a non-HTTPS DEM template',
      { ...request, demTileUrl: 'http://tiles.example/{z}/{x}/{y}' },
    ],
    [
      'a DEM template without {y}',
      { ...request, demTileUrl: 'https://tiles.example/{z}/{x}' },
    ],
    ['a zoom beyond the DEM pyramid', { ...request, z: 13, x: 0, y: 0 }],
    ['a column outside the zoom level', { ...request, x: 4_096 }],
    ['a fractional row', { ...request, y: 1.5 }],
    ['a non-finite instant', { ...request, instantMs: Number.NaN }],
    ['a 256 px tile', { ...request, tileSize: 256 }],
    ['a color channel above 255', { ...request, shadowColor: [27, 36, 256] }],
    ['a highlight opacity above 1', { ...request, highlightOpacity: 1.5 }],
    [
      'a relief tile below the DEM minimum zoom',
      { ...request, z: 8, x: 0, y: 0, demMinZoom: 9 },
    ],
    ['an inverted DEM zoom range', { ...request, demMinZoom: 12, demMaxZoom: 10 }],
  ])('rejects %s', (_name, payload) => {
    expect(terrainShadowTileRequestSchema.safeParse(payload).success).toBe(false);
  });
});

describe('isTerrainShadowTileResult', () => {
  it('requires an ImageBitmap and complete metrics', () => {
    class FakeImageBitmap {
      public readonly width = 512;
    }
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const bitmap = new FakeImageBitmap();

    expect(isTerrainShadowTileResult({ bitmap, metrics })).toBe(true);
    expect(isTerrainShadowTileResult({ bitmap: {}, metrics })).toBe(false);
    expect(
      isTerrainShadowTileResult({ bitmap, metrics: { ...metrics, memoryBytes: -1 } }),
    ).toBe(false);
    expect(isTerrainShadowTileResult({ bitmap })).toBe(false);
  });

  it('rejects every result where ImageBitmap does not exist', () => {
    vi.stubGlobal('ImageBitmap', undefined);

    expect(isTerrainShadowTileResult({ bitmap: {}, metrics })).toBe(false);
  });
});
