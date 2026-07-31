import { describe, expect, it } from 'vitest';

import {
  medianInPlace,
  repairMedianInPlace,
} from '@/domain/elevation/robustElevationStatistics';

describe('robustElevationStatistics', () => {
  it('calculates odd and even medians while sorting only the populated prefix', () => {
    const odd = new Float64Array([9, 1, 5, 100]);
    const even = new Float64Array([9, 1, 5, 3, 100]);

    expect(medianInPlace(odd, 3)).toBe(5);
    expect([...odd]).toEqual([1, 5, 9, 100]);
    expect(medianInPlace(even, 4)).toBe(4);
    expect([...even]).toEqual([1, 3, 5, 9, 100]);
  });

  it('rejects count values outside the populated prefix', () => {
    const values = new Float64Array([1, 2]);

    expect(() => medianInPlace(values, 0)).toThrow(
      'Median count must select populated values.',
    );
    expect(() => medianInPlace(values, 3)).toThrow(
      'Median count must select populated values.',
    );
  });

  it('uses a unique dense cluster but keeps the overall median for ambiguous clusters', () => {
    expect(repairMedianInPlace(new Float64Array([1, 100, 101, 102, 103]), 5, 2)).toBe(
      101.5,
    );
    expect(repairMedianInPlace(new Float64Array([1, 2, 100, 101]), 4, 1)).toBe(51);
    expect(repairMedianInPlace(new Float64Array([1, 50]), 2, 1)).toBe(25.5);
  });
});
