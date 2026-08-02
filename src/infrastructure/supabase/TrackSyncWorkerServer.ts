import { z } from 'zod';

import { loadSupabaseConfiguration } from '@/bootstrap/configuration/SupabaseConfiguration';
import { calculateTrackMetrics } from '@/domain/tracks/trackCalculations';
import {
  decodeTrackSyncGeometry,
  encodeTrackSyncGeometry,
} from '@/domain/tracks/trackSyncGeometry';
import {
  validateLocalTrackSyncPair,
  type AppDatabase,
  type LocalTrackSyncPair,
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
const usageSchema = z.object({
  usedBytes: z.number().int().nonnegative().max(8_388_608),
  reservedBytes: z.number().int().nonnegative().max(8_388_608),
  limitBytes: z.literal(8_388_608),
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
  });

type RemoteRecord = z.infer<typeof remoteRecordSchema>;

interface RemoteGateway {
  status(signal: AbortSignal): Promise<TrackSyncUsage>;
  snapshot(signal: AbortSignal): Promise<readonly RemoteRecord[]>;
  mutate(
    state: TrackSyncState,
    pair: LocalTrackSyncPair | null,
    signal: AbortSignal,
  ): Promise<RemoteMutation>;
  download(path: string, signal: AbortSignal): Promise<Uint8Array>;
}

type RemoteMutation =
  | { readonly outcome: 'applied' | 'existing'; readonly revision: number }
  | { readonly outcome: 'conflict'; readonly revision: number }
  | { readonly outcome: 'missing' }
  | { readonly outcome: 'reserved' };

function syncStatesEqual(left: TrackSyncState, right: TrackSyncState): boolean {
  return (
    left.trackId === right.trackId &&
    left.contentHash === right.contentHash &&
    left.remoteRevision === right.remoteRevision &&
    left.pendingKind === right.pendingKind
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

function errorForResponse(response: Response): TrackSyncWorkerError {
  if (response.status === 401) {
    return new TrackSyncWorkerError('Your account session expired.', 'auth-expired');
  }
  if (response.status === 413) {
    return new TrackSyncWorkerError('Track geometry quota exceeded.', 'quota');
  }
  return new TrackSyncWorkerError(
    'Synchronization could not reach the server.',
    'network',
  );
}

export class FetchRemoteGateway implements RemoteGateway {
  public constructor(
    private readonly origin: string,
    private readonly publishableKey: string,
    private readonly accessToken: string,
  ) {}

  public async status(signal: AbortSignal): Promise<TrackSyncUsage> {
    const response = await this.request('/functions/v1/track-sync', {
      method: 'POST',
      body: JSON.stringify({ action: 'status' }),
      signal,
    });
    if (!response.ok) throw errorForResponse(response);
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
        '/rest/v1/track_records?select=content_hash,revision,state,object_path,compressed_bytes,metadata&state=in.(reserved,ready)',
        {
          headers: {
            Range: [String(offset), String(offset + snapshotPageSize - 1)].join('-'),
            'Range-Unit': 'items',
          },
          signal,
        },
      );
      if (!response.ok) throw errorForResponse(response);
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
      form.set('metadata', JSON.stringify(remoteMetadata(pair.summary)));
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
          metadata: remoteMetadata(pair.summary),
        }),
        signal,
      });
    } else {
      if (state.remoteRevision === null) return { outcome: 'applied', revision: 0 };
      response = await this.request('/functions/v1/track-sync', {
        method: 'POST',
        body: JSON.stringify({
          action: 'delete',
          contentHash: state.contentHash,
          baseRevision: state.remoteRevision,
        }),
        signal,
      });
    }
    if (!response.ok) throw errorForResponse(response);
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
    if (state.pendingKind === 'delete' && outcome === 'applied') {
      return { outcome: 'applied', revision: 0 };
    }
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

  public async download(path: string, signal: AbortSignal): Promise<Uint8Array> {
    const response = await this.request(
      `/storage/v1/object/track-geometries/${encodeURIComponent(path).replaceAll('%2F', '/')}`,
      { signal },
    );
    if (!response.ok) throw errorForResponse(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('apikey', this.publishableKey);
    headers.set('Authorization', `Bearer ${this.accessToken}`);
    if (!(init.body instanceof FormData))
      headers.set('Content-Type', 'application/json');
    return fetch(new URL(path, this.origin), { ...init, headers });
  }
}

