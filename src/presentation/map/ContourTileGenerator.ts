import { addProtocol, removeProtocol } from 'maplibre-gl';
import type { AddProtocolAction, GetResourceResponse } from 'maplibre-gl';
import maplibreContour from 'maplibre-contour';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { ContourIntervalMeters } from '@/application/ports/MapLayerPreferencesRepository';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import type {
  TerrainComputeMetrics,
  TerrainComputeStatus,
} from '@/infrastructure/elevation/TerrainComputeBackend';
import { WorkerTerrainComputeBackend } from '@/infrastructure/elevation/WorkerTerrainComputeBackend';
import { ContourTimingDiagnostics } from '@/presentation/map/ContourTimingDiagnostics';
import { TerrainComputeDiagnostics } from '@/presentation/map/TerrainComputeDiagnostics';

export interface ContourTileGenerator {
  createDemTileUrl(): string;
  createTileUrl(intervalMeters: ContourIntervalMeters): string;
  setFilterEnabled(enabled: boolean): void;
  setInteractionActive(active: boolean): void;
  getStatus(): TerrainComputeStatus;
  subscribeStatus(listener: (status: TerrainComputeStatus) => void): () => void;
  subscribeMetrics(listener: (metrics: TerrainComputeMetrics) => void): () => void;
  dispose(): void;
}

export function withOwnedProtocolBuffers(
  protocol: AddProtocolAction,
): AddProtocolAction {
  return async (request, abortController) => {
    const response = (await protocol(
      request,
      abortController,
    )) as GetResourceResponse<unknown>;
    return {
      ...response,
      // MapLibre transfers protocol ArrayBuffers to its worker, detaching them.
      // maplibre-contour caches its generated buffer, so every delivery needs an
      // owned copy or a later cache hit will attempt to transfer detached memory.
      data:
        response.data instanceof ArrayBuffer ? response.data.slice(0) : response.data,
    };
  };
}

function registerProtocolWithOwnedBuffers(
  id: string,
  protocol: AddProtocolAction,
): void {
  addProtocol(id, withOwnedProtocolBuffers(protocol));
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
    this.#source.manager = this.#backend;
    this.#source.setupMaplibre({ addProtocol: registerProtocolWithOwnedBuffers });
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

  public subscribeStatus(listener: (status: TerrainComputeStatus) => void): () => void {
    return this.#backend.subscribeStatus(listener);
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
