import { describe, expect, it } from 'vitest';

import {
  decodeTerrariumElevation,
  encodeTerrariumElevation,
  filterTerrariumTile,
  type DecodedTerrariumTile,
  type TerrariumFilterPolicy,
  type TerrariumTileGrid,
} from '@/infrastructure/elevation/TerrariumDemFilter';

const policy: TerrariumFilterPolicy = {
  minimumElevationMeters: -500,
  maximumElevationMeters: 9_000,
  sentinelElevationsMeters: [-32_768],
  spikeThresholdMeters: 500,
  negativeSpikeThresholdMeters: 300,
  maximumNeighborMadMeters: 80,
  minimumConsensusNeighbors: 5,
  maximumSpikeSupportNeighbors: 1,
  cacheSize: 8,
};

function tile(width = 5, height = 5, elevation = 1_000): DecodedTerrariumTile {
  const data = new Uint8ClampedArray(width * height * 4);
  const [red, green, blue] = encodeTerrariumElevation(elevation);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

function setPixel(
  target: DecodedTerrariumTile,
  x: number,
  y: number,
  elevation: number,
  alpha = 255,
): void {
  const [red, green, blue] = encodeTerrariumElevation(elevation);
  const offset = (y * target.width + x) * 4;
  target.data[offset] = red;
  target.data[offset + 1] = green;
  target.data[offset + 2] = blue;
  target.data[offset + 3] = alpha;
}

function elevationAt(target: DecodedTerrariumTile, x: number, y: number): number {
  const offset = (y * target.width + x) * 4;
  return decodeTerrariumElevation(
    target.data[offset] ?? 0,
    target.data[offset + 1] ?? 0,
    target.data[offset + 2] ?? 0,
  );
}

function grid(center: DecodedTerrariumTile): TerrariumTileGrid {
  return [
    [null, null, null],
    [null, center, null],
    [null, null, null],
  ];
}

describe('filterTerrariumTile', () => {
  it('leaves valid terrain byte-equivalent', () => {
    const source = tile();
    setPixel(source, 2, 2, 1_035.25);

    const result = filterTerrariumTile(grid(source), policy);

    expect(result.tile.data).toEqual(source.data);
    expect(result.counts.repairedCount).toBe(0);
    expect(elevationAt(result.tile, 2, 2)).toBe(1_035.25);
  });

  it('repairs transparent no-data from valid neighboring elevations', () => {
    const source = tile();
    setPixel(source, 2, 2, 0, 0);

    const result = filterTerrariumTile(grid(source), policy);

    expect(elevationAt(result.tile, 2, 2)).toBe(1_000);
    expect(result.tile.data[(2 * source.width + 2) * 4 + 3]).toBe(255);
    expect(result.counts).toMatchObject({ noDataCount: 1, repairedCount: 1 });
  });

  it('repairs an explicit Terrarium sentinel', () => {
    const source = tile();
    setPixel(source, 2, 2, -32_768);

    const result = filterTerrariumTile(grid(source), policy);

    expect(elevationAt(result.tile, 2, 2)).toBe(1_000);
    expect(result.counts).toMatchObject({ sentinelCount: 1, repairedCount: 1 });
  });

  it.each([
    ['positive', 2_000],
    ['negative', 0],
  ])('repairs an isolated %s spike', (_label, elevation) => {
    const source = tile();
    setPixel(source, 2, 2, elevation);

    const result = filterTerrariumTile(grid(source), policy);

    expect(elevationAt(result.tile, 2, 2)).toBe(1_000);
    expect(result.counts).toMatchObject({ spikeCount: 1, repairedCount: 1 });
  });

  it('repairs the observed shallow downward spike while preserving an equivalent rise', () => {
    const downward = tile(5, 5, 635.5);
    setPixel(downward, 2, 2, 320.25);
    const upward = tile(5, 5, 635.5);
    setPixel(upward, 2, 2, 950.75);

    const repaired = filterTerrariumTile(grid(downward), policy);
    const preserved = filterTerrariumTile(grid(upward), policy);

    expect(elevationAt(repaired.tile, 2, 2)).toBe(635.5);
    expect(repaired.counts).toMatchObject({ spikeCount: 1, repairedCount: 1 });
    expect(preserved.tile.data).toEqual(upward.data);
    expect(preserved.counts.spikeCount).toBe(0);
  });

  it('preserves a coherent narrow ridge rather than globally smoothing it', () => {
    const source = tile(7, 7, 0);
    for (let x = 0; x < source.width; x += 1) setPixel(source, x, 3, 1_000);

    const result = filterTerrariumTile(grid(source), policy);

    expect(result.tile.data).toEqual(source.data);
    expect(result.counts.spikeCount).toBe(0);
  });

  it('preserves a coherent downward cliff at the new rejection threshold', () => {
    const source = tile(7, 7, 635.5);
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 3; x < source.width; x += 1) setPixel(source, x, y, 320.25);
    }

    const result = filterTerrariumTile(grid(source), policy);

    expect(result.tile.data).toEqual(source.data);
    expect(result.counts.spikeCount).toBe(0);
  });

  it('uses neighboring tile pixels to repair a corner spike without a seam', () => {
    const center = tile(3, 3);
    const north = tile(3, 3);
    const northWest = tile(3, 3);
    const west = tile(3, 3);
    setPixel(center, 0, 0, 2_000);
    const context: TerrariumTileGrid = [
      [northWest, north, null],
      [west, center, null],
      [null, null, null],
    ];

    const result = filterTerrariumTile(context, policy);

    expect(elevationAt(result.tile, 0, 0)).toBe(1_000);
    expect(result.counts.spikeCount).toBe(1);
  });

  it('repairs the observed impossible scanline without changing adjacent terrain', () => {
    const source = tile(8, 5, 1_100);
    for (let x = 0; x < source.width; x += 1) setPixel(source, x, 2, -700);

    const result = filterTerrariumTile(grid(source), policy);

    expect(result.counts).toMatchObject({ impossibleCount: 8, repairedCount: 8 });
    expect(elevationAt(result.tile, 4, 2)).toBe(1_100);
    expect(elevationAt(result.tile, 4, 1)).toBe(1_100);
  });
});
