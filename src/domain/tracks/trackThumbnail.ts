import type { TrackCoordinate } from '@/domain/tracks/gpx';
import { EARTH_RADIUS_METERS, isLoop } from '@/domain/tracks/trackCalculations';

export const TRACK_THUMBNAIL_ALGORITHM_VERSION = 1;

/** Douglas–Peucker tolerance as a fraction of the track's larger bounding-box side. */
const THUMBNAIL_SIMPLIFICATION_EXTENT_FRACTION = 0.01;

/** Browser-derived list thumbnail; recomputed when the track content hash or algorithm version changes. */
export interface TrackThumbnail {
  readonly trackId: string;
  /** `LocalTrackSummary.contentHash` it was derived from; null for legacy rows without a hash. */
  readonly contentHash: string | null;
  readonly algorithmVersion: typeof TRACK_THUMBNAIL_ALGORITHM_VERSION;
  readonly loop: boolean;
  /** Simplified `[longitude, latitude]` vertices per source segment; empty segments dropped. */
  readonly segments: readonly (readonly TrackCoordinate[])[];
}

type PlanarPoint = readonly [x: number, y: number];

export function createTrackThumbnail(
  trackId: string,
  contentHash: string | null,
  segments: readonly (readonly TrackCoordinate[])[],
): TrackThumbnail {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const segment of segments) {
    for (const [longitude, latitude] of segment) {
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    }
  }
  const centerLongitude = (west + east) / 2;
  const centerLatitude = (south + north) / 2;
  const metersPerDegree = (EARTH_RADIUS_METERS * Math.PI) / 180;
  const longitudeScale = Math.cos((centerLatitude * Math.PI) / 180) * metersPerDegree;
  const project = ([longitude, latitude]: TrackCoordinate): PlanarPoint => [
    (longitude - centerLongitude) * longitudeScale,
    (latitude - centerLatitude) * metersPerDegree,
  ];
  const extent = Math.max(
    (east - west) * longitudeScale,
    (north - south) * metersPerDegree,
  );
  const tolerance = extent * THUMBNAIL_SIMPLIFICATION_EXTENT_FRACTION;

  return {
    trackId,
    contentHash,
    algorithmVersion: TRACK_THUMBNAIL_ALGORITHM_VERSION,
    loop: isLoop(segments),
    segments: segments
      .filter((segment) => segment.length > 0)
      .map((segment) => simplifySegment(segment, segment.map(project), tolerance)),
  };
}

/** Iterative Douglas–Peucker; recursion would overflow on 100k+ point recordings. */
function simplifySegment(
  segment: readonly TrackCoordinate[],
  projected: readonly PlanarPoint[],
  tolerance: number,
): readonly TrackCoordinate[] {
  const lastIndex = segment.length - 1;
  const keep = new Uint8Array(segment.length);
  keep[0] = 1;
  keep[lastIndex] = 1;
  const stack: [startIndex: number, endIndex: number][] =
    lastIndex > 1 ? [[0, lastIndex]] : [];
  for (let range = stack.pop(); range !== undefined; range = stack.pop()) {
    const [startIndex, endIndex] = range;
    const start = projected[startIndex];
    const end = projected[endIndex];
    if (start === undefined || end === undefined) continue;
    let farthestIndex = -1;
    let farthestDistance = tolerance;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const point = projected[index];
      if (point === undefined) continue;
      const distance = pointToSegmentDistance(point, start, end);
      if (distance > farthestDistance) {
        farthestIndex = index;
        farthestDistance = distance;
      }
    }
    if (farthestIndex === -1) continue;
    keep[farthestIndex] = 1;
    if (farthestIndex - startIndex > 1) stack.push([startIndex, farthestIndex]);
    if (endIndex - farthestIndex > 1) stack.push([farthestIndex, endIndex]);
  }
  return segment.filter((_, index) => keep[index] === 1);
}

function pointToSegmentDistance(
  point: PlanarPoint,
  start: PlanarPoint,
  end: PlanarPoint,
): number {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(
            0,
            ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) /
              lengthSquared,
          ),
        );
  return Math.hypot(
    point[0] - (start[0] + deltaX * fraction),
    point[1] - (start[1] + deltaY * fraction),
  );
}
