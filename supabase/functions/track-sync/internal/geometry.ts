import { MAX_CANONICAL_BYTES, TrackSyncFailure } from './contracts.ts';

export function validateCanonicalGeometry(bytes: Uint8Array): void {
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
  if (bytes[4] !== 1) {
    throw new TrackSyncFailure(
      400,
      'unsupported_codec',
      'Only GRPT codec version 1 is supported.',
    );
  }
  const flags = bytes[5];
  if ((flags & ~0x01) !== 0) {
    throw new TrackSyncFailure(
      400,
      'unsupported_codec',
      'The GRPT envelope uses unsupported flags.',
    );
  }

  let cursor = readVarUint(bytes, 6);
  const segmentCount = cursor.value;
  if (segmentCount < 1 || segmentCount > 1_000_000) {
    throw new TrackSyncFailure(
      400,
      'invalid_geometry',
      'The GRPT envelope has an invalid segment count.',
    );
  }
  let pointCount = 0;
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
    if (pointCount > 5_000_000) {
      throw new TrackSyncFailure(
        400,
        'invalid_geometry',
        'The GRPT envelope contains too many points.',
      );
    }
    for (let point = 0; point < segmentPointCount; point += 1) {
      cursor = readVarUint(bytes, cursor.offset);
      cursor = readVarUint(bytes, cursor.offset);
      if ((flags & 0x01) !== 0) cursor = readVarUint(bytes, cursor.offset);
    }
  }
  if (cursor.offset !== bytes.byteLength) {
    throw new TrackSyncFailure(
      400,
      'invalid_geometry',
      'The GRPT envelope contains trailing bytes.',
    );
  }
}

export async function validateGeometryUpload(
  compressed: Uint8Array,
  expectedContentHash: string,
): Promise<void> {
  const canonical = await decompressGeometry(compressed);
  validateCanonicalGeometry(canonical);
  if ((await sha256Hex(canonical)) !== expectedContentHash) {
    throw new TrackSyncFailure(
      400,
      'content_hash_mismatch',
      'Declared and computed geometry hashes differ.',
    );
  }
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
    if ((byte & 0x80) === 0) return { value, offset };
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
