import { describe, expect, it } from 'vitest';

import { calculateWeightedCloudCover } from '@/domain/satellite/calculateWeightedCloudCover';
import type { SatelliteSceneMatch } from '@/domain/satellite/SatelliteSearchResult';

function match(cloudCoverPercent: number, viewportCoveragePercent: number) {
  return {
    scene: { cloudCoverPercent },
    coverage: { viewportCoveragePercent },
  } as SatelliteSceneMatch;
}

describe('calculateWeightedCloudCover', () => {
  it('weights each scene by its submitted-viewport coverage', () => {
    expect(calculateWeightedCloudCover([match(80, 25), match(20, 75)])).toBe(35);
  });

  it('uses the simple average when no scene covers the viewport', () => {
    expect(calculateWeightedCloudCover([match(80, 0), match(20, 0)])).toBe(50);
  });

  it('returns no summary for an empty acquisition day', () => {
    expect(calculateWeightedCloudCover([])).toBeNull();
  });
});
