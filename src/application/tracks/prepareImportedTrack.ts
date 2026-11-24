import type {
  ElevationProvider,
  ElevationSample,
  ElevationSamplingProgress,
} from '@/application/ports/ElevationProvider';
import {
  calculateElevationProfile,
  medianFilterElevationSamples,
  type ElevationProfile,
  type ElevationProfileInputPoint,
  type ElevationSampleInput,
} from '@/domain/tracks/elevationProfile';
import type { TrackCoordinate, TrackPoint, TrackSegment } from '@/domain/tracks/gpx';
import {
  calculateTrackMetrics,
  geodesicDistanceMeters,
  type TrackMetrics,
} from '@/domain/tracks/trackCalculations';

const defaultSampleIntervalMeters = 10;
const maximumPersistedPoints = 100_000;
const stationDistanceToleranceMeters = 1e-6;

interface ResampledStation {
  readonly coordinate: TrackCoordinate;
  readonly recordedAt?: string;
  readonly sourceSegmentIndex: number;
  /** Distance along the source polyline; chords between stations can be shorter. */
  readonly sourceDistanceMeters: number;
}

export interface TrackElevationProgressPoint {
  readonly distanceMeters: number;
  readonly elevationMeters: number | null;
}

export interface TrackElevationPreparationProgress {
  readonly completedSamples: number;
  readonly totalSamples: number;
  readonly points: readonly TrackElevationProgressPoint[];
}

export interface PrepareImportedTrackOptions {
  readonly onProgress?: (progress: TrackElevationPreparationProgress) => void;
  readonly preserveGeometry?: boolean;
  readonly sampleIntervalMeters?: number;
  readonly maximumElevationSamples?: number;
}

