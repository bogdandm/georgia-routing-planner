import type { Map as MapLibreMap } from 'maplibre-gl';
import type * as Mediabunny from 'mediabunny';

import { mapVisualPalette } from '@/presentation/map/mapVisualPalette';

/** Hike readout drawn into a video frame's lower-left corner. */
export interface VideoOverlay {
  readonly time: string;
  readonly distance: string;
  /** Climb so far; null when the route has no elevation. */
  readonly ascent: string | null;
  /** Elevation profile of the whole route with the walked share; null without elevation. */
  readonly profile: {
    /** Elevation at evenly spaced distances from the start to the finish. */
    readonly elevations: readonly number[];
    /** Walked share of the route distance, 0–1. */
    readonly progress: number;
  } | null;
}
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
 * Longest side of a recorded video frame in either orientation: a canvas with a longer
 * side is scaled down to it, and a smaller canvas keeps its own size.
 */
const videoLongSidePixels = 1920;
/**
 * Social networks expect a constant rate of 24–60 frames per second, so each map frame is
 * repeated for its duration at this rate.
 */
export const videoFrameRate = 30;

/** The browser's WebCodecs offer no H.264 encoder for a video of this frame size. */
export class MapVideoEncoderUnsupportedError extends Error {
  public readonly width: number;
  public readonly height: number;

