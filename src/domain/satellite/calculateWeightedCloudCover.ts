import type { SatelliteSceneMatch } from '@/domain/satellite/SatelliteSearchResult';

/**
 * Summarizes one acquisition day's cloud cover using submitted-viewport coverage as
 * the weight. A zero-coverage group falls back to an unweighted average.
 */
export function calculateWeightedCloudCover(
  matches: readonly SatelliteSceneMatch[],
): number | null {
  if (matches.length === 0) return null;
  const totalWeight = matches.reduce(
    (sum, match) => sum + match.coverage.viewportCoveragePercent,
    0,
  );
  if (totalWeight === 0) {
    return (
      matches.reduce((sum, match) => sum + match.scene.cloudCoverPercent, 0) /
      matches.length
    );
  }
  return (
    matches.reduce(
      (sum, match) =>
        sum + match.scene.cloudCoverPercent * match.coverage.viewportCoveragePercent,
      0,
    ) / totalWeight
  );
}
