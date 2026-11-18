import type { KyInstance } from 'ky';

import type {
  ElevationCoordinate,
  ElevationProvider,
  ElevationSample,
  ElevationSamplingProgressListener,
  LoadedTerrainSampler,
  TerrainSamplerSource,
} from '@/application/ports/ElevationProvider';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import { terrainShadowModel } from '@/domain/terrain/terrainShadow';
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
> & { readonly tileSize: number; readonly minZoom?: number };

/**
 * Detail levels of a loaded terrain sampler, mirroring the sun-shadow shader's DEM levels
 * (z, z − 2, z − 4): each serves marches up to its reach and covers that far around
 * every requested coordinate.
 */
const terrainSamplerLevels = [
  { zoomOffset: 0, reachMeters: 5_000 },
  { zoomOffset: 2, reachMeters: 20_000 },
  { zoomOffset: 4, reachMeters: terrainShadowModel.maximumShadowDistanceMeters },
] as const;

const metersPerLatitudeDegree = (Math.PI * terrainShadowModel.earthRadiusMeters) / 180;
/** At most this many decoded tiles (1 MiB each at 512 px) back one sampler. */
const maximumTerrainSamplerTiles = 160;

/** Decoded heights of one level; `NaN` marks transparent or non-finite pixels. */
interface TerrainSamplerLevel {
  readonly zoom: number;
  readonly reachMeters: number;
  readonly tiles: ReadonlyMap<number, Float32Array>;
}

