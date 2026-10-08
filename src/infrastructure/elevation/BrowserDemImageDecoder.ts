/** RGBA pixels of one decoded raster-DEM tile, row-major from the north-west corner. */
export interface DecodedDemTile {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface DemImageDecoder {
  decode(blob: Blob, signal: AbortSignal): Promise<DecodedDemTile>;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new DOMException('DEM tile request canceled.', 'AbortError');
}

/** Decodes WebP or PNG DEM tiles with current-Chrome browser primitives. */
export class BrowserDemImageDecoder implements DemImageDecoder {
  public async decode(blob: Blob, signal: AbortSignal): Promise<DecodedDemTile> {
    throwIfAborted(signal);
    const bitmap = await createImageBitmap(blob);
    try {
      throwIfAborted(signal);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) throw new Error('DEM image canvas is unavailable.');
      context.drawImage(bitmap, 0, 0);
      const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
      throwIfAborted(signal);
      return {
        width: bitmap.width,
        height: bitmap.height,
        data: image.data,
      };
    } finally {
      bitmap.close();
    }
  }
}
