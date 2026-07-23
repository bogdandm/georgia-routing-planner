import type { TrackCoordinate, TrackPoint, TrackSegment } from '@/domain/tracks/gpx';

export const DISTANCE_ALGORITHM_VERSION = 1;
export const ELEVATION_ALGORITHM_VERSION = 1;
export const ROUTE_SHAPE_ALGORITHM_VERSION = 1;
export const DOMINANT_SUMMIT_ALGORITHM_VERSION = 1;

const earthRadiusMeters = 6_371_008.8;

export interface TrackBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
  readonly crossesAntimeridian: boolean;
}

export interface TrackMetrics {
  readonly distanceMeters: number;
  readonly distanceAlgorithmVersion: typeof DISTANCE_ALGORITHM_VERSION;
  readonly startCoordinate: TrackCoordinate;
  readonly endCoordinate: TrackCoordinate;
  readonly bounds: TrackBounds;
  readonly center: TrackCoordinate;
  readonly recordedStartAt?: string;
  readonly recordedEndAt?: string;
  readonly elapsedSeconds?: number;
  readonly ascentMeters?: number;
  readonly descentMeters?: number;
  readonly minimumElevationMeters?: number;
  readonly maximumElevationMeters?: number;
  readonly elevationSource?: 'gpx';
  readonly elevationAlgorithmVersion?: typeof ELEVATION_ALGORITHM_VERSION;
}

type TrackMetricsBuilder = {
  -readonly [Key in keyof TrackMetrics]: TrackMetrics[Key];
};

export interface DominantSummit {
  readonly coordinate: TrackCoordinate;
  readonly distanceAlongMeters: number;
  readonly elevationMeters: number;
  readonly algorithmVersion: typeof DOMINANT_SUMMIT_ALGORITHM_VERSION;
}

export interface PoiCandidate {
  readonly label: string;
  readonly kind: string;
  readonly matchedCoordinate: TrackCoordinate;
  readonly distanceMeters?: number;
  readonly lookedUpAt: string;
}

