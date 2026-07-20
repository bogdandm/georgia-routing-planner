import {
  decodeTerrariumElevation,
  encodeTerrariumElevation,
  type DecodedTerrariumTile,
  type FilteredTerrariumTile,
  type TerrariumFilterPolicy,
  type TerrariumTileGrid,
} from '../../src/infrastructure/elevation/TerrariumDemFilter';

type RejectionReason = 'no-data' | 'sentinel' | 'impossible' | 'spike';

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? upper) + upper) / 2 : upper;
}

function pixelOffset(tile: DecodedTerrariumTile, x: number, y: number): number {
  return (y * tile.width + x) * 4;
}

function validateTile(tile: DecodedTerrariumTile, width: number, height: number): void {
  if (
    tile.width !== width ||
    tile.height !== height ||
    tile.data.length !== width * height * 4
  ) {
    throw new RangeError('Terrarium context tiles must have matching RGBA dimensions.');
  }
}

function contextPixel(
  grid: TerrariumTileGrid,
  centerWidth: number,
  centerHeight: number,
  x: number,
  y: number,
): readonly [number, number, number, number] | null {
  const column = x < 0 ? 0 : x >= centerWidth ? 2 : 1;
  const row = y < 0 ? 0 : y >= centerHeight ? 2 : 1;
  const tile = grid[row][column];
  if (tile === null) return null;
  const localX = x < 0 ? x + centerWidth : x >= centerWidth ? x - centerWidth : x;
  const localY = y < 0 ? y + centerHeight : y >= centerHeight ? y - centerHeight : y;
  const offset = pixelOffset(tile, localX, localY);
  const red = tile.data[offset];
  const green = tile.data[offset + 1];
  const blue = tile.data[offset + 2];
  const alpha = tile.data[offset + 3];
  return red === undefined ||
    green === undefined ||
    blue === undefined ||
    alpha === undefined
    ? null
    : [red, green, blue, alpha];
}

function hardRejectionReason(
  pixel: readonly [number, number, number, number],
  policy: TerrariumFilterPolicy,
): Exclude<RejectionReason, 'spike'> | null {
  if (pixel[3] === 0) return 'no-data';
  const elevation = decodeTerrariumElevation(pixel[0], pixel[1], pixel[2]);
  if (
    policy.sentinelElevationsMeters.some(
      (sentinel) => Math.abs(elevation - sentinel) < 1 / 256,
    )
  ) {
    return 'sentinel';
  }
  return elevation < policy.minimumElevationMeters ||
    elevation > policy.maximumElevationMeters
    ? 'impossible'
    : null;
}

function validNeighborElevations(
  grid: TerrariumTileGrid,
  width: number,
  height: number,
  x: number,
  y: number,
  policy: TerrariumFilterPolicy,
): number[] {
  const elevations: number[] = [];
  for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
    for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
      if (deltaX === 0 && deltaY === 0) continue;
      const pixel = contextPixel(grid, width, height, x + deltaX, y + deltaY);
      if (pixel === null || hardRejectionReason(pixel, policy) !== null) continue;
      elevations.push(decodeTerrariumElevation(pixel[0], pixel[1], pixel[2]));
    }
  }
  return elevations;
}

function spikeRejectionReason(
  elevation: number,
  neighbors: readonly number[],
  policy: TerrariumFilterPolicy,
): 'spike' | null {
  if (neighbors.length < policy.minimumConsensusNeighbors) return null;
  const neighborMedian = median(neighbors);
  const deviations = neighbors.map((value) => Math.abs(value - neighborMedian));
  const medianAbsoluteDeviation = median(deviations);
  const consensusCount = deviations.filter(
    (value) => value <= policy.maximumNeighborMadMeters,
  ).length;
  const supportCount = neighbors.filter(
    (value) => Math.abs(value - elevation) <= policy.maximumNeighborMadMeters,
  ).length;
  const residual = elevation - neighborMedian;
  const threshold =
    residual < 0 ? policy.negativeSpikeThresholdMeters : policy.spikeThresholdMeters;
  return Math.abs(residual) >= threshold &&
    medianAbsoluteDeviation <= policy.maximumNeighborMadMeters &&
    consensusCount >= policy.minimumConsensusNeighbors &&
    supportCount <= policy.maximumSpikeSupportNeighbors
    ? 'spike'
    : null;
}

/** Frozen pre-optimization behavior used only as a correctness oracle. */
export function referenceFilterTerrariumTile(
  grid: TerrariumTileGrid,
  policy: TerrariumFilterPolicy,
): FilteredTerrariumTile {
  const center = grid[1][1];
  for (const row of grid) {
    for (const tile of row) {
      if (tile !== null) validateTile(tile, center.width, center.height);
    }
  }
  const output = new Uint8ClampedArray(center.data);
  const reasons = Array.from(
    { length: center.width * center.height },
    (): RejectionReason | null => null,
  );
  const counts = {
    noDataCount: 0,
    sentinelCount: 0,
    impossibleCount: 0,
    spikeCount: 0,
    repairedCount: 0,
    unrepairedCount: 0,
  };

  for (let y = 0; y < center.height; y += 1) {
    for (let x = 0; x < center.width; x += 1) {
      const offset = pixelOffset(center, x, y);
      const pixel = contextPixel(grid, center.width, center.height, x, y);
      if (pixel === null) continue;
      const hardReason = hardRejectionReason(pixel, policy);
      const elevation = decodeTerrariumElevation(pixel[0], pixel[1], pixel[2]);
      const neighbors = validNeighborElevations(
        grid,
        center.width,
        center.height,
        x,
        y,
        policy,
      );
      const reason = hardReason ?? spikeRejectionReason(elevation, neighbors, policy);
      reasons[offset / 4] = reason;
      if (reason === 'no-data') counts.noDataCount += 1;
      else if (reason === 'sentinel') counts.sentinelCount += 1;
      else if (reason === 'impossible') counts.impossibleCount += 1;
      else if (reason === 'spike') counts.spikeCount += 1;
    }
  }

  for (let y = 0; y < center.height; y += 1) {
    for (let x = 0; x < center.width; x += 1) {
      const offset = pixelOffset(center, x, y);
      if (reasons[offset / 4] === null) continue;
      const neighbors = validNeighborElevations(
        grid,
        center.width,
        center.height,
        x,
        y,
        policy,
      );
      if (neighbors.length === 0) {
        counts.unrepairedCount += 1;
        continue;
      }
      const [red, green, blue] = encodeTerrariumElevation(median(neighbors));
      output[offset] = red;
      output[offset + 1] = green;
      output[offset + 2] = blue;
      output[offset + 3] = 255;
      counts.repairedCount += 1;
    }
  }

  return { tile: { width: center.width, height: center.height, data: output }, counts };
}
