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
