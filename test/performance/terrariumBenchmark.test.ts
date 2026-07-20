import { describe, expect, it } from 'vitest';

import {
  assertEquivalent,
  createBenchmarkScenarios,
  executionOrder,
  percentile,
  runTerrariumBenchmark,
} from '../../tools/performance/terrariumBenchmark';

describe('Terrarium filter benchmark', () => {
  it('generates deterministic, complete scenarios', () => {
    const first = createBenchmarkScenarios(42);
    const second = createBenchmarkScenarios(42);

    expect(first.map((scenario) => scenario.name)).toEqual([
      'valid-varied',
      'sparse-spikes',
      'many-invalid',
      'corrupt-scanline',
      'cross-tile-edges',
      'high-gradient',
    ]);
    expect(first[0]?.grid[1][1].data).toEqual(second[0]?.grid[1][1].data);
    expect(
      first.every((scenario) => scenario.grid.flat().every((tile) => tile !== null)),
    ).toBe(true);
  });

  it('checks correctness before timings can be reported', () => {
    const scenario = createBenchmarkScenarios(42)[0];
    expect(scenario).toBeDefined();
    if (scenario === undefined) return;

    expect(() => {
      assertEquivalent(scenario, undefined, (grid) => ({
        tile: grid[1][1],
        counts: {
          noDataCount: 1,
          sentinelCount: 0,
          impossibleCount: 0,
          spikeCount: 0,
          repairedCount: 0,
          unrepairedCount: 0,
        },
      }));
    }).toThrow(/repair counts differ/u);
  });

  it('calculates nearest-rank percentiles and alternates execution order', () => {
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2);
    expect(percentile([4, 1, 3, 2], 0.95)).toBe(4);
    expect(executionOrder(0)).toEqual(['reference', 'candidate']);
    expect(executionOrder(1)).toEqual(['candidate', 'reference']);
  });

  it('excludes warmups and emits a versioned JSON-compatible report', () => {
    const scenario = createBenchmarkScenarios(42)[0];
    expect(scenario).toBeDefined();
    if (scenario === undefined) return;
    let now = 0;
    const report = runTerrariumBenchmark([scenario], 2, 3, () => {
      now += 1;
      return now;
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      seed: 42,
      iterations: 2,
      warmupIterations: 3,
      combined: {
        reference: { medianMs: 1 },
        candidate: { medianMs: 1 },
      },
    });
    expect(() => JSON.stringify(report)).not.toThrow();
  });
});
