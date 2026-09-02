import { z } from 'zod';

import { loadSupabaseConfiguration } from '@/bootstrap/configuration/SupabaseConfiguration';
import { calculateTrackMetrics } from '@/domain/tracks/trackCalculations';
import {
  decodeTrackSyncGeometry,
  encodeLegacyTrackSyncGeometry,
  encodeTrackSyncGeometry,
} from '@/domain/tracks/trackSyncGeometry';
import { LOCAL_TRACK_SCHEMA_VERSION } from '@/domain/tracks/localTrack';
import type { SavedMarker } from '@/domain/markers/savedMarker';
import type {
  RemoteMarkerDeletionCandidate,
  RemoteTrackDeletionCandidate,
} from '@/application/user/UserDataService';
import {
  validateLocalTrackSyncPair,
  validateSavedMarkerRecord,
  type AppDatabase,
  type LocalTrackSyncPair,
  type MarkerSyncState,
  type TrackSyncState,
  type TrackSyncUsage,
} from '@/infrastructure/persistence/AppDatabase';
import {
  WorkerRpcServer,
  type WorkerRpcEndpoint,
} from '@/infrastructure/runtime/WorkerRpc';

import {
  TrackSyncWorkerError,
  trackSyncWorkerEventNames,
  trackSyncWorkerMethods,
  type TrackSyncWorkerRequest,
  type TrackSyncWorkerResult,
} from './TrackSyncWorkerClient';

const hashPattern = /^[0-9a-f]{64}$/;
const snapshotPageSize = 1_000;
const maximumSnapshotRecords = 10_000;
const maximumServerErrorAttempts = 3;
const exhaustedServerErrorMessage =
  'Cloud synchronization stopped after 3 server failures. Reload the page to try again.';
const usageSchema = z.object({
  usedBytes: z.number().int().nonnegative().max(8_388_608),
  reservedBytes: z.number().int().nonnegative().max(8_388_608),
  limitBytes: z.literal(8_388_608),
});
const errorResponseSchema = z.object({
  error: z.object({ code: z.string().regex(/^[a-z0-9_]{1,64}$/) }),
});
const remoteRecordSchema = z
  .object({
    content_hash: z.string().regex(hashPattern),
    revision: z.number().int().nonnegative(),
    state: z.enum(['ready', 'reserved']),
    object_path: z.string().min(1).max(500),
    compressed_bytes: z.number().int().positive().max(8_388_608),
    metadata: z.record(z.string(), z.unknown()),
  })
  .superRefine((record, context) => {
    if (record.state === 'ready' && record.revision === 0) {
      context.addIssue({ code: 'custom', message: 'Ready records need a revision.' });
    }
    if (record.state === 'reserved' && record.revision !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'Reserved records use revision zero.',
      });
    }
    const hasLineageHash = Object.hasOwn(record.metadata, 'lineageHash');
    const hasGeometryVersion = Object.hasOwn(record.metadata, 'geometryVersion');
    if (hasLineageHash !== hasGeometryVersion) {
      context.addIssue({
        code: 'custom',
        message: 'Track lineage metadata must be complete.',
      });
    }
    if (
      hasLineageHash &&
      (typeof record.metadata.lineageHash !== 'string' ||
        !hashPattern.test(record.metadata.lineageHash) ||
        (record.metadata.geometryVersion !== 1 &&
          record.metadata.geometryVersion !== 2))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Track lineage metadata is invalid.',
      });
    }
  });

type RemoteRecord = z.infer<typeof remoteRecordSchema>;

interface RemoteMarkerRecord {
  readonly marker_id: string;
  readonly revision: number;
  readonly payload: SavedMarker;
}

const remoteMarkerRecordSchema = z
  .object({
    marker_id: z.string().min(1).max(200),
    revision: z.number().int().positive(),
    payload: z.unknown(),
  })
  .strict();

function parseRemoteMarkerRecord(value: unknown): RemoteMarkerRecord {
  const parsed = remoteMarkerRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new TrackSyncWorkerError(
      'The server returned invalid marker records.',
      'invalid-remote',
    );
  }
  let payload: SavedMarker;
  try {
    payload = validateSavedMarkerRecord(parsed.data.payload);
  } catch {
    throw new TrackSyncWorkerError(
      'The server returned invalid marker records.',
      'invalid-remote',
    );
  }
  if (payload.id !== parsed.data.marker_id) {
    throw new TrackSyncWorkerError(
      'The server returned invalid marker records.',
      'invalid-remote',
    );
  }
  return { ...parsed.data, payload };
}

interface RemoteIdentity {
  readonly lineageHash: string;
  readonly geometryVersion: 1 | 2;
}

interface RemoteLineage {
  readonly identity: RemoteIdentity;
  readonly head: RemoteRecord;
  readonly members: readonly RemoteRecord[];
}

function remoteIdentity(record: RemoteRecord): RemoteIdentity {
  const lineageHash = record.metadata.lineageHash;
  const geometryVersion = record.metadata.geometryVersion;
  if (lineageHash === undefined && geometryVersion === undefined) {
    return { lineageHash: record.content_hash, geometryVersion: 1 };
  }
  if (
    typeof lineageHash !== 'string' ||
    !hashPattern.test(lineageHash) ||
    (geometryVersion !== 1 && geometryVersion !== 2)
  ) {
    throw new TrackSyncWorkerError(
      'The server returned invalid track records.',
      'invalid-remote',
    );
  }
  return { lineageHash, geometryVersion };
}