export interface PreparedImportedTrack {
  readonly sourceSegments: readonly TrackSegment[];
  readonly sourceProfile: ElevationProfile | null;
  readonly sourceMetrics: TrackMetrics;
  readonly calculatedSegments: readonly TrackSegment[] | null;
  readonly calculatedProfile: ElevationProfile | null;
  readonly calculatedMetrics: TrackMetrics | null;
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

function requiredValue<T>(values: readonly (T | undefined)[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new TrackElevationPreparationError('elevation-unavailable');
  }
  return value;
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

function segmentDistanceMeters(segment: TrackSegment): number {
  let distanceMeters = 0;
  for (let index = 1; index < segment.points.length; index += 1) {
    const previous = requiredValue(segment.points, index - 1);
    const current = requiredValue(segment.points, index);
    distanceMeters += geodesicDistanceMeters(previous.coordinate, current.coordinate);
  }
  return distanceMeters;
}

function stationCount(distanceMeters: number, intervalMeters: number): number {
  const wholeStations = Math.floor(distanceMeters / intervalMeters);
  return (
    wholeStations +
    1 +
    (distanceMeters - wholeStations * intervalMeters > stationDistanceToleranceMeters
      ? 1
      : 0)
  );
}

function resampleSegment(
  segment: TrackSegment,
  sourceSegmentIndex: number,
  signal: AbortSignal,
  intervalMeters: number,
): readonly ResampledStation[] {
  const points = segment.points;
  const distances = [0];
  signal.throwIfAborted();
  for (let index = 1; index < points.length; index += 1) {
    const previous = requiredValue(points, index - 1);
    const current = requiredValue(points, index);
    distances.push(
      requiredValue(distances, index - 1) +
        geodesicDistanceMeters(previous.coordinate, current.coordinate),
    );
  }
  const totalDistance = requiredValue(distances, distances.length - 1);
  const stations: ResampledStation[] = [];
  let legIndex = 0;
  const appendStation = (distanceMeters: number): void => {
    while (
      legIndex < points.length - 2 &&
      requiredValue(distances, legIndex + 1) < distanceMeters
    ) {
      legIndex += 1;
    }
    const start = requiredValue(points, legIndex);
    const end = requiredValue(points, legIndex + 1);
    const startDistance = requiredValue(distances, legIndex);
    const endDistance = requiredValue(distances, legIndex + 1);
    const legDistance = endDistance - startDistance;
    const fraction =
      legDistance === 0 ? 0 : (distanceMeters - startDistance) / legDistance;
    const exactStart = fraction <= 1e-9;
    const exactEnd = fraction >= 1 - 1e-9;
    const sourcePoint = exactStart ? start : exactEnd ? end : undefined;
    const recordedAt =
      sourcePoint?.recordedAt ??
      interpolateRecordedAt(start.recordedAt, end.recordedAt, fraction);
    const station: ResampledStation = {
      coordinate:
        sourcePoint?.coordinate ??
        interpolateCoordinate(start.coordinate, end.coordinate, fraction),
      sourceSegmentIndex,
      sourceDistanceMeters: distanceMeters,
      ...(recordedAt === undefined ? {} : { recordedAt }),
    };
    stations.push(station);
  };
  for (
    let distanceMeters = 0;
    distanceMeters <= totalDistance;
    distanceMeters += intervalMeters
  ) {
    if (stations.length % 1_000 === 0) signal.throwIfAborted();
    appendStation(Math.min(distanceMeters, totalDistance));
  }
  const endpoint = requiredValue(points, points.length - 1);
  const endpointStation: ResampledStation = {
    coordinate: endpoint.coordinate,
    sourceSegmentIndex,
    sourceDistanceMeters: totalDistance,
    ...(endpoint.recordedAt === undefined ? {} : { recordedAt: endpoint.recordedAt }),
  };
  const finalStation = requiredValue(stations, stations.length - 1);
  // Compare path positions, not coordinates: a route may revisit its endpoint earlier.
  if (
    totalDistance - finalStation.sourceDistanceMeters <=
    stationDistanceToleranceMeters
  ) {
    stations[stations.length - 1] = endpointStation;
  } else {
    stations.push(endpointStation);
  }
  return stations;
}

function availableMeters(sample: ElevationSample | undefined): number | undefined {
  return sample?.status === 'available' && Number.isFinite(sample.meters)
    ? sample.meters
    : undefined;
}

function elevationProfileInputs(
  segments: readonly TrackSegment[],
): readonly (readonly ElevationSampleInput[])[] {
  const runs: ElevationSampleInput[][] = [];
  segments.forEach((segment, sourceSegmentIndex) => {
    let run: ElevationSampleInput[] = [];
    const finishRun = (): void => {
      if (run.length >= 2) runs.push(run);
      run = [];
    };
    for (const point of segment.points) {
      if (point.elevationMeters === undefined) {
        finishRun();
        continue;
      }
      const input: ElevationSampleInput = {
        coordinate: point.coordinate,
        elevationMeters: point.elevationMeters,
        sourceSegmentIndex,
        ...(point.recordedAt === undefined ? {} : { recordedAt: point.recordedAt }),
      };
      run.push(input);
    }
    finishRun();
  });
  return runs;
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

function pointDistances(
  points: readonly { readonly coordinate: TrackCoordinate }[],
): readonly number[] {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = requiredValue(points, index - 1);
    const current = requiredValue(points, index);
    distances.push(
      requiredValue(distances, index - 1) +
        geodesicDistanceMeters(previous.coordinate, current.coordinate),
    );
  }
  return distances;
}

function preserveSegmentGeometry(
  source: TrackSegment,
  samples: readonly ElevationProfileInputPoint[],
  sampleDistances: readonly number[],
): TrackSegment {
  const sourceDistances = pointDistances(source.points);
  let sampleIndex = 0;
  return {
    points: source.points.map((point, index) => {
      const distanceMeters = requiredValue(sourceDistances, index);
      while (
        sampleIndex < samples.length - 2 &&
        requiredValue(sampleDistances, sampleIndex + 1) < distanceMeters
      ) {
        sampleIndex += 1;
      }
      const start = requiredValue(samples, sampleIndex);
      const end = requiredValue(samples, sampleIndex + 1);
      const startDistance = requiredValue(sampleDistances, sampleIndex);
      const endDistance = requiredValue(sampleDistances, sampleIndex + 1);
      const fraction =
        endDistance === startDistance
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                (distanceMeters - startDistance) / (endDistance - startDistance),
              ),
            );
      return {
        coordinate: point.coordinate,
        ...(point.recordedAt === undefined ? {} : { recordedAt: point.recordedAt }),
        elevationMeters:
          start.elevationMeters +
          (end.elevationMeters - start.elevationMeters) * fraction,
      };
    }),
  };
}

