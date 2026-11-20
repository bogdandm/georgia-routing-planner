import type { Map as MapLibreMap } from 'maplibre-gl';
import type * as Mediabunny from 'mediabunny';

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
 * Largest recorded video frame, 1080p in the map's own orientation: a larger canvas is
 * scaled down to fit it, and a smaller canvas keeps its own size.
 */
const videoLongSidePixels = 1920;
const videoShortSidePixels = 1080;
/**
 * Social networks expect a constant rate of 24–60 frames per second, so each map frame is
 * repeated for its duration at this rate.
 */
export const videoFrameRate = 30;

/**
 * MP4 video of map frames: H.264 through WebCodecs, without audio, with the index at the
 * start of the file, which is what social networks and messengers accept for upload.
 */
export class MapVideoRecorder {
  readonly #output: Mediabunny.Output<
    Mediabunny.Mp4OutputFormat,
    Mediabunny.BufferTarget
  >;
  readonly #source: Mediabunny.CanvasSource;
  readonly #context: CanvasRenderingContext2D;
  readonly #width: number;
  readonly #height: number;
  #elapsedMs = 0;
  #videoFrames = 0;

  private constructor(
    {
      BufferTarget,
      CanvasSource,
      Mp4OutputFormat,
      Output,
      Quality,
    }: Pick<
      typeof Mediabunny,
      'BufferTarget' | 'CanvasSource' | 'Mp4OutputFormat' | 'Output' | 'Quality'
    >,
    sourceWidth: number,
    sourceHeight: number,
  ) {
    const scale = Math.min(
      1,
      videoLongSidePixels / Math.max(sourceWidth, sourceHeight),
      videoShortSidePixels / Math.min(sourceWidth, sourceHeight),
    );
    // H.264 stores color at half resolution, so both sides must be even.
    this.#width = Math.max(2, 2 * Math.round((sourceWidth * scale) / 2));
    this.#height = Math.max(2, 2 * Math.round((sourceHeight * scale) / 2));
    const canvas = document.createElement('canvas');
    canvas.width = this.#width;
    canvas.height = this.#height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('A 2D canvas is unavailable.');
    this.#context = context;
    this.#source = new CanvasSource(canvas, {
      codec: 'avc',
      quality: new Quality('high'),
    });
    this.#output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    });
    this.#output.addVideoTrack(this.#source, { frameRate: videoFrameRate });
  }

  public static async start(
    sourceWidth: number,
    sourceHeight: number,
  ): Promise<MapVideoRecorder> {
    // Dynamic, not static: the encoder is about 200 kB that only a recording needs, so
    // Vite splits it out of the startup bundle and loads it with the first recording.
    // Destructuring at the import lets the bundler drop the unused rest of the library.
    const { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } =
      await import('mediabunny');
    const recorder = new MapVideoRecorder(
      { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality },
      sourceWidth,
      sourceHeight,
    );
    await recorder.#output.start();
    return recorder;
  }

  /**
   * Call within the frame that drew `canvas` (see `readWhenMapIdle`) and wait for the
   * returned promise before the next frame: the copy is taken synchronously, encoding
   * continues after. A `caption` is drawn in the lower-left corner of the video frame.
   */
  public async addFrame(
    canvas: HTMLCanvasElement,
    durationMs: number,
    caption?: string,
  ): Promise<void> {
    this.#context.drawImage(canvas, 0, 0, this.#width, this.#height);
    if (caption !== undefined) this.drawCaption(caption);
    this.#elapsedMs += durationMs;
    const endFrame = Math.round((this.#elapsedMs * videoFrameRate) / 1000);
    for (; this.#videoFrames < endFrame; this.#videoFrames += 1) {
      await this.#source.add(this.#videoFrames / videoFrameRate, 1 / videoFrameRate);
    }
  }

  /** Light text on a dark plate, sized to the frame so it reads after re-encoding. */
  private drawCaption(caption: string): void {
    const context = this.#context;
    const fontPixels = Math.max(
      12,
      Math.round(Math.min(this.#width, this.#height) / 22),
    );
    const margin = Math.round(fontPixels * 0.8);
    const padding = Math.round(fontPixels * 0.45);
    context.font = `600 ${String(fontPixels)}px system-ui, sans-serif`;
    context.textBaseline = 'middle';
    const plateWidth = context.measureText(caption).width + padding * 2;
    const plateHeight = fontPixels + padding * 2;
    const plateTop = this.#height - margin - plateHeight;
    context.fillStyle = 'rgba(0, 0, 0, 0.55)';
    context.beginPath();
    context.roundRect(margin, plateTop, plateWidth, plateHeight, padding);
    context.fill();
    context.fillStyle = '#FFFFFF';
    context.fillText(caption, margin + padding, plateTop + plateHeight / 2);
  }

  public async finish(): Promise<Uint8Array> {
    await this.#output.finalize();
    const { buffer } = this.#output.target;
    if (buffer === null) throw new Error('The video has no data.');
    return new Uint8Array(buffer);
  }

  /** Releases the encoder of an unfinished recording. */
  public cancel(): Promise<void> {
    return this.#output.cancel();
  }
}