function readyLineages(records: readonly RemoteRecord[]): readonly RemoteLineage[] {
  const membersByLineage = new Map<string, RemoteRecord[]>();
  for (const record of records) {
    if (record.state !== 'ready') continue;
    const identity = remoteIdentity(record);
    const members = membersByLineage.get(identity.lineageHash);
    if (members === undefined) membersByLineage.set(identity.lineageHash, [record]);
    else members.push(record);
  }
  return [...membersByLineage.entries()].map(([lineageHash, members]) => {
    members.sort((left, right) => {
      const versionOrder =
        remoteIdentity(right).geometryVersion - remoteIdentity(left).geometryVersion;
      if (versionOrder !== 0) return versionOrder;
      if (left.revision !== right.revision) return right.revision - left.revision;
      return left.content_hash.localeCompare(right.content_hash);
    });
    const head = members[0];
    if (head === undefined) throw new Error('A remote lineage has no ready members.');
    return { identity: { ...remoteIdentity(head), lineageHash }, head, members };
  });
}

interface RemoteGateway {
  status(signal: AbortSignal): Promise<TrackSyncUsage>;
  snapshot(signal: AbortSignal): Promise<readonly RemoteRecord[]>;
  markerSnapshot?(signal: AbortSignal): Promise<readonly RemoteMarkerRecord[]>;
  mutate(
    state: TrackSyncState,
    pair: LocalTrackSyncPair | null,
    signal: AbortSignal,
  ): Promise<RemoteMutation>;
  mutateMarker?(
    markerId: string,
    baseRevision: number,
    payload: SavedMarker | null,
    signal: AbortSignal,
  ): Promise<RemoteMutation>;
  download(path: string, signal: AbortSignal): Promise<Uint8Array>;
  deleteRemoteRecord(
    contentHash: string,
    revision: number,
    signal: AbortSignal,
  ): Promise<RemoteMutation>;
}

type RemoteMutation =
  | { readonly outcome: 'applied' | 'existing'; readonly revision: number }
  | { readonly outcome: 'conflict'; readonly revision: number }
  | { readonly outcome: 'missing' }
  | { readonly outcome: 'reserved' };

interface ServerErrorBudget {
  failures: number;
}

type RemoteGatewayFactory = (accessToken: string) => RemoteGateway;

function syncStatesEqual(left: TrackSyncState, right: TrackSyncState): boolean {
  return (
    left.trackId === right.trackId &&
    left.contentHash === right.contentHash &&
    left.lineageHash === right.lineageHash &&
    left.geometryVersion === right.geometryVersion &&
    left.remoteRevision === right.remoteRevision &&
    left.pendingKind === right.pendingKind
  );
}

