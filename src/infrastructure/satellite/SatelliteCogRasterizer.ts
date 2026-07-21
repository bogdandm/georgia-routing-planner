import { fromUrl, type GeoTIFF, type TypedArray } from 'geotiff';
import proj4 from 'proj4';

import type { SatelliteCogTileRequest } from '@/infrastructure/satellite/SatelliteCogProtocol';

interface ProjectedBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface RasterBand {
  readonly data: TypedArray;
  readonly width: number;
  readonly height: number;
}

interface CachedScene {
  readonly signature: string;
  readonly red: Promise<GeoTIFF>;
  readonly green: Promise<GeoTIFF>;
  readonly blue: Promise<GeoTIFF>;
}

const rasterSampleSize = 258;
const maximumCachedScenes = 2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Converts one XYZ tile pixel coordinate to WGS84 longitude/latitude. */
export function tilePixelToLongitudeLatitude(
  z: number,
  x: number,
  y: number,
  pixelX: number,
  pixelY: number,
  tileSize: number,
): readonly [number, number] {
  const scale = 2 ** z;
  const worldX = (x + pixelX / tileSize) / scale;
  const worldY = (y + pixelY / tileSize) / scale;
  const longitude = worldX * 360 - 180;
  const latitude = (Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180) / Math.PI;
  return [longitude, latitude];
}

function projectedTileBounds(request: SatelliteCogTileRequest): ProjectedBounds {
  const transform = proj4('EPSG:4326', `EPSG:${String(request.projectionEpsg)}`);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const pixelY of [0, request.tileSize / 2, request.tileSize]) {
    for (const pixelX of [0, request.tileSize / 2, request.tileSize]) {
      const longitudeLatitude = tilePixelToLongitudeLatitude(
        request.z,
        request.x,
        request.y,
        pixelX,
        pixelY,
        request.tileSize,
      );
      const [projectedX = 0, projectedY = 0] = transform.forward([
        ...longitudeLatitude,
      ]);
      minX = Math.min(minX, projectedX);
      minY = Math.min(minY, projectedY);
      maxX = Math.max(maxX, projectedX);
      maxY = Math.max(maxY, projectedY);
    }
  }
  return { minX, minY, maxX, maxY };
}

function isTypedRaster(value: unknown): value is TypedArray & {
  readonly width: number;
  readonly height: number;
} {
  return (
    ArrayBuffer.isView(value) &&
    'width' in value &&
    typeof value.width === 'number' &&
    'height' in value &&
    typeof value.height === 'number'
  );
}

async function readBand(
  tiff: GeoTIFF,
  bounds: ProjectedBounds,
  signal: AbortSignal,
): Promise<RasterBand> {
  const result = await tiff.readRasters({
    bbox: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY],
    width: rasterSampleSize,
    height: rasterSampleSize,
    samples: [0],
    interleave: true,
    fillValue: 0,
    resampleMethod: 'bilinear',
    signal,
  });
  if (!isTypedRaster(result)) {
    throw new Error('The satellite COG returned an unsupported raster layout.');
  }
  return { data: result, width: result.width, height: result.height };
}

function bilinearSample(band: RasterBand, sampleX: number, sampleY: number): number {
  const x0 = clamp(Math.floor(sampleX), 0, band.width - 1);
  const y0 = clamp(Math.floor(sampleY), 0, band.height - 1);
  const x1 = Math.min(x0 + 1, band.width - 1);
  const y1 = Math.min(y0 + 1, band.height - 1);
  const xWeight = clamp(sampleX - x0, 0, 1);
  const yWeight = clamp(sampleY - y0, 0, 1);
  const topLeft = band.data[y0 * band.width + x0] ?? 0;
  const topRight = band.data[y0 * band.width + x1] ?? 0;
  const bottomLeft = band.data[y1 * band.width + x0] ?? 0;
  const bottomRight = band.data[y1 * band.width + x1] ?? 0;
  const top = topLeft + (topRight - topLeft) * xWeight;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * xWeight;
  return top + (bottom - top) * yWeight;
}