function calculatedProfileInputs(
  segments: readonly TrackSegment[],
): readonly (readonly ElevationProfileInputPoint[])[] {
  return segments.map((segment, sourceSegmentIndex) =>
    segment.points.flatMap((point) =>
      point.elevationMeters === undefined
        ? []
        : [
            {
              coordinate: point.coordinate,
              ...(point.recordedAt === undefined
                ? {}
                : { recordedAt: point.recordedAt }),
              rawElevationMeters: point.elevationMeters,
              elevationMeters: point.elevationMeters,
              sourceSegmentIndex,
            },
          ],
    ),
  );
}

export async function prepareImportedTrack(
  segments: readonly TrackSegment[],
  elevationProvider: ElevationProvider | null,
  signal: AbortSignal,
  options: PrepareImportedTrackOptions = {},
): Promise<PreparedImportedTrack> {
  signal.throwIfAborted();
  const configuredIntervalMeters =
    options.sampleIntervalMeters ?? defaultSampleIntervalMeters;
  const maximumElevationSamples =
    options.maximumElevationSamples ?? maximumPersistedPoints;
  if (
    !Number.isFinite(configuredIntervalMeters) ||
    configuredIntervalMeters <= 0 ||
    !Number.isInteger(maximumElevationSamples) ||
    maximumElevationSamples < 2
  ) {
    throw new Error('Elevation sampling options are invalid.');
  }
  const routableSegments: {
    readonly segment: TrackSegment;
    readonly sourceSegmentIndex: number;
  }[] = [];
  let totalDistanceMeters = 0;
  segments.forEach((segment, sourceSegmentIndex) => {
    const distanceMeters = segmentDistanceMeters(segment);
    if (distanceMeters <= 0) return;
    totalDistanceMeters += distanceMeters;
    routableSegments.push({ segment, sourceSegmentIndex });
  });
  if (routableSegments.length === 0) {
    throw new TrackElevationPreparationError('zero-length-track');
  }

  const sourceMetrics = calculateTrackMetrics(segments);
  const sourceProfile = calculateElevationProfile(
    medianFilterElevationSamples(elevationProfileInputs(segments)),
  );
  const sourceResult = {
    sourceSegments: segments,
    sourceProfile,
    sourceMetrics,
  };
  if (elevationProvider === null) {
    if (sourceProfile === null) {
      throw new TrackElevationPreparationError('elevation-unavailable');
    }
    return {
      ...sourceResult,
      calculatedSegments: null,
      calculatedProfile: null,
      calculatedMetrics: null,
    };
  }
  const effectiveIntervalMeters =
    options.maximumElevationSamples === undefined
      ? configuredIntervalMeters
      : Math.max(
          configuredIntervalMeters,
          totalDistanceMeters / (maximumElevationSamples - 1),
        );
  const totalPoints = routableSegments.reduce(
    (count, { segment }) =>
      count + stationCount(segmentDistanceMeters(segment), effectiveIntervalMeters),
    0,
  );
  if (totalPoints > maximumElevationSamples) {
    throw new TrackElevationPreparationError('point-limit-exceeded');
  }

  const resampled = routableSegments.map(({ segment, sourceSegmentIndex }) =>
    resampleSegment(segment, sourceSegmentIndex, signal, effectiveIntervalMeters),
  );
  const stations = resampled.flat();
  // Retained geometry is measured along the source polyline, so its stations must be
  // too: chords between sparse stations cut switchbacks, and mapping source vertices
  // onto chord distances shifts elevations forward and flattens the track end.
  const distancesBySegment = resampled.map((segment) =>
    options.preserveGeometry
      ? segment.map((station) => station.sourceDistanceMeters)
      : pointDistances(segment),
  );
  const stationDistanceMeters: number[] = [];
  let distanceOffset = 0;
  for (const distances of distancesBySegment) {
    for (const distanceMeters of distances) {
      stationDistanceMeters.push(distanceOffset + distanceMeters);
    }
    distanceOffset += requiredValue(distances, distances.length - 1);
  }
  const onProgress = options.onProgress;
  const shouldPublishProgress = onProgress !== undefined;
  const previewIndices = shouldPublishProgress
    ? stations.length > 1_200
      ? Array.from({ length: 1_200 }, (_, slot) =>
          Math.round((slot * (stations.length - 1)) / 1_199),
        )
      : stations.map((_, index) => index)
    : [];
  const previewSlotsByStationIndex = new Map(
    previewIndices.map((stationIndex, slot) => [stationIndex, slot]),
  );
  const previewDemElevations: (number | undefined)[] = previewIndices.map(
    () => undefined,
  );
  const publishProgress =
    onProgress === undefined
      ? undefined
      : (progress: ElevationSamplingProgress): void => {
          for (const [sampleOffset, stationIndex] of progress.indices.entries()) {
            const previewSlot = previewSlotsByStationIndex.get(stationIndex);
            if (previewSlot === undefined) continue;
            previewDemElevations[previewSlot] = availableMeters(
              progress.samples[sampleOffset],
            );
          }
          onProgress({
            completedSamples: progress.completedSamples,
            totalSamples: progress.totalSamples,
            points: previewIndices.map((stationIndex, slot) => ({
              distanceMeters: requiredValue(stationDistanceMeters, stationIndex),
              elevationMeters: previewDemElevations[slot] ?? null,
            })),
          });
        };
  const samples = await elevationProvider.sampleMany(
    stations.map((station) => ({
      longitude: station.coordinate[0],
      latitude: station.coordinate[1],
    })),
    signal,
    publishProgress,
  );
  signal.throwIfAborted();

  let sampleOffset = 0;
  const assembled: ElevationProfileInputPoint[][] = [];
  const assembledSources: TrackSegment[] = [];
  const assembledDistances: (readonly number[])[] = [];
  for (const [segmentIndex, stationSegment] of resampled.entries()) {
    const segmentSamples = samples.slice(
      sampleOffset,
      sampleOffset + stationSegment.length,
    );
    sampleOffset += stationSegment.length;
    const values = stationSegment.map((_, index) =>
      availableMeters(segmentSamples[index]),
    );
    if (values.every((value) => value === undefined)) continue;
    const distances = requiredValue(distancesBySegment, segmentIndex);
    fillMissingElevations(values, distances);
    assembled.push(
      stationSegment.map((station, index) => {
        const elevationMeters = requiredValue(values, index);
        return {
          coordinate: station.coordinate,
          ...(station.recordedAt === undefined
            ? {}
            : { recordedAt: station.recordedAt }),
          rawElevationMeters: elevationMeters,
          elevationMeters,
          sourceSegmentIndex: station.sourceSegmentIndex,
        };
      }),
    );
    const source = requiredValue(routableSegments, segmentIndex).segment;
    assembledSources.push(source);
    assembledDistances.push(distances);
  }

  const calculatedSegments = options.preserveGeometry
    ? assembled.map((segment, index) => {
        const source = requiredValue(assembledSources, index);
        return preserveSegmentGeometry(
          source,
          segment,
          requiredValue(assembledDistances, index),
        );
      })
    : assembled.map((segment) => ({
        points: segment.map((point) => ({
          coordinate: point.coordinate,
          ...(point.recordedAt === undefined ? {} : { recordedAt: point.recordedAt }),
          elevationMeters: point.elevationMeters,
        })),
      }));
  const calculatedProfile = calculateElevationProfile(
    options.preserveGeometry ? calculatedProfileInputs(calculatedSegments) : assembled,
  );
  if (calculatedProfile === null) {
    if (sourceProfile === null) {
      throw new TrackElevationPreparationError('elevation-unavailable');
    }
    return {
      ...sourceResult,
      calculatedSegments: null,
      calculatedProfile: null,
      calculatedMetrics: null,
    };
  }
  const prepared: PreparedImportedTrack = {
    ...sourceResult,
    calculatedSegments,
    calculatedProfile,
    calculatedMetrics: calculateTrackMetrics(calculatedSegments, 'dem-assisted'),
  };
  // Without usable source elevation the DEM projection is saved as the track itself, so
  // it keeps every source vertex.
  return sourceProfile !== null ||
    options.preserveGeometry === true ||
    !canReplaceSourceElevation(prepared)
    ? prepared
    : withCanonicalDemProjection(prepared, resampled);
}

