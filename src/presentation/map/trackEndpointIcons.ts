import { importedTrackEndpointImageIds } from './mapIds';
import { mapVisualPalette } from './mapVisualPalette';

export type TrackEndpointKind = 'start' | 'finish';

/** Image pixels per CSS pixel; MapLibre draws the icon at `size / pixelRatio`. */
export const trackEndpointIconPixelRatio = 2;

/** Raw non-premultiplied RGBA image accepted by `map.addImage`. */
export interface TrackEndpointIcon {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

// Geometry in CSS pixels relative to the icon centre.
const iconSizeCss = 20;
const outerRadius = 10;
const ringWidth = 2;
const stopHalfSide = 3.5;
// Triangle centroid sits on the icon centre so the glyph looks centred.
const playLeft = -2.75;
const playRight = 5.5;
const playHalfHeight = 4.75;
const samplesPerAxis = 4;

/**
 * Rasterizes a cassette-player style endpoint icon synchronously: a white-ringed disc in
 * the endpoint colour with a white Play triangle (start) or Stop square (finish).
 * Pixels are supersampled so the edges stay antialiased without a canvas.
 */
export function createTrackEndpointIcon(kind: TrackEndpointKind): TrackEndpointIcon {
  const size = iconSizeCss * trackEndpointIconPixelRatio;
  const disc = hexRgb(
    kind === 'start'
      ? mapVisualPalette.userGeometry.gpxTrackStart
      : mapVisualPalette.userGeometry.gpxTrackFinish,
  );
  const isGlyph =
    kind === 'start'
      ? (x: number, y: number) =>
          x >= playLeft &&
          Math.abs(y) <= (playHalfHeight * (playRight - x)) / (playRight - playLeft)
      : (x: number, y: number) =>
          Math.abs(x) <= stopHalfSide && Math.abs(y) <= stopHalfSide;
  const data = new Uint8Array(size * size * 4);
  const sampleCount = samplesPerAxis * samplesPerAxis;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let covered = 0;
      let discCovered = 0;
      for (let sy = 0; sy < samplesPerAxis; sy += 1) {
        for (let sx = 0; sx < samplesPerAxis; sx += 1) {
          const x =
            (column + (sx + 0.5) / samplesPerAxis) / trackEndpointIconPixelRatio -
            outerRadius;
          const y =
            (row + (sy + 0.5) / samplesPerAxis) / trackEndpointIconPixelRatio -
            outerRadius;
          const distance = Math.hypot(x, y);
          if (distance > outerRadius) continue;
          covered += 1;
          if (distance <= outerRadius - ringWidth && !isGlyph(x, y)) discCovered += 1;
        }
      }
      if (covered === 0) continue;
      // Colour is the coverage-weighted mix of white and the disc colour.
      const discShare = discCovered / covered;
      const offset = (row * size + column) * 4;
      data[offset] = Math.round(255 + (disc[0] - 255) * discShare);
      data[offset + 1] = Math.round(255 + (disc[1] - 255) * discShare);
      data[offset + 2] = Math.round(255 + (disc[2] - 255) * discShare);
      data[offset + 3] = Math.round((255 * covered) / sampleCount);
    }
  }
  return { width: size, height: size, data };
}

/**
 * The endpoint icon a style requests as `imageId`, for maps that add images on demand
 * through `setMissingStyleImageResolver`; null for every other image.
 */
export function createTrackEndpointImage(
  imageId: string,
): { readonly image: TrackEndpointIcon; readonly pixelRatio: number } | null {
  const kind =
    imageId === importedTrackEndpointImageIds.start
      ? 'start'
      : imageId === importedTrackEndpointImageIds.finish
        ? 'finish'
        : null;
  if (kind === null) return null;
  return {
    image: createTrackEndpointIcon(kind),
    pixelRatio: trackEndpointIconPixelRatio,
  };
}

// Time label background in CSS pixels: rounded corners, a white border, and a small
// stretchable middle that `icon-text-fit` grows around the text.
const timeLabelCornerRadius = 5;
const timeLabelBorderWidth = 1.5;
const timeLabelSizeCss = 2 * timeLabelCornerRadius + 2;

/** Signed distance from a point to a centred rounded square; negative inside. */
function roundedSquareDistance(
  x: number,
  y: number,
  halfSide: number,
  radius: number,
): number {
  const qx = Math.abs(x) - (halfSide - radius);
  const qy = Math.abs(y) - (halfSide - radius);
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    radius
  );
}

/**
 * Rasterizes the time label background: a white-bordered rounded rectangle in the track
 * colour. Only the middle stretches, so the corners keep their radius at any text width.
 */
export function createTrackTimeLabelImage(): {
  readonly image: TrackEndpointIcon;
  readonly pixelRatio: number;
  readonly stretchX: [[number, number]];
  readonly stretchY: [[number, number]];
  readonly content: [number, number, number, number];
} {
  const ratio = trackEndpointIconPixelRatio;
  const size = timeLabelSizeCss * ratio;
  const halfSide = timeLabelSizeCss / 2;
  const fill = hexRgb(mapVisualPalette.userGeometry.gpxTrack);
  const data = new Uint8Array(size * size * 4);
  const sampleCount = samplesPerAxis * samplesPerAxis;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let covered = 0;
      let fillCovered = 0;
      for (let sy = 0; sy < samplesPerAxis; sy += 1) {
        for (let sx = 0; sx < samplesPerAxis; sx += 1) {
          const x = (column + (sx + 0.5) / samplesPerAxis) / ratio - halfSide;
          const y = (row + (sy + 0.5) / samplesPerAxis) / ratio - halfSide;
          if (roundedSquareDistance(x, y, halfSide, timeLabelCornerRadius) > 0)
            continue;
          covered += 1;
          const inner = roundedSquareDistance(
            x,
            y,
            halfSide - timeLabelBorderWidth,
            timeLabelCornerRadius - timeLabelBorderWidth,
          );
          if (inner <= 0) fillCovered += 1;
        }
      }
      if (covered === 0) continue;
      const fillShare = fillCovered / covered;
      const offset = (row * size + column) * 4;
      data[offset] = Math.round(255 + (fill[0] - 255) * fillShare);
      data[offset + 1] = Math.round(255 + (fill[1] - 255) * fillShare);
      data[offset + 2] = Math.round(255 + (fill[2] - 255) * fillShare);
      data[offset + 3] = Math.round((255 * covered) / sampleCount);
    }
  }
  const cornerEnd = timeLabelCornerRadius * ratio;
  const border = timeLabelBorderWidth * ratio;
  return {
    image: { width: size, height: size, data },
    pixelRatio: ratio,
    stretchX: [[cornerEnd, size - cornerEnd]],
    stretchY: [[cornerEnd, size - cornerEnd]],
    content: [border, border, size - border, size - border],
  };
}

function hexRgb(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
