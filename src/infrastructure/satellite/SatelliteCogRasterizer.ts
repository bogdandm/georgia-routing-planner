import { fromUrl, type GeoTIFF, type TypedArray } from 'geotiff';
import proj4 from 'proj4';

import type { SatelliteCogTileRequest } from '@/infrastructure/satellite/SatelliteCogProtocol';

interface ProjectedBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface VisualRaster {
  readonly data: TypedArray;
  readonly width: number;
  readonly height: number;
}

interface CachedScene {
  readonly signature: string;
  readonly visual: Promise<GeoTIFF>;
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

async function readVisualRaster(
  tiff: GeoTIFF,
  bounds: ProjectedBounds,
  signal: AbortSignal,
): Promise<VisualRaster> {
  const result = await tiff.readRasters({
    bbox: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY],
    width: rasterSampleSize,
    height: rasterSampleSize,
    samples: [0, 1, 2],
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

function bilinearSample(
  raster: VisualRaster,
  sampleX: number,
  sampleY: number,
  channel: number,
): number {
  const x0 = clamp(Math.floor(sampleX), 0, raster.width - 1);
  const y0 = clamp(Math.floor(sampleY), 0, raster.height - 1);
  const x1 = Math.min(x0 + 1, raster.width - 1);
  const y1 = Math.min(y0 + 1, raster.height - 1);
  const xWeight = clamp(sampleX - x0, 0, 1);
  const yWeight = clamp(sampleY - y0, 0, 1);
  const sample = (x: number, y: number) =>
    raster.data[(y * raster.width + x) * 3 + channel] ?? 0;
  const topLeft = sample(x0, y0);
  const topRight = sample(x1, y0);
  const bottomLeft = sample(x0, y1);
  const bottomRight = sample(x1, y1);
  const top = topLeft + (topRight - topLeft) * xWeight;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * xWeight;
  return top + (bottom - top) * yWeight;
}

/** Preserves the provider-rendered 8-bit RGB values and masks its black no-data area. */
export function visualPixel(
  red: number,
  green: number,
  blue: number,
): readonly [number, number, number, number] {
  if (red <= 0 && green <= 0 && blue <= 0) return [0, 0, 0, 0];
  return [
    Math.round(clamp(red, 0, 255)),
    Math.round(clamp(green, 0, 255)),
    Math.round(clamp(blue, 0, 255)),
    255,
  ];
}

function renderTilePixels(
  request: SatelliteCogTileRequest,
  bounds: ProjectedBounds,
  visual: VisualRaster,
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
      const sampleX = ((projectedX - bounds.minX) / width) * (visual.width - 1);
      const sampleY = ((bounds.maxY - projectedY) / height) * (visual.height - 1);
      const rgba = visualPixel(
        bilinearSample(visual, sampleX, sampleY, 0),
        bilinearSample(visual, sampleX, sampleY, 1),
        bilinearSample(visual, sampleX, sampleY, 2),
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
    const visual = await scene.visual.then((tiff) =>
      readVisualRaster(tiff, bounds, signal),
    );
    const pixels = renderTilePixels(request, bounds, visual);
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
    const signature = [request.visualHref, request.projectionEpsg].join('|');
    const existing = this.#scenes.get(request.sceneKey);
    if (existing?.signature === signature) {
      this.#scenes.delete(request.sceneKey);
      this.#scenes.set(request.sceneKey, existing);
      return existing;
    }
    const scene: CachedScene = {
      signature,
      visual: fromUrl(request.visualHref, {
        allowFullFile: false,
      }),
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
