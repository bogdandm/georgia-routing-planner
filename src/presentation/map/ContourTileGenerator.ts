import { addProtocol } from 'maplibre-gl';
import type { AddProtocolAction, GetResourceResponse } from 'maplibre-gl';
import maplibreContour from 'maplibre-contour';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { ContourIntervalMeters } from '@/application/ports/MapLayerPreferencesRepository';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import { FilteredTerrariumTileProvider } from '@/infrastructure/elevation/FilteredTerrariumTileProvider';
import { ContourTimingDiagnostics } from '@/presentation/map/ContourTimingDiagnostics';

export interface ContourTileGenerator {
  createDemTileUrl(): string;
  createTileUrl(intervalMeters: ContourIntervalMeters): string;
  setFilterEnabled(enabled: boolean): void;
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
  readonly #filteredTiles: FilteredTerrariumTileProvider | null;
  #filterEnabled = true;
  #revision = 0;

  public constructor(
    terrain: MapProviderConfiguration['terrain'],
    requestTimeoutMs: number,
    logger: DiagnosticLogger,
  ) {
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
    this.#filteredTiles =
      terrain.encoding === 'terrarium'
        ? new FilteredTerrariumTileProvider(terrain, requestTimeoutMs, logger)
        : null;
    if (this.#filteredTiles !== null) {
      const filteredTiles = this.#filteredTiles;
      this.#source.manager.fetchTile = (zoom, x, y, abortController) =>
        filteredTiles.getTile(zoom, x, y, abortController);
    }
    this.#source.setupMaplibre({ addProtocol: registerProtocolWithOwnedBuffers });
    const timingDiagnostics = new ContourTimingDiagnostics(logger);
    this.#source.onTiming((timing) => {
      timingDiagnostics.record({
        durationMs: timing.duration,
        tileCount: timing.tilesUsed,
        failed: timing.error === true,
      });
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
    if (this.#filteredTiles === null || this.#filterEnabled === enabled) return;
    this.#filterEnabled = enabled;
    this.#filteredTiles.setEnabled(enabled);
    this.#revision += 1;
    const manager = this.#source.manager as unknown as {
      readonly tileCache?: { clear(): void };
      readonly parsedCache?: { clear(): void };
      readonly contourCache?: { clear(): void };
    };
    manager.tileCache?.clear();
    manager.parsedCache?.clear();
    manager.contourCache?.clear();
  }
}