/** Applies the same bounded reflectance, gamma, and saturation controls as the remote renderer. */
export function colorizeSatellitePixel(
  red: number,
  green: number,
  blue: number,
  tuning: SatelliteCogTileRequest['tuning'],
): readonly [number, number, number, number] {
  if (red <= 0 && green <= 0 && blue <= 0) return [0, 0, 0, 0];
  const gammaExponent = 1 / tuning.gamma;
  const normalized = [red, green, blue].map((channel) =>
    Math.pow(clamp(channel / tuning.reflectanceMax, 0, 1), gammaExponent),
  );
  const normalizedRed = normalized[0] ?? 0;
  const normalizedGreen = normalized[1] ?? 0;
  const normalizedBlue = normalized[2] ?? 0;
  const luminance =
    normalizedRed * 0.2126 + normalizedGreen * 0.7152 + normalizedBlue * 0.0722;
  const saturate = (channel: number) =>
    clamp(luminance + (channel - luminance) * tuning.saturation, 0, 1);
  return [
    Math.round(saturate(normalizedRed) * 255),
    Math.round(saturate(normalizedGreen) * 255),
    Math.round(saturate(normalizedBlue) * 255),
    255,
  ];
}

function renderTilePixels(
  request: SatelliteCogTileRequest,
  bounds: ProjectedBounds,
  red: RasterBand,
  green: RasterBand,
  blue: RasterBand,
): Uint8ClampedArray<ArrayBuffer> {
  const output = new Uint8ClampedArray(
    new ArrayBuffer(request.tileSize * request.tileSize * 4),
  );
  const transform = proj4('EPSG:4326', `EPSG:${String(request.projectionEpsg)}`);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  for (let pixelY = 0; pixelY < request.tileSize; pixelY += 1) {
    for (let pixelX = 0; pixelX < request.tileSize; pixelX += 1) {
      const longitudeLatitude = tilePixelToLongitudeLatitude(
        request.z,
        request.x,
        request.y,
        pixelX + 0.5,
        pixelY + 0.5,
        request.tileSize,
      );
      const [projectedX = 0, projectedY = 0] = transform.forward([
        ...longitudeLatitude,
      ]);
      const sampleX = ((projectedX - bounds.minX) / width) * (red.width - 1);
      const sampleY = ((bounds.maxY - projectedY) / height) * (red.height - 1);
      const rgba = colorizeSatellitePixel(
        bilinearSample(red, sampleX, sampleY),
        bilinearSample(green, sampleX, sampleY),
        bilinearSample(blue, sampleX, sampleY),
        request.tuning,
      );
      const offset = (pixelY * request.tileSize + pixelX) * 4;
      output[offset] = rgba[0];
      output[offset + 1] = rgba[1];
      output[offset + 2] = rgba[2];
      output[offset + 3] = rgba[3];
    }
  }
  return output;
}

/** Reads only the required COG ranges and rasterizes one Web Mercator tile in a worker. */
export class SatelliteCogRasterizer {
  readonly #scenes = new Map<string, CachedScene>();

  public async render(
    request: SatelliteCogTileRequest,
    signal: AbortSignal,
  ): Promise<ArrayBuffer> {
    const scene = this.getScene(request);
    const bounds = projectedTileBounds(request);
    const [red, green, blue] = await Promise.all([
      scene.red.then((tiff) => readBand(tiff, bounds, signal)),
      scene.green.then((tiff) => readBand(tiff, bounds, signal)),
      scene.blue.then((tiff) => readBand(tiff, bounds, signal)),
    ]);
    const pixels = renderTilePixels(request, bounds, red, green, blue);
    const canvas = new OffscreenCanvas(request.tileSize, request.tileSize);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Browser raster canvas is unavailable.');
    context.putImageData(
      new ImageData(pixels, request.tileSize, request.tileSize),
      0,
      0,
    );
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
    return blob.arrayBuffer();
  }

  private getScene(request: SatelliteCogTileRequest): CachedScene {
    const signature = [
      request.redHref,
      request.greenHref,
      request.blueHref,
      request.projectionEpsg,
    ].join('|');
    const existing = this.#scenes.get(request.sceneKey);
    if (existing?.signature === signature) {
      this.#scenes.delete(request.sceneKey);
      this.#scenes.set(request.sceneKey, existing);
      return existing;
    }
    const scene: CachedScene = {
      signature,
      red: fromUrl(request.redHref),
      green: fromUrl(request.greenHref),
      blue: fromUrl(request.blueHref),
    };
    this.#scenes.set(request.sceneKey, scene);
    while (this.#scenes.size > maximumCachedScenes) {
      const oldestKey = this.#scenes.keys().next().value;
      if (oldestKey === undefined) break;
      this.#scenes.delete(oldestKey);
    }
    return scene;
  }
}
