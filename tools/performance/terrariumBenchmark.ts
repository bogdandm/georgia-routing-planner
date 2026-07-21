import { cpus } from 'node:os';

import {
  encodeTerrariumElevation,
  filterTerrariumTile,
  type DecodedTerrariumTile,
  type FilteredTerrariumTile,
  type TerrariumFilterPolicy,
  type TerrariumTileGrid,
} from '../../src/infrastructure/elevation/TerrariumDemFilter';
import { referenceFilterTerrariumTile } from './referenceTerrariumFilter';

export const benchmarkPolicy: TerrariumFilterPolicy = {
  minimumElevationMeters: -500,
  maximumElevationMeters: 9_000,
  sentinelElevationsMeters: [-32_768],
  spikeThresholdMeters: 500,
  negativeSpikeThresholdMeters: 300,
  maximumNeighborMadMeters: 80,
  minimumConsensusNeighbors: 5,
  maximumSpikeSupportNeighbors: 1,
  cacheSize: 32,
};

export interface TerrariumBenchmarkScenario {
  readonly name: string;
  readonly seed: number;
  readonly grid: TerrariumTileGrid;
}

export interface TimingSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly tilesPerSecond: number;
}

export interface ScenarioBenchmarkResult {
  readonly name: string;
  readonly reference: TimingSummary;
  readonly candidate: TimingSummary;
}

export interface TerrariumBenchmarkReport {
  readonly schemaVersion: 1;
  readonly runtime: {
    readonly version: string;
    readonly cpuModel: string;
    readonly execution: 'node' | 'chrome';
  };
  readonly seed: number;
  readonly iterations: number;
  readonly warmupIterations: number;
  readonly scenarios: readonly ScenarioBenchmarkResult[];
  readonly combined: {
    readonly reference: TimingSummary;
    readonly candidate: TimingSummary;
    readonly medianImprovementPercent: number;
    readonly maximumP95RegressionPercent: number;
  };
}

type FilterImplementation = (
  grid: TerrariumTileGrid,
  policy: TerrariumFilterPolicy,
) => FilteredTerrariumTile;

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function createTile(
  tileX: number,
  tileY: number,
  random: () => number,
  elevationAt: (globalX: number, globalY: number, randomValue: number) => number,
): DecodedTerrariumTile {
  const size = 256;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [red, green, blue] = encodeTerrariumElevation(
        elevationAt(tileX * size + x, tileY * size + y, random()),
      );
      const offset = (y * size + x) * 4;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function setElevation(
  tile: DecodedTerrariumTile,
  x: number,
  y: number,
  elevation: number,
  alpha = 255,
): void {
  const [red, green, blue] = encodeTerrariumElevation(elevation);
  const offset = (y * tile.width + x) * 4;
  tile.data[offset] = red;
  tile.data[offset + 1] = green;
  tile.data[offset + 2] = blue;
  tile.data[offset + 3] = alpha;
}

function createGrid(
  seed: number,
  elevationAt: (globalX: number, globalY: number, randomValue: number) => number,
): TerrariumTileGrid {
  const random = createRandom(seed);
  const rows: DecodedTerrariumTile[][] = [];
  for (let tileY = -1; tileY <= 1; tileY += 1) {
    const row: DecodedTerrariumTile[] = [];
    for (let tileX = -1; tileX <= 1; tileX += 1) {
      row.push(createTile(tileX, tileY, random, elevationAt));
    }
    rows.push(row);
  }
  const north = rows[0];
  const center = rows[1];
  const south = rows[2];
  if (north === undefined || center === undefined || south === undefined) {
    throw new Error('Benchmark grid construction failed.');
  }
  return [
    [north[0] ?? null, north[1] ?? null, north[2] ?? null],
    [
      center[0] ?? null,
      center[1] ?? createTile(0, 0, random, elevationAt),
      center[2] ?? null,
    ],
    [south[0] ?? null, south[1] ?? null, south[2] ?? null],
  ];
}

/** Builds the stable multi-scenario corpus used for local timing comparisons. */
export function createBenchmarkScenarios(
  seed: number,
): readonly TerrariumBenchmarkScenario[] {
  const varied = createGrid(
    seed,
    (x, y, noise) =>
      1_200 + Math.sin(x / 21) * 180 + Math.cos(y / 17) * 140 + noise * 12,
  );
  const sparseSpikes = createGrid(
    seed + 1,
    (x, y, noise) => 1_400 + Math.sin((x + y) / 25) * 100 + noise * 8,
  );
  const sparseCenter = sparseSpikes[1][1];
  for (let index = 0; index < 64; index += 1) {
    setElevation(
      sparseCenter,
      (index * 37) % 256,
      (index * 83) % 256,
      index % 2 === 0 ? 4_500 : -200,
    );
  }

  const asymmetricPits = createGrid(seed + 2, (_x, _y, noise) => 1_000 + noise * 8);
  const asymmetricCenter = asymmetricPits[1][1];
  for (let index = 0; index < 32; index += 1) {
    setElevation(
      asymmetricCenter,
      16 + (index % 8) * 30,
      16 + Math.floor(index / 8) * 30,
      650,
    );
  }

  const manyInvalid = createGrid(seed + 3, (_x, _y, noise) => 900 + noise * 20);
  const manyInvalidCenter = manyInvalid[1][1];
  for (let y = 4; y < 252; y += 8) {
    for (let x = 4; x < 252; x += 8) setElevation(manyInvalidCenter, x, y, -32_768);
  }

  const scanline = createGrid(seed + 4, (x, y) => 1_100 + x * 0.1 + y * 0.05);
  const scanlineCenter = scanline[1][1];
  for (let x = 0; x < 256; x += 1) setElevation(scanlineCenter, x, 5, -700);

  const crossTile = createGrid(seed + 5, (x, y) => 1_500 + x * 0.2 + y * 0.1);
  const crossCenter = crossTile[1][1];
  const crossWest = crossTile[1][0];
  const crossNorth = crossTile[0][1];
  for (let index = 0; index < 256; index += 1) {
    setElevation(crossCenter, 0, index, 3_000);
    if (crossWest !== null) setElevation(crossWest, 255, index, 1_500 + index * 0.1);
    setElevation(crossCenter, index, 0, 3_000);
    if (crossNorth !== null) setElevation(crossNorth, index, 255, 1_500 + index * 0.2);
  }

  const highGradient = createGrid(
    seed + 6,
    (x, y, noise) => 3_500 + Math.sin(x / 2) * 420 + Math.cos(y / 2) * 420 + noise * 70,
  );

  return [
    { name: 'valid-varied', seed, grid: varied },
    { name: 'sparse-spikes', seed: seed + 1, grid: sparseSpikes },
    { name: 'asymmetric-shallow-pits', seed: seed + 2, grid: asymmetricPits },
    { name: 'many-invalid', seed: seed + 3, grid: manyInvalid },
    { name: 'corrupt-scanline', seed: seed + 4, grid: scanline },
    { name: 'cross-tile-edges', seed: seed + 5, grid: crossTile },
    { name: 'high-gradient', seed: seed + 6, grid: highGradient },
  ];
}

export function percentile(
  samples: readonly number[],
  percentileValue: number,
): number {
  if (samples.length === 0)
    throw new RangeError('At least one timing sample is required.');
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(percentileValue * sorted.length) - 1,
  );
  return sorted[index] ?? 0;
}

