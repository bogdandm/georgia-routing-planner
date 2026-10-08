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
import {
  ContourTimingDiagnostics,
  TerrainComputeDiagnostics,
} from '@/presentation/map/TerrainComputeDiagnostics';

type TerrainManagerContract = InstanceType<typeof maplibreContour.DemSource>['manager'];

/**
 * Keeps the third-party manager shape private while the application backend stays truthful.
 * Only the contour protocol is registered with MapLibre: relief and 3D terrain load the
 * provider tiles directly, so the library's shared-DEM protocol and parsed-tile accessor
 * have no caller. Their methods exist only because the library type requires them and
 * reject instead of pretending to serve DEM data.
 */
class TerrainComputeManagerAdapter implements TerrainManagerContract {
  public readonly loaded: Promise<void>;

  public constructor(private readonly backend: WorkerTerrainComputeBackend) {
    this.loaded = backend.loaded;
  }

  public fetchTile(
    ..._parameters: Parameters<TerrainManagerContract['fetchTile']>
  ): ReturnType<TerrainManagerContract['fetchTile']> {
    return Promise.reject(
      new Error('Raw DEM access is internal to terrain contour computation.'),
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
  createTileUrl(intervalMeters: ContourIntervalMeters): string;
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
  #disposed = false;
  readonly #releaseMetrics: () => void;
  readonly #timingDiagnostics: ContourTimingDiagnostics;
  readonly #computeDiagnostics: TerrainComputeDiagnostics;

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
    addProtocol(this.#source.contourProtocolId, this.#source.contourProtocolV4);
    this.#timingDiagnostics = new ContourTimingDiagnostics(logger);
    this.#source.onTiming((timing) => {
      this.#timingDiagnostics.record({
        durationMs: timing.duration,
        tileCount: timing.tilesUsed,
        failed: timing.error === true,
      });
    });
    this.#computeDiagnostics = new TerrainComputeDiagnostics(logger);
    this.#releaseMetrics = this.#backend.subscribeMetrics((metrics) => {
      this.#computeDiagnostics.record(metrics);
    });
  }

  public createTileUrl(intervalMeters: ContourIntervalMeters): string {
    return this.#source.contourProtocolUrl({
      thresholds: { 11: [intervalMeters, 200] },
      elevationKey: 'ele',
      levelKey: 'level',
      contourLayer: 'contours',
    });
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
    removeProtocol(this.#source.contourProtocolId);
    this.#releaseMetrics();
    this.#timingDiagnostics.dispose();
    this.#computeDiagnostics.dispose();
    this.#backend.dispose();
  }
}
