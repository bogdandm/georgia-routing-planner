import type { SupabaseContext } from 'npm:@supabase/server@1.4.1';
import { z } from 'npm:zod@4.4.3';


import {
  CONTENT_HASH_PATTERN,
  MAX_JSON_BYTES,
  MAX_MARKER_BYTES,
  MAX_METADATA_BYTES,
  MAX_MULTIPART_BYTES,
  type MarkerPayload,
  type MetadataTrackCommand,
  type RpcResponse,
  type StatusTrackCommand,
  TRACK_QUOTA_BYTES,
  type TrackSyncCommand,
  TrackSyncFailure,
  type TrackSyncResult,
  type TrackUsage,
  type UpsertMarkerCommand,
  UUID_PATTERN,
} from './contracts.ts';

const markerIconKeys: Readonly<Record<string, true>> = Object.fromEntries(
  ['place','flag','home','parking','apartment','business','cabin','cottage','city','map','my-location','navigation','pin','public','school','explore','landscape','forest','terrain','water','snow','beach','eco','grass','park','spa','volcano','waves','sunny','cloud','storm','tsunami','hiking','cycling','boating','pets','skiing','kayaking','kitesurfing','paragliding','rowing','sailing','diving','skateboarding','snowboarding','sports','football','surfing','swimming','running','restaurant','cafe','hotel','store','bakery','brunch','camping','fast-food','ice-cream','liquor','bar','dining','drinking-water','grocery','shelter','ramen','seafood','tapas','camera','castle','church','museum','monument','attraction','celebration','deck','festival','fort','mosque','synagogue','buddhist-temple','hindu-temple','theater','tour','villa','hospital','medical','info','warning','roadwork','blocked','car-crash','alert','danger','emergency','engineering','fire-extinguisher','safety','fire-station','report','security','sos','traffic','viewpoint','shuttle','commute','bus','car','railway','electric-bike','flight','fuel','bike','snowmobile','train','tram','motorcycle'].map((key) => [key, true]),
);
const markerColorKeys: Readonly<Record<string, true>> = {
  blue: true, teal: true, purple: true, olive: true, orange: true, rose: true, navy: true, 'blue-green': true, green: true, red: true,
};
import { validateGeometryUpload } from './geometry.ts';

export function requireUserId(context: SupabaseContext): string {
  const userId = context.userClaims?.id;
  if (
    context.authMode !== 'user' ||
    typeof userId !== 'string' ||
    !UUID_PATTERN.test(userId)
  ) {
    throw new TrackSyncFailure(401, 'invalid_jwt', 'A verified user JWT is required.');
  }
  return userId;
}

export async function parseTrackSyncRequest(
  request: Request,
): Promise<TrackSyncCommand> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.startsWith('multipart/form-data;')) {
    return await parseUploadRequest(request);
  }
  if (!contentType.startsWith('application/json')) {
    throw new TrackSyncFailure(
      415,
      'invalid_content_type',
      'Request body must be JSON or multipart data.',
    );
  }
  return await parseJsonRequest(request);
}

export function createTrackSyncResponse(result: TrackSyncResult): Response {
  if (result instanceof TrackSyncFailure) {
    return jsonResponse(
      result.details === undefined
        ? { error: { code: result.code, message: result.message } }
        : { ...result.details, error: { code: result.code, message: result.message } },
      result.status,
    );
  }
  if ('outcome' in result) {
    return jsonResponse({
      outcome: result.outcome,
      record: serializeRecord((result as RpcResponse).record),
    });
  }
  return jsonResponse(result as TrackUsage);
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireContentHash(value: unknown): string {
  if (typeof value !== 'string' || !CONTENT_HASH_PATTERN.test(value)) {
    throw new TrackSyncFailure(
      400,
      'invalid_content_hash',
      'contentHash must be lowercase SHA-256.',
    );
  }
  return value;
}

function requireBaseRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TrackSyncFailure(
      400,
      'invalid_base_revision',
      'baseRevision must be a non-negative integer.',
    );
  }
  return value as number;
}

function requireCompressedBytes(value: unknown): number {
  const parsed =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (
    !Number.isSafeInteger(parsed) ||
    (parsed as number) <= 0 ||
    (parsed as number) > TRACK_QUOTA_BYTES
  ) {
    throw new TrackSyncFailure(
      400,
      'invalid_compressed_bytes',
      'compressedBytes is outside the allowed range.',
    );
  }
  return parsed as number;
}

