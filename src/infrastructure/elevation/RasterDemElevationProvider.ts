import type { KyInstance } from 'ky';

import type {
  ElevationCoordinate,
  ElevationProvider,
  ElevationSample,
  ElevationSamplingProgressListener,
} from '@/application/ports/ElevationProvider';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import {
  BrowserDemImageDecoder,
  type DecodedDemTile,
  type DemImageDecoder,
} from '@/infrastructure/elevation/BrowserDemImageDecoder';

/** One weighted pixel of a bilinear sample, addressed inside its slippy-map tile. */
interface DemCorner {
  readonly tileX: number;
  readonly tileY: number;
  readonly pixelX: number;
  readonly pixelY: number;
  readonly weight: number;
}

interface DemTileCorner {
  readonly sampleIndex: number;
  readonly pixelX: number;
  readonly pixelY: number;
  readonly weight: number;
}

interface DemTileRequest {
  readonly x: number;
  readonly y: number;
  /** Samples that need this tile, each listed once. */
  readonly sampleIndices: number[];
  readonly corners: DemTileCorner[];
}

const maximumMercatorLatitude = 85.05112878;

/**
 * Locates the up to four pixel centres that surround a coordinate at the given zoom.
 * Pixel values describe pixel centres, so the sample point is offset by half a pixel
 * before interpolation. Columns wrap at the antimeridian; rows clamp at the Mercator
 * limits. Corners with zero weight are omitted so exact pixel-centre hits need no
 * neighbouring tiles.
 */
function bilinearDemCorners(
  coordinate: ElevationCoordinate,
  zoom: number,
  tileSize: number,
): readonly DemCorner[] | null {
  if (
    !Number.isFinite(coordinate.longitude) ||
    !Number.isFinite(coordinate.latitude) ||
    coordinate.latitude < -maximumMercatorLatitude ||
    coordinate.latitude > maximumMercatorLatitude
  ) {
    return null;
  }
  const worldPixels = 2 ** zoom * tileSize;
  const longitude = ((((coordinate.longitude + 180) % 360) + 360) % 360) - 180;
  const latitudeRadians = (coordinate.latitude * Math.PI) / 180;
  const columnPosition = ((longitude + 180) / 360) * worldPixels - 0.5;
  const rowPosition =
    ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * worldPixels - 0.5;
  const leftColumn = Math.floor(columnPosition);
  const topRow = Math.floor(rowPosition);
  const columnFraction = columnPosition - leftColumn;
  const rowFraction = rowPosition - topRow;
  const corners: DemCorner[] = [];
  for (const [rowOffset, rowWeight] of [
    [0, 1 - rowFraction],
    [1, rowFraction],
  ] as const) {
    for (const [columnOffset, columnWeight] of [
      [0, 1 - columnFraction],
      [1, columnFraction],
    ] as const) {
      const weight = rowWeight * columnWeight;
      if (weight <= 0) continue;
      const column =
        (((leftColumn + columnOffset) % worldPixels) + worldPixels) % worldPixels;
      const row = Math.min(worldPixels - 1, Math.max(0, topRow + rowOffset));
      const tileX = Math.floor(column / tileSize);
      const tileY = Math.floor(row / tileSize);
      corners.push({
        tileX,
        tileY,
        pixelX: column - tileX * tileSize,
        pixelY: row - tileY * tileSize,
        weight,
      });
    }
  }
  return corners;
}

export function decodeDemElevation(
  pixel: { readonly red: number; readonly green: number; readonly blue: number },
  encoding: MapProviderConfiguration['terrain']['encoding'],
): number {
  if (encoding === 'terrarium') {
    return pixel.red * 256 + pixel.green + pixel.blue / 256 - 32_768;
  }
  return -10_000 + (pixel.red * 65_536 + pixel.green * 256 + pixel.blue) * 0.1;
}

/** Sampling works for any square tile size; only these terrain fields are read. */
type RasterDemSource = Pick<
  MapProviderConfiguration['terrain'],
  'tileUrl' | 'encoding' | 'maxZoom'
> & { readonly tileSize: number };

/**
 * Samples raster DEM tiles at the provider's maximum zoom with bilinear interpolation
 * between pixel centres. Each needed tile is fetched and decoded once per batch.
 * Transparent or non-finite pixels are treated as missing; the remaining corner
 * weights are renormalised, and a sample without any valid corner is unavailable.
 */
export class RasterDemElevationProvider implements ElevationProvider {
  public constructor(
    private readonly httpClient: KyInstance,
    private readonly terrain: RasterDemSource,
    private readonly idGenerator: IdGenerator,
    private readonly decoder: DemImageDecoder = new BrowserDemImageDecoder(),
  ) {}

