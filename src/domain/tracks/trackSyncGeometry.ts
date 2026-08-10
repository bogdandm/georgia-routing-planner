import type { TrackPoint } from '@/domain/tracks/gpx';
import type { LocalTrackContent } from '@/domain/tracks/localTrack';

const magic = [0x47, 0x52, 0x50, 0x54] as const;
const legacyVersion = 1;
const currentVersion = 2;
const timestampsFlag = 0x01;
const elevationsFlag = 0x02;
const coordinateScale = 1_000_000;
const maximumSegments = 512;
const maximumPoints = 100_000;
const maximumVaruintBytes = 10;

export class TrackSyncGeometryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TrackSyncGeometryError';
  }
}

export type DecodedTrackSyncGeometry = readonly (readonly TrackPoint[])[];

function requireCoordinate(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TrackSyncGeometryError('Track geometry contains an invalid coordinate.');
  }
  const scaled = Math.round(value * coordinateScale);
  if (!Number.isSafeInteger(scaled)) {
    throw new TrackSyncGeometryError('Track geometry coordinate overflowed.');
  }
  return scaled;
}

function zigZagEncode(value: number): bigint {
  if (!Number.isSafeInteger(value))
    throw new TrackSyncGeometryError('Track geometry overflowed.');
  const signed = BigInt(value);
  return signed < 0n ? -signed * 2n - 1n : signed * 2n;
}

function zigZagDecode(value: bigint): number {
  const signed = (value & 1n) === 0n ? value / 2n : -(value + 1n) / 2n;
  if (
    signed < BigInt(Number.MIN_SAFE_INTEGER) ||
    signed > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new TrackSyncGeometryError('Track geometry overflowed.');
  }
  return Number(signed);
}

function appendVaruint(bytes: number[], value: bigint): void {
  if (value < 0n) throw new TrackSyncGeometryError('Track geometry overflowed.');
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0n);
}

function readVaruint(bytes: Uint8Array, offset: { value: number }): bigint {
  let result = 0n;
  for (let index = 0; index < maximumVaruintBytes; index += 1) {
    const byte = bytes[offset.value];
    if (byte === undefined)
      throw new TrackSyncGeometryError('Track geometry is truncated.');
    offset.value += 1;
    result |= BigInt(byte & 0x7f) << BigInt(index * 7);
    if ((byte & 0x80) === 0) return result;
  }
  throw new TrackSyncGeometryError('Track geometry varint is too long.');
}

function readCount(
  bytes: Uint8Array,
  offset: { value: number },
  maximum: number,
): number {
  const value = readVaruint(bytes, offset);
  if (value > BigInt(maximum))
    throw new TrackSyncGeometryError('Track geometry exceeds a limit.');
  return Number(value);
}

function timestampMilliseconds(recordedAt: string): number {
  const value = Date.parse(recordedAt);
  if (!Number.isSafeInteger(value)) {
    throw new TrackSyncGeometryError('Track geometry contains an invalid timestamp.');
  }
  return value;
}

function appendElevation(bytes: number[], elevationMeters: number | undefined): void {
  if (elevationMeters === undefined) {
    bytes.push(0x00);
    return;
  }
  if (!Number.isFinite(elevationMeters)) {
    throw new TrackSyncGeometryError('Track geometry contains an invalid elevation.');
  }
  bytes.push(0x01);
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, elevationMeters, false);
  bytes.push(...new Uint8Array(buffer));
}

function readElevation(
  bytes: Uint8Array,
  offset: { value: number },
): number | undefined {
  const tag = bytes[offset.value];
  if (tag === undefined)
    throw new TrackSyncGeometryError('Track geometry is truncated.');
  offset.value += 1;
  if (tag === 0x00) return undefined;
  if (tag !== 0x01) {
    throw new TrackSyncGeometryError('Track geometry contains an invalid elevation.');
  }
  if (offset.value + 8 > bytes.length) {
    throw new TrackSyncGeometryError('Track geometry contains an invalid elevation.');
  }
  const elevationMeters = new DataView(
    bytes.buffer,
    bytes.byteOffset + offset.value,
    8,
  ).getFloat64(0, false);
  offset.value += 8;
  if (!Number.isFinite(elevationMeters)) {
    throw new TrackSyncGeometryError('Track geometry contains an invalid elevation.');
  }
  return elevationMeters;
}