  public constructor(width: number, height: number) {
    super(`H.264 encoding at ${String(width)}×${String(height)} is unsupported.`);
    this.name = 'MapVideoEncoderUnsupportedError';
    this.width = width;
    this.height = height;
  }
}

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
    }: Pick<
      typeof Mediabunny,
      'BufferTarget' | 'CanvasSource' | 'Mp4OutputFormat' | 'Output'
    >,
    width: number,
    height: number,
    quality: Mediabunny.Quality,
  ) {
    this.#width = width;
    this.#height = height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('A 2D canvas is unavailable.');
    this.#context = context;
    this.#source = new CanvasSource(canvas, { codec: 'avc', quality });
    this.#output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    });
    this.#output.addVideoTrack(this.#source, { frameRate: videoFrameRate });
  }

  /**
   * Rejects with `MapVideoEncoderUnsupportedError` when the browser cannot encode the
   * frame size, before any frame is drawn.
   */
  public static async start(
    sourceWidth: number,
    sourceHeight: number,
  ): Promise<MapVideoRecorder> {
    // Dynamic, not static: the encoder is about 200 kB that only a recording needs, so
    // Vite splits it out of the startup bundle and loads it with the first recording.
    // Destructuring at the import lets the bundler drop the unused rest of the library.
    const {
      BufferTarget,
      CanvasSource,
      Mp4OutputFormat,
      Output,
      Quality,
      canEncodeVideo,
    } = await import('mediabunny');
    const scale = Math.min(
      1,
      videoLongSidePixels / Math.max(sourceWidth, sourceHeight),
    );
    // H.264 stores color at half resolution, so both sides must be even.
    const width = Math.max(2, 2 * Math.round((sourceWidth * scale) / 2));
    const height = Math.max(2, 2 * Math.round((sourceHeight * scale) / 2));
    // The whole map moves every frame, and satellite imagery is detailed: below this
    // level the encoder smears the imagery and the labels, even on held frames.
    const quality = new Quality('very-high');
    // The same encoder configurations the source tries, checked up front so the failure
    // can name the frame size instead of surfacing from the first frame.
    if (
      !(await canEncodeVideo('avc', {
        width,
        height,
        quality,
        frameRate: videoFrameRate,
      }))
    ) {
      throw new MapVideoEncoderUnsupportedError(width, height);
    }
    const recorder = new MapVideoRecorder(
      { BufferTarget, CanvasSource, Mp4OutputFormat, Output },
      width,
      height,
      quality,
    );
    await recorder.#output.start();
    return recorder;
  }

  /**
   * Call within the frame that drew `canvas` (see `readWhenMapIdle`) and wait for the
   * returned promise before the next frame: the copy is taken synchronously, encoding
   * continues after. An `overlay` is drawn in the lower-left corner of the video frame.
   */
  public async addFrame(
    canvas: HTMLCanvasElement,
    durationMs: number,
    overlay?: VideoOverlay,
  ): Promise<void> {
    this.#context.drawImage(canvas, 0, 0, this.#width, this.#height);
    if (overlay !== undefined) this.drawOverlay(overlay);
    this.#elapsedMs += durationMs;
    const endFrame = Math.round((this.#elapsedMs * videoFrameRate) / 1000);
    for (; this.#videoFrames < endFrame; this.#videoFrames += 1) {
      await this.#source.add(this.#videoFrames / videoFrameRate, 1 / videoFrameRate);
    }
  }

  /**
   * A dark plate in the lower-left corner: the clock above the distance and climb, and
   * beside them a wide, low elevation profile walked in the hiker's color. Sizes follow
   * the frame's short side, so at 1080p the plate is about 640 × 82 px. The text column
   * keeps a minimum width, so the profile does not shift as the figures grow.
   */
  private drawOverlay(overlay: VideoOverlay): void {
    const context = this.#context;
    const unit = Math.min(this.#width, this.#height) / 1080;
    const size = (pixels: number) => Math.max(1, Math.round(pixels * unit));
    const margin = size(20);
    const padding = size(14);
    const timeHeight = size(20);
    const statsHeight = size(28);
    const lineGap = size(6);
    const timeFont = `500 ${String(timeHeight)}px system-ui, sans-serif`;
    const statsFont = `600 ${String(statsHeight)}px system-ui, sans-serif`;
    const gap = size(14);
    const arrowWidth = size(14);
    const arrowHeight = size(18);
    const chartGap = size(18);
    const chartWidth = size(320);
    const chartHeight = size(44);
    const hiker = mapVisualPalette.userGeometry.gpxTrackHighlight;

    context.font = timeFont;
    const timeWidth = context.measureText(overlay.time).width;
    context.font = statsFont;
    const distanceWidth = context.measureText(overlay.distance).width;
    const ascentWidth =
      overlay.ascent === null
        ? 0
        : gap + arrowWidth + size(5) + context.measureText(overlay.ascent).width;
    const textWidth = Math.max(size(250), timeWidth, distanceWidth + ascentWidth);
    const textHeight = timeHeight + lineGap + statsHeight;
    const profile = overlay.profile;
    const charted = profile !== null && profile.elevations.length >= 2;
    const plateWidth = padding * 2 + textWidth + (charted ? chartGap + chartWidth : 0);
    const plateHeight = padding * 2 + textHeight;
    const left = margin;
    const top = this.#height - margin - plateHeight;

    context.fillStyle = 'rgba(0, 0, 0, 0.5)';
    context.beginPath();
    context.roundRect(left, top, plateWidth, plateHeight, size(10));
    context.fill();

    const textLeft = left + padding;
    context.textBaseline = 'top';
    context.font = timeFont;
    context.fillStyle = 'rgba(255, 255, 255, 0.8)';
    context.fillText(overlay.time, textLeft, top + padding);

    const statsTop = top + padding + timeHeight + lineGap;
    context.font = statsFont;
    context.fillStyle = '#FFFFFF';
    context.fillText(overlay.distance, textLeft, statsTop);
    if (overlay.ascent !== null) {
      // A drawn triangle, not a glyph: every font has it, and it needs no translation.
      const arrowLeft = textLeft + distanceWidth + gap;
      const arrowTop = statsTop + size(5);
      context.beginPath();
      context.moveTo(arrowLeft, arrowTop + arrowHeight);
      context.lineTo(arrowLeft + arrowWidth / 2, arrowTop);
      context.lineTo(arrowLeft + arrowWidth, arrowTop + arrowHeight);
      context.closePath();
      context.fill();
      context.fillText(overlay.ascent, arrowLeft + arrowWidth + size(5), statsTop);
    }

    if (!charted) return;
    const chartLeft = textLeft + textWidth + chartGap;
    const chartBottom = top + padding + (textHeight + chartHeight) / 2;
    const lowest = Math.min(...profile.elevations);
    const range = Math.max(1, Math.max(...profile.elevations) - lowest);
    const last = profile.elevations.length - 1;
    const outline = new Path2D();
    for (const [index, elevation] of profile.elevations.entries()) {
      const x = chartLeft + (index / last) * chartWidth;
      const y = chartBottom - ((elevation - lowest) / range) * chartHeight;
      if (index === 0) outline.moveTo(x, y);
      else outline.lineTo(x, y);
    }
    const area = new Path2D(outline);
    area.lineTo(chartLeft + chartWidth, chartBottom);
    area.lineTo(chartLeft, chartBottom);
    area.closePath();
    context.lineWidth = size(2);
    context.lineJoin = 'round';
    context.fillStyle = 'rgba(255, 255, 255, 0.15)';
    context.fill(area);
    context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    context.stroke(outline);

    const walkedRight = chartLeft + profile.progress * chartWidth;
    context.save();
    context.beginPath();
    context.rect(
      chartLeft,
      chartBottom - chartHeight - size(2),
      walkedRight - chartLeft,
      chartHeight + size(4),
    );
    context.clip();
    context.globalAlpha = 0.45;
    context.fillStyle = hiker;
    context.fill(area);
    context.globalAlpha = 1;
    context.strokeStyle = hiker;
    context.stroke(outline);
    context.restore();

    const position = profile.progress * last;
    const below = Math.floor(position);
    const elevation =
      (profile.elevations[below] ?? lowest) +
      ((profile.elevations[Math.min(last, below + 1)] ?? lowest) -
        (profile.elevations[below] ?? lowest)) *
        (position - below);
    context.beginPath();
    context.arc(
      walkedRight,
      chartBottom - ((elevation - lowest) / range) * chartHeight,
      size(5),
      0,
      Math.PI * 2,
    );
    context.fillStyle = hiker;
    context.fill();
    context.lineWidth = size(2);
    context.strokeStyle = '#FFFFFF';
    context.stroke();
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