  public async sample(
    coordinate: ElevationCoordinate,
    signal: AbortSignal,
  ): Promise<ElevationSample> {
    return (
      (await this.sampleMany([coordinate], signal))[0] ?? { status: 'unavailable' }
    );
  }

  public async sampleMany(
    coordinates: readonly ElevationCoordinate[],
    signal: AbortSignal,
    onProgress?: ElevationSamplingProgressListener,
  ): Promise<readonly ElevationSample[]> {
    const { maxZoom: zoom, tileSize } = this.terrain;
    const samples: ElevationSample[] = coordinates.map(() => ({
      status: 'unavailable',
    }));
    const pendingTileCounts = new Int32Array(coordinates.length);
    const weightedElevations = new Float64Array(coordinates.length);
    const validWeights = new Float64Array(coordinates.length);
    const tiles = new Map<string, DemTileRequest>();
    let totalSamples = 0;
    for (const [sampleIndex, coordinate] of coordinates.entries()) {
      const corners = bilinearDemCorners(coordinate, zoom, tileSize);
      if (corners === null) continue;
      totalSamples += 1;
      for (const corner of corners) {
        const key = `${String(corner.tileX)}/${String(corner.tileY)}`;
        let tile = tiles.get(key);
        if (tile === undefined) {
          tile = { x: corner.tileX, y: corner.tileY, sampleIndices: [], corners: [] };
          tiles.set(key, tile);
        }
        if (tile.sampleIndices.at(-1) !== sampleIndex) {
          tile.sampleIndices.push(sampleIndex);
          pendingTileCounts[sampleIndex] = (pendingTileCounts[sampleIndex] ?? 0) + 1;
        }
        tile.corners.push({
          sampleIndex,
          pixelX: corner.pixelX,
          pixelY: corner.pixelY,
          weight: corner.weight,
        });
      }
    }
    if (!signal.aborted) {
      onProgress?.({ completedSamples: 0, totalSamples, indices: [], samples: [] });
    }
    let completedSamples = 0;
    await Promise.all(
      [...tiles.values()].map(async (tile) => {
        const blob = await this.httpClient
          .get(
            this.terrain.tileUrl
              .replaceAll('{z}', String(zoom))
              .replaceAll('{x}', String(tile.x))
              .replaceAll('{y}', String(tile.y)),
            { signal, context: { operationId: this.idGenerator.generate() } },
          )
          .blob();
        signal.throwIfAborted();
        const decoded = await this.decoder.decode(blob, signal);
        for (const corner of tile.corners) {
          const meters = this.pixelElevation(decoded, corner.pixelX, corner.pixelY);
          if (meters === null) continue;
          weightedElevations[corner.sampleIndex] =
            (weightedElevations[corner.sampleIndex] ?? 0) + corner.weight * meters;
          validWeights[corner.sampleIndex] =
            (validWeights[corner.sampleIndex] ?? 0) + corner.weight;
        }
        signal.throwIfAborted();
        const resolvedIndices: number[] = [];
        for (const sampleIndex of tile.sampleIndices) {
          const pendingTiles = (pendingTileCounts[sampleIndex] ?? 0) - 1;
          pendingTileCounts[sampleIndex] = pendingTiles;
          if (pendingTiles > 0) continue;
          const weight = validWeights[sampleIndex] ?? 0;
          if (weight > 0) {
            samples[sampleIndex] = {
              status: 'available',
              meters: (weightedElevations[sampleIndex] ?? 0) / weight,
            };
          }
          resolvedIndices.push(sampleIndex);
        }
        completedSamples += resolvedIndices.length;
        onProgress?.({
          completedSamples,
          totalSamples,
          indices: resolvedIndices,
          samples: resolvedIndices.map(
            (index) => samples[index] ?? { status: 'unavailable' },
          ),
        });
      }),
    );
    return samples;
  }

  private pixelElevation(
    decoded: DecodedDemTile,
    pixelX: number,
    pixelY: number,
  ): number | null {
    const offset = (pixelY * decoded.width + pixelX) * 4;
    const red = decoded.data[offset];
    const green = decoded.data[offset + 1];
    const blue = decoded.data[offset + 2];
    if (
      red === undefined ||
      green === undefined ||
      blue === undefined ||
      decoded.data[offset + 3] !== 255
    ) {
      return null;
    }
    const meters = decodeDemElevation({ red, green, blue }, this.terrain.encoding);
    return Number.isFinite(meters) ? meters : null;
  }
}
