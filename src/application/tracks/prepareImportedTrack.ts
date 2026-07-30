import type {
  ElevationProvider,
  ElevationSample,
} from '@/application/ports/ElevationProvider';
import {
  calculateElevationProfile,
  medianFilterElevationSamples,
  type ElevationProfile,
  type ElevationSampleInput,
} from '@/domain/tracks/elevationProfile';
import type { TrackCoordinate, TrackSegment } from '@/domain/tracks/gpx';
import {
  calculateTrackMetrics,
  geodesicDistanceMeters,
  type TrackMetrics,
} from '@/domain/tracks/trackCalculations';

const sampleIntervalMeters = 10;
const sourceInterpolationMaximumDistanceMeters = 20;
const maximumPersistedPoints = 100_000;

interface ResampledStation {
  readonly coordinate: TrackCoordinate;
  readonly recordedAt?: string;
  readonly sourceElevationMeters?: number;
  readonly sourceSegmentIndex: number;
}

export interface PreparedImportedTrack {
  readonly segments: readonly TrackSegment[];
  readonly profile: ElevationProfile;
  readonly metrics: TrackMetrics;
}

export type TrackElevationPreparationErrorCode =
  'elevation-unavailable' | 'point-limit-exceeded' | 'zero-length-track';

export class TrackElevationPreparationError extends Error {
  public constructor(readonly code: TrackElevationPreparationErrorCode) {
    const messages: Record<TrackElevationPreparationErrorCode, string> = {
      'elevation-unavailable': 'Elevation data is unavailable for this track.',
      'point-limit-exceeded':
        'This track is too long to prepare at 10 metre resolution.',
      'zero-length-track':
        'This track is broken: all track points are in one location, so its route length is zero. Choose another file.',
    };
    super(messages[code]);
    this.name = 'TrackElevationPreparationError';
  }
}

