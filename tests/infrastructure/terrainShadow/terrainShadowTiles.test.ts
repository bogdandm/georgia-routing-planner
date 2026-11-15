import { describe, expect, it } from 'vitest';

import {
  demTileUrl,
  isTerrainShadowNightTile,
  mosaicContainsWithMargin,
  terrainShadowLevelZooms,
  terrainShadowMosaicLevel,
  terrainShadowMosaicSize,
  terrainShadowTileGeometry,
  terrainShadowTileSize,
} from '@/infrastructure/terrainShadow/terrainShadowTiles';

/** Absolute Web Mercator texel of a point at `zoom`, computed independently in doubles. */
function worldTexel(
  longitudeDegrees: number,
  latitudeDegrees: number,
  zoom: number,
): readonly [number, number] {
  const worldSize = 2 ** zoom * terrainShadowTileSize;
  const latitude = (latitudeDegrees * Math.PI) / 180;
  return [
    ((longitudeDegrees + 180) / 360) * worldSize,
    ((1 - Math.log(Math.tan(Math.PI / 4 + latitude / 2)) / Math.PI) / 2) * worldSize,
  ];
}

describe('terrainShadowLevelZooms', () => {
  it('uses z, z − 2, and z − 4 inside the DEM zoom range', () => {
    expect(terrainShadowLevelZooms(12, 0, 12)).toEqual([12, 10, 8]);
  });

  it('clamps coarse levels to the DEM minimum and fine levels to the DEM maximum', () => {
    expect(terrainShadowLevelZooms(7, 6, 12)).toEqual([7, 6, 6]);
    expect(terrainShadowLevelZooms(14, 0, 12)).toEqual([12, 12, 10]);
  });
});

describe('terrainShadowMosaicLevel', () => {
  it('wraps mosaic columns across the antimeridian', () => {
    const level = terrainShadowMosaicLevel({ z: 3, x: 0, y: 4 }, 3);

    expect(level.tiles.map((tile) => tile?.x)).toEqual([7, 0, 1, 7, 0, 1, 7, 0, 1]);
    expect(level.tiles.map((tile) => tile?.y)).toEqual([3, 3, 3, 4, 4, 4, 5, 5, 5]);
  });

  it('marks rows beyond the poles as missing so they render at sea level', () => {
    const north = terrainShadowMosaicLevel({ z: 2, x: 3, y: 0 }, 2);
    const world = terrainShadowMosaicLevel({ z: 0, x: 0, y: 0 }, 0);

    expect(north.tiles.slice(0, 3)).toEqual([null, null, null]);
    expect(north.tiles.slice(3, 6)).toEqual([
      { z: 2, x: 2, y: 0 },
      { z: 2, x: 3, y: 0 },
      { z: 2, x: 0, y: 0 },
    ]);
    expect(world.tiles).toEqual([
      null,
      null,
      null,
      { z: 0, x: 0, y: 0 },
      { z: 0, x: 0, y: 0 },
      { z: 0, x: 0, y: 0 },
      null,
      null,
      null,
    ]);
  });

  it('centers the mosaic on the ancestor of the output tile', () => {
    const level = terrainShadowMosaicLevel({ z: 12, x: 2_541, y: 1_514 }, 10);

    expect(level.tiles[4]).toEqual({ z: 10, x: 635, y: 378 });
    expect(level.outputOriginTexels).toEqual([512 + 128, 512 + 256]);
    expect(level.texelsPerOutputPixel).toBe(0.25);
  });

  it('maps output pixel centers to their absolute Web Mercator mosaic texels', () => {
    const output = { z: 12, x: 2_541, y: 1_514 };
    const geometry = terrainShadowTileGeometry(output);
    const pixel = [137.5, 402.5] as const;
    const longitudeDegrees =
      ((geometry.westLongitudeRadians +
        (geometry.longitudeSpanRadians * pixel[0]) / terrainShadowTileSize) *
        180) /
      Math.PI;
    const mercatorY =
      geometry.northMercatorY -
      (geometry.mercatorYSpan * pixel[1]) / terrainShadowTileSize;
    const latitudeDegrees =
      ((2 * Math.atan(Math.exp(mercatorY)) - Math.PI / 2) * 180) / Math.PI;

    for (const zoom of terrainShadowLevelZooms(output.z, 0, 12)) {
      const level = terrainShadowMosaicLevel(output, zoom);
      const northWest = level.tiles[0];
      if (northWest === null || northWest === undefined) {
        throw new Error('Expected an in-world mosaic corner.');
      }
      const [worldX, worldY] = worldTexel(longitudeDegrees, latitudeDegrees, zoom);
      const mosaicX =
        level.outputOriginTexels[0] + pixel[0] * level.texelsPerOutputPixel;
      const mosaicY =
        level.outputOriginTexels[1] + pixel[1] * level.texelsPerOutputPixel;

      expect(mosaicX).toBeCloseTo(worldX - northWest.x * terrainShadowTileSize, 6);
      expect(mosaicY).toBeCloseTo(worldY - northWest.y * terrainShadowTileSize, 6);
    }
  });

  it('scales radians of longitude to texels of the level', () => {
    const level = terrainShadowMosaicLevel({ z: 12, x: 2_541, y: 1_514 }, 8);

    expect(level.texelsPerRadian * 2 * Math.PI).toBeCloseTo(
      256 * terrainShadowTileSize,
      9,
    );
  });

  it('rejects a level finer than the output tile', () => {
    expect(() => terrainShadowMosaicLevel({ z: 7, x: 0, y: 0 }, 8)).toThrow(RangeError);
  });
});

