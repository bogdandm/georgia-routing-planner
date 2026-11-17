import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  compressShadeMask,
  expandCompressedShadeMask,
} from '@/infrastructure/terrainShadow/terrainShadowMaskCodec';
import type { TerrainShadowTileRequest } from '@/infrastructure/terrainShadow/TerrainShadowProtocol';
import {
  terrainShadowMaskKey,
  TerrainShadowRenderer,
} from '@/infrastructure/terrainShadow/TerrainShadowRenderer';
import * as shadeShaders from '@/infrastructure/terrainShadow/terrainShadowShaders';

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
  alpenglowColor: [240, 163, 184],
  alpenglowOpacity: 0.6,
  neutralBrightness: 1.45,
  exposure: 0,
  shadowStrength: 2,
  highlightRolloff: 2,
  lighting: {
    skyLightShare: 0.35,
    skyOcclusionStrength: 1.75,
    nightSkyLight: 0.6,
    nightTopLight: 0,
    nightTopLightFocus: 2,
    diffuseSkyFraction: 0.5,
    softEdgeSigmaPixels: 1,
  },
};

describe('terrainShadowMaskKey', () => {
  it('reuses source-energy masks for every palette and tone-mapping change', () => {
    const recolored: TerrainShadowTileRequest = {
      ...request,
      shadowColor: [0, 0, 0],
      highlightColor: [255, 255, 255],
      highlightOpacity: 0.1,
      goldenShadowColor: [44, 35, 80],
      lowSunShadowColor: [30, 40, 70],
      alpenglowColor: [255, 180, 195],
      alpenglowOpacity: 0,
      neutralBrightness: 1.1,
      exposure: 1,
      shadowStrength: 3,
      highlightRolloff: 0.5,
    };
    expect(terrainShadowMaskKey(recolored, false)).toBe(
      terrainShadowMaskKey(request, false),
    );
  });

  it('keeps masks for distinct DEM sources and tile coordinates separate', () => {
    const key = terrainShadowMaskKey(request, false);
    expect(
      terrainShadowMaskKey(
        { ...request, demTileUrl: 'https://other.example/{z}/{x}/{y}.webp' },
        false,
      ),
    ).not.toBe(key);
    expect(terrainShadowMaskKey({ ...request, x: request.x + 1 }, false)).not.toBe(key);
    expect(terrainShadowMaskKey({ ...request, y: request.y + 1 }, false)).not.toBe(key);
    expect(terrainShadowMaskKey({ ...request, z: request.z + 1 }, false)).not.toBe(key);
  });

  it.each([
    'skyLightShare',
    'skyOcclusionStrength',
    'nightSkyLight',
    'nightTopLight',
    'nightTopLightFocus',
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TerrainShadowRenderer', () => {
  it('reuses separate plain-night source arrays and accounts for cached colorizers', async () => {
    vi.stubGlobal(
      'ImageData',
      class {
        public constructor(
          public readonly data: Uint8ClampedArray,
          public readonly width: number,
          public readonly height: number,
        ) {}
      },
    );
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close: vi.fn() }));
    const colorizers = vi.spyOn(shadeShaders, 'createShadeColorizer');
    const expansions = vi.spyOn(shadeShaders, 'expandShadeMask');
    const nightRequest: TerrainShadowTileRequest = {
      ...request,
      instantMs: Date.UTC(2026, 11, 21, 21),
      lighting: { ...request.lighting, nightSkyLight: 0, nightTopLight: 0 },
    };
    const renderer = new TerrainShadowRenderer();
    const signal = new AbortController().signal;
    try {
      const first = await renderer.render(nightRequest, signal);
      const recolored = await renderer.render(
        { ...nightRequest, alpenglowColor: [255, 190, 200] },
        signal,
      );
      const restored = await renderer.render(nightRequest, signal);
      const mask = expansions.mock.calls[0]?.[0];
      expect(mask?.direct).toBeInstanceOf(Float32Array);
      expect(mask?.sky).toBeInstanceOf(Float32Array);
      expect(mask?.direct).toHaveLength(512 * 512);
      expect(mask?.sky).toHaveLength(512 * 512);
      expect(mask?.direct.every((energy) => energy === 0)).toBe(true);
      expect(mask?.sky.every((energy) => energy === 0)).toBe(true);
      expect(mask?.sunlight).toHaveLength(128 * 128);
      expect(
        mask?.sunlight.every((code) => code === shadeShaders.sunlightNightCode),
      ).toBe(true);
      expect(expansions.mock.calls[1]?.[0]).toBe(mask);
      expect(expansions.mock.calls[2]?.[0]).toBe(mask);
      expect(colorizers).toHaveBeenCalledTimes(2);
      const colorizerBytes = 256 * 6 * Float32Array.BYTES_PER_ELEMENT;
      expect(first.metrics).toMatchObject({
        cacheHit: true,
        cachedMasks: 0,
        cachedDemTiles: 0,
        memoryBytes: colorizerBytes,
      });
      expect(recolored.metrics.memoryBytes).toBe(2 * colorizerBytes);
      expect(restored.metrics.memoryBytes).toBe(2 * colorizerBytes);
      expect(expansions.mock.calls[2]?.[1]).toBe(expansions.mock.calls[0]?.[1]);
    } finally {
      renderer.dispose();
    }
    await expect(renderer.prefetch(nightRequest, signal)).rejects.toThrow(
      'The terrain shadow renderer was disposed.',
    );
  });
});

