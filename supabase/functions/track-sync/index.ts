import { type SupabaseContext, withSupabase } from 'npm:@supabase/server@1.4.1';

export const TRACK_GEOMETRY_BUCKET = 'track-geometries';
export const TRACK_QUOTA_BYTES = 8_388_608;
const MAX_METADATA_BYTES = 65_536;
const MAX_JSON_BYTES = MAX_METADATA_BYTES + 4_096;
const MAX_MULTIPART_BYTES = TRACK_QUOTA_BYTES + MAX_METADATA_BYTES + 131_072;
const MAX_CANONICAL_BYTES = 67_108_864;
const STORAGE_PAGE_SIZE = 100;
const DATABASE_PAGE_SIZE = 1_000;
const MAX_STORAGE_OBJECTS = 10_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

interface RpcResponse {
  readonly outcome: 'applied' | 'upload' | 'conflict' | 'existing' | 'missing';
  readonly record?: unknown;
  readonly objectPath?: string;
}

interface MetadataTrackRequest {
  readonly action: 'metadata';
  readonly contentHash: string;
  readonly baseRevision: number;
  readonly metadata: Record<string, unknown>;
}

interface DeleteTrackRequest {
  readonly action: 'delete';
  readonly contentHash: string;
  readonly baseRevision: number;
}

interface StatusRequest {
  readonly action: 'status' | 'purge';
}

type JsonTrackRequest = MetadataTrackRequest | DeleteTrackRequest;
type TrackRequest = JsonTrackRequest | StatusRequest;

interface StorageEntry {
  readonly id: string | null;
  readonly name: string;
}

class RequestFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
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
    throw new RequestFailure(
      400,
      'invalid_content_hash',
      'contentHash must be lowercase SHA-256.',
    );
  }
  return value;
}

function requireBaseRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RequestFailure(
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
    throw new RequestFailure(
      400,
      'invalid_compressed_bytes',
      'compressedBytes is outside the allowed range.',
    );
  }
  return parsed as number;
}

function requireMetadata(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    throw new RequestFailure(
      400,
      'invalid_metadata',
      'metadata must be a JSON object.',
    );
  }
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  if (encoded.byteLength > MAX_METADATA_BYTES) {
    throw new RequestFailure(413, 'metadata_too_large', 'metadata exceeds 64 KiB.');
  }
  return value;
}

function parseIntegerField(value: FormDataEntryValue | null, name: string): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new RequestFailure(
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
      throw new RequestFailure(
        413,
        'request_too_large',
        'Request body exceeds the allowed size.',
      );
    }
  }

  if (request.body === null) {
    throw new RequestFailure(400, 'missing_body', 'Request body is required.');
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
      throw new RequestFailure(
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
    throw new RequestFailure(
      400,
      'invalid_request',
      'Request contains unsupported or missing fields.',
    );
  }
}