function routableSourceSegments(
  prepared: PreparedImportedTrack,
): readonly TrackSegment[] {
  return prepared.sourceSegments.filter(
    (segment) => segmentDistanceMeters(segment) > 0,
  );
}

/**
 * Whether the DEM projection can replace the source elevation without changing the
 * geometry: every source segment has length (a stationary one has no DEM stations to keep
 * it), the projection has every segment (preparation skips segments without any DEM
 * sample), and its stations plus every source vertex stay within the persisted point
 * limit. That count is an upper bound: vertices replace stations at the same position.
 */
export function canReplaceSourceElevation(prepared: PreparedImportedTrack): boolean {
  const calculatedSegments = prepared.calculatedSegments;
  if (calculatedSegments === null) return false;
  const routable = routableSourceSegments(prepared);
  let mergedPointCount = 0;
  for (const segment of [...calculatedSegments, ...routable]) {
    mergedPointCount += segment.points.length;
  }
  return (
    routable.length === prepared.sourceSegments.length &&
    calculatedSegments.length === routable.length &&
    mergedPointCount <= maximumPersistedPoints
  );
}

/**
 * Puts every source vertex back among the DEM stations sampled along it, so a canonical
 * DEM projection keeps the drawn geometry instead of cutting bends between stations. A
 * vertex takes the elevation interpolated between its neighbouring stations, which adds
 * no climb, and replaces a station at the same position. Times come from both inputs.
 */