function requireMetadata(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    throw new TrackSyncFailure(
      400,
      'invalid_metadata',
      'metadata must be a JSON object.',
    );
  }
  if (
    typeof value.lineageHash !== 'string' ||
    !CONTENT_HASH_PATTERN.test(value.lineageHash) ||
    (value.geometryVersion !== 1 && value.geometryVersion !== 2)
  ) {
    throw new TrackSyncFailure(
      400,
      'invalid_metadata',
      'metadata must contain a lowercase SHA-256 lineageHash and geometryVersion 1 or 2.',
    );
  }
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  if (encoded.byteLength > MAX_METADATA_BYTES) {
    throw new TrackSyncFailure(413, 'metadata_too_large', 'metadata exceeds 64 KiB.');
  }
  return value;
}

function requireMarkerId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new TrackSyncFailure(400, 'invalid_marker', 'markerId must be 1 to 200 characters.');
  }
  return value;
}

function requireMarkerPayload(value: unknown, markerId: string): MarkerPayload {
  if (!isObject(value)) {
    throw new TrackSyncFailure(400, 'invalid_marker', 'marker must be an object.');
  }
  requireExactFields(value, [
    'schemaVersion',
    'id',
    'name',
    'normalizedName',
    'coordinate',
    'iconKey',
    'colorKey',
    'createdAt',
    'updatedAt',
  ]);
  if (
    value.schemaVersion !== 1 ||
    value.id !== markerId ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    value.name.length > 200 ||
    value.name !== value.name.trim() ||
    typeof value.normalizedName !== 'string' ||
    value.normalizedName !== value.name.trim().toLocaleLowerCase('en') ||
    !Array.isArray(value.coordinate) ||
    value.coordinate.length !== 2 ||
    !Number.isFinite(value.coordinate[0]) ||
    !Number.isFinite(value.coordinate[1]) ||
    value.coordinate[0] < -180 ||
    value.coordinate[0] > 180 ||
    value.coordinate[1] < -90 ||
    value.coordinate[1] > 90 ||
    typeof value.iconKey !== 'string' ||
    markerIconKeys[value.iconKey] !== true ||
    typeof value.colorKey !== 'string' ||
    markerColorKeys[value.colorKey] !== true ||
    typeof value.createdAt !== 'string' ||
    !z.iso.datetime().safeParse(value.createdAt).success ||
    typeof value.updatedAt !== 'string' ||
    !z.iso.datetime().safeParse(value.updatedAt).success
  ) {
    throw new TrackSyncFailure(400, 'invalid_marker', 'marker is invalid.');
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_MARKER_BYTES) {
    throw new TrackSyncFailure(413, 'marker_too_large', 'marker exceeds 4 KiB.');
  }
  return value as unknown as MarkerPayload;
}

function parseIntegerField(value: FormDataEntryValue | null, name: string): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new TrackSyncFailure(
      400,
      `invalid_${name}`,
      `${name} must be a non-negative integer.`,
    );
  }
  return Number(value);
}

