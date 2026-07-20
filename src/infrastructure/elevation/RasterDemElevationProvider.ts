import type { KyInstance } from 'ky';

import type {
  ElevationCoordinate,
  ElevationProvider,
  ElevationSample,
} from '@/application/ports/ElevationProvider';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';

interface DemPixel {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
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
  pixel: DemPixel,
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

/** Fetches one configured raster-DEM tile and decodes only the selected pixel. */
export class RasterDemElevationProvider implements ElevationProvider {
  public constructor(
    private readonly httpClient: KyInstance,
    private readonly terrain: MapProviderConfiguration['terrain'],
    private readonly idGenerator: IdGenerator,
  ) {}

  public async sample(
    coordinate: ElevationCoordinate,
    signal: AbortSignal,
  ): Promise<ElevationSample> {
    const location = locateDemPixel(
      coordinate,
      this.terrain.maxZoom,
      this.terrain.tileSize,
    );
    if (location === null) return { status: 'unavailable' };
    const blob = await this.httpClient
      .get(tileUrl(this.terrain.tileUrl, location), {
        signal,
        context: { operationId: this.idGenerator.generate() },
      })
      .blob();
    signal.throwIfAborted();
    const bitmap = await createImageBitmap(blob);
    try {
      signal.throwIfAborted();
      const canvas = new OffscreenCanvas(1, 1);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) return { status: 'unavailable' };
      context.drawImage(bitmap, location.pixelX, location.pixelY, 1, 1, 0, 0, 1, 1);
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
      if (red === undefined || green === undefined || blue === undefined) {
        return { status: 'unavailable' };
      }
      return {
        status: 'available',
        meters: decodeDemElevation({ red, green, blue }, this.terrain.encoding),
      };
    } finally {
      bitmap.close();
    }
  }
}
