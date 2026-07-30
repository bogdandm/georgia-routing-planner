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

const terrariumOffsetMeters = 32_768;
const terrariumQuantization = 256;

const enum PixelState {
  Missing = 0,
  Valid = 1,
  NoData = 2,
  Sentinel = 3,
  Impossible = 4,
}

/** Decodes one opaque Terrarium RGB pixel into elevation metres. */
export function decodeTerrariumElevation(
  red: number,
  green: number,
  blue: number,
): number {
  return red * 256 + green + blue / terrariumQuantization - terrariumOffsetMeters;
}

function packedTerrariumElevation(elevationMeters: number): number {
  return Math.max(
    0,
    Math.min(
      0xff_ff_ff,
      Math.round((elevationMeters + terrariumOffsetMeters) * terrariumQuantization),
    ),
  );
}

/** Encodes elevation metres into the nearest representable Terrarium RGB value. */
export function encodeTerrariumElevation(
  elevationMeters: number,
): readonly [number, number, number] {
  const encoded = packedTerrariumElevation(elevationMeters);
  return [encoded >>> 16, (encoded >>> 8) & 0xff, encoded & 0xff];
}

function writeTerrariumElevation(
  elevationMeters: number,
  output: Uint8ClampedArray,
  offset: number,
): void {
  const encoded = packedTerrariumElevation(elevationMeters);
  output[offset] = encoded >>> 16;
  output[offset + 1] = (encoded >>> 8) & 0xff;
  output[offset + 2] = encoded & 0xff;
  output[offset + 3] = 255;
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

function repairMedianInPlace(
  values: Float64Array,
  count: number,
  maximumDeviation: number,
): number {
  const overallMedian = medianInPlace(values, count);
  let bestStart = 0;
  let bestCount = 1;
  let start = 0;
  let ambiguous = false;
  for (let end = 0; end < count; end += 1) {
    while (
      start < end &&
      (values[end] ?? 0) - (values[start] ?? 0) > maximumDeviation * 2
    ) {
      start += 1;
    }
    const clusterCount = end - start + 1;
    if (clusterCount > bestCount) {
      bestStart = start;
      bestCount = clusterCount;
      ambiguous = false;
    } else if (clusterCount === bestCount && start !== bestStart) {
      ambiguous = true;
    }
  }
  if (bestCount < Math.min(3, count) || ambiguous) return overallMedian;
  const middle = bestStart + Math.floor(bestCount / 2);
  const upper = values[middle] ?? overallMedian;
  if (bestCount % 2 === 1) return upper;
  return ((values[middle - 1] ?? upper) + upper) / 2;
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

function decodePlanePixel(
  tile: DecodedTerrariumTile,
  x: number,
  y: number,
  planeIndex: number,
  policy: TerrariumFilterPolicy,
  elevations: Float64Array,
  validity: Uint8Array,
): void {
  const sourceOffset = (y * tile.width + x) * 4;
  if (tile.data[sourceOffset + 3] === 0) {
    validity[planeIndex] = PixelState.NoData;
    return;
  }

  const elevation = decodeTerrariumElevation(
    tile.data[sourceOffset] ?? 0,
    tile.data[sourceOffset + 1] ?? 0,
    tile.data[sourceOffset + 2] ?? 0,
  );
  elevations[planeIndex] = elevation;
  let sentinelIndex = 0;
  while (sentinelIndex < policy.sentinelElevationsMeters.length) {
    const sentinel = policy.sentinelElevationsMeters[sentinelIndex];
    if (
      sentinel !== undefined &&
      Math.abs(elevation - sentinel) < 1 / terrariumQuantization
    ) {
      validity[planeIndex] = PixelState.Sentinel;
      return;
    }
    sentinelIndex += 1;
  }
  validity[planeIndex] =
    elevation < policy.minimumElevationMeters ||
    elevation > policy.maximumElevationMeters
      ? PixelState.Impossible
      : PixelState.Valid;
}

function populateHeightPlane(
  grid: TerrariumTileGrid,
  policy: TerrariumFilterPolicy,
  elevations: Float64Array,
  validity: Uint8Array,
  stride: number,
): void {
  const center = grid[1][1];
  const width = center.width;
  const height = center.height;

  for (let y = 0; y < height; y += 1) {
    let planeIndex = (y + 1) * stride + 1;
    for (let x = 0; x < width; x += 1) {
      decodePlanePixel(center, x, y, planeIndex, policy, elevations, validity);
      planeIndex += 1;
    }
  }

  const north = grid[0][1];
  if (north !== null) {
    for (let x = 0; x < width; x += 1) {
      decodePlanePixel(north, x, height - 1, x + 1, policy, elevations, validity);
    }
  }
  const south = grid[2][1];
  if (south !== null) {
    const planeRow = (height + 1) * stride;
    for (let x = 0; x < width; x += 1) {
      decodePlanePixel(south, x, 0, planeRow + x + 1, policy, elevations, validity);
    }
  }
  const west = grid[1][0];
  if (west !== null) {
    for (let y = 0; y < height; y += 1) {
      decodePlanePixel(
        west,
        width - 1,
        y,
        (y + 1) * stride,
        policy,
        elevations,
        validity,
      );
    }
  }
  const east = grid[1][2];
  if (east !== null) {
    for (let y = 0; y < height; y += 1) {
      decodePlanePixel(east, 0, y, (y + 2) * stride - 1, policy, elevations, validity);
    }
  }

  const northWest = grid[0][0];
  if (northWest !== null) {
    decodePlanePixel(northWest, width - 1, height - 1, 0, policy, elevations, validity);
  }
  const northEast = grid[0][2];
  if (northEast !== null) {
    decodePlanePixel(
      northEast,
      0,
      height - 1,
      stride - 1,
      policy,
      elevations,
      validity,
    );
  }
  const southWest = grid[2][0];
  if (southWest !== null) {
    decodePlanePixel(
      southWest,
      width - 1,
      0,
      (height + 1) * stride,
      policy,
      elevations,
      validity,
    );
  }
  const southEast = grid[2][2];
  if (southEast !== null) {
    decodePlanePixel(
      southEast,
      0,
      0,
      (height + 2) * stride - 1,
      policy,
      elevations,
      validity,
    );
  }
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
  const width = center.width;
  const height = center.height;
  for (const row of grid) {
    for (const tile of row) {
      if (tile !== null) validateTile(tile, width, height);
    }
  }

  const counts = {
    noDataCount: 0,
    sentinelCount: 0,
    impossibleCount: 0,
    spikeCount: 0,
    repairedCount: 0,
    unrepairedCount: 0,
  };
  if (width === 0 || height === 0) {
    return { tile: { width, height, data: center.data }, counts };
  }

  const stride = width + 2;
  const elevations = new Float64Array((width + 2) * (height + 2));
  const validity = new Uint8Array((width + 2) * (height + 2));
  populateHeightPlane(grid, policy, elevations, validity, stride);

  let output: Uint8ClampedArray | null = null;
  const neighbors = new Float64Array(8);
  const deviations = new Float64Array(8);
  const neighborOffsets = [
    -stride - 1,
    -stride,
    -stride + 1,
    -1,
    1,
    stride - 1,
    stride,
    stride + 1,
  ] as const;

  for (let y = 0; y < height; y += 1) {
    let planeIndex = (y + 1) * stride + 1;
    let outputOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const state = validity[planeIndex];
      let neighborCount = 0;
      let neighborMedian: number;

      if (state !== PixelState.Valid) {
        if (state === PixelState.NoData) counts.noDataCount += 1;
        else if (state === PixelState.Sentinel) counts.sentinelCount += 1;
        else if (state === PixelState.Impossible) counts.impossibleCount += 1;
        else {
          planeIndex += 1;
          outputOffset += 4;
          continue;
        }

        let neighborOffsetIndex = 0;
        while (neighborOffsetIndex < neighborOffsets.length) {
          const neighborIndex =
            planeIndex + (neighborOffsets[neighborOffsetIndex] ?? 0);
          neighborOffsetIndex += 1;
          if (validity[neighborIndex] !== PixelState.Valid) continue;
          neighbors[neighborCount] = elevations[neighborIndex] ?? 0;
          neighborCount += 1;
        }
        if (neighborCount === 0) {
          counts.unrepairedCount += 1;
          planeIndex += 1;
          outputOffset += 4;
          continue;
        }
        neighborMedian = repairMedianInPlace(
          neighbors,
          neighborCount,
          policy.maximumNeighborMadMeters,
        );
      } else {
        const elevation = elevations[planeIndex] ?? 0;
        let supportCount = 0;
        const severeSupportLimit = policy.maximumSpikeSupportNeighbors + 1;
        let neighborOffsetIndex = 0;
        while (neighborOffsetIndex < neighborOffsets.length) {
          const neighborIndex =
            planeIndex + (neighborOffsets[neighborOffsetIndex] ?? 0);
          neighborOffsetIndex += 1;
          if (validity[neighborIndex] !== PixelState.Valid) continue;
          const neighbor = elevations[neighborIndex] ?? 0;
          neighbors[neighborCount] = neighbor;
          neighborCount += 1;
          if (Math.abs(neighbor - elevation) <= policy.maximumNeighborMadMeters) {
            supportCount += 1;
            if (supportCount > severeSupportLimit) break;
          }
        }
        const severeConsensusMinimum = Math.max(
          1,
          policy.minimumConsensusNeighbors - 1,
        );
        if (
          supportCount > severeSupportLimit ||
          neighborCount < severeConsensusMinimum
        ) {
          planeIndex += 1;
          outputOffset += 4;
          continue;
        }

        neighborMedian = medianInPlace(neighbors, neighborCount);
        const residual = elevation - neighborMedian;
        const threshold =
          residual < 0
            ? policy.negativeSpikeThresholdMeters
            : policy.spikeThresholdMeters;
        if (Math.abs(residual) < threshold) {
          planeIndex += 1;
          outputOffset += 4;
          continue;
        }

        let consensusCount = 0;
        for (let index = 0; index < neighborCount; index += 1) {
          const deviation = Math.abs(
            (neighbors[index] ?? neighborMedian) - neighborMedian,
          );
          deviations[index] = deviation;
          if (deviation <= policy.maximumNeighborMadMeters) consensusCount += 1;
        }
        const medianAbsoluteDeviation = medianInPlace(deviations, neighborCount);
        // Provider corruption can form a narrow downward strand with two mutually
        // supporting pixels. Relax one support and consensus vote only for a drop at
        // least twice the normal downward threshold; coherent cliffs retain more support.
        const severeNegativeSpike =
          residual <= -policy.negativeSpikeThresholdMeters * 2;
        const consensusMinimum = severeNegativeSpike
          ? severeConsensusMinimum
          : policy.minimumConsensusNeighbors;
        const supportLimit = severeNegativeSpike
          ? severeSupportLimit
          : policy.maximumSpikeSupportNeighbors;
        if (
          medianAbsoluteDeviation > policy.maximumNeighborMadMeters ||
          consensusCount < consensusMinimum ||
          supportCount > supportLimit
        ) {
          planeIndex += 1;
          outputOffset += 4;
          continue;
        }
        counts.spikeCount += 1;
      }

      output ??= new Uint8ClampedArray(center.data);
      writeTerrariumElevation(neighborMedian, output, outputOffset);
      counts.repairedCount += 1;
      planeIndex += 1;
      outputOffset += 4;
    }
  }

  return { tile: { width, height, data: output ?? center.data }, counts };
}