async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > limit) {
      throw new TrackSyncFailure(
        413,
        'request_too_large',
        'Request body exceeds the allowed size.',
      );
    }
  }

  if (request.body === null) {
    throw new TrackSyncFailure(400, 'missing_body', 'Request body is required.');
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new TrackSyncFailure(
        413,
        'request_too_large',
        'Request body exceeds the allowed size.',
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function requireExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): void {
  const allowed = new Set(fields);
  if (
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new TrackSyncFailure(
      400,
      'invalid_request',
      'Request contains unsupported or missing fields.',
    );
  }
}

async function parseJsonRequest(request: Request): Promise<TrackSyncCommand> {
  const bytes = await readBoundedBody(request, MAX_JSON_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TrackSyncFailure(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  if (!isObject(value) || typeof value.action !== 'string') {
    throw new TrackSyncFailure(
      400,
      'invalid_request',
      'A supported action is required.',
    );
  }
  if (value.action === 'status') {
    requireExactFields(value, ['action']);
    return { action: value.action };
  }
  if (value.action === 'metadata') {
    requireExactFields(value, ['action', 'contentHash', 'baseRevision', 'metadata']);
    return {
      action: 'metadata',
      contentHash: requireContentHash(value.contentHash),
      baseRevision: requireBaseRevision(value.baseRevision),
      metadata: requireMetadata(value.metadata),
    };
  }
  if (value.action === 'delete') {
    requireExactFields(value, ['action', 'contentHash', 'baseRevision']);
    return {
      action: 'delete',
      contentHash: requireContentHash(value.contentHash),
      baseRevision: requireBaseRevision(value.baseRevision),
    };
  }
  if (value.action === 'marker-upsert') {
    requireExactFields(value, ['action', 'markerId', 'baseRevision', 'marker']);
    const markerId = requireMarkerId(value.markerId);
    const marker = requireMarkerPayload(value.marker, markerId);
    return {
      action: 'marker-upsert',
      markerId,
      baseRevision: requireBaseRevision(value.baseRevision),
      marker,
    };
  }
  if (value.action === 'marker-delete') {
    requireExactFields(value, ['action', 'markerId', 'baseRevision']);
    return {
      action: 'marker-delete',
      markerId: requireMarkerId(value.markerId),
      baseRevision: requireBaseRevision(value.baseRevision),
    };
  }
  throw new TrackSyncFailure(
    400,
    'invalid_action',
    'Unsupported track synchronization action.',
  );
}

async function parseUploadRequest(request: Request): Promise<TrackSyncCommand> {
  const contentType = request.headers.get('content-type') ?? '';
  const body = await readBoundedBody(request, MAX_MULTIPART_BYTES);
  let formData: FormData;
  try {
    formData = await new Response(new Uint8Array(body).buffer, {
      headers: { 'Content-Type': contentType },
    }).formData();
  } catch {
    throw new TrackSyncFailure(
      400,
      'invalid_multipart',
      'Upload body is not valid multipart data.',
    );
  }
  const uploadFields = [
    'action',
    'baseRevision',
    'contentHash',
    'compressedBytes',
    'metadata',
    'geometry',
  ];
  const allowedFields = new Set(uploadFields);
  const submittedFields = Array.from(formData.keys());
  if (
    submittedFields.some((field) => !allowedFields.has(field)) ||
    uploadFields.some((field) => formData.getAll(field).length !== 1)
  ) {
    throw new TrackSyncFailure(
      400,
      'invalid_request',
      'Upload contains unsupported, missing, or repeated fields.',
    );
  }
  if (formData.get('action') !== 'upload') {
    throw new TrackSyncFailure(
      400,
      'invalid_action',
      'Multipart requests support only upload.',
    );
  }
  const contentHash = requireContentHash(formData.get('contentHash'));
  const compressedBytes = requireCompressedBytes(formData.get('compressedBytes'));
  const baseRevision = requireBaseRevision(
    parseIntegerField(formData.get('baseRevision'), 'baseRevision'),
  );
  const metadataText = formData.get('metadata');
  if (typeof metadataText !== 'string') {
    throw new TrackSyncFailure(
      400,
      'invalid_metadata',
      'metadata must be a JSON object.',
    );
  }
  let metadataValue: unknown;
  try {
    metadataValue = JSON.parse(metadataText);
  } catch {
    throw new TrackSyncFailure(400, 'invalid_metadata', 'metadata must be valid JSON.');
  }
  const metadata = requireMetadata(metadataValue);
  const geometryFile = formData.get('geometry');
  if (!(geometryFile instanceof File)) {
    throw new TrackSyncFailure(
      400,
      'invalid_geometry',
      'geometry must be a GZIP file.',
    );
  }
  if (geometryFile.type !== 'application/gzip') {
    throw new TrackSyncFailure(
      415,
      'invalid_geometry_type',
      'geometry must use application/gzip.',
    );
  }
  if (geometryFile.size !== compressedBytes) {
    throw new TrackSyncFailure(
      400,
      'compressed_size_mismatch',
      'Declared and actual compressed sizes differ.',
    );
  }
  const geometry = new Uint8Array(await geometryFile.arrayBuffer());
  const geometryIdentity = await validateGeometryUpload(geometry, contentHash);
  if (
    metadata.geometryVersion !== geometryIdentity.geometryVersion ||
    metadata.lineageHash !== geometryIdentity.lineageHash
  ) {
    throw new TrackSyncFailure(
      400,
      'invalid_metadata',
      'metadata lineage does not match the GRPT geometry.',
    );
  }
  return {
    action: 'upload',
    contentHash,
    compressedBytes,
    baseRevision,
    metadata,
    geometry,
  };
}

function serializeRecord(value: unknown): unknown {
  if (!isObject(value)) return undefined;
  return {
    contentHash: value.content_hash,
    metadata: value.metadata,
    revision: value.revision,
    state: value.state,
    compressedBytes: value.compressed_bytes,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}
