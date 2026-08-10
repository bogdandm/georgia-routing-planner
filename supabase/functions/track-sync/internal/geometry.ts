import { MAX_CANONICAL_BYTES, TrackSyncFailure } from './contracts.ts';

export type TrackGeometryVersion = 1 | 2;
export interface TrackGeometryIdentity {
  readonly geometryVersion: TrackGeometryVersion;
  readonly lineageHash: string;
}

export function validateCanonicalGeometry(bytes: Uint8Array): TrackGeometryVersion {
  if (
    bytes.byteLength < 8 ||
    bytes[0] !== 0x47 ||
    bytes[1] !== 0x52 ||
    bytes[2] !== 0x50 ||
    bytes[3] !== 0x54
  ) {
    throw new TrackSyncFailure(
      400,
      'invalid_geometry',
      'Geometry must use the GRPT envelope.',
    );
  }
  const version = bytes[4];
  if (version !== 1 && version !== 2) {
    throw new TrackSyncFailure(
      400,
      'unsupported_codec',
      'Only GRPT codec versions 1 and 2 are supported.',
    );
  }
  const flags = bytes[5]!;
  const allowedFlags = version === 1 ? 0x01 : 0x03;
  if ((flags & ~allowedFlags) !== 0) {
    throw new TrackSyncFailure(
      400,
      'unsupported_codec',
      'The GRPT envelope uses unsupported flags.',
    );
  }

  let cursor = readVarUint(bytes, 6);
  const segmentCount = cursor.value;
  if (segmentCount < 1 || segmentCount > 512) {
    throw new TrackSyncFailure(
      400,
      'invalid_geometry',
      'The GRPT envelope has an invalid segment count.',
    );
  }
  let pointCount = 0;
  let hasTimestamp = false;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    cursor = readVarUint(bytes, cursor.offset);
    const segmentPointCount = cursor.value;
    if (segmentPointCount < 2) {
      throw new TrackSyncFailure(
        400,
        'invalid_geometry',
        'Every GRPT segment must contain at least two points.',
      );
    }
    pointCount += segmentPointCount;
    if (pointCount > 100_000) {
      throw new TrackSyncFailure(
        400,
        'invalid_geometry',
        'The GRPT envelope contains too many points.',
      );
    }
    for (let point = 0; point < segmentPointCount; point += 1) {
      cursor = readVarUint(bytes, cursor.offset);
      cursor = readVarUint(bytes, cursor.offset);
      if ((flags & 0x01) !== 0) {
        cursor = readVarUint(bytes, cursor.offset);
        if (cursor.value !== 0) hasTimestamp = true;
      }
      if ((flags & 0x02) !== 0) {
        cursor = { value: 0, offset: readElevation(bytes, cursor.offset) };
      }
    }
  }
  if ((flags & 0x01) !== 0 && !hasTimestamp) {
    throw new TrackSyncFailure(
      400,
      'invalid_geometry',
      'The GRPT timestamp flag is not canonical.',
    );
  }
  if (cursor.offset !== bytes.byteLength) {
    throw new TrackSyncFailure(
      400,
      'invalid_geometry',
      'The GRPT envelope contains trailing bytes.',
    );
  }
  return version;
}

export async function validateGeometryUpload(
  compressed: Uint8Array,
  expectedContentHash: string,
): Promise<TrackGeometryIdentity> {
  const canonical = await decompressGeometry(compressed);
  const geometryVersion = validateCanonicalGeometry(canonical);
  const contentHash = await sha256Hex(canonical);
  if (contentHash !== expectedContentHash) {
    throw new TrackSyncFailure(
      400,
      'content_hash_mismatch',
      'Declared and computed geometry hashes differ.',
    );
  }
  return {
    geometryVersion,
    lineageHash:
      geometryVersion === 1
        ? contentHash
        : await sha256Hex(legacyCanonicalGeometry(canonical)),
  };
}

function legacyCanonicalGeometry(bytes: Uint8Array): Uint8Array {
  const legacy = [0x47, 0x52, 0x50, 0x54, 1, bytes[5]! & 0x01];
  let cursor = copyVarUint(bytes, 6, legacy);
  const segmentCount = cursor.value;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    cursor = copyVarUint(bytes, cursor.offset, legacy);
    const segmentPointCount = cursor.value;
    for (let point = 0; point < segmentPointCount; point += 1) {
      cursor = copyVarUint(bytes, cursor.offset, legacy);
      cursor = copyVarUint(bytes, cursor.offset, legacy);
      if ((bytes[5]! & 0x01) !== 0) {
        cursor = copyVarUint(bytes, cursor.offset, legacy);
      }
      if ((bytes[5]! & 0x02) !== 0) {
        cursor = { value: 0, offset: readElevation(bytes, cursor.offset) };
      }
    }
  }
  return Uint8Array.from(legacy);
}

function copyVarUint(
  bytes: Uint8Array,
  offset: number,
  destination: number[],
): { readonly value: number; readonly offset: number } {
  const start = offset;
  const cursor = readVarUint(bytes, offset);
  for (let index = start; index < cursor.offset; index += 1) {
    destination.push(bytes[index]!);
  }
  return cursor;
}

function readElevation(bytes: Uint8Array, offset: number): number {
  const tag = bytes[offset];
  if (tag === 0x00) return offset + 1;
  if (tag !== 0x01 || offset + 9 > bytes.byteLength) {
    throw new TrackSyncFailure(
      400,
      'invalid_geometry',
      'The GRPT envelope contains an invalid elevation.',
    );
  }
  const elevationMeters = new DataView(
    bytes.buffer,
    bytes.byteOffset + offset + 1,
    8,
  ).getFloat64(0, false);
  if (!Number.isFinite(elevationMeters)) {
    throw new TrackSyncFailure(
      400,
      'invalid_geometry',
      'The GRPT envelope contains an invalid elevation.',
    );
  }
  return offset + 9;
}

function readVarUint(
  bytes: Uint8Array,
  offset: number,
): { readonly value: number; readonly offset: number } {
  let value = 0;
  let multiplier = 1;
  for (let index = 0; index < 8; index += 1) {
    if (offset >= bytes.byteLength) {
      throw new TrackSyncFailure(
        400,
        'invalid_geometry',
        'The GRPT envelope is truncated.',
      );
    }
    const byte = bytes[offset];
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) {
      throw new TrackSyncFailure(
        400,
        'invalid_geometry',
        'The GRPT envelope contains an oversized integer.',
      );
    }
    offset += 1;
    if ((byte & 0x80) === 0) {
      if (index > 0 && byte === 0) {
        throw new TrackSyncFailure(
          400,
          'invalid_geometry',
          'The GRPT envelope contains a non-canonical integer.',
        );
      }
      return { value, offset };
    }
    multiplier *= 128;
  }
  throw new TrackSyncFailure(
    400,
    'invalid_geometry',
    'The GRPT envelope contains an invalid integer.',
  );
}

async function decompressGeometry(compressed: Uint8Array): Promise<Uint8Array> {
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = new Blob([new Uint8Array(compressed).buffer])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
  } catch {
    throw new TrackSyncFailure(
      400,
      'invalid_geometry',
      'Geometry must be valid GZIP data.',
    );
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_CANONICAL_BYTES) {
        await reader.cancel();
        throw new TrackSyncFailure(
          413,
          'geometry_too_large',
          'Decompressed geometry exceeds 64 MiB.',
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof TrackSyncFailure) throw error;
    throw new TrackSyncFailure(
      400,
      'invalid_geometry',
      'Geometry must be valid GZIP data.',
    );
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return bytesToHex(new Uint8Array(digest));
}
