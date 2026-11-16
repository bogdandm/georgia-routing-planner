import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Calls `read` with the map canvas right after MapLibre draws the next frame. The canvas
 * is created without `preserveDrawingBuffer`, so its pixels are only defined inside the
 * frame that drew them: reading them later returns a blank image. The canvas holds the
 * GL map only, without HTML controls, markers, popups, or the Sun disk overlay.
 */
export function readNextMapFrame<T>(
  map: MapLibreMap,
  read: (canvas: HTMLCanvasElement) => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    map.once('render', () => {
      try {
        resolve(read(map.getCanvas()));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    map.triggerRepaint();
  });
}

/** PNG of the map as drawn in the next frame. */
export async function captureMapPng(map: MapLibreMap): Promise<Blob> {
  // `toBlob` copies the bitmap when called, so the encoding may finish after the frame.
  const blob = await readNextMapFrame(
    map,
    (canvas) =>
      new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      }),
  );
  if (blob === null) throw new Error('The map canvas could not be encoded.');
  return blob;
}

/**
 * Calls `read` with the map canvas in the frame after which MapLibre turns idle: every
 * tile loaded and no transition or fade running. MapLibre fires `idle` right after that
 * frame's draw, so the canvas pixels are still defined.
 */
export function readWhenMapIdle<T>(
  map: MapLibreMap,
  signal: AbortSignal,
  read: (canvas: HTMLCanvasElement) => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handleIdle = () => {
      signal.removeEventListener('abort', handleAbort);
      try {
        resolve(read(map.getCanvas()));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const handleAbort = () => {
      map.off('idle', handleIdle);
      reject(new DOMException('The map capture was aborted.', 'AbortError'));
    };
    if (signal.aborted) {
      handleAbort();
      return;
    }
    signal.addEventListener('abort', handleAbort, { once: true });
    map.once('idle', handleIdle);
    map.triggerRepaint();
  });
}

/**
 * Shorter side of a recorded GIF frame (1080p): a high-DPI canvas above it is scaled down
 * to it, and a smaller canvas keeps its own size.
 */
const gifShortSidePixels = 1080;

/** Looping GIF of map frames, each given its own 256-color palette. */
export class MapGifRecorder {
  readonly #encoder = GIFEncoder();
  readonly #context: CanvasRenderingContext2D;
  readonly #width: number;
  readonly #height: number;

  public constructor(sourceWidth: number, sourceHeight: number) {
    const scale = Math.min(1, gifShortSidePixels / Math.min(sourceWidth, sourceHeight));
    this.#width = Math.max(1, Math.round(sourceWidth * scale));
    this.#height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = this.#width;
    canvas.height = this.#height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('A 2D canvas is unavailable.');
    this.#context = context;
  }

  /** Call within the frame that drew `canvas`; see `readWhenMapIdle`. */
  public addFrame(canvas: HTMLCanvasElement, delayMs: number): void {
    const width = this.#width;
    const height = this.#height;
    this.#context.drawImage(canvas, 0, 0, width, height);
    const { data } = this.#context.getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    this.#encoder.writeFrame(applyPalette(data, palette), width, height, {
      palette,
      delay: delayMs,
      repeat: 0,
    });
  }

  public finish(): Uint8Array {
    this.#encoder.finish();
    return this.#encoder.bytes();
  }
}