async function parseJsonRequest(request: Request): Promise<TrackRequest> {
  const bytes = await readBoundedBody(request, MAX_JSON_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestFailure(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  if (!isObject(value) || typeof value.action !== 'string') {
    throw new RequestFailure(400, 'invalid_request', 'A supported action is required.');
  }
  if (value.action === 'status' || value.action === 'purge') {
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
  throw new RequestFailure(
    400,
    'invalid_action',
    'Unsupported track synchronization action.',
  );
}

function readVarUint(
  bytes: Uint8Array,
  offset: number,
): { readonly value: number; readonly offset: number } {
  let value = 0;
  let multiplier = 1;
  for (let index = 0; index < 8; index += 1) {
    if (offset >= bytes.byteLength) {
      throw new RequestFailure(
        400,
        'invalid_geometry',
        'The GRPT envelope is truncated.',
      );
    }
    const byte = bytes[offset];
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) {
      throw new RequestFailure(
        400,
        'invalid_geometry',
        'The GRPT envelope contains an oversized integer.',
      );
    }
    offset += 1;
    if ((byte & 0x80) === 0) return { value, offset };
    multiplier *= 128;
  }
  throw new RequestFailure(
    400,
    'invalid_geometry',
    'The GRPT envelope contains an invalid integer.',
  );
}

export function validateCanonicalGeometry(bytes: Uint8Array): void {
  if (
    bytes.byteLength < 8 ||
    bytes[0] !== 0x47 ||
    bytes[1] !== 0x52 ||
    bytes[2] !== 0x50 ||
    bytes[3] !== 0x54
  ) {
    throw new RequestFailure(
      400,
      'invalid_geometry',
      'Geometry must use the GRPT envelope.',
    );
  }
  if (bytes[4] !== 1) {
    throw new RequestFailure(
      400,
      'unsupported_codec',
      'Only GRPT codec version 1 is supported.',
    );
  }
  const flags = bytes[5];
  if ((flags & ~0x01) !== 0) {
    throw new RequestFailure(
      400,
      'unsupported_codec',
      'The GRPT envelope uses unsupported flags.',
    );
  }

  let cursor = readVarUint(bytes, 6);
  const segmentCount = cursor.value;
  if (segmentCount < 1 || segmentCount > 1_000_000) {
    throw new RequestFailure(
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
      throw new RequestFailure(
        400,
        'invalid_geometry',
        'Every GRPT segment must contain at least two points.',
      );
    }
    pointCount += segmentPointCount;
    if (pointCount > 5_000_000) {
      throw new RequestFailure(
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
    throw new RequestFailure(
      400,
      'invalid_geometry',
      'The GRPT envelope contains trailing bytes.',
    );
  }
}

async function decompressGeometry(compressed: Uint8Array): Promise<Uint8Array> {
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = new Blob([new Uint8Array(compressed).buffer])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
  } catch {
    throw new RequestFailure(
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
        throw new RequestFailure(
          413,
          'geometry_too_large',
          'Decompressed geometry exceeds 64 MiB.',
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestFailure) throw error;
    throw new RequestFailure(
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

const RPC_OUTCOMES: Readonly<Record<RpcResponse['outcome'], true>> = {
  applied: true,
  upload: true,
  conflict: true,
  existing: true,
  missing: true,
};

function parseRpcResponse(value: unknown): RpcResponse {
  if (!isObject(value) || typeof value.outcome !== 'string') {
    throw new Error('Track synchronization RPC returned an invalid response.');
  }
  if (!(value.outcome in RPC_OUTCOMES)) {
    throw new Error('Track synchronization RPC returned an unsupported outcome.');
  }
  return {
    outcome: value.outcome as RpcResponse['outcome'],
    record: value.record,
    objectPath: typeof value.objectPath === 'string' ? value.objectPath : undefined,
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

function outcomeResponse(result: RpcResponse): Response {
  return jsonResponse({
    outcome: result.outcome,
    record: serializeRecord(result.record),
  });
}

function requireUserId(context: SupabaseContext): string {
  const userId = context.userClaims?.id;
  if (
    context.authMode !== 'user' ||
    typeof userId !== 'string' ||
    !UUID_PATTERN.test(userId)
  ) {
    throw new RequestFailure(401, 'invalid_jwt', 'A verified user JWT is required.');
  }
  return userId;
}

function isExpectedObjectPath(
  path: string,
  userId: string,
  contentHash: string,
): boolean {
  const prefix = `${userId}/${contentHash}/`;
  if (!path.startsWith(prefix) || !path.endsWith('.grpt.gz')) return false;
  return UUID_PATTERN.test(path.slice(prefix.length, -'.grpt.gz'.length));
}

function isAlreadyExistsError(error: {
  readonly message?: string;
  readonly statusCode?: string | number;
}): boolean {
  return (
    error.statusCode === 409 ||
    error.statusCode === '409' ||
    /(?:asset|resource) already exists/i.test(error.message ?? '')
  );
}

async function listStorageDirectory(
  context: SupabaseContext,
  prefix: string,
): Promise<readonly StorageEntry[]> {
  const entries: StorageEntry[] = [];
  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    const { data, error } = await context.supabaseAdmin.storage
      .from(TRACK_GEOMETRY_BUCKET)
      .list(prefix, {
        limit: STORAGE_PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
    if (error) throw new Error(`Unable to list track geometry: ${error.message}`);
    const page = (data ?? []) as StorageEntry[];
    entries.push(...page);
    if (entries.length > MAX_STORAGE_OBJECTS || page.length < STORAGE_PAGE_SIZE) break;
  }
  if (entries.length > MAX_STORAGE_OBJECTS) {
    throw new Error('Track geometry cleanup exceeded its bounded object count.');
  }
  return entries;
}

async function listUserObjects(
  context: SupabaseContext,
  userId: string,
): Promise<readonly string[]> {
  const objects: string[] = [];
  const directories = [userId];
  while (directories.length > 0) {
    const directory = directories.shift()!;
    const entries = await listStorageDirectory(context, directory);
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.id === null) directories.push(path);
      else objects.push(path);
      if (objects.length + directories.length > MAX_STORAGE_OBJECTS) {
        throw new Error('Track geometry cleanup exceeded its bounded object count.');
      }
    }
  }
  return objects;
}

async function removeObjects(
  context: SupabaseContext,
  paths: readonly string[],
): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += STORAGE_PAGE_SIZE) {
    const batch = paths.slice(offset, offset + STORAGE_PAGE_SIZE);
    const { error } = await context.supabaseAdmin.storage
      .from(TRACK_GEOMETRY_BUCKET)
      .remove(batch);
    if (error) throw new Error(`Unable to delete track geometry: ${error.message}`);
  }
}

async function readActiveObjectPaths(
  context: SupabaseContext,
  userId: string,
): Promise<ReadonlySet<string>> {
  const activePaths = new Set<string>();
  for (let offset = 0; ; offset += DATABASE_PAGE_SIZE) {
    const { data, error } = await context.supabaseAdmin
      .from('track_records')
      .select('object_path')
      .eq('user_id', userId)
      .order('object_path')
      .range(offset, offset + DATABASE_PAGE_SIZE - 1);
    if (error)
      throw new Error(`Unable to read active track geometry paths: ${error.message}`);
    const rows: unknown = data;
    if (!Array.isArray(rows))
      throw new Error('Active track geometry paths returned an invalid response.');
    if (offset + rows.length > MAX_STORAGE_OBJECTS) {
      throw new Error('Active track geometry paths exceeded the bounded object count.');
    }
    for (const row of rows) {
      if (isObject(row) && typeof row.object_path === 'string') {
        activePaths.add(row.object_path);
      }
    }
    if (rows.length < DATABASE_PAGE_SIZE) return activePaths;
  }
}

async function removeInactiveCandidates(
  context: SupabaseContext,
  userId: string,
  candidates: readonly string[],
): Promise<void> {
  if (candidates.length === 0) return;
  const activePaths = await readActiveObjectPaths(context, userId);
  await removeObjects(
    context,
    candidates.filter((path) => !activePaths.has(path)),
  );
}

export async function cleanupOrphanedObjects(
  context: SupabaseContext,
  userId: string,
): Promise<void> {
  const objects = await listUserObjects(context, userId);
  await removeInactiveCandidates(context, userId, objects);
}

async function readUsage(
  context: SupabaseContext,
  userId: string,
): Promise<{
  readonly usedBytes: number;
  readonly reservedBytes: number;
  readonly limitBytes: number;
}> {
  const { data, error } = await context.supabaseAdmin
    .from('user_track_usage')
    .select('used_bytes, reserved_bytes')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Unable to read track quota: ${error.message}`);
  const usage: unknown = data;
  return {
    usedBytes:
      isObject(usage) && typeof usage.used_bytes === 'number' ? usage.used_bytes : 0,
    reservedBytes:
      isObject(usage) && typeof usage.reserved_bytes === 'number'
        ? usage.reserved_bytes
        : 0,
    limitBytes: TRACK_QUOTA_BYTES,
  };
}

async function executeRpc(
  context: SupabaseContext,
  name: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const rpc = context.supabaseAdmin.rpc as unknown as (
    rpcName: string,
    rpcParameters: Record<string, unknown>,
  ) => Promise<{
    readonly data: unknown;
    readonly error: { readonly message: string } | null;
  }>;
  const { data, error } = await rpc(name, parameters);
  if (error) {
    if (/quota exceeded/i.test(error.message)) {
      throw new RequestFailure(413, 'quota_exceeded', 'Track geometry quota exceeded.');
    }
    throw new Error(`${name} failed: ${error.message}`);
  }
  return data;
}

async function callRpc(
  context: SupabaseContext,
  name: string,
  parameters: Record<string, unknown>,
): Promise<RpcResponse> {
  return parseRpcResponse(await executeRpc(context, name, parameters));
}

async function parseUploadRequest(request: Request): Promise<{
  readonly contentHash: string;
  readonly compressedBytes: number;
  readonly baseRevision: number;
  readonly metadata: Record<string, unknown>;
  readonly geometry: Uint8Array;
}> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw new RequestFailure(
      415,
      'invalid_content_type',
      'Uploads require multipart/form-data.',
    );
  }
  const body = await readBoundedBody(request, MAX_MULTIPART_BYTES);
  let formData: FormData;
  try {
    formData = await new Response(new Uint8Array(body).buffer, {
      headers: { 'Content-Type': contentType },
    }).formData();
  } catch {
    throw new RequestFailure(
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
    throw new RequestFailure(
      400,
      'invalid_request',
      'Upload contains unsupported, missing, or repeated fields.',
    );
  }
  if (formData.get('action') !== 'upload') {
    throw new RequestFailure(
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
    throw new RequestFailure(
      400,
      'invalid_metadata',
      'metadata must be a JSON object.',
    );
  }
  let metadataValue: unknown;
  try {
    metadataValue = JSON.parse(metadataText);
  } catch {
    throw new RequestFailure(400, 'invalid_metadata', 'metadata must be valid JSON.');
  }
  const metadata = requireMetadata(metadataValue);
  const geometryFile = formData.get('geometry');
  if (!(geometryFile instanceof File)) {
    throw new RequestFailure(400, 'invalid_geometry', 'geometry must be a GZIP file.');
  }
  if (geometryFile.type !== 'application/gzip') {
    throw new RequestFailure(
      415,
      'invalid_geometry_type',
      'geometry must use application/gzip.',
    );
  }
  if (geometryFile.size !== compressedBytes) {
    throw new RequestFailure(
      400,
      'compressed_size_mismatch',
      'Declared and actual compressed sizes differ.',
    );
  }
  const geometry = new Uint8Array(await geometryFile.arrayBuffer());
  const canonical = await decompressGeometry(geometry);
  validateCanonicalGeometry(canonical);
  if ((await sha256Hex(canonical)) !== contentHash) {
    throw new RequestFailure(
      400,
      'content_hash_mismatch',
      'Declared and computed geometry hashes differ.',
    );
  }
  return { contentHash, compressedBytes, baseRevision, metadata, geometry };
}

async function handleUpload(
  request: Request,
  context: SupabaseContext,
  userId: string,
): Promise<Response> {
  const upload = await parseUploadRequest(request);
  await cleanupOrphanedObjects(context, userId);
  const reservation = await callRpc(context, 'reserve_track_upload', {
    p_user_id: userId,
    p_content_hash: upload.contentHash,
    p_compressed_bytes: upload.compressedBytes,
    p_metadata: upload.metadata,
    p_base_revision: upload.baseRevision,
  });
  if (reservation.outcome !== 'upload') return outcomeResponse(reservation);
  const objectPath = reservation.objectPath;
  if (
    typeof objectPath !== 'string' ||
    !isExpectedObjectPath(objectPath, userId, upload.contentHash)
  ) {
    await executeRpc(context, 'release_track_upload', {
      p_user_id: userId,
      p_content_hash: upload.contentHash,
    });
    throw new Error('Track reservation returned an invalid object path.');
  }

  let createdByThisRequest = false;
  const storage = context.supabaseAdmin.storage.from(TRACK_GEOMETRY_BUCKET);
  const { error: uploadError } = await storage.upload(objectPath, upload.geometry, {
    contentType: 'application/gzip',
    upsert: false,
  });
  if (uploadError && !isAlreadyExistsError(uploadError)) {
    await executeRpc(context, 'release_track_upload', {
      p_user_id: userId,
      p_content_hash: upload.contentHash,
    });
    throw new Error(`Unable to upload track geometry: ${uploadError.message}`);
  }
  createdByThisRequest = uploadError === null;

  try {
    const finalized = await callRpc(context, 'finalize_track_upload', {
      p_user_id: userId,
      p_content_hash: upload.contentHash,
    });
    return outcomeResponse(finalized);
  } catch (finalizeError) {
    let compensationError: Error | undefined;
    if (createdByThisRequest) {
      const { error: removeError } = await storage.remove([objectPath]);
      if (removeError !== null) {
        compensationError = new Error(
          `Uploaded object cleanup failed: ${removeError.message}`,
        );
      }
      try {
        await executeRpc(context, 'release_track_upload', {
          p_user_id: userId,
          p_content_hash: upload.contentHash,
        });
      } catch (releaseError) {
        compensationError = new AggregateError(
          compensationError === undefined
            ? [releaseError]
            : [compensationError, releaseError],
          'Upload compensation failed.',
        );
      }
    }
    if (compensationError !== undefined) {
      throw new AggregateError(
        [finalizeError, compensationError],
        'Track upload finalization failed.',
      );
    }
    throw finalizeError;
  }
}

async function handleMetadata(
  request: MetadataTrackRequest,
  context: SupabaseContext,
  userId: string,
): Promise<Response> {
  await cleanupOrphanedObjects(context, userId);
  return outcomeResponse(
    await callRpc(context, 'apply_track_metadata', {
      p_user_id: userId,
      p_content_hash: request.contentHash,
      p_base_revision: request.baseRevision,
      p_metadata: request.metadata,
    }),
  );
}

async function handleDelete(
  request: DeleteTrackRequest,
  context: SupabaseContext,
  userId: string,
): Promise<Response> {
  await cleanupOrphanedObjects(context, userId);
  const result = await callRpc(context, 'delete_track', {
    p_user_id: userId,
    p_content_hash: request.contentHash,
    p_base_revision: request.baseRevision,
  });
  if (result.outcome === 'applied' && result.objectPath !== undefined) {
    const { error } = await context.supabaseAdmin.storage
      .from(TRACK_GEOMETRY_BUCKET)
      .remove([result.objectPath]);
    if (error)
      throw new Error(
        `Track row was deleted but object cleanup failed: ${error.message}`,
      );
  }
  return outcomeResponse(result);
}

async function handlePurge(
  context: SupabaseContext,
  userId: string,
): Promise<Response> {
  const objectsBeforePurge = await listUserObjects(context, userId);
  await executeRpc(context, 'purge_user_track_data', { p_user_id: userId });
  const objectsAfterPurge = await listUserObjects(context, userId);
  await removeInactiveCandidates(
    context,
    userId,
    Array.from(new Set([...objectsBeforePurge, ...objectsAfterPurge])),
  );
  return jsonResponse({ outcome: 'applied' });
}

export async function handleTrackSync(
  request: Request,
  context: SupabaseContext,
): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      throw new RequestFailure(405, 'method_not_allowed', 'Only POST is supported.');
    }
    const userId = requireUserId(context);
    const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.startsWith('multipart/form-data;')) {
      return await handleUpload(request, context, userId);
    }
    if (!contentType.startsWith('application/json')) {
      throw new RequestFailure(
        415,
        'invalid_content_type',
        'Request body must be JSON or multipart data.',
      );
    }
    const parsed = await parseJsonRequest(request);
    if (parsed.action === 'metadata')
      return await handleMetadata(parsed, context, userId);
    if (parsed.action === 'delete') return await handleDelete(parsed, context, userId);
    if (parsed.action === 'status') {
      await cleanupOrphanedObjects(context, userId);
      return jsonResponse(await readUsage(context, userId));
    }
    return await handlePurge(context, userId);
  } catch (error) {
    if (error instanceof RequestFailure) {
      const detail =
        error.code === 'quota_exceeded'
          ? {
              ...(await readUsage(context, context.userClaims?.id ?? '')),
              error: { code: error.code, message: error.message },
            }
          : { error: { code: error.code, message: error.message } };
      return jsonResponse(detail, error.status);
    }
    console.error(
      'track-sync failed',
      error instanceof Error ? error.message : 'unknown error',
    );
    return jsonResponse(
      {
        error: { code: 'internal_error', message: 'Track synchronization failed.' },
      },
      500,
    );
  }
}

export default {
  fetch: withSupabase({ auth: 'user' }, handleTrackSync),
};