function encodeGeometry(
  content: LocalTrackContent,
  codecVersion: typeof legacyVersion | typeof currentVersion,
): Uint8Array {
  const segments = content.trackPoints;
  if (segments.length === 0 || segments.length > maximumSegments) {
    throw new TrackSyncGeometryError('Track geometry has an invalid segment count.');
  }
  let totalPoints = 0;
  let includesTimestamps = false;
  let includesElevations = false;
  for (const segment of segments) {
    if (segment.length < 2 || totalPoints + segment.length > maximumPoints) {
      throw new TrackSyncGeometryError('Track geometry has an invalid point count.');
    }
    totalPoints += segment.length;
    includesTimestamps ||= segment.some((point) => point.recordedAt !== undefined);
    includesElevations ||= segment.some((point) => point.elevationMeters !== undefined);
  }

  const flags =
    (includesTimestamps ? timestampsFlag : 0) |
    (codecVersion === currentVersion && includesElevations ? elevationsFlag : 0);
  const bytes = [...magic, codecVersion, flags];
  appendVaruint(bytes, BigInt(segments.length));
  for (const segment of segments) {
    appendVaruint(bytes, BigInt(segment.length));
    let previousLongitude = 0;
    let previousLatitude = 0;
    let previousTimestamp: number | null = null;
    for (const point of segment) {
      const longitude = requireCoordinate(point.coordinate[0], -180, 180);
      const latitude = requireCoordinate(point.coordinate[1], -90, 90);
      appendVaruint(bytes, zigZagEncode(longitude - previousLongitude));
      appendVaruint(bytes, zigZagEncode(latitude - previousLatitude));
      previousLongitude = longitude;
      previousLatitude = latitude;
      if (includesTimestamps) {
        if (point.recordedAt === undefined) {
          appendVaruint(bytes, 0n);
        } else {
          const timestamp = timestampMilliseconds(point.recordedAt);
          appendVaruint(bytes, zigZagEncode(timestamp - (previousTimestamp ?? 0)) + 1n);
          previousTimestamp = timestamp;
        }
      }
      if ((flags & elevationsFlag) !== 0) {
        appendElevation(bytes, point.elevationMeters);
      }
    }
  }
  return Uint8Array.from(bytes);
}

/** Encodes legacy GRPT v1 geometry solely to recognize persisted v1 identities. */
export function encodeLegacyTrackSyncGeometry(content: LocalTrackContent): Uint8Array {
  return encodeGeometry(content, legacyVersion);
}

/** Encodes normalized track geometry into canonical GRPT v2 bytes. */
export function encodeTrackSyncGeometry(content: LocalTrackContent): Uint8Array {
  return encodeGeometry(content, currentVersion);
}

/** Decodes and validates a canonical GRPT v1 or v2 payload. */
export function decodeTrackSyncGeometry(bytes: Uint8Array): DecodedTrackSyncGeometry {
  if (bytes.length < 8 || !magic.every((value, index) => bytes[index] === value)) {
    throw new TrackSyncGeometryError('Track geometry has an invalid header.');
  }
  const codecVersion = bytes[4];
  if (codecVersion !== legacyVersion && codecVersion !== currentVersion) {
    throw new TrackSyncGeometryError('Track geometry version is unsupported.');
  }
  const allowedFlags =
    codecVersion === legacyVersion ? timestampsFlag : timestampsFlag | elevationsFlag;
  const flags = bytes[5];
  if (flags === undefined || (flags & ~allowedFlags) !== 0) {
    throw new TrackSyncGeometryError('Track geometry has unknown flags.');
  }
  const offset = { value: 6 };
  const segmentCount = readCount(bytes, offset, maximumSegments);
  if (segmentCount === 0)
    throw new TrackSyncGeometryError('Track geometry has an invalid segment count.');
  const segments: TrackPoint[][] = [];
  let totalPoints = 0;
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const pointCount = readCount(bytes, offset, maximumPoints - totalPoints);
    if (pointCount < 2)
      throw new TrackSyncGeometryError('Track geometry has an invalid point count.');
    totalPoints += pointCount;
    let previousLongitude = 0;
    let previousLatitude = 0;
    let previousTimestamp: number | null = null;
    const segment: TrackPoint[] = [];
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      previousLongitude += zigZagDecode(readVaruint(bytes, offset));
      previousLatitude += zigZagDecode(readVaruint(bytes, offset));
      const longitude = previousLongitude / coordinateScale;
      const latitude = previousLatitude / coordinateScale;
      requireCoordinate(longitude, -180, 180);
      requireCoordinate(latitude, -90, 90);
      const point: {
        coordinate: TrackPoint['coordinate'];
        elevationMeters?: number;
        recordedAt?: string;
      } = { coordinate: [longitude, latitude] };
      if ((flags & timestampsFlag) !== 0) {
        const taggedTimestamp = readVaruint(bytes, offset);
        if (taggedTimestamp !== 0n) {
          const timestamp: number =
            (previousTimestamp ?? 0) + zigZagDecode(taggedTimestamp - 1n);
          if (!Number.isSafeInteger(timestamp)) {
            throw new TrackSyncGeometryError(
              'Track geometry contains an invalid timestamp.',
            );
          }
          const recordedAt = new Date(timestamp);
          if (Number.isNaN(recordedAt.getTime())) {
            throw new TrackSyncGeometryError(
              'Track geometry contains an invalid timestamp.',
            );
          }
          point.recordedAt = recordedAt.toISOString();
          previousTimestamp = timestamp;
        }
      }
      if ((flags & elevationsFlag) !== 0) {
        const elevationMeters = readElevation(bytes, offset);
        if (elevationMeters !== undefined) point.elevationMeters = elevationMeters;
      }
      segment.push(point);
    }
    segments.push(segment);
  }
  if (offset.value !== bytes.length)
    throw new TrackSyncGeometryError('Track geometry has trailing bytes.');
  return segments;
}