describe('compact terrain source-energy masks', () => {
  it.each([
    ['full', 1 / 2048, 2 ** -25],
    // float32 → binary16 → seven mantissa bits: two roundings, 1/256 + 1/2048.
    ['playback', 9 / 2048, 2 ** -22 + 2 ** -25],
  ] as const)(
    'preserves unclamped HDR energies at %s precision and sunlight losslessly',
    (precision, relativeBound, absoluteBound) => {
      const energies = [
        0,
        2 ** -26,
        2 ** -25,
        3 * 2 ** -25,
        2 ** -14,
        0.0001,
        0.35,
        1,
        1.003,
        2,
        10,
        19.75,
      ];
      const direct = Float32Array.from(
        { length: 512 * 512 },
        (_value, index) => energies[index % energies.length] ?? 0,
      );
      const sky = Float32Array.from(
        { length: 512 * 512 },
        (_value, index) => energies[(index + 5) % energies.length] ?? 0,
      );
      const sunlight = Uint8Array.from(
        { length: 128 * 128 },
        (_value, index) => index % 256,
      );
      const compressed = compressShadeMask({ direct, sky, sunlight }, precision);
      const restored = expandCompressedShadeMask(compressed);
      let maximumNormalRelativeError = 0;
      let maximumSubnormalAbsoluteError = 0;
      for (const [source, result] of [
        [direct, restored.direct],
        [sky, restored.sky],
      ] as const) {
        for (let index = 0; index < source.length; index += 1) {
          const energy = source[index] ?? 0;
          const error = Math.abs((result[index] ?? 0) - energy);
          if (energy >= 2 ** -14) {
            maximumNormalRelativeError = Math.max(
              maximumNormalRelativeError,
              error / energy,
            );
          } else {
            maximumSubnormalAbsoluteError = Math.max(
              maximumSubnormalAbsoluteError,
              error,
            );
          }
        }
      }
      expect(maximumNormalRelativeError).toBeLessThanOrEqual(relativeBound);
      expect(maximumSubnormalAbsoluteError).toBeLessThanOrEqual(absoluteBound);
      expect(restored.direct[0]).toBe(0);
      expect(restored.direct[1]).toBe(0);
      expect(restored.direct[11]).toBe(19.75);
      expect(restored.sunlight).toEqual(sunlight);
      expect(restored.sunlight.buffer.byteLength).toBe(sunlight.byteLength);
      // This repetitive synthetic fixture proves the codec path, not real-scene capacity.
      expect(compressed.byteLength).toBeLessThan(64 * 1024);
    },
  );
});
