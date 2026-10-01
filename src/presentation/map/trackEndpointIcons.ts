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

function hexRgb(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
