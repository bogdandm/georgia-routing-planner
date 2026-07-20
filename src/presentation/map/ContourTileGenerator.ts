import { addProtocol, removeProtocol } from 'maplibre-gl';
import maplibreContour from 'maplibre-contour';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { ContourIntervalMeters } from '@/application/ports/MapLayerPreferencesRepository';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import type {
  TerrainComputeMetrics,
  TerrainComputeQueueState,
  TerrainComputeStatus,
} from '@/infrastructure/elevation/TerrainComputeBackend';
import { WorkerTerrainComputeBackend } from '@/infrastructure/elevation/WorkerTerrainComputeBackend';
import { ContourTimingDiagnostics } from '@/presentation/map/ContourTimingDiagnostics';
import { TerrainComputeDiagnostics } from '@/presentation/map/TerrainComputeDiagnostics';

type TerrainManagerContract = InstanceType<typeof maplibreContour.DemSource>['manager'];

/** Keeps the third-party manager shape private while the application backend stays truthful. */
class TerrainComputeManagerAdapter implements TerrainManagerContract {
  public readonly loaded: Promise<void>;

  public constructor(private readonly backend: WorkerTerrainComputeBackend) {
    this.loaded = backend.loaded;
  }

  public fetchTile(
    ...parameters: Parameters<TerrainManagerContract['fetchTile']>
  ): ReturnType<TerrainManagerContract['fetchTile']> {
    return this.backend.fetchTile(
      parameters[0],
      parameters[1],
      parameters[2],
      parameters[3],
    );
  }

  public fetchAndParseTile(
    ..._parameters: Parameters<TerrainManagerContract['fetchAndParseTile']>
  ): ReturnType<TerrainManagerContract['fetchAndParseTile']> {
    return Promise.reject(
      new Error('Parsed DEM access is internal to terrain contour computation.'),
    );
  }

  public fetchContourTile(
    ...parameters: Parameters<TerrainManagerContract['fetchContourTile']>
  ): ReturnType<TerrainManagerContract['fetchContourTile']> {
    return this.backend.fetchContourTile(
      parameters[0],
      parameters[1],
      parameters[2],
      parameters[3],
      parameters[4],
    );
  }
}

export interface ContourTileGenerator {
  createDemTileUrl(): string;
  createTileUrl(intervalMeters: ContourIntervalMeters): string;
  setFilterEnabled(enabled: boolean): void;
  setInteractionActive(active: boolean): void;
  getStatus(): TerrainComputeStatus;
  getQueueState(): TerrainComputeQueueState;
  subscribeStatus(listener: (status: TerrainComputeStatus) => void): () => void;
  subscribeQueueState(listener: (state: TerrainComputeQueueState) => void): () => void;
  subscribeMetrics(listener: (metrics: TerrainComputeMetrics) => void): () => void;
  dispose(): void;
}

/** Registers the bounded client-side contour protocol for one application runtime. */
export class MapLibreContourTileGenerator implements ContourTileGenerator {
  readonly #source: InstanceType<typeof maplibreContour.DemSource>;
  readonly #backend: WorkerTerrainComputeBackend;
  #filterEnabled = true;
  #revision = 0;
  #disposed = false;
  readonly #releaseMetrics: () => void;

  public constructor(
    terrain: MapProviderConfiguration['terrain'],
    requestTimeoutMs: number,
    logger: DiagnosticLogger,
  ) {
    this.#backend = new WorkerTerrainComputeBackend(terrain, requestTimeoutMs, logger);
    this.#source = new maplibreContour.DemSource({
      id: 'georgia-terrain',
      url: terrain.tileUrl,
      encoding: terrain.encoding,
      maxzoom: terrain.maxZoom,
      cacheSize: terrain.overlays.contourCacheSize,
      timeoutMs: requestTimeoutMs,
      // Keep lifecycle deterministic: MapLibre owns request cancellation and no
      // additional worker survives after the application runtime is released.
      worker: false,
    });
    this.#source.manager = new TerrainComputeManagerAdapter(this.#backend);
    this.#source.setupMaplibre({ addProtocol });
    const timingDiagnostics = new ContourTimingDiagnostics(logger);
    this.#source.onTiming((timing) => {
      timingDiagnostics.record({
        durationMs: timing.duration,
        tileCount: timing.tilesUsed,
        failed: timing.error === true,
      });
    });
    const computeDiagnostics = new TerrainComputeDiagnostics(logger);
    this.#releaseMetrics = this.#backend.subscribeMetrics((metrics) => {
      computeDiagnostics.record(metrics);
    });
  }

  public createDemTileUrl(): string {
    return `${this.#source.sharedDemProtocolUrl}?demFilterRevision=${String(this.#revision)}`;
  }

  public createTileUrl(intervalMeters: ContourIntervalMeters): string {
    const url = this.#source.contourProtocolUrl({
      thresholds: { 11: [intervalMeters, 200] },
      elevationKey: 'ele',
      levelKey: 'level',
      contourLayer: 'contours',
    });
    return `${url}&demFilterRevision=${String(this.#revision)}`;
  }

  public setFilterEnabled(enabled: boolean): void {
    if (this.#filterEnabled === enabled) return;
    this.#filterEnabled = enabled;
    this.#backend.setFilterEnabled(enabled);
    this.#revision += 1;
  }

  public setInteractionActive(active: boolean): void {
    this.#backend.setInteractionActive(active);
  }

  public getStatus(): TerrainComputeStatus {
    return this.#backend.getStatus();
  }

  public getQueueState(): TerrainComputeQueueState {
    return this.#backend.getQueueState();
  }

  public subscribeStatus(listener: (status: TerrainComputeStatus) => void): () => void {
    return this.#backend.subscribeStatus(listener);
  }

  public subscribeQueueState(
    listener: (state: TerrainComputeQueueState) => void,
  ): () => void {
    return this.#backend.subscribeQueueState(listener);
  }

  public subscribeMetrics(
    listener: (metrics: TerrainComputeMetrics) => void,
  ): () => void {
    return this.#backend.subscribeMetrics(listener);
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    removeProtocol(this.#source.sharedDemProtocolId);
    removeProtocol(this.#source.contourProtocolId);
    this.#releaseMetrics();
    this.#backend.dispose();
  }
}