function interpolateCoordinate(
  start: TrackCoordinate,
  end: TrackCoordinate,
  fraction: number,
): TrackCoordinate {
  const toVector = ([longitude, latitude]: TrackCoordinate): readonly [
    number,
    number,
    number,
  ] => {
    const longitudeRadians = (longitude * Math.PI) / 180;
    const latitudeRadians = (latitude * Math.PI) / 180;
    return [
      Math.cos(latitudeRadians) * Math.cos(longitudeRadians),
      Math.cos(latitudeRadians) * Math.sin(longitudeRadians),
      Math.sin(latitudeRadians),
    ];
  };
  const startVector = toVector(start);
  const endVector = toVector(end);
  const dot = Math.max(
    -1,
    Math.min(
      1,
      startVector[0] * endVector[0] +
        startVector[1] * endVector[1] +
        startVector[2] * endVector[2],
    ),
  );
  const angle = Math.acos(dot);
  if (angle < 1e-12) return start;
  const sine = Math.sin(angle);
  const startWeight = Math.sin((1 - fraction) * angle) / sine;
  const endWeight = Math.sin(fraction * angle) / sine;
  const x = startVector[0] * startWeight + endVector[0] * endWeight;
  const y = startVector[1] * startWeight + endVector[1] * endWeight;
  const z = startVector[2] * startWeight + endVector[2] * endWeight;
  const longitude = (Math.atan2(y, x) * 180) / Math.PI;
  return [
    ((((longitude + 180) % 360) + 360) % 360) - 180,
    (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI,
  ];
}

function interpolateRecordedAt(
  start: string | undefined,
  end: string | undefined,
  fraction: number,
): string | undefined {
  if (start === undefined || end === undefined) return undefined;
  const startMillis = Date.parse(start);
  const endMillis = Date.parse(end);
  if (!Number.isFinite(startMillis) || !Number.isFinite(endMillis)) return undefined;
  return new Date(startMillis + (endMillis - startMillis) * fraction).toISOString();
}

function stationCount(segment: TrackSegment): number {
  let distanceMeters = 0;
  for (let index = 1; index < segment.points.length; index += 1) {
    const previous = segment.points[index - 1];
    const current = segment.points[index];
    if (previous !== undefined && current !== undefined) {
      distanceMeters += geodesicDistanceMeters(previous.coordinate, current.coordinate);
    }
  }
  const wholeStations = Math.floor(distanceMeters / sampleIntervalMeters);
  return (
    wholeStations +
    1 +
    (distanceMeters - wholeStations * sampleIntervalMeters > 1e-6 ? 1 : 0)
  );
}

function resampleSegment(
  segment: TrackSegment,
  sourceSegmentIndex: number,
  signal: AbortSignal,
): readonly ResampledStation[] {
  const points = segment.points;
  const distances = [0];
  signal.throwIfAborted();
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const accumulated = distances[index - 1] ?? 0;
    distances.push(
      previous === undefined || current === undefined
        ? accumulated
        : accumulated + geodesicDistanceMeters(previous.coordinate, current.coordinate),
    );
  }
  const totalDistance = distances.at(-1) ?? 0;
  const stations: ResampledStation[] = [];
  let legIndex = 0;
  const appendStation = (distanceMeters: number): void => {
    while (
      legIndex < points.length - 2 &&
      (distances[legIndex + 1] ?? Infinity) < distanceMeters
    ) {
      legIndex += 1;
    }
    const start = points[legIndex];
    const end = points[legIndex + 1] ?? start;
    const startDistance = distances[legIndex] ?? 0;
    const endDistance = distances[legIndex + 1] ?? startDistance;
    if (start === undefined || end === undefined) return;
    const legDistance = endDistance - startDistance;
    const fraction =
      legDistance === 0 ? 0 : (distanceMeters - startDistance) / legDistance;
    const exactStart = fraction <= 1e-9;
    const exactEnd = fraction >= 1 - 1e-9;
    const sourcePoint = exactStart ? start : exactEnd ? end : undefined;
    const recordedAt =
      sourcePoint?.recordedAt ??
      interpolateRecordedAt(start.recordedAt, end.recordedAt, fraction);
    const sourceElevationMeters =
      sourcePoint?.elevationMeters ??
      (legDistance <= sourceInterpolationMaximumDistanceMeters &&
      start.elevationMeters !== undefined &&
      end.elevationMeters !== undefined
        ? start.elevationMeters +
          (end.elevationMeters - start.elevationMeters) * fraction
        : undefined);
    const station: ResampledStation = {
      coordinate:
        sourcePoint?.coordinate ??
        interpolateCoordinate(start.coordinate, end.coordinate, fraction),
      sourceSegmentIndex,
      ...(recordedAt === undefined ? {} : { recordedAt }),
      ...(sourceElevationMeters === undefined ? {} : { sourceElevationMeters }),
    };
    stations.push(station);
  };
  for (
    let distanceMeters = 0;
    distanceMeters <= totalDistance;
    distanceMeters += sampleIntervalMeters
  ) {
    if (stations.length % 1_000 === 0) signal.throwIfAborted();
    appendStation(Math.min(distanceMeters, totalDistance));
  }
  const endpoint = points.at(-1);
  if (endpoint !== undefined) {
    const endpointStation: ResampledStation = {
      coordinate: endpoint.coordinate,
      sourceSegmentIndex,
      ...(endpoint.recordedAt === undefined ? {} : { recordedAt: endpoint.recordedAt }),
      ...(endpoint.elevationMeters === undefined
        ? {}
        : { sourceElevationMeters: endpoint.elevationMeters }),
    };
    const finalStation = stations.at(-1);
    if (
      finalStation?.coordinate[0] === endpoint.coordinate[0] &&
      finalStation.coordinate[1] === endpoint.coordinate[1]
    ) {
      stations[stations.length - 1] = endpointStation;
    } else {
      stations.push(endpointStation);
    }
  }
  return stations;
}

function availableMeters(sample: ElevationSample | undefined): number | undefined {
  return sample?.status === 'available' && Number.isFinite(sample.meters)
    ? sample.meters
    : undefined;
}

function fillMissingElevations(
  values: (number | undefined)[],
  distances: readonly number[],
): void {
  let firstKnown = values.findIndex((value) => value !== undefined);
  if (firstKnown < 0) throw new TrackElevationPreparationError('elevation-unavailable');
  const firstValue = values[firstKnown];
  while (firstKnown > 0) {
    firstKnown -= 1;
    values[firstKnown] = firstValue;
  }
  let index = 0;
  while (index < values.length) {
    if (values[index] !== undefined) {
      index += 1;
      continue;
    }
    const missingStart = index;
    while (index < values.length && values[index] === undefined) index += 1;
    const previousIndex = missingStart - 1;
    const nextIndex = index;
    const previous = values[previousIndex];
    const next = values[nextIndex];
    if (previous === undefined) continue;
    if (next === undefined) {
      for (let trailing = missingStart; trailing < values.length; trailing += 1)
        values[trailing] = previous;
      break;
    }
    const startDistance = distances[previousIndex] ?? 0;
    const endDistance = distances[nextIndex] ?? startDistance;
    for (let missing = missingStart; missing < nextIndex; missing += 1) {
      const fraction =
        endDistance === startDistance
          ? 0
          : ((distances[missing] ?? startDistance) - startDistance) /
            (endDistance - startDistance);
      values[missing] = previous + (next - previous) * fraction;
    }
  }
}

