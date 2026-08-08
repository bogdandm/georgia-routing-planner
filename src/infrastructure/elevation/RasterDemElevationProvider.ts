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
  BrowserTerrariumPngCodec,
  type TerrariumPngCodec,
} from '@/infrastructure/elevation/BrowserTerrariumPngCodec';
import type { FilteredTerrariumTileProvider } from '@/infrastructure/elevation/FilteredTerrariumTileProvider';

interface DemPixel {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

interface TilePixelLocation {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly pixelX: number;
  readonly pixelY: number;
}

const maximumMercatorLatitude = 85.05112878;

export function locateDemPixel(
  coordinate: ElevationCoordinate,
  zoom: number,
  tileSize: number,
): TilePixelLocation | null {
  if (
    !Number.isFinite(coordinate.longitude) ||
    !Number.isFinite(coordinate.latitude) ||
    coordinate.latitude < -maximumMercatorLatitude ||
    coordinate.latitude > maximumMercatorLatitude
  ) {
    return null;
  }
  const longitude = (((coordinate.longitude + 180) % 360) + 360) % 360;
  const normalizedLongitude = longitude - 180;
  const tileCount = 2 ** zoom;
  const xPosition = ((normalizedLongitude + 180) / 360) * tileCount;
  const latitudeRadians = (coordinate.latitude * Math.PI) / 180;
  const yPosition =
    ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * tileCount;
  const x = Math.min(tileCount - 1, Math.max(0, Math.floor(xPosition)));
  const y = Math.min(tileCount - 1, Math.max(0, Math.floor(yPosition)));
  return {
    z: zoom,
    x,
    y,
    pixelX: Math.min(tileSize - 1, Math.max(0, Math.floor((xPosition - x) * tileSize))),
    pixelY: Math.min(tileSize - 1, Math.max(0, Math.floor((yPosition - y) * tileSize))),
  };
}

export function decodeDemElevation(
  pixel: Pick<DemPixel, 'red' | 'green' | 'blue'>,
  encoding: MapProviderConfiguration['terrain']['encoding'],
): number {
  if (encoding === 'terrarium') {
    return pixel.red * 256 + pixel.green + pixel.blue / 256 - 32_768;
  }
  return -10_000 + (pixel.red * 65_536 + pixel.green * 256 + pixel.blue) * 0.1;
}

function tileUrl(template: string, location: TilePixelLocation): string {
  return template
    .replaceAll('{z}', String(location.z))
    .replaceAll('{x}', String(location.x))
    .replaceAll('{y}', String(location.y));
}

/** Batches raster DEM samples by tile and reuses repaired Terrarium tile data. */
export class RasterDemElevationProvider implements ElevationProvider {
  public constructor(
    private readonly httpClient: KyInstance,
    private readonly terrain: MapProviderConfiguration['terrain'],
    private readonly idGenerator: IdGenerator,
    private readonly filteredTerrariumTiles: FilteredTerrariumTileProvider | null = null,
    private readonly pngCodec: TerrariumPngCodec = new BrowserTerrariumPngCodec(),
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
    const samples: ElevationSample[] = coordinates.map(() => ({
      status: 'unavailable',
    }));
    const tiles = new Map<string, { location: TilePixelLocation; indices: number[] }>();
    for (const [index, coordinate] of coordinates.entries()) {
      const location = locateDemPixel(
        coordinate,
        this.terrain.maxZoom,
        this.terrain.tileSize,
      );
      if (location === null) continue;
      const key = `${String(location.z)}/${String(location.x)}/${String(location.y)}`;
      const tile = tiles.get(key);
      if (tile === undefined) {
        tiles.set(key, { location, indices: [index] });
      } else {
        tile.indices.push(index);
      }
    }
    if (!signal.aborted) {
      onProgress?.({
        completedTiles: 0,
        totalTiles: tiles.size,
        indices: [],
        samples: [],
      });
    }
    let completedTiles = 0;
    await Promise.all(
      [...tiles.values()].map(async ({ location, indices }) => {
        const blob =
          this.terrain.encoding === 'terrarium' && this.filteredTerrariumTiles !== null
            ? (
                await this.filteredTerrariumTiles.getTile(
                  location.z,
                  location.x,
                  location.y,
                  signal,
                )
              ).data
            : await this.httpClient
                .get(tileUrl(this.terrain.tileUrl, location), {
                  signal,
                  context: { operationId: this.idGenerator.generate() },
                })
                .blob();
        signal.throwIfAborted();
        const decoded = await this.pngCodec.decode(blob, signal);
        for (const index of indices) {
          const coordinate = coordinates[index];
          if (coordinate === undefined) continue;
          const pixelLocation = locateDemPixel(
            coordinate,
            this.terrain.maxZoom,
            this.terrain.tileSize,
          );
          if (pixelLocation === null) continue;
          const offset =
            (pixelLocation.pixelY * decoded.width + pixelLocation.pixelX) * 4;
          const red = decoded.data[offset];
          const green = decoded.data[offset + 1];
          const blue = decoded.data[offset + 2];
          const alpha = decoded.data[offset + 3];
          if (
            red === undefined ||
            green === undefined ||
            blue === undefined ||
            alpha !== 255
          )
            continue;
          const meters = decodeDemElevation(
            { red, green, blue },
            this.terrain.encoding,
          );
          if (
            !Number.isFinite(meters) ||
            meters < this.terrain.filter.minimumElevationMeters ||
            meters > this.terrain.filter.maximumElevationMeters ||
            this.terrain.filter.sentinelElevationsMeters.includes(meters)
          ) {
            continue;
          }
          samples[index] = { status: 'available', meters };
        }
        signal.throwIfAborted();
        completedTiles += 1;
        onProgress?.({
          completedTiles,
          totalTiles: tiles.size,
          indices,
          samples: indices.map((index) => samples[index] ?? { status: 'unavailable' }),
        });
      }),
    );
    return samples;
  }
}