function remoteMetadata(
  summary: LocalTrackSyncPair['summary'],
): Record<string, unknown> {
  const {
    metrics: _metrics,
    startPoi: _startPoi,
    middlePoi: _middlePoi,
    endPoi: _endPoi,
    fallbackPoi: _fallbackPoi,
    ...metadata
  } = summary;
  const result: Record<string, unknown> = {
    ...metadata,
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
      schemaVersion: 3,
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
      content: { schemaVersion: 3, trackId: id, trackPoints: decoded },
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

  public constructor(
    endpoint: WorkerRpcEndpoint,
    private readonly database: AppDatabase,
    private readonly gatewayFactory: (accessToken: string) => RemoteGateway = (
      accessToken,
    ) => {
      const configuration = loadSupabaseConfiguration(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      );
      if (configuration.status !== 'configured')
        throw new TrackSyncWorkerError('Synchronization is not configured.', 'network');
      return new FetchRemoteGateway(
        configuration.value.url,
        configuration.value.publishableKey,
        accessToken,
      );
    },
  ) {
    this.#rpc = new WorkerRpcServer(endpoint, {
      [trackSyncWorkerMethods.synchronize]: async (payload, { signal }) => {
        const request = z
          .object({ accessToken: z.string().min(1).max(8_192) })
          .strict()
          .parse(payload) as TrackSyncWorkerRequest;
        const result = await this.synchronize(request.accessToken, signal);
        if (result.changed)
          this.#rpc.publishEvent(trackSyncWorkerEventNames.tracksChanged, null);
        return result;
      },
    });
  }

  public async synchronize(
    accessToken: string,
    signal: AbortSignal,
  ): Promise<TrackSyncWorkerResult> {
    const gateway = this.gatewayFactory(accessToken);
    const local = await this.backfillAndDeduplicate();
    signal.throwIfAborted();
    let usage = await gateway.status(signal);
    await gateway.snapshot(signal);
    const mutationStates = new Map<string, TrackSyncState | null>();
    const mutationDeleted = new Set<string>();
    for (const entry of [...local].sort(
      (left, right) =>
        Number(right.state.pendingKind === 'delete') -
        Number(left.state.pendingKind === 'delete'),
    )) {
      if (entry.state.pendingKind === null) continue;
      const outcome = await this.applyPending(entry, gateway, signal);
      mutationStates.set(entry.state.trackId, outcome.state);
      if (outcome.deleteLocal) mutationDeleted.add(entry.state.trackId);
    }
    if (mutationStates.size > 0) usage = await gateway.status(signal);
    const secondSnapshot = await gateway.snapshot(signal);
    const remoteByHash = new Map(
      secondSnapshot.map((record) => [record.content_hash, record]),
    );
    const initialEntryByTrackId = new Map(
      local.map((entry) => [entry.state.trackId, entry]),
    );
    const put: LocalTrackSyncPair[] = [];
    const states: TrackSyncState[] = [];
    const deleted = new Set(mutationDeleted);
    const current = await this.readLocal();
    const currentHashes = new Set(current.map((entry) => entry.state.contentHash));
    for (const entry of current) {
      const initial = initialEntryByTrackId.get(entry.state.trackId);
      const hasMutation = mutationStates.has(entry.state.trackId);
      const stateUnchangedSinceScan =
        initial !== undefined && syncStatesEqual(initial.state, entry.state);
      const pairUnchangedSinceScan =
        initial?.pair?.summary.updatedAt === entry.pair?.summary.updatedAt &&
        initial?.pair?.summary.name === entry.pair?.summary.name &&
        initial?.pair?.summary.favorite === entry.pair?.summary.favorite;
      let effective: TrackSyncState | null = entry.state;
      if (stateUnchangedSinceScan && pairUnchangedSinceScan && hasMutation) {
        effective = mutationStates.get(entry.state.trackId) ?? null;
      }
      if (effective === null) {
        if (entry.pair === null) deleted.add(entry.state.trackId);
        continue;
      }
      const remote = remoteByHash.get(effective.contentHash);
      if (remote === undefined && effective.remoteRevision !== null) {
        deleted.add(effective.trackId);
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
      if (effective.remoteRevision === remote.revision) {
        if (!syncStatesEqual(effective, entry.state)) states.push(effective);
        continue;
      }
      const pair = await this.downloadPair(remote, effective.trackId, gateway, signal);
      put.push(pair);
      states.push({
        trackId: pair.summary.id,
        contentHash: remote.content_hash,
        remoteRevision: remote.revision,
        pendingKind: null,
      });
      if (pair.summary.id !== effective.trackId) deleted.add(effective.trackId);
    }
    for (const remote of secondSnapshot) {
      if (remote.state !== 'ready' || currentHashes.has(remote.content_hash)) continue;
      const pair = await this.downloadPair(remote, undefined, gateway, signal);
      put.push(pair);
      states.push({
        trackId: pair.summary.id,
        contentHash: remote.content_hash,
        remoteRevision: remote.revision,
        pendingKind: null,
      });
    }
    signal.throwIfAborted();
    await this.database.applyRemoteTrackMergeBatch({
      put,
      deleteTrackIds: [...deleted],
      states,
      usage,
    });
    return {
      usage,
      changed: put.length > 0 || deleted.size > 0 || states.length > 0,
    };
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

  private async backfillAndDeduplicate(): Promise<
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
      if (summary.contentHash !== undefined) continue;
      const content = contentById.get(summary.id);
      if (content === undefined) continue;
      contentHashes.push({
        trackId: summary.id,
        contentHash: await hash(encodeTrackSyncGeometry(content)),
      });
    }
    await this.database.backfillAndDeduplicateTrackSync(contentHashes);
    return this.readLocal();
  }

  private async applyPending(
    entry: { readonly pair: LocalTrackSyncPair | null; readonly state: TrackSyncState },
    gateway: RemoteGateway,
    signal: AbortSignal,
  ): Promise<{ readonly state: TrackSyncState | null; readonly deleteLocal: boolean }> {
    let state = entry.state;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await gateway.mutate(state, entry.pair, signal);
      if (result.outcome === 'missing') {
        return { state: null, deleteLocal: state.remoteRevision !== null };
      }
      if (result.outcome === 'reserved') {
        return { state: entry.state, deleteLocal: false };
      }
      if (result.outcome === 'conflict') {
        if (attempt === 1) return { state: entry.state, deleteLocal: false };
        state = { ...state, remoteRevision: result.revision };
        continue;
      }
      if (state.pendingKind === 'delete') return { state: null, deleteLocal: false };
      return {
        state: { ...state, remoteRevision: result.revision, pendingKind: null },
        deleteLocal: false,
      };
    }
    return { state: entry.state, deleteLocal: false };
  }
}