function mergeSourceVertices(
  source: TrackSegment,
  stations: readonly ResampledStation[],
  calculated: TrackSegment,
): TrackSegment {
  if (stations.length !== calculated.points.length) {
    throw new Error('The DEM projection does not match its stations.');
  }
  const stationMeters = calculated.points.map((point) => {
    if (point.elevationMeters === undefined) {
      throw new TrackElevationPreparationError('elevation-unavailable');
    }
    return point.elevationMeters;
  });
  const stationDistance = (index: number): number =>
    requiredValue(stations, index).sourceDistanceMeters;
  const vertexDistances = pointDistances(source.points);
  const points: TrackPoint[] = [];
  let stationIndex = 0;
  source.points.forEach((vertex, vertexIndex) => {
    const vertexDistance = requiredValue(vertexDistances, vertexIndex);
    while (
      stationDistance(stationIndex) <
      vertexDistance - stationDistanceToleranceMeters
    ) {
      points.push(requiredValue(calculated.points, stationIndex));
      stationIndex += 1;
    }
    // The last station sits on the last vertex, so `stationIndex` stays in range.
    const previousIndex = Math.max(0, stationIndex - 1);
    const span = stationDistance(stationIndex) - stationDistance(previousIndex);
    const fraction =
      span <= stationDistanceToleranceMeters
        ? 1
        : (vertexDistance - stationDistance(previousIndex)) / span;
    const previousMeters = requiredValue(stationMeters, previousIndex);
    const point: { -readonly [Key in keyof TrackPoint]: TrackPoint[Key] } = {
      coordinate: vertex.coordinate,
      elevationMeters:
        previousMeters +
        (requiredValue(stationMeters, stationIndex) - previousMeters) *
          Math.min(1, Math.max(0, fraction)),
    };
    if (vertex.recordedAt !== undefined) point.recordedAt = vertex.recordedAt;
    points.push(point);
    while (
      stationIndex < stations.length - 1 &&
      stationDistance(stationIndex) <= vertexDistance + stationDistanceToleranceMeters
    ) {
      stationIndex += 1;
    }
  });
  return { points };
}