export function formatGeneratedPoiLabel(label: string, category: string): string {
  if (category === 'mountain_pass:yes' && !/\bpass\b/iu.test(label)) {
    return `${label} Pass`;
  }
  if (
    (category === 'natural:peak' || category === 'natural:volcano') &&
    !/^(?:mt\.?|mount)\s/iu.test(label)
  ) {
    return `Mt. ${label}`;
  }
  return label;
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

export function geodesicDistanceMeters(
  start: TrackCoordinate,
  end: TrackCoordinate,
): number {
  const latitudeDelta = radians(end[1] - start[1]);
  const longitudeDelta = radians(end[0] - start[0]);
  const startLatitude = radians(start[1]);
  const endLatitude = radians(end[1]);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function calculateBounds(points: readonly TrackPoint[]): {
  readonly bounds: TrackBounds;
  readonly center: TrackCoordinate;
} {
  let south = 90;
  let north = -90;
  const longitudes: number[] = [];
  for (const point of points) {
    south = Math.min(south, point.coordinate[1]);
    north = Math.max(north, point.coordinate[1]);
    longitudes.push(point.coordinate[0]);
  }
  longitudes.sort((left, right) => left - right);
  let largestGap = -1;
  let gapStartIndex = 0;
  for (let index = 0; index < longitudes.length; index += 1) {
    const current = longitudes[index];
    const next = longitudes[(index + 1) % longitudes.length];
    if (current === undefined || next === undefined) continue;
    const gap = index === longitudes.length - 1 ? next + 360 - current : next - current;
    if (gap > largestGap) {
      largestGap = gap;
      gapStartIndex = index;
    }
  }
  const west = longitudes[(gapStartIndex + 1) % longitudes.length] ?? 0;
  const east = longitudes[gapStartIndex] ?? 0;
  const crossesAntimeridian = west > east;
  const eastUnwrapped = crossesAntimeridian ? east + 360 : east;
  let centerLongitude = (west + eastUnwrapped) / 2;
  if (centerLongitude > 180) centerLongitude -= 360;
  return {
    bounds: { west, south, east, north, crossesAntimeridian },
    center: [centerLongitude, (south + north) / 2],
  };
}

export function calculateTrackMetrics(segments: readonly TrackSegment[]): TrackMetrics {
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];
  const startPoint = firstSegment?.points[0];
  const endPoint = lastSegment?.points[lastSegment.points.length - 1];
  if (startPoint === undefined || endPoint === undefined) {
    throw new Error('Track metrics require at least one non-empty segment.');
  }

  let distanceMeters = 0;
  let ascentMeters = 0;
  let descentMeters = 0;
  let elevationPairCount = 0;
  const elevationValues: number[] = [];
  const timestampValues: number[] = [];
  let allPointsHaveTime = true;
  let timestampsOrdered = true;
  let previousTimestamp: number | undefined;
  const allPoints: TrackPoint[] = [];

  for (const segment of segments) {
    allPoints.push(...segment.points);
    for (const point of segment.points) {
      if (point.elevationMeters !== undefined)
        elevationValues.push(point.elevationMeters);
      if (point.recordedAt === undefined) {
        allPointsHaveTime = false;
      } else {
        const timestamp = Date.parse(point.recordedAt);
        timestampValues.push(timestamp);
        if (previousTimestamp !== undefined && timestamp < previousTimestamp) {
          timestampsOrdered = false;
        }
        previousTimestamp = timestamp;
      }
    }
    for (let index = 1; index < segment.points.length; index += 1) {
      const previous = segment.points[index - 1];
      const current = segment.points[index];
      if (previous === undefined || current === undefined) continue;
      distanceMeters += geodesicDistanceMeters(previous.coordinate, current.coordinate);
      if (
        previous.elevationMeters !== undefined &&
        current.elevationMeters !== undefined
      ) {
        elevationPairCount += 1;
        const delta = current.elevationMeters - previous.elevationMeters;
        if (delta > 0) ascentMeters += delta;
        if (delta < 0) descentMeters += Math.abs(delta);
      }
    }
  }

  const { bounds, center } = calculateBounds(allPoints);
  const recordedStart = timestampValues[0];
  const recordedEnd = timestampValues[timestampValues.length - 1];
  const hasRecordedDuration =
    allPointsHaveTime &&
    timestampsOrdered &&
    recordedStart !== undefined &&
    recordedEnd !== undefined &&
    recordedEnd >= recordedStart;
  const result: TrackMetricsBuilder = {
    distanceMeters,
    distanceAlgorithmVersion: DISTANCE_ALGORITHM_VERSION,
    startCoordinate: startPoint.coordinate,
    endCoordinate: endPoint.coordinate,
    bounds,
    center,
  };
  if (hasRecordedDuration) {
    result.recordedStartAt = new Date(recordedStart).toISOString();
    result.recordedEndAt = new Date(recordedEnd).toISOString();
    result.elapsedSeconds = (recordedEnd - recordedStart) / 1_000;
  }
  if (elevationValues.length > 0) {
    result.minimumElevationMeters = Math.min(...elevationValues);
    result.maximumElevationMeters = Math.max(...elevationValues);
    result.elevationSource = 'gpx';
    result.elevationAlgorithmVersion = ELEVATION_ALGORITHM_VERSION;
  }
  if (elevationPairCount > 0) {
    result.ascentMeters = ascentMeters;
    result.descentMeters = descentMeters;
  }
  return result;
}

function cumulativeDistances(points: readonly TrackPoint[]): readonly number[] {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const accumulated = distances[index - 1];
    if (previous === undefined || current === undefined || accumulated === undefined)
      continue;
    distances.push(
      accumulated + geodesicDistanceMeters(previous.coordinate, current.coordinate),
    );
  }
  return distances;
}

export function pointNearestFraction(
  points: readonly TrackPoint[],
  fraction: number,
): TrackPoint {
  const distances = cumulativeDistances(points);
  const total = distances[distances.length - 1] ?? 0;
  const target = Math.min(1, Math.max(0, fraction)) * total;
  let closestIndex = 0;
  let closestDelta = Number.POSITIVE_INFINITY;
  for (const [index, distance] of distances.entries()) {
    const delta = Math.abs(distance - target);
    if (delta < closestDelta) {
      closestDelta = delta;
      closestIndex = index;
    }
  }
  const point = points[closestIndex];
  if (point === undefined) throw new Error('Representative point requires geometry.');
  return point;
}