function markerStatesEqual(left: MarkerSyncState, right: MarkerSyncState): boolean {
  return (
    left.markerId === right.markerId &&
    left.remoteRevision === right.remoteRevision &&
    left.pendingKind === right.pendingKind &&
    left.localVersion === right.localVersion
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hash(bytes: Uint8Array): Promise<string> {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))),
  );
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([Uint8Array.from(bytes)])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([Uint8Array.from(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function errorForResponse(response: Response): Promise<TrackSyncWorkerError> {
  if (response.status === 401) {
    return new TrackSyncWorkerError('Your account session expired.', 'auth-expired');
  }
  if (response.status === 413) {
    return new TrackSyncWorkerError('Track geometry quota exceeded.', 'quota');
  }
  let detail = String(response.status);
  try {
    const parsed = errorResponseSchema.safeParse(await response.json());
    if (parsed.success) {
      const code = parsed.data.error.code;
      if (code === 'marker_limit') {
        return new TrackSyncWorkerError(
          'Cloud marker limit reached. Delete a synchronized marker and try again.',
          'limit',
        );
      }
      if (code === 'marker_revision_exhausted') {
        return new TrackSyncWorkerError(
          'Synchronization could not finish. Your local tracks and markers remain available.',
          'revision-exhausted',
        );
      }
      detail += `/${code}`;
    }
  } catch {
    // The HTTP status remains actionable when an intermediary returns a non-JSON body.
  }
  return new TrackSyncWorkerError(
    `Cloud synchronization request failed (${detail}).`,
    'network',
  );
}

export class FetchRemoteGateway implements RemoteGateway {
  public constructor(
    private readonly origin: string,
    private readonly publishableKey: string,
    private readonly accessToken: string,
    private readonly serverErrorBudget: ServerErrorBudget = { failures: 0 },
  ) {}

  public async status(signal: AbortSignal): Promise<TrackSyncUsage> {
    const response = await this.request('/functions/v1/track-sync', {
      method: 'POST',
      body: JSON.stringify({ action: 'status' }),
      signal,
    });
    if (!response.ok) throw await errorForResponse(response);
    const parsed = usageSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new TrackSyncWorkerError(
        'The server returned invalid quota data.',
        'invalid-remote',
      );
    return parsed.data;
  }

  public async snapshot(signal: AbortSignal): Promise<readonly RemoteRecord[]> {
    const records: RemoteRecord[] = [];
    for (let offset = 0; offset < maximumSnapshotRecords; offset += snapshotPageSize) {
      const response = await this.request(
        '/rest/v1/track_records?select=content_hash,revision,state,object_path,compressed_bytes,metadata&state=in.(reserved,ready)&order=content_hash.asc',
        {
          headers: {
            Range: [String(offset), String(offset + snapshotPageSize - 1)].join('-'),
            'Range-Unit': 'items',
          },
          signal,
        },
      );
      if (!response.ok) throw await errorForResponse(response);
      const parsed = z.array(remoteRecordSchema).safeParse(await response.json());
      if (!parsed.success) {
        throw new TrackSyncWorkerError(
          'The server returned invalid track records.',
          'invalid-remote',
        );
      }
      records.push(...parsed.data);
      if (parsed.data.length < snapshotPageSize) return records;
    }
    throw new TrackSyncWorkerError(
      'The server returned too many track records.',
      'invalid-remote',
    );
  }

  public async markerSnapshot(
    signal: AbortSignal,
  ): Promise<readonly RemoteMarkerRecord[]> {
    const records: RemoteMarkerRecord[] = [];
    for (let offset = 0; offset < maximumSnapshotRecords; offset += snapshotPageSize) {
      const response = await this.request(
        '/rest/v1/marker_records?select=marker_id,revision,payload&order=marker_id.asc',
        {
          headers: {
            Range: [String(offset), String(offset + snapshotPageSize - 1)].join('-'),
            'Range-Unit': 'items',
          },
          signal,
        },
      );
      if (!response.ok) throw await errorForResponse(response);
      const value: unknown = await response.json();
      if (!Array.isArray(value)) {
        throw new TrackSyncWorkerError(
          'The server returned invalid marker records.',
          'invalid-remote',
        );
      }
      const page = value.map(parseRemoteMarkerRecord);
      records.push(...page);
      if (page.length < snapshotPageSize) return records;
    }
    const probe = await this.request(
      '/rest/v1/marker_records?select=marker_id,revision,payload&order=marker_id.asc',
      { headers: { Range: '10000-10000', 'Range-Unit': 'items' }, signal },
    );
    if (!probe.ok) throw await errorForResponse(probe);
    const value: unknown = await probe.json();
    if (!Array.isArray(value)) {
      throw new TrackSyncWorkerError(
        'The server returned invalid marker records.',
        'invalid-remote',
      );
    }
    if (value.length > 0) {
      throw new TrackSyncWorkerError(
        'Cloud marker limit reached. Delete a synchronized marker and try again.',
        'limit',
      );
    }
    return records;
  }

  public async mutate(
    state: TrackSyncState,
    pair: LocalTrackSyncPair | null,
    signal: AbortSignal,
  ): Promise<RemoteMutation> {
    let response: Response;
    if (state.pendingKind === 'upsert') {
      if (pair === null)
        throw new TrackSyncWorkerError(
          'The local track is unavailable.',
          'invalid-remote',
        );
      const geometry = await gzip(encodeTrackSyncGeometry(pair.content));
      const form = new FormData();
      form.set('action', 'upload');
      form.set('contentHash', state.contentHash);
      form.set('baseRevision', String(state.remoteRevision ?? 0));
      form.set('compressedBytes', String(geometry.byteLength));
      form.set(
        'metadata',
        JSON.stringify(remoteMetadata(pair, state.lineageHash, state.geometryVersion)),
      );
      form.set(
        'geometry',
        new Blob([Uint8Array.from(geometry)], { type: 'application/gzip' }),
        'track.grpt.gz',
      );
      response = await this.request('/functions/v1/track-sync', {
        method: 'POST',
        body: form,
        signal,
      });
    } else if (state.pendingKind === 'metadata') {
      if (pair === null || state.remoteRevision === null) return { outcome: 'missing' };
      response = await this.request('/functions/v1/track-sync', {
        method: 'POST',
        body: JSON.stringify({
          action: 'metadata',
          contentHash: state.contentHash,
          baseRevision: state.remoteRevision,
          metadata: remoteMetadata(pair, state.lineageHash, state.geometryVersion),
        }),
        signal,
      });
    } else {
      if (state.remoteRevision === null) return { outcome: 'applied', revision: 0 };
      return await this.deleteRemoteRecord(
        state.contentHash,
        state.remoteRevision,
        signal,
      );
    }
    if (!response.ok) throw await errorForResponse(response);
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null || !('outcome' in value)) {
      throw new TrackSyncWorkerError(
        'The server returned an invalid mutation.',
        'invalid-remote',
      );
    }
    const responseValue = value as Record<string, unknown>;
    const outcome = responseValue.outcome;
    if (outcome === 'missing') return { outcome: 'missing' };
    const record = z
      .object({
        contentHash: z.string().regex(hashPattern),
        revision: z.number().int().nonnegative(),
        state: z.enum(['ready', 'reserved']),
      })
      .safeParse(responseValue.record);
    if (!record.success || record.data.contentHash !== state.contentHash) {
      throw new TrackSyncWorkerError(
        'The server returned an invalid track record.',
        'invalid-remote',
      );
    }
    if (outcome === 'conflict') {
      if (record.data.state === 'reserved') return { outcome: 'reserved' };
      return { outcome: 'conflict', revision: record.data.revision };
    }
    if (outcome === 'applied' || outcome === 'existing') {
      return { outcome, revision: record.data.revision };
    }
    throw new TrackSyncWorkerError(
      'The server returned an invalid mutation outcome.',
      'invalid-remote',
    );
  }

  public async deleteRemoteRecord(
    contentHash: string,
    revision: number,
    signal: AbortSignal,
  ): Promise<RemoteMutation> {
    const response = await this.request('/functions/v1/track-sync', {
      method: 'POST',
      body: JSON.stringify({
        action: 'delete',
        contentHash,
        baseRevision: revision,
      }),
      signal,
    });
    if (!response.ok) throw await errorForResponse(response);
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null || !('outcome' in value)) {
      throw new TrackSyncWorkerError(
        'The server returned an invalid mutation.',
        'invalid-remote',
      );
    }
    const responseValue = value as Record<string, unknown>;
    if (responseValue.outcome === 'missing') return { outcome: 'missing' };
    if (responseValue.outcome === 'applied') {
      return { outcome: 'applied', revision: 0 };
    }
    const record = z
      .object({
        contentHash: z.string().regex(hashPattern),
        revision: z.number().int().nonnegative(),
        state: z.enum(['ready', 'reserved']),
      })
      .safeParse(responseValue.record);
    if (
      responseValue.outcome !== 'conflict' ||
      !record.success ||
      record.data.contentHash !== contentHash
    ) {
      throw new TrackSyncWorkerError(
        'The server returned an invalid track record.',
        'invalid-remote',
      );
    }
    if (record.data.state === 'reserved') return { outcome: 'reserved' };
    return { outcome: 'conflict', revision: record.data.revision };
  }

  public async mutateMarker(
    markerId: string,
    baseRevision: number,
    payload: SavedMarker | null,
    signal: AbortSignal,
  ): Promise<RemoteMutation> {
    const response = await this.request('/functions/v1/track-sync', {
      method: 'POST',
      body: JSON.stringify(
        payload === null
          ? { action: 'marker-delete', markerId, baseRevision }
          : { action: 'marker-upsert', markerId, baseRevision, marker: payload },
      ),
      signal,
    });
    if (!response.ok) throw await errorForResponse(response);
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null || !('outcome' in value)) {
      throw new TrackSyncWorkerError(
        'The server returned an invalid marker mutation.',
        'invalid-remote',
      );
    }
    const responseValue = value as Record<string, unknown>;
    if (responseValue.outcome === 'missing') return { outcome: 'missing' };
    if (responseValue.outcome === 'applied' && payload === null) {
      return { outcome: 'applied', revision: 0 };
    }
    let record: RemoteMarkerRecord;
    try {
      record = parseRemoteMarkerRecord(responseValue.record);
    } catch {
      throw new TrackSyncWorkerError(
        'The server returned an invalid marker mutation.',
        'invalid-remote',
      );
    }
    if (record.marker_id !== markerId) {
      throw new TrackSyncWorkerError(
        'The server returned an invalid marker mutation.',
        'invalid-remote',
      );
    }
    if (responseValue.outcome === 'conflict') {
      return { outcome: 'conflict', revision: record.revision };
    }
    if (responseValue.outcome === 'applied' || responseValue.outcome === 'existing') {
      return { outcome: responseValue.outcome, revision: record.revision };
    }
    throw new TrackSyncWorkerError(
      'The server returned an invalid marker mutation outcome.',
      'invalid-remote',
    );
  }

  public async download(path: string, signal: AbortSignal): Promise<Uint8Array> {
    const response = await this.request(
      `/storage/v1/object/track-geometries/${encodeURIComponent(path).replaceAll('%2F', '/')}`,
      { signal },
    );
    if (!response.ok) throw await errorForResponse(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    if (this.serverErrorBudget.failures >= maximumServerErrorAttempts) {
      throw new TrackSyncWorkerError(exhaustedServerErrorMessage, 'network');
    }
    const headers = new Headers(init.headers);
    headers.set('apikey', this.publishableKey);
    headers.set('Authorization', `Bearer ${this.accessToken}`);
    if (!(init.body instanceof FormData))
      headers.set('Content-Type', 'application/json');
    const response = await fetch(new URL(path, this.origin), { ...init, headers });
    if (response.status === 500) this.serverErrorBudget.failures += 1;
    return response;
  }
}

function remoteMetadata(
  pair: LocalTrackSyncPair,
  lineageHash: string,
  geometryVersion: 1 | 2,
): Record<string, unknown> {
  const { summary } = pair;
  const {
    metrics: _metrics,
    calculatedMetrics: _calculatedMetrics,
    startPoi: _startPoi,
    middlePoi: _middlePoi,
    endPoi: _endPoi,
    fallbackPoi: _fallbackPoi,
    ...metadata
  } = summary;
  const result: Record<string, unknown> = {
    ...metadata,
    lineageHash,
    geometryVersion,
    markers: pair.content.markers,
    metrics: {
      distanceMeters: summary.metrics.distanceMeters,
      ...(summary.metrics.elapsedSeconds === undefined
        ? {}
        : { elapsedSeconds: summary.metrics.elapsedSeconds }),
    },
  };
  const poiFields = [
    ['startPoi', summary.startPoi],
    ['middlePoi', summary.middlePoi],
    ['endPoi', summary.endPoi],
    ['fallbackPoi', summary.fallbackPoi],
  ] as const;
  for (const [key, poi] of poiFields) {
    if (poi !== undefined) result[key] = { label: poi.label, kind: poi.kind };
  }
  return result;
}

function localFromRemote(
  record: RemoteRecord,
  geometry: Uint8Array,
  localId?: string,
): LocalTrackSyncPair {
  try {
    const base = record.metadata;
    const name = typeof base.name === 'string' ? base.name : null;
    const savedAt = typeof base.savedAt === 'string' ? base.savedAt : null;
    const sourceFilename =
      typeof base.sourceFilename === 'string' ? base.sourceFilename : null;
    const sourceFormat = base.sourceFormat;
    const geometryKind = base.geometryKind;
    if (
      name === null ||
      savedAt === null ||
      sourceFilename === null ||
      (sourceFormat !== 'gpx' && sourceFormat !== 'fit' && sourceFormat !== 'kml') ||
      (geometryKind !== 'track' && geometryKind !== 'route')
    ) {
      throw new Error('Required track metadata is missing.');
    }
    const decoded = decodeTrackSyncGeometry(geometry);
    const id = localId ?? `local:sync:${record.content_hash}`;
    const summary: Record<string, unknown> = {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      id,
      name,
      normalizedName: name.toLocaleLowerCase('en'),
      savedAt,
      updatedAt: base.updatedAt ?? savedAt,
      contentHash: record.content_hash,
      sourceFilename,
      sourceFormat,
      favorite: base.favorite,
      geometryKind,
      pointCount: decoded.reduce((count, segment) => count + segment.length, 0),
      segmentCount: decoded.length,
      metrics: calculateTrackMetrics(decoded.map((points) => ({ points }))),
      metadata: base.metadata,
      warnings: base.warnings,
    };
    if (base.generatedName !== undefined) {
      summary.generatedName = base.generatedName;
    }
    if (base.middleAnchorKind !== undefined) {
      summary.middleAnchorKind = base.middleAnchorKind;
    }
    return validateLocalTrackSyncPair({
      summary,
      content: {
        schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
        trackId: id,
        trackPoints: decoded,
        markers: base.markers === undefined ? [] : base.markers,
      },
    });
  } catch {
    throw new TrackSyncWorkerError(
      'The server returned invalid track metadata.',
      'invalid-remote',
    );
  }
}

/** Worker-side owner of scan, network validation, and one atomic local merge. */
export class TrackSyncWorkerServer {
  readonly #rpc: WorkerRpcServer;
  readonly #serverErrorBudget: ServerErrorBudget = { failures: 0 };
  readonly #gatewayFactory: RemoteGatewayFactory;

  public constructor(
    endpoint: WorkerRpcEndpoint,
    private readonly database: AppDatabase,
    gatewayFactory?: RemoteGatewayFactory,
  ) {
    this.#gatewayFactory =
      gatewayFactory ??
      ((accessToken) => {
        const configuration = loadSupabaseConfiguration(
          import.meta.env.VITE_SUPABASE_URL,
          import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        );
        if (configuration.status !== 'configured') {
          throw new TrackSyncWorkerError(
            'Synchronization is not configured.',
            'network',
          );
        }
        return new FetchRemoteGateway(
          configuration.value.url,
          configuration.value.publishableKey,
          accessToken,
          this.#serverErrorBudget,
        );
      });
    this.#rpc = new WorkerRpcServer(endpoint, {
      [trackSyncWorkerMethods.synchronize]: async (payload, { signal }) => {
        const request = z
          .object({
            accessToken: z.string().min(1).max(8_192),
            userId: z.string().min(1).max(200),
            sessionRevision: z.number().int().nonnegative(),
          })
          .strict()
          .parse(payload) as TrackSyncWorkerRequest;
        const result = await this.synchronize(
          request.userId,
          request.accessToken,
          request.sessionRevision,
          signal,
        );
        if (result.changed.markers) {
          this.#rpc.publishEvent(trackSyncWorkerEventNames.markersChanged, {
            userId: request.userId,
            sessionRevision: request.sessionRevision,
          });
        }
        return result;
      },
    });
  }

  public async synchronize(
    userId: string,
    accessToken: string,
    sessionRevision: number,
    signal: AbortSignal,
  ): Promise<TrackSyncWorkerResult> {
    const gateway = this.#gatewayFactory(accessToken);
    const local = await this.prepareUserDataSync(userId, signal);
    signal.throwIfAborted();
    let usage = await gateway.status(signal);
    const firstSnapshot = await gateway.snapshot(signal);
    const firstLineages = readyLineages(firstSnapshot);
    const localByLineage = new Map(
      local.map((entry) => [entry.state.lineageHash, entry]),
    );
    let completedTracks = 0;
    let totalTracks =
      local.filter((entry) => entry.state.pendingKind !== null).length +
      firstLineages.filter((lineage) => {
        const localEntry = localByLineage.get(lineage.identity.lineageHash);
        return (
          localEntry === undefined ||
          (localEntry.state.pendingKind === null &&
            (localEntry.state.contentHash !== lineage.head.content_hash ||
              localEntry.state.remoteRevision !== lineage.head.revision))
        );
      }).length;
    const remoteDeletionCandidates = new Map<string, RemoteTrackDeletionCandidate>();
    const publishProgress = () => {
      this.#rpc.publishEvent(trackSyncWorkerEventNames.progress, {
        completedItems: completedTracks,
        totalItems: totalTracks,
      });
    };
    if (totalTracks > 0) publishProgress();
    const mutationStates = new Map<string, TrackSyncState | null>();
    for (const entry of [...local].sort(
      (left, right) =>
        Number(right.state.pendingKind === 'delete') -
        Number(left.state.pendingKind === 'delete'),
    )) {
      if (entry.state.pendingKind === null) continue;
      const outcome = await this.applyPending(entry, gateway, signal);
      mutationStates.set(entry.state.trackId, outcome.state);
      if (outcome.remoteTrackDeletion !== null) {
        remoteDeletionCandidates.set(
          outcome.remoteTrackDeletion.trackId,
          outcome.remoteTrackDeletion,
        );
      }
      completedTracks += 1;
      publishProgress();
    }
    if (mutationStates.size > 0) usage = await gateway.status(signal);
    const secondSnapshot = await gateway.snapshot(signal);
    const lineages = readyLineages(secondSnapshot);
    const lineageByHash = new Map(
      lineages.map((lineage) => [lineage.identity.lineageHash, lineage]),
    );
    const remoteByHash = new Map(
      secondSnapshot.map((record) => [record.content_hash, record]),
    );
    const initialEntryByTrackId = new Map(
      local.map((entry) => [entry.state.trackId, entry]),
    );
    type DownloadSelection =
      | {
          readonly kind: 'existing';
          readonly remote: RemoteRecord;
          readonly localId: string;
        }
      | { readonly kind: 'new'; readonly remote: RemoteRecord };
    const downloads: DownloadSelection[] = [];
    const put: LocalTrackSyncPair[] = [];
    const states: TrackSyncState[] = [];
    const deleted = new Set<string>();
    const handledLineages = new Set<string>();
    const current = await this.readLocal();
    for (const entry of current) {
      const initial = initialEntryByTrackId.get(entry.state.trackId);
      const hasMutation = mutationStates.has(entry.state.trackId);
      const mutationState = mutationStates.get(entry.state.trackId);
      const stateUnchangedSinceScan =
        initial !== undefined && syncStatesEqual(initial.state, entry.state);
      const pairUnchangedSinceScan =
        initial?.pair?.summary.updatedAt === entry.pair?.summary.updatedAt &&
        initial?.pair?.summary.name === entry.pair?.summary.name &&
        initial?.pair?.summary.favorite === entry.pair?.summary.favorite;
      let effective: TrackSyncState | null = entry.state;
      if (
        entry.pair === null &&
        entry.state.pendingKind === 'delete' &&
        entry.state.remoteRevision === null &&
        mutationState?.contentHash === entry.state.contentHash &&
        mutationState.remoteRevision !== null
      ) {
        effective = {
          ...entry.state,
          remoteRevision: mutationState.remoteRevision,
        };
      } else if (stateUnchangedSinceScan && pairUnchangedSinceScan && hasMutation) {
        effective = mutationState ?? null;
      }
      if (effective === null) {
        if (entry.pair === null) deleted.add(entry.state.trackId);
        continue;
      }

      const lineage = lineageByHash.get(effective.lineageHash);
      if (lineage !== undefined) {
        handledLineages.add(lineage.identity.lineageHash);
        const remoteIsOlder =
          lineage.identity.geometryVersion < effective.geometryVersion;
        const matchesHead =
          effective.contentHash === lineage.head.content_hash &&
          effective.remoteRevision === lineage.head.revision;
        if (
          remoteIsOlder ||
          effective.pendingKind !== null ||
          (matchesHead && entry.pair !== null)
        ) {
          if (!syncStatesEqual(effective, entry.state)) states.push(effective);
          continue;
        }
        if (entry.pair === null) {
          deleted.add(effective.trackId);
          continue;
        }
        downloads.push({
          kind: 'existing',
          localId: effective.trackId,
          remote: lineage.head,
        });
        continue;
      }

      const remote = remoteByHash.get(effective.contentHash);
      if (remote === undefined && effective.remoteRevision !== null) {
        if (entry.pair !== null && effective.pendingKind !== 'delete') {
          remoteDeletionCandidates.set(entry.pair.summary.id, {
            trackId: entry.pair.summary.id,
            name: entry.pair.summary.name,
          });
        } else if (entry.pair === null) {
          deleted.add(effective.trackId);
        }
        continue;
      }
      if (
        remote === undefined ||
        remote.state === 'reserved' ||
        effective.pendingKind !== null
      ) {
        if (!syncStatesEqual(effective, entry.state)) states.push(effective);
        continue;
      }
      handledLineages.add(remoteIdentity(remote).lineageHash);
      if (effective.remoteRevision === remote.revision) {
        if (!syncStatesEqual(effective, entry.state)) states.push(effective);
        continue;
      }
      downloads.push({
        kind: 'existing',
        localId: effective.trackId,
        remote,
      });
    }
    for (const lineage of lineages) {
      if (handledLineages.has(lineage.identity.lineageHash)) continue;
      downloads.push({ kind: 'new', remote: lineage.head });
    }
    const reconciledTotalTracks = completedTracks + downloads.length;
    if (reconciledTotalTracks !== totalTracks) {
      totalTracks = reconciledTotalTracks;
      publishProgress();
    }
    for (const download of downloads) {
      const pair = await this.downloadPair(
        download.remote,
        download.kind === 'existing' ? download.localId : undefined,
        gateway,
        signal,
      );
      const identity = remoteIdentity(download.remote);
      put.push(pair);
      states.push({
        trackId: pair.summary.id,
        contentHash: download.remote.content_hash,
        lineageHash: identity.lineageHash,
        geometryVersion: identity.geometryVersion,
        remoteRevision: download.remote.revision,
        pendingKind: null,
      });
      if (download.kind === 'existing' && pair.summary.id !== download.localId) {
        deleted.add(download.localId);
      }
      completedTracks += 1;
      publishProgress();
    }
    signal.throwIfAborted();
    await this.database.applyRemoteTrackMergeBatch({
      put,
      deleteTrackIds: [...deleted],
      states,
      expectedStates: local.map((entry) => entry.state),
      expectedUserId: userId,
      signal,
      usage,
    });
    const tracksChanged = put.length > 0 || deleted.size > 0 || states.length > 0;
    if (tracksChanged) {
      this.#rpc.publishEvent(trackSyncWorkerEventNames.tracksChanged, {
        userId,
        sessionRevision,
      });
    }
    const supersededCount = lineages.reduce(
      (count, lineage) => count + Math.max(0, lineage.members.length - 1),
      0,
    );
    if (supersededCount > 0) {
      await this.cleanupSupersededLineages(lineages, gateway, signal);
      usage = await gateway.status(signal);
      await this.database.applyRemoteTrackMergeBatch({
        put: [],
        deleteTrackIds: [],
        states: [],
        expectedUserId: userId,
        signal,
        usage,
      });
    }
    const markerOutcome = await this.synchronizeMarkers(
      userId,
      gateway,
      signal,
      (items) => {
        totalTracks += items;
        publishProgress();
      },
      () => {
        completedTracks += 1;
        publishProgress();
      },
    );
    return {
      usage,
      changed: { tracks: tracksChanged, markers: markerOutcome.changed },
      remoteTrackDeletions: [...remoteDeletionCandidates.values()],
      remoteMarkerDeletions: markerOutcome.remoteDeletions,
    };
  }

  private async synchronizeMarkers(
    userId: string,
    gateway: RemoteGateway,
    signal: AbortSignal,
    addItems: (items: number) => void,
    completeItem: () => void,
  ): Promise<{
    readonly changed: boolean;
    readonly remoteDeletions: readonly RemoteMarkerDeletionCandidate[];
  }> {
    if (gateway.markerSnapshot === undefined || gateway.mutateMarker === undefined) {
      return { changed: false, remoteDeletions: [] };
    }
    const initial = await this.database.readMarkerSyncSnapshot();
    const firstRemote = new Map(
      (await gateway.markerSnapshot(signal)).map((record) => [
        record.marker_id,
        record,
      ]),
    );
    const initialById = new Map(initial.map((entry) => [entry.state.markerId, entry]));
    const pending = initial.filter(
      (entry) =>
        entry.state.pendingKind !== null &&
        !(entry.state.pendingKind === 'upsert' && entry.marker === null),
    );
    const anticipatedRemoteUpdates = [...firstRemote.values()].filter((remote) => {
      const entry = initialById.get(remote.marker_id);
      return (
        entry === undefined ||
        (entry.state.pendingKind === null &&
          entry.state.remoteRevision !== null &&
          (remote.revision > entry.state.remoteRevision ||
            (remote.revision === entry.state.remoteRevision &&
              JSON.stringify(remote.payload) !== JSON.stringify(entry.marker))))
      );
    }).length;
    if (pending.length + anticipatedRemoteUpdates > 0) {
      addItems(pending.length + anticipatedRemoteUpdates);
    }
    const acknowledgements = new Map<string, MarkerSyncState | null>();
    const remoteDeletions = new Map<string, RemoteMarkerDeletionCandidate>();
    for (const entry of [...pending].sort(
      (left, right) =>
        Number(right.state.pendingKind === 'delete') -
        Number(left.state.pendingKind === 'delete'),
    )) {
      const remote = firstRemote.get(entry.state.markerId);
      let baseRevision = entry.state.remoteRevision ?? remote?.revision ?? 0;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const mutation = await gateway.mutateMarker(
          entry.state.markerId,
          baseRevision,
          entry.state.pendingKind === 'delete' ? null : entry.marker,
          signal,
        );
        if (mutation.outcome === 'conflict') {
          if (attempt === 1) {
            throw new TrackSyncWorkerError(
              'Synchronization could not finish. Your local tracks and markers remain available.',
              'concurrent-change',
            );
          }
          baseRevision = mutation.revision;
          continue;
        }
        if (mutation.outcome === 'missing') {
          if (entry.state.pendingKind === 'upsert' && entry.marker !== null) {
            remoteDeletions.set(entry.marker.id, {
              markerId: entry.marker.id,
              name: entry.marker.name,
            });
          } else {
            acknowledgements.set(entry.state.markerId, null);
          }
          break;
        }
        if (mutation.outcome === 'reserved') break;
        if (entry.state.pendingKind === 'delete') {
          acknowledgements.set(entry.state.markerId, null);
        } else {
          acknowledgements.set(entry.state.markerId, {
            ...entry.state,
            remoteRevision: mutation.revision,
            pendingKind: null,
          });
        }
        break;
      }
      completeItem();
    }
    const secondRemote = new Map(
      (await gateway.markerSnapshot(signal)).map((record) => [
        record.marker_id,
        record,
      ]),
    );
    const current = new Map(
      (await this.database.readMarkerSyncSnapshot()).map((entry) => [
        entry.state.markerId,
        entry,
      ]),
    );
    const putById = new Map<string, SavedMarker>();
    const stateById = new Map<string, MarkerSyncState>();
    const deleteStateIds = new Set<string>();
    const expectedById = new Map<string, MarkerSyncState | null>();
    for (const [markerId, acknowledged] of acknowledgements) {
      const before = initialById.get(markerId);
      const now = current.get(markerId);
      if (before === undefined || now === undefined) continue;
      const markerUnchanged =
        JSON.stringify(before.marker) === JSON.stringify(now.marker);
      if (!markerUnchanged || !markerStatesEqual(before.state, now.state)) {
        throw new TrackSyncWorkerError(
          'Synchronization could not finish. Your local tracks and markers remain available.',
          'concurrent-change',
        );
      }
      expectedById.set(markerId, now.state);
      if (acknowledged === null) deleteStateIds.add(markerId);
      else stateById.set(markerId, acknowledged);
    }
    for (const [markerId, remote] of secondRemote) {
      const entry = current.get(markerId);
      if (entry === undefined) {
        if (!firstRemote.has(markerId)) addItems(1);
        putById.set(markerId, remote.payload);
        stateById.set(markerId, {
          markerId,
          remoteRevision: remote.revision,
          pendingKind: null,
          localVersion: 1,
        });
        expectedById.set(markerId, null);
        completeItem();
        continue;
      }
      if (entry.state.pendingKind !== null) continue;
      if (entry.state.remoteRevision === null) continue;
      if (remote.revision < entry.state.remoteRevision) {
        throw new TrackSyncWorkerError(
          'The server returned an invalid marker revision.',
          'invalid-remote',
        );
      }
      const changedPayload =
        JSON.stringify(remote.payload) !== JSON.stringify(entry.marker);
      if (
        remote.revision > entry.state.remoteRevision ||
        (remote.revision === entry.state.remoteRevision && changedPayload)
      ) {
        if (entry.state.localVersion >= Number.MAX_SAFE_INTEGER) {
          throw new TrackSyncWorkerError(
            'Synchronization could not finish. Your local tracks and markers remain available.',
            'revision-exhausted',
          );
        }
        putById.set(markerId, remote.payload);
        stateById.set(markerId, {
          markerId,
          remoteRevision: remote.revision,
          pendingKind: null,
          localVersion: entry.state.localVersion + 1,
        });
        expectedById.set(markerId, entry.state);
        completeItem();
      }
    }
    for (const entry of current.values()) {
      if (
        entry.marker !== null &&
        entry.state.pendingKind === null &&
        entry.state.remoteRevision !== null &&
        !secondRemote.has(entry.state.markerId)
      ) {
        remoteDeletions.set(entry.marker.id, {
          markerId: entry.marker.id,
          name: entry.marker.name,
        });
      }
    }
    const result = await this.database.applyRemoteMarkerMergeBatch({
      put: [...putById.values()],
      deleteMarkerIds: [],
      states: [...stateById.values()],
      deleteStateIds: [...deleteStateIds],
      expected: [...expectedById].map(([markerId, state]) => ({ markerId, state })),
      expectedUserId: userId,
      signal,
    });
    return { changed: result.changed, remoteDeletions: [...remoteDeletions.values()] };
  }

  private async cleanupSupersededLineages(
    lineages: readonly RemoteLineage[],
    gateway: RemoteGateway,
    signal: AbortSignal,
  ): Promise<void> {
    for (const lineage of lineages) {
      for (const record of lineage.members.slice(1)) {
        let revision = record.revision;
        let removed = false;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const result = await gateway.deleteRemoteRecord(
            record.content_hash,
            revision,
            signal,
          );
          if (result.outcome === 'applied' || result.outcome === 'missing') {
            removed = true;
            break;
          }
          if (result.outcome === 'conflict' && attempt === 0) {
            revision = result.revision;
            continue;
          }
          break;
        }
        if (!removed) {
          throw new TrackSyncWorkerError(
            'Cloud synchronization could not remove a superseded track.',
            'network',
          );
        }
      }
    }
  }

  private async downloadPair(
    remote: RemoteRecord,
    localId: string | undefined,
    gateway: RemoteGateway,
    signal: AbortSignal,
  ): Promise<LocalTrackSyncPair> {
    const compressed = await gateway.download(remote.object_path, signal);
    if (compressed.byteLength !== remote.compressed_bytes) {
      throw new TrackSyncWorkerError(
        'The server returned an invalid geometry length.',
        'invalid-remote',
      );
    }
    try {
      const canonical = await gunzip(compressed);
      if ((await hash(canonical)) !== remote.content_hash) {
        throw new Error('The downloaded hash does not match the record.');
      }
      if (canonical[4] !== remoteIdentity(remote).geometryVersion) {
        throw new Error('The downloaded codec version does not match the record.');
      }
      return localFromRemote(remote, canonical, localId);
    } catch (error) {
      if (error instanceof TrackSyncWorkerError) throw error;
      throw new TrackSyncWorkerError(
        'The server returned invalid track geometry.',
        'invalid-remote',
      );
    }
  }

  private async readLocal(): Promise<
    readonly {
      readonly pair: LocalTrackSyncPair | null;
      readonly state: TrackSyncState;
    }[]
  > {
    const states = await this.database.trackSyncStates.toArray();
    const entries: { pair: LocalTrackSyncPair | null; state: TrackSyncState }[] = [];
    for (const state of states) {
      const summary = await this.database.localTracks.get(state.trackId);
      const content = await this.database.localTrackContents.get(state.trackId);
      entries.push({
        pair:
          summary !== undefined && content !== undefined ? { summary, content } : null,
        state,
      });
    }
    return entries;
  }

  private async prepareUserDataSync(
    userId: string,
    signal: AbortSignal,
  ): Promise<
    readonly {
      readonly pair: LocalTrackSyncPair | null;
      readonly state: TrackSyncState;
    }[]
  > {
    const summaries = await this.database.localTracks.toArray();
    const contents = await this.database.localTrackContents.toArray();
    const contentById = new Map(contents.map((content) => [content.trackId, content]));
    const contentHashes = [];
    for (const summary of summaries) {
      const content = contentById.get(summary.id);
      if (content === undefined) continue;
      const [contentHash, legacyContentHash] = await Promise.all([
        hash(encodeTrackSyncGeometry(content)),
        hash(encodeLegacyTrackSyncGeometry(content)),
      ]);
      contentHashes.push({
        trackId: summary.id,
        contentHash,
        legacyContentHash,
      });
      signal.throwIfAborted();
    }
    await this.database.prepareUserDataSync(userId, contentHashes, signal);
    return this.readLocal();
  }

  private async applyPending(
    entry: { readonly pair: LocalTrackSyncPair | null; readonly state: TrackSyncState },
    gateway: RemoteGateway,
    signal: AbortSignal,
  ): Promise<{
    readonly state: TrackSyncState | null;
    readonly deleteLocal: boolean;
    readonly remoteTrackDeletion: RemoteTrackDeletionCandidate | null;
  }> {
    let state = entry.state;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await gateway.mutate(state, entry.pair, signal);
      if (result.outcome === 'missing') {
        if (entry.pair !== null && state.pendingKind !== 'delete') {
          return {
            state: entry.state,
            deleteLocal: false,
            remoteTrackDeletion: {
              trackId: entry.pair.summary.id,
              name: entry.pair.summary.name,
            },
          };
        }
        return {
          state: null,
          deleteLocal: entry.pair === null,
          remoteTrackDeletion: null,
        };
      }
      if (result.outcome === 'reserved') {
        return {
          state: entry.state,
          deleteLocal: false,
          remoteTrackDeletion: null,
        };
      }
      if (
        result.outcome === 'existing' &&
        state.pendingKind === 'upsert' &&
        state.remoteRevision === null
      ) {
        state = { ...state, remoteRevision: result.revision };
        continue;
      }
      if (result.outcome === 'conflict') {
        if (attempt === 1) {
          return {
            state: entry.state,
            deleteLocal: false,
            remoteTrackDeletion: null,
          };
        }
        state = { ...state, remoteRevision: result.revision };
        continue;
      }
      if (state.pendingKind === 'delete') {
        return { state: null, deleteLocal: true, remoteTrackDeletion: null };
      }
      return {
        state: { ...state, remoteRevision: result.revision, pendingKind: null },
        deleteLocal: false,
        remoteTrackDeletion: null,
      };
    }
    return {
      state: entry.state,
      deleteLocal: false,
      remoteTrackDeletion: null,
    };
  }
}