function worldPixelPosition(
  latitudeDegrees: number,
  longitudeDegrees: number,
  worldPixels: number,
): { readonly column: number; readonly row: number } {
  const longitude = ((((longitudeDegrees + 180) % 360) + 360) % 360) - 180;
  const latitude =
    (Math.min(
      maximumMercatorLatitude,
      Math.max(-maximumMercatorLatitude, latitudeDegrees),
    ) *
      Math.PI) /
    180;
  return {
    column: ((longitude + 180) / 360) * worldPixels,
    row: ((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2) * worldPixels,
  };
}

/** Bilinear height between pixel centres of one level, or null without valid corners. */
function levelElevation(
  level: TerrainSamplerLevel,
  tileSize: number,
  latitudeDegrees: number,
  longitudeDegrees: number,
): number | null {
  const tileCount = 2 ** level.zoom;
  const worldPixels = tileCount * tileSize;
  const position = worldPixelPosition(latitudeDegrees, longitudeDegrees, worldPixels);
  const columnPosition = position.column - 0.5;
  const rowPosition = position.row - 0.5;
  const leftColumn = Math.floor(columnPosition);
  const topRow = Math.floor(rowPosition);
  const columnFraction = columnPosition - leftColumn;
  const rowFraction = rowPosition - topRow;
  let weighted = 0;
  let weights = 0;
  for (let rowOffset = 0; rowOffset <= 1; rowOffset += 1) {
    const rowWeight = rowOffset === 0 ? 1 - rowFraction : rowFraction;
    if (rowWeight <= 0) continue;
    const row = Math.min(worldPixels - 1, Math.max(0, topRow + rowOffset));
    const tileY = Math.floor(row / tileSize);
    for (let columnOffset = 0; columnOffset <= 1; columnOffset += 1) {
      const weight =
        rowWeight * (columnOffset === 0 ? 1 - columnFraction : columnFraction);
      if (weight <= 0) continue;
      const column =
        (((leftColumn + columnOffset) % worldPixels) + worldPixels) % worldPixels;
      const tileX = Math.floor(column / tileSize);
      const heights = level.tiles.get(tileX * tileCount + tileY);
      if (heights === undefined) continue;
      const meters =
        heights[(row - tileY * tileSize) * tileSize + (column - tileX * tileSize)];
      if (meters === undefined || Number.isNaN(meters)) continue;
      weighted += weight * meters;
      weights += weight;
    }
  }
  return weights > 0 ? weighted / weights : null;
}

/**
 * Samples raster DEM tiles at the provider's maximum zoom with bilinear interpolation
 * between pixel centres. Each needed tile is fetched and decoded once per batch.
 * Transparent or non-finite pixels are treated as missing; the remaining corner
 * weights are renormalised, and a sample without any valid corner is unavailable.
 */
export class RasterDemElevationProvider
  implements ElevationProvider, TerrainSamplerSource
{
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

  public async loadTerrainSampler(
    coordinates: readonly ElevationCoordinate[],
    signal: AbortSignal,
  ): Promise<LoadedTerrainSampler> {
    const { maxZoom, tileSize } = this.terrain;
    const minZoom = this.terrain.minZoom ?? 0;
    let maximumElevationMeters = -Infinity;
    const plans = terrainSamplerLevels.map(({ zoomOffset, reachMeters }) => {
      const zoom = Math.max(minZoom, maxZoom - zoomOffset);
      const tileCount = 2 ** zoom;
      const keys = new Set<number>();
      for (const coordinate of coordinates) {
        const latitudeReach = reachMeters / metersPerLatitudeDegree;
        const longitudeReach = Math.min(
          180,
          latitudeReach /
            Math.max(0.01, Math.cos((coordinate.latitude * Math.PI) / 180)),
        );
        const northWest = worldPixelPosition(
          coordinate.latitude + latitudeReach,
          coordinate.longitude - longitudeReach,
          tileCount,
        );
        const southEast = worldPixelPosition(
          coordinate.latitude - latitudeReach,
          coordinate.longitude + longitudeReach,
          tileCount,
        );
        const firstRow = Math.max(0, Math.floor(northWest.row));
        const lastRow = Math.min(tileCount - 1, Math.floor(southEast.row));
        const firstColumn = Math.floor(northWest.column);
        // Wrapped east edges continue past the antimeridian.
        let lastColumn = Math.floor(southEast.column);
        if (lastColumn < firstColumn) lastColumn += tileCount;
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          for (let row = firstRow; row <= lastRow; row += 1) {
            keys.add((column % tileCount) * tileCount + row);
          }
        }
      }
      return { zoom, tileCount, reachMeters, keys };
    });
    // Decoded tiles stay in memory until the march ends, so a widely scattered route
    // fails here instead of exhausting the tab.
    if (
      plans.reduce((sum, plan) => sum + plan.keys.size, 0) > maximumTerrainSamplerTiles
    ) {
      throw new Error('The route needs too many DEM tiles.');
    }
    const levels = await Promise.all(
      plans.map(async ({ zoom, tileCount, reachMeters, keys }) => {
        const tiles = new Map<number, Float32Array>();
        await Promise.all(
          [...keys].map(async (key) => {
            const x = Math.floor(key / tileCount);
            const y = key % tileCount;
            const blob = await this.httpClient
              .get(
                this.terrain.tileUrl
                  .replaceAll('{z}', String(zoom))
                  .replaceAll('{x}', String(x))
                  .replaceAll('{y}', String(y)),
                { signal, context: { operationId: this.idGenerator.generate() } },
              )
              .blob();
            signal.throwIfAborted();
            const decoded = await this.decoder.decode(blob, signal);
            if (decoded.width !== tileSize || decoded.height !== tileSize) {
              throw new Error('A DEM tile has an unexpected size.');
            }
            const { data } = decoded;
            const terrarium = this.terrain.encoding === 'terrarium';
            const heights = new Float32Array(tileSize * tileSize);
            for (let pixel = 0; pixel < heights.length; pixel += 1) {
              const offset = pixel * 4;
              const red = data[offset] ?? 0;
              const green = data[offset + 1] ?? 0;
              const blue = data[offset + 2] ?? 0;
              // Same decoding as `decodeDemElevation`, inlined for ~260k pixels per tile.
              const meters =
                data[offset + 3] !== 255
                  ? Number.NaN
                  : terrarium
                    ? red * 256 + green + blue / 256 - 32_768
                    : -10_000 + (red * 65_536 + green * 256 + blue) * 0.1;
              heights[pixel] = meters;
              if (meters > maximumElevationMeters) maximumElevationMeters = meters;
            }
            tiles.set(key, heights);
          }),
        );
        return { zoom, reachMeters, tiles } satisfies TerrainSamplerLevel;
      }),
    );
    const meanLatitude =
      coordinates.reduce((sum, coordinate) => sum + coordinate.latitude, 0) /
      Math.max(1, coordinates.length);
    const finestZoom = levels[0]?.zoom ?? maxZoom;
    return {
      baseResolutionMeters:
        (2 *
          Math.PI *
          terrainShadowModel.earthRadiusMeters *
          Math.cos((meanLatitude * Math.PI) / 180)) /
        (2 ** finestZoom * tileSize),
      maximumElevationMeters: Number.isFinite(maximumElevationMeters)
        ? maximumElevationMeters
        : 0,
      // The finest level within reach answers first; coarser levels fill its gaps.
      elevationAt: (latitudeDegrees, longitudeDegrees, distanceMeters) => {
        for (const level of levels) {
          if (distanceMeters > level.reachMeters) continue;
          const meters = levelElevation(
            level,
            tileSize,
            latitudeDegrees,
            longitudeDegrees,
          );
          if (meters !== null) return meters;
        }
        return null;
      },
    };
  }
}
