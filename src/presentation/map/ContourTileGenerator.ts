import { addProtocol } from 'maplibre-gl';
import type { AddProtocolAction, GetResourceResponse } from 'maplibre-gl';
import maplibreContour from 'maplibre-contour';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { ContourIntervalMeters } from '@/application/ports/MapLayerPreferencesRepository';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';

export interface ContourTileGenerator {
  createTileUrl(intervalMeters: ContourIntervalMeters): string;
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
    this.#source.setupMaplibre({ addProtocol: registerProtocolWithOwnedBuffers });
    this.#source.onTiming((timing) => {
      logger.log({
        level: timing.error === true ? 'warn' : 'debug',
        name:
          timing.error === true
            ? 'map.contours.tile-failed'
            : 'map.contours.tile-generated',
        data: {
          durationMs: Math.round(timing.duration),
          tileCount: timing.tilesUsed,
          status: timing.error === true ? 'failed' : 'success',
        },
      });
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
}