function stationDistances(stations: readonly ResampledStation[]): readonly number[] {
  const distances = [0];
  for (let index = 1; index < stations.length; index += 1) {
    const previous = stations[index - 1];
    const current = stations[index];
    distances.push(
      (distances[index - 1] ?? 0) +
        (previous === undefined || current === undefined
          ? 0
          : geodesicDistanceMeters(previous.coordinate, current.coordinate)),
    );
  }
  return distances;
}

export async function prepareImportedTrack(
  segments: readonly TrackSegment[],
  elevationProvider: ElevationProvider | null,
  signal: AbortSignal,
): Promise<PreparedImportedTrack> {
  signal.throwIfAborted();
  let totalPoints = 0;
  let hasRouteDistance = false;
  for (const segment of segments) {
    const segmentStationCount = stationCount(segment);
    totalPoints += segmentStationCount;
    if (segmentStationCount > 1) hasRouteDistance = true;
    if (totalPoints > maximumPersistedPoints) {
      throw new TrackElevationPreparationError('point-limit-exceeded');
    }
  }
  if (!hasRouteDistance) throw new TrackElevationPreparationError('zero-length-track');
  const resampled = segments.map((segment, index) =>
    resampleSegment(segment, index, signal),
  );
  const stations = resampled.flat();
  const samples =
    elevationProvider === null
      ? stations.map(() => ({ status: 'unavailable' }) as const)
      : await elevationProvider.sampleMany(
          stations.map((station) => ({
            longitude: station.coordinate[0],
            latitude: station.coordinate[1],
          })),
          signal,
        );
  signal.throwIfAborted();
  let sampleOffset = 0;
  const assembled: ElevationSampleInput[][] = [];
  for (const stationSegment of resampled) {
    const segmentSamples = samples.slice(
      sampleOffset,
      sampleOffset + stationSegment.length,
    );
    sampleOffset += stationSegment.length;
    const distances = stationDistances(stationSegment);
    const values = stationSegment.map(
      (station, index) =>
        station.sourceElevationMeters ?? availableMeters(segmentSamples[index]),
    );
    for (let index = 1; index < stationSegment.length - 1; index += 1) {
      const source = stationSegment[index]?.sourceElevationMeters;
      const previous = values[index - 1];
      const next = values[index + 1];
      const dem = availableMeters(segmentSamples[index]);
      if (
        source === undefined ||
        previous === undefined ||
        next === undefined ||
        dem === undefined
      )
        continue;
      const neighborMedian = (previous + next) / 2;
      const neighborResidual = source - neighborMedian;
      const demResidual = source - dem;
      if (
        Math.abs(neighborResidual) >= 30 &&
        Math.abs(demResidual) >= 30 &&
        Math.sign(neighborResidual) === Math.sign(demResidual)
      ) {
        values[index] = Math.abs(dem - neighborMedian) <= 30 ? dem : neighborMedian;
      }
    }
    fillMissingElevations(values, distances);
    assembled.push(
      stationSegment.map((station, index) => ({
        coordinate: station.coordinate,
        ...(station.recordedAt === undefined ? {} : { recordedAt: station.recordedAt }),
        elevationMeters: values[index] ?? 0,
        sourceSegmentIndex: station.sourceSegmentIndex,
      })),
    );
  }
  const filtered = medianFilterElevationSamples(assembled);
  const profile = calculateElevationProfile(filtered);
  if (profile === null)
    throw new TrackElevationPreparationError('elevation-unavailable');
  const preparedSegments = filtered.map((segment) => ({
    points: segment.map((point) => ({
      coordinate: point.coordinate,
      ...(point.recordedAt === undefined ? {} : { recordedAt: point.recordedAt }),
      elevationMeters: point.elevationMeters,
    })),
  }));
  return {
    segments: preparedSegments,
    profile,
    metrics: calculateTrackMetrics(preparedSegments),
  };
}
