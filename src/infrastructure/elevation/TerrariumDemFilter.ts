export interface DecodedTerrariumTile {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** Validated physical and statistical bounds applied to decoded Terrarium pixels. */
export interface TerrariumFilterPolicy {
  readonly minimumElevationMeters: number;
  readonly maximumElevationMeters: number;
  readonly sentinelElevationsMeters: readonly number[];
  readonly spikeThresholdMeters: number;
  readonly negativeSpikeThresholdMeters: number;
  readonly maximumNeighborMadMeters: number;
  readonly minimumConsensusNeighbors: number;
  readonly maximumSpikeSupportNeighbors: number;
  readonly cacheSize: number;
}

export type TerrariumTileGrid = readonly [
  readonly [
    DecodedTerrariumTile | null,
    DecodedTerrariumTile | null,
    DecodedTerrariumTile | null,
  ],
  readonly [
    DecodedTerrariumTile | null,
    DecodedTerrariumTile,
    DecodedTerrariumTile | null,
  ],
  readonly [
    DecodedTerrariumTile | null,
    DecodedTerrariumTile | null,
    DecodedTerrariumTile | null,
  ],
];

export interface TerrariumRepairCounts {
  readonly noDataCount: number;
  readonly sentinelCount: number;
  readonly impossibleCount: number;
  readonly spikeCount: number;
  readonly repairedCount: number;
  readonly unrepairedCount: number;
}

interface FilteredTerrariumTile {
  readonly tile: DecodedTerrariumTile;
  readonly counts: TerrariumRepairCounts;
}

type RejectionReason = 'no-data' | 'sentinel' | 'impossible' | 'spike';

const terrariumOffsetMeters = 32_768;
const terrariumQuantization = 256;

/** Decodes one opaque Terrarium RGB pixel into elevation metres. */
export function decodeTerrariumElevation(
  red: number,
  green: number,
  blue: number,
): number {
  return red * 256 + green + blue / terrariumQuantization - terrariumOffsetMeters;
}

/** Encodes elevation metres into the nearest representable Terrarium RGB value. */
export function encodeTerrariumElevation(
  elevationMeters: number,
): readonly [number, number, number] {
  const encoded = Math.max(
    0,
    Math.min(
      0xff_ff_ff,
      Math.round((elevationMeters + terrariumOffsetMeters) * terrariumQuantization),
    ),
  );
  return [encoded >>> 16, (encoded >>> 8) & 0xff, encoded & 0xff];
}

function medianInPlace(values: Float64Array, count: number): number {
  for (let index = 1; index < count; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    let insertionIndex = index - 1;
    while (insertionIndex >= 0 && (values[insertionIndex] ?? value) > value) {
      values[insertionIndex + 1] = values[insertionIndex] ?? value;
      insertionIndex -= 1;
    }
    values[insertionIndex + 1] = value;
  }
  const middle = Math.floor(count / 2);
  const upper = values[middle];
  if (upper === undefined) throw new RangeError('Median requires at least one value.');
  if (count % 2 === 1) return upper;
  const lower = values[middle - 1];
  if (lower === undefined) throw new RangeError('Median pair is incomplete.');
  return (lower + upper) / 2;
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
      (sentinel) => Math.abs(elevation - sentinel) < 1 / terrariumQuantization,
    )
  ) {
    return 'sentinel';
  }
  return elevation < policy.minimumElevationMeters ||
    elevation > policy.maximumElevationMeters
    ? 'impossible'
    : null;
}

function fillValidNeighborElevations(
  grid: TerrariumTileGrid,
  width: number,
  height: number,
  x: number,
  y: number,
  policy: TerrariumFilterPolicy,
  elevations: Float64Array,
): number {
  let count = 0;
  for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
    for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
      if (deltaX === 0 && deltaY === 0) continue;
      const pixel = contextPixel(grid, width, height, x + deltaX, y + deltaY);
      if (pixel === null || hardRejectionReason(pixel, policy) !== null) continue;
      elevations[count] = decodeTerrariumElevation(pixel[0], pixel[1], pixel[2]);
      count += 1;
    }
  }
  return count;
}

function spikeRejectionReason(
  elevation: number,
  neighbors: Float64Array,
  neighborCount: number,
  deviations: Float64Array,
  policy: TerrariumFilterPolicy,
): 'spike' | null {
  if (neighborCount < policy.minimumConsensusNeighbors) return null;
  const neighborMedian = medianInPlace(neighbors, neighborCount);
  let consensusCount = 0;
  let supportCount = 0;
  for (let index = 0; index < neighborCount; index += 1) {
    const neighbor = neighbors[index] ?? neighborMedian;
    const deviation = Math.abs(neighbor - neighborMedian);
    deviations[index] = deviation;
    if (deviation <= policy.maximumNeighborMadMeters) consensusCount += 1;
    if (Math.abs(neighbor - elevation) <= policy.maximumNeighborMadMeters) {
      supportCount += 1;
    }
  }
  const medianAbsoluteDeviation = medianInPlace(deviations, neighborCount);
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

/**
 * Repairs only rejected center-tile pixels. The one-pixel neighboring-tile halo makes
 * the decision at tile borders equivalent to an interior-pixel decision.
 */
export function filterTerrariumTile(
  grid: TerrariumTileGrid,
  policy: TerrariumFilterPolicy,
): FilteredTerrariumTile {
  const center = grid[1][1];
  for (const row of grid) {
    for (const tile of row) {
      if (tile !== null) validateTile(tile, center.width, center.height);
    }
  }

  let output: Uint8ClampedArray | null = null;
  const counts = {
    noDataCount: 0,
    sentinelCount: 0,
    impossibleCount: 0,
    spikeCount: 0,
    repairedCount: 0,
    unrepairedCount: 0,
  };
  const neighbors = new Float64Array(8);
  const deviations = new Float64Array(8);

  for (let y = 0; y < center.height; y += 1) {
    for (let x = 0; x < center.width; x += 1) {
      const offset = pixelOffset(center, x, y);
      const pixel = contextPixel(grid, center.width, center.height, x, y);
      if (pixel === null) continue;
      const hardReason = hardRejectionReason(pixel, policy);
      const elevation = decodeTerrariumElevation(pixel[0], pixel[1], pixel[2]);
      const neighborCount = fillValidNeighborElevations(
        grid,
        center.width,
        center.height,
        x,
        y,
        policy,
        neighbors,
      );
      const reason =
        hardReason ??
        spikeRejectionReason(elevation, neighbors, neighborCount, deviations, policy);
      if (reason === 'no-data') counts.noDataCount += 1;
      else if (reason === 'sentinel') counts.sentinelCount += 1;
      else if (reason === 'impossible') counts.impossibleCount += 1;
      else if (reason === 'spike') counts.spikeCount += 1;
      else continue;
      if (neighborCount === 0) {
        counts.unrepairedCount += 1;
        continue;
      }
      const [red, green, blue] = encodeTerrariumElevation(
        medianInPlace(neighbors, neighborCount),
      );
      output ??= new Uint8ClampedArray(center.data);
      output[offset] = red;
      output[offset + 1] = green;
      output[offset + 2] = blue;
      output[offset + 3] = 255;
      counts.repairedCount += 1;
    }
  }

  return {
    tile: { width: center.width, height: center.height, data: output ?? center.data },
    counts,
  };
}
