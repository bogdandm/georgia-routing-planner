import { performance } from 'node:perf_hooks';

import { filterTerrariumTile } from '../../src/infrastructure/elevation/TerrariumDemFilter';
import { createTerrariumBenchmarkFixtures } from '../../tests/helpers/terrariumDemFilterFixtures';
import { referenceFilterTerrariumTile } from '../../tests/helpers/referenceTerrariumDemFilter';

interface FilterResult {
  readonly tile: { readonly data: Uint8ClampedArray };
  readonly counts: { readonly repairedCount: number; readonly spikeCount: number };
}

const warmupRuns = 5;
const seriesCount = 7;
const runsPerSeries = 3;
let checksum = 0;

function consume(result: FilterResult): void {
  const data = result.tile.data;
  checksum =
    (checksum +
      (data[0] ?? 0) +
      (data[Math.floor(data.length / 2)] ?? 0) +
      (data[data.length - 1] ?? 0) +
      result.counts.repairedCount +
      result.counts.spikeCount) >>>
    0;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const value = sorted[Math.floor(sorted.length / 2)];
  if (value === undefined) throw new RangeError('Benchmark median requires a value.');
  return value;
}

function measure(run: () => FilterResult): number {
  const start = performance.now();
  for (let index = 0; index < runsPerSeries; index += 1) consume(run());
  return (performance.now() - start) / runsPerSeries;
}

console.log('Scenario | Oracle ms/tile | Candidate ms/tile | Speedup');
console.log('--- | ---: | ---: | ---:');

for (const fixture of createTerrariumBenchmarkFixtures()) {
  const candidateGrid = fixture.createGrid();
  const oracleGrid = fixture.createGrid();
  const candidateRun = () => filterTerrariumTile(candidateGrid, fixture.policy);
  const oracleRun = () => referenceFilterTerrariumTile(oracleGrid, fixture.policy);

  const candidateCheck = candidateRun();
  const oracleCheck = oracleRun();
  if (
    JSON.stringify(candidateCheck.counts) !== JSON.stringify(oracleCheck.counts) ||
    candidateCheck.tile.data.length !== oracleCheck.tile.data.length
  ) {
    throw new Error(`Benchmark parity failed for ${fixture.name}.`);
  }
  for (let index = 0; index < candidateCheck.tile.data.length; index += 1) {
    if (candidateCheck.tile.data[index] !== oracleCheck.tile.data[index]) {
      throw new Error(`Benchmark byte parity failed for ${fixture.name} at ${index}.`);
    }
  }

  for (let index = 0; index < warmupRuns; index += 1) {
    consume(candidateRun());
    consume(oracleRun());
  }

  const candidateTimes: number[] = [];
  const oracleTimes: number[] = [];
  for (let series = 0; series < seriesCount; series += 1) {
    if (series % 2 === 0) {
      candidateTimes.push(measure(candidateRun));
      oracleTimes.push(measure(oracleRun));
    } else {
      oracleTimes.push(measure(oracleRun));
      candidateTimes.push(measure(candidateRun));
    }
  }

  const candidateMedian = median(candidateTimes);
  const oracleMedian = median(oracleTimes);
  console.log(
    `${fixture.name} | ${oracleMedian.toFixed(3)} | ${candidateMedian.toFixed(3)} | ${(oracleMedian / candidateMedian).toFixed(2)}x`,
  );
}

console.log(`Checksum: ${checksum}`);