export function executionOrder(
  iteration: number,
): readonly ['reference', 'candidate'] | readonly ['candidate', 'reference'] {
  return iteration % 2 === 0 ? ['reference', 'candidate'] : ['candidate', 'reference'];
}

export function assertEquivalent(
  scenario: TerrariumBenchmarkScenario,
  reference: FilterImplementation = referenceFilterTerrariumTile,
  candidate: FilterImplementation = filterTerrariumTile,
): void {
  const expected = reference(scenario.grid, benchmarkPolicy);
  const actual = candidate(scenario.grid, benchmarkPolicy);
  if (JSON.stringify(expected.counts) !== JSON.stringify(actual.counts)) {
    throw new Error(`Candidate repair counts differ for ${scenario.name}.`);
  }
  if (expected.tile.data.length !== actual.tile.data.length) {
    throw new Error(`Candidate output length differs for ${scenario.name}.`);
  }
  for (let index = 0; index < expected.tile.data.length; index += 1) {
    if (expected.tile.data[index] !== actual.tile.data[index]) {
      throw new Error(
        `Candidate output differs for ${scenario.name} at byte ${String(index)}.`,
      );
    }
  }
}

function summarize(samples: readonly number[]): TimingSummary {
  const medianMs = percentile(samples, 0.5);
  const p95Ms = percentile(samples, 0.95);
  return {
    medianMs,
    p95Ms,
    tilesPerSecond: medianMs === 0 ? 0 : 1_000 / medianMs,
  };
}

export function runTerrariumBenchmark(
  scenarios: readonly TerrariumBenchmarkScenario[],
  iterations: number,
  warmupIterations: number,
  now: () => number = () => performance.now(),
  reference: FilterImplementation = referenceFilterTerrariumTile,
  candidate: FilterImplementation = filterTerrariumTile,
): TerrariumBenchmarkReport {
  if (iterations < 1 || warmupIterations < 0)
    throw new RangeError('Benchmark iteration counts are invalid.');
  const results: ScenarioBenchmarkResult[] = [];
  const combinedReference: number[] = [];
  const combinedCandidate: number[] = [];
  for (const scenario of scenarios) {
    assertEquivalent(scenario, reference, candidate);
    for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
      for (const implementation of executionOrder(iteration)) {
        (implementation === 'reference' ? reference : candidate)(
          scenario.grid,
          benchmarkPolicy,
        );
      }
    }
    const referenceSamples: number[] = [];
    const candidateSamples: number[] = [];
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      for (const implementation of executionOrder(iteration)) {
        const startedAt = now();
        (implementation === 'reference' ? reference : candidate)(
          scenario.grid,
          benchmarkPolicy,
        );
        const duration = now() - startedAt;
        (implementation === 'reference' ? referenceSamples : candidateSamples).push(
          duration,
        );
      }
    }
    combinedReference.push(...referenceSamples);
    combinedCandidate.push(...candidateSamples);
    results.push({
      name: scenario.name,
      reference: summarize(referenceSamples),
      candidate: summarize(candidateSamples),
    });
  }
  const referenceSummary = summarize(combinedReference);
  const candidateSummary = summarize(combinedCandidate);
  const maximumP95RegressionPercent = Math.max(
    ...results.map(({ reference: referenceResult, candidate: candidateResult }) =>
      referenceResult.p95Ms === 0
        ? 0
        : ((candidateResult.p95Ms - referenceResult.p95Ms) / referenceResult.p95Ms) *
          100,
    ),
  );
  return {
    schemaVersion: 1,
    runtime: {
      version: process.version,
      cpuModel: cpus()[0]?.model ?? 'unknown',
      execution: 'node',
    },
    seed: scenarios[0]?.seed ?? 0,
    iterations,
    warmupIterations,
    scenarios: results,
    combined: {
      reference: referenceSummary,
      candidate: candidateSummary,
      medianImprovementPercent:
        referenceSummary.medianMs === 0
          ? 0
          : ((referenceSummary.medianMs - candidateSummary.medianMs) /
              referenceSummary.medianMs) *
            100,
      maximumP95RegressionPercent,
    },
  };
}
