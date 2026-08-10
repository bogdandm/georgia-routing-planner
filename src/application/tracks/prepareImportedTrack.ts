import type {
  ElevationProvider,
  ElevationSample,
  ElevationSamplingProgress,
} from '@/application/ports/ElevationProvider';
import {
  calculateElevationProfile,
  filterDemElevationSamples,
  medianFilterElevationSamples,
  type ElevationProfile,
  type ElevationProfileInputPoint,
  type ElevationSampleInput,
} from '@/domain/tracks/elevationProfile';
import type { TrackCoordinate, TrackSegment } from '@/domain/tracks/gpx';
import {
  calculateTrackMetrics,
  geodesicDistanceMeters,
  type TrackMetrics,
} from '@/domain/tracks/trackCalculations';

const defaultSampleIntervalMeters = 10;
const maximumPersistedPoints = 100_000;

interface ResampledStation {
  readonly coordinate: TrackCoordinate;
  readonly recordedAt?: string;
  readonly sourceSegmentIndex: number;
}

export interface TrackElevationProgressPoint {
  readonly distanceMeters: number;
  readonly elevationMeters: number | null;
}

export interface TrackElevationPreparationProgress {
  readonly completedTiles: number;
  readonly totalTiles: number;
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
    const previous = segment.points[index - 1];
    const current = segment.points[index];
    if (previous !== undefined && current !== undefined) {
      distanceMeters += geodesicDistanceMeters(previous.coordinate, current.coordinate);
    }
  }
  return distanceMeters;
}

function stationCount(distanceMeters: number, intervalMeters: number): number {
  const wholeStations = Math.floor(distanceMeters / intervalMeters);
  return (
    wholeStations + 1 + (distanceMeters - wholeStations * intervalMeters > 1e-6 ? 1 : 0)
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
    const station: ResampledStation = {
      coordinate:
        sourcePoint?.coordinate ??
        interpolateCoordinate(start.coordinate, end.coordinate, fraction),
      sourceSegmentIndex,
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
  const endpoint = points.at(-1);
  if (endpoint !== undefined) {
    const endpointStation: ResampledStation = {
      coordinate: endpoint.coordinate,
      sourceSegmentIndex,
      ...(endpoint.recordedAt === undefined ? {} : { recordedAt: endpoint.recordedAt }),
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
    const previous = points[index - 1];
    const current = points[index];
    distances.push(
      (distances[index - 1] ?? 0) +
        (previous === undefined || current === undefined
          ? 0
          : geodesicDistanceMeters(previous.coordinate, current.coordinate)),
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
      const distanceMeters = sourceDistances[index] ?? 0;
      while (
        sampleIndex < samples.length - 2 &&
        (sampleDistances[sampleIndex + 1] ?? Infinity) < distanceMeters
      ) {
        sampleIndex += 1;
      }
      const start = samples[sampleIndex];
      const end = samples[sampleIndex + 1] ?? start;
      const startDistance = sampleDistances[sampleIndex] ?? 0;
      const endDistance = sampleDistances[sampleIndex + 1] ?? startDistance;
      if (start === undefined || end === undefined) {
        throw new TrackElevationPreparationError('elevation-unavailable');
      }
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
  const distancesBySegment = resampled.map((segment) => pointDistances(segment));
  const stationDistanceMeters: number[] = [];
  let distanceOffset = 0;
  for (const distances of distancesBySegment) {
    for (const distanceMeters of distances) {
      stationDistanceMeters.push(distanceOffset + distanceMeters);
    }
    distanceOffset += distances.at(-1) ?? 0;
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
  const publishProgress = (progress: ElevationSamplingProgress): void => {
    if (onProgress === undefined) return;
    for (const [sampleOffset, stationIndex] of progress.indices.entries()) {
      const previewSlot = previewSlotsByStationIndex.get(stationIndex);
      if (previewSlot === undefined) continue;
      previewDemElevations[previewSlot] = availableMeters(
        progress.samples[sampleOffset],
      );
    }
    onProgress({
      completedTiles: progress.completedTiles,
      totalTiles: progress.totalTiles,
      points: previewIndices.map((stationIndex, slot) => ({
        distanceMeters: stationDistanceMeters[stationIndex] ?? 0,
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
    shouldPublishProgress ? publishProgress : undefined,
  );
  signal.throwIfAborted();

  let sampleOffset = 0;
  const assembled: ElevationSampleInput[][] = [];
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
    const distances = distancesBySegment[segmentIndex] ?? [];
    fillMissingElevations(values, distances);
    assembled.push(
      stationSegment.map((station, index) => ({
        coordinate: station.coordinate,
        ...(station.recordedAt === undefined ? {} : { recordedAt: station.recordedAt }),
        elevationMeters: values[index] ?? 0,
        sourceSegmentIndex: station.sourceSegmentIndex,
      })),
    );
    const source = routableSegments[segmentIndex]?.segment;
    if (source === undefined) {
      throw new TrackElevationPreparationError('elevation-unavailable');
    }
    assembledSources.push(source);
    assembledDistances.push(distances);
  }

  const filtered = filterDemElevationSamples(assembled);
  const calculatedSegments = options.preserveGeometry
    ? filtered.map((segment, index) => {
        const source = assembledSources[index];
        if (source === undefined) {
          throw new TrackElevationPreparationError('elevation-unavailable');
        }
        return preserveSegmentGeometry(
          source,
          segment,
          assembledDistances[index] ?? [],
        );
      })
    : filtered.map((segment) => ({
        points: segment.map((point) => ({
          coordinate: point.coordinate,
          ...(point.recordedAt === undefined ? {} : { recordedAt: point.recordedAt }),
          elevationMeters: point.elevationMeters,
        })),
      }));
  const calculatedProfile = calculateElevationProfile(
    options.preserveGeometry ? calculatedProfileInputs(calculatedSegments) : filtered,
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
  return {
    ...sourceResult,
    calculatedSegments,
    calculatedProfile,
    calculatedMetrics: calculateTrackMetrics(calculatedSegments, 'dem-assisted'),
  };
}
