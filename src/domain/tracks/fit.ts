import { Decoder, Stream } from '@garmin/fitsdk';

import {
  GPX_PARSER_VERSION,
  GpxParseError,
  type ParsedGpx,
  type TrackPoint,
  type TrackSegment,
} from '@/domain/tracks/gpx';

const semicirclesToDegrees = 180 / 2 ** 31;
const maximumBytes = 10 * 1024 * 1024;
const maximumPoints = 100_000;
const segmentGapMilliseconds = 5 * 60 * 1_000;

function validCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** Decodes only ordered geographic record fields; sensor/profile data is discarded. */
export function parseFit(buffer: ArrayBuffer): ParsedGpx {
  if (buffer.byteLength > maximumBytes) {
    throw new GpxParseError(
      'file-too-large',
      'FIT file is larger than the import limit.',
    );
  }
  const decoder = new Decoder(Stream.fromArrayBuffer(buffer));
  if (!decoder.isFIT() || !decoder.checkIntegrity()) {
    throw new GpxParseError('invalid-xml', 'The FIT file failed its integrity check.');
  }
  const { messages, errors } = decoder.read({
    includeUnknownData: false,
    mergeHeartRates: false,
  });
  if (errors.length > 0) {
    throw new GpxParseError('invalid-xml', 'The FIT file could not be decoded safely.');
  }
  const fileType = messages.fileIdMesgs?.[0]?.type;
  if (fileType !== 'activity' && fileType !== 'course') {
    throw new GpxParseError(
      'empty-geometry',
      'Only FIT Activity and Course files with GPS positions are supported.',
    );
  }
  const segments: TrackSegment[] = [];
  let current: TrackPoint[] = [];
  let previousTime: number | undefined;
  for (const record of messages.recordMesgs ?? []) {
    if (
      current.length +
        segments.reduce((sum, segment) => sum + segment.points.length, 0) >=
      maximumPoints
    ) {
      throw new GpxParseError('limit-exceeded', 'FIT contains too many track points.');
    }
    if (
      typeof record.positionLat !== 'number' ||
      typeof record.positionLong !== 'number'
    ) {
      continue;
    }
    const latitude = record.positionLat * semicirclesToDegrees;
    const longitude = record.positionLong * semicirclesToDegrees;
    if (!validCoordinate(latitude, longitude)) continue;
    const timestamp =
      record.timestamp instanceof Date ? record.timestamp.getTime() : undefined;
    if (
      timestamp !== undefined &&
      previousTime !== undefined &&
      timestamp - previousTime > segmentGapMilliseconds &&
      current.length >= 2
    ) {
      segments.push({ points: current });
      current = [];
    }
    const elevation =
      typeof record.enhancedAltitude === 'number'
        ? record.enhancedAltitude
        : typeof record.altitude === 'number'
          ? record.altitude
          : undefined;
    const point: {
      coordinate: readonly [number, number];
      elevationMeters?: number;
      recordedAt?: string;
    } = { coordinate: [longitude, latitude] };
    if (elevation !== undefined && Number.isFinite(elevation)) {
      point.elevationMeters = elevation;
    }
    if (timestamp !== undefined) point.recordedAt = new Date(timestamp).toISOString();
    current.push(point);
    previousTime = timestamp;
  }
  if (current.length >= 2) segments.push({ points: current });
  if (segments.length === 0) {
    throw new GpxParseError(
      'empty-geometry',
      'The FIT file has no usable geographic track points.',
    );
  }
  const name =
    messages.courseMesgs?.[0]?.name ?? messages.sessionMesgs?.[0]?.sport?.toString();
  return {
    parserVersion: GPX_PARSER_VERSION,
    geometryKind: 'track',
    segments,
    pointCount: segments.reduce((sum, segment) => sum + segment.points.length, 0),
    metadata: {
      version: '1.1',
      links: [],
      ...(name === undefined ? {} : { selectedName: name }),
    },
    warnings: [],
  };
}