/** Makes the DEM projection canonical: source elevation goes, source vertices stay. */
function withCanonicalDemProjection(
  prepared: PreparedImportedTrack,
  stationsBySegment: readonly (readonly ResampledStation[])[],
): PreparedImportedTrack {
  const calculatedSegments = routableSourceSegments(prepared).map((segment, index) =>
    mergeSourceVertices(
      segment,
      requiredValue(stationsBySegment, index),
      requiredValue(prepared.calculatedSegments ?? [], index),
    ),
  );
  const sourceSegments = prepared.sourceSegments.map((segment) => ({
    points: segment.points.map(({ coordinate, recordedAt }) =>
      recordedAt === undefined ? { coordinate } : { coordinate, recordedAt },
    ),
  }));
  return {
    ...prepared,
    sourceSegments,
    sourceProfile: null,
    sourceMetrics: calculateTrackMetrics(sourceSegments),
    calculatedSegments,
    calculatedProfile: calculateElevationProfile(
      calculatedProfileInputs(calculatedSegments),
    ),
    calculatedMetrics: calculateTrackMetrics(calculatedSegments, 'dem-assisted'),
  };
}

/**
 * Replaces usable source elevation with the DEM projection prepared at the default
 * interval, keeping every source vertex. Call it only when `canReplaceSourceElevation`
 * holds and the source still has a profile; preparation already does this otherwise.
 */
export function withoutSourceElevation(
  prepared: PreparedImportedTrack,
): PreparedImportedTrack {
  const signal = new AbortController().signal;
  return withCanonicalDemProjection(
    prepared,
    routableSourceSegments(prepared).map((segment, index) =>
      resampleSegment(segment, index, signal, defaultSampleIntervalMeters),
    ),
  );
}

/** Drops every point time from both projections and recomputes what depends on them. */
export function withoutPointTimes(
  prepared: PreparedImportedTrack,
): PreparedImportedTrack {
  const withoutTimes = (segments: readonly TrackSegment[]): readonly TrackSegment[] =>
    segments.map((segment) => ({
      points: segment.points.map(({ coordinate, elevationMeters }) =>
        elevationMeters === undefined
          ? { coordinate }
          : { coordinate, elevationMeters },
      ),
    }));
  const sourceSegments = withoutTimes(prepared.sourceSegments);
  const result: PreparedImportedTrack = {
    ...prepared,
    sourceSegments,
    sourceMetrics: calculateTrackMetrics(sourceSegments),
  };
  if (prepared.calculatedSegments === null) return result;
  const calculatedSegments = withoutTimes(prepared.calculatedSegments);
  return {
    ...result,
    calculatedSegments,
    calculatedProfile: calculateElevationProfile(
      calculatedProfileInputs(calculatedSegments),
    ),
    calculatedMetrics: calculateTrackMetrics(calculatedSegments, 'dem-assisted'),
  };
}
