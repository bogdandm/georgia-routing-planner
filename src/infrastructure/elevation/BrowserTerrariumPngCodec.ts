import type { DecodedTerrariumTile } from '@/infrastructure/elevation/TerrariumDemFilter';

export interface TerrariumPngCodec {
  decode(blob: Blob, signal: AbortSignal): Promise<DecodedTerrariumTile>;
  encode(tile: DecodedTerrariumTile, signal: AbortSignal): Promise<Blob>;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new DOMException('Terrarium tile request canceled.', 'AbortError');
}

/** Decodes and encodes PNGs with current-Chrome browser primitives. */
export class BrowserTerrariumPngCodec implements TerrariumPngCodec {
  public async decode(blob: Blob, signal: AbortSignal): Promise<DecodedTerrariumTile> {
    throwIfAborted(signal);
    const bitmap = await createImageBitmap(blob);
    try {
      throwIfAborted(signal);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) throw new Error('Terrarium PNG canvas is unavailable.');
      context.drawImage(bitmap, 0, 0);
      const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
      throwIfAborted(signal);
      return {
        width: bitmap.width,
        height: bitmap.height,
        data: new Uint8ClampedArray(image.data),
      };
    } finally {
      bitmap.close();
    }
  }

  public async encode(tile: DecodedTerrariumTile, signal: AbortSignal): Promise<Blob> {
    throwIfAborted(signal);
    const canvas = new OffscreenCanvas(tile.width, tile.height);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Terrarium PNG canvas is unavailable.');
    const image = context.createImageData(tile.width, tile.height);
    image.data.set(tile.data);
    context.putImageData(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    throwIfAborted(signal);
    return blob;
  }
}