describe('mosaicContainsWithMargin', () => {
  it('requires one texel of bilinear footprint inside the mosaic', () => {
    const edge = terrainShadowMosaicSize;

    expect(mosaicContainsWithMargin(1, 1)).toBe(true);
    expect(mosaicContainsWithMargin(edge - 1, edge - 1)).toBe(true);
    expect(mosaicContainsWithMargin(0.99, 700)).toBe(false);
    expect(mosaicContainsWithMargin(700, edge - 0.99)).toBe(false);
  });
});

describe('terrainShadowTileGeometry', () => {
  it('returns tile edges in longitude radians and Mercator y', () => {
    expect(terrainShadowTileGeometry({ z: 1, x: 1, y: 1 })).toEqual({
      westLongitudeRadians: 0,
      longitudeSpanRadians: Math.PI,
      northMercatorY: 0,
      mercatorYSpan: Math.PI,
    });
  });
});

describe('demTileUrl', () => {
  it('fills the provider template with the DEM tile address', () => {
    expect(
      demTileUrl('https://tiles.example/{z}/{x}/{y}.webp', { z: 10, x: 635, y: 378 }),
    ).toBe('https://tiles.example/10/635/378.webp');
  });
});

describe('isTerrainShadowNightTile', () => {
  // The z12 tile around Tchkhutkharo; Tbilisi time is UTC+4 and sunset there is 17:45.
  const [x, y] = worldTexel(43.14, 42.71, 12).map((texel) =>
    Math.floor(texel / terrainShadowTileSize),
  ) as [number, number];
  const tile = { z: 12, x, y };
  const tbilisiTime = (hour: number, minute: number) =>
    Date.UTC(2026, 10, 15, hour - 4, minute);

  it('keeps daylight and sunset tiles for the GPU', () => {
    expect(isTerrainShadowNightTile(tile, tbilisiTime(13, 40))).toBe(false);
    expect(isTerrainShadowNightTile(tile, tbilisiTime(17, 46))).toBe(false);
  });

  it('answers tiles well after sunset and before sunrise as night', () => {
    expect(isTerrainShadowNightTile(tile, tbilisiTime(18, 30))).toBe(true);
    expect(isTerrainShadowNightTile(tile, tbilisiTime(6, 30))).toBe(true);
  });
});