export function findDominantSummit(
  points: readonly TrackPoint[],
): DominantSummit | null {
  if (points.length < 3) return null;
  const distances = cumulativeDistances(points);
  const total = distances[distances.length - 1] ?? 0;
  if (total <= 0) return null;

  let coveredDistance = 0;
  let highestIndex = -1;
  let highestElevation = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (
      point?.elevationMeters !== undefined &&
      point.elevationMeters > highestElevation
    ) {
      highestElevation = point.elevationMeters;
      highestIndex = index;
    }
    if (index > 0) {
      const previous = points[index - 1];
      const current = points[index];
      const previousDistance = distances[index - 1];
      const currentDistance = distances[index];
      if (
        previous?.elevationMeters !== undefined &&
        current?.elevationMeters !== undefined &&
        previousDistance !== undefined &&
        currentDistance !== undefined
      ) {
        coveredDistance += currentDistance - previousDistance;
      }
    }
  }
  const highestPoint = points[highestIndex];
  const highestDistance = distances[highestIndex];
  const startElevation = points[0]?.elevationMeters;
  const endElevation = points[points.length - 1]?.elevationMeters;
  if (
    highestPoint?.elevationMeters === undefined ||
    highestDistance === undefined ||
    startElevation === undefined ||
    endElevation === undefined ||
    coveredDistance / total < 0.8 ||
    highestDistance / total < 0.2 ||
    highestDistance / total > 0.8 ||
    highestPoint.elevationMeters - Math.max(startElevation, endElevation) < 100
  ) {
    return null;
  }
  const neighbourhood = total * 0.1;
  for (const [index, point] of points.entries()) {
    const distance = distances[index];
    if (
      distance !== undefined &&
      point.elevationMeters !== undefined &&
      Math.abs(distance - highestDistance) > neighbourhood &&
      highestPoint.elevationMeters - point.elevationMeters < 50
    ) {
      return null;
    }
  }
  return {
    coordinate: highestPoint.coordinate,
    distanceAlongMeters: highestDistance,
    elevationMeters: highestPoint.elevationMeters,
    algorithmVersion: DOMINANT_SUMMIT_ALGORITHM_VERSION,
  };
}

export function isLoop(
  segments: readonly TrackSegment[],
  distanceMeters: number,
): boolean {
  if (segments.length !== 1) return false;
  const first = segments[0]?.points[0];
  const points = segments[0]?.points;
  const last = points?.[points.length - 1];
  if (first === undefined || last === undefined) return false;
  return (
    geodesicDistanceMeters(first.coordinate, last.coordinate) <=
    Math.max(100, distanceMeters * 0.01)
  );
}

function cleanLabel(candidate: PoiCandidate | undefined): string | undefined {
  const value = candidate?.label.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

export function generateEnglishTrackName(input: {
  readonly loop: boolean;
  readonly multipleSegments: boolean;
  readonly startPoi?: PoiCandidate;
  readonly middlePoi?: PoiCandidate;
  readonly endPoi?: PoiCandidate;
  readonly fallbackPoi?: PoiCandidate;
}): string | null {
  if (input.multipleSegments || input.loop) {
    return (
      cleanLabel(
        input.fallbackPoi ?? input.middlePoi ?? input.startPoi ?? input.endPoi,
      ) ?? null
    );
  }
  const labels = [
    cleanLabel(input.startPoi),
    cleanLabel(input.middlePoi),
    cleanLabel(input.endPoi),
  ].filter((value): value is string => value !== undefined);
  const unique = labels.filter(
    (label, index) =>
      labels.findIndex(
        (candidate) =>
          candidate.localeCompare(label, 'en', { sensitivity: 'base' }) === 0,
      ) === index,
  );
  const [first, second, third] = unique;
  if (first !== undefined && second !== undefined && third !== undefined) {
    return `${second}: ${first} \u2192 ${third}`;
  }
  if (first !== undefined && second !== undefined) return `${first} \u2192 ${second}`;
  return first ?? null;
}
