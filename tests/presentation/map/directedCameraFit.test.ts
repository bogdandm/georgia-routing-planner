import { describe, expect, it } from 'vitest';

import {
  directedCameraFit,
  type DirectedCameraFit,
  type DirectedCameraFitInput,
} from '@/presentation/map/directedCameraFit';
import type { MapCoordinate, MapPathPoint } from '@/presentation/map/mapTypes';

const viewport = { width: 1600, height: 1000 };
const padding = { top: 56, right: 56, bottom: 56, left: 500 };
const exaggeration = 1.15;

/** Rendered terrain: a slope rising 20 m per 0.0004° of latitude from 2,600 m. */
const slope = (coordinate: MapCoordinate) =>
  (2_600 + ((coordinate.latitude - 42.5) / 0.0004) * 20) * exaggeration;

/** A 6.6 km climb north-east up the slope, gaining 800 m. */
const climb: readonly MapPathPoint[] = Array.from({ length: 41 }, (_, index) => ({
  longitude: 44.5 + index * 0.0003,
  latitude: 42.5 + index * 0.0004,
  elevationMeters: 2_600 + index * 20,
}));

function fitClimb(
  renderedElevationAt: DirectedCameraFitInput['renderedElevationAt'],
): DirectedCameraFit {
  const from = climb[0];
  const to = climb.at(-1);
  if (from === undefined || to === undefined) throw new Error('Empty fixture.');
  const fit = directedCameraFit({
    path: { from, to, points: climb },
    viewport,
    padding,
    pitchDegrees: 45,
    fieldOfViewDegrees: 36.87,
    terrainExaggeration: exaggeration,
    maxZoom: 18,
    renderedElevationAt,
  });
  if (fit === null) throw new Error('Expected a fit.');
  return fit;
}

/** Screen positions of the climb under a 45° pinhole camera lifted to `centerHeight`. */
function projectClimb(fit: DirectedCameraFit, centerHeight: number) {
  const worldSize = 512 * 2 ** fit.zoom;
  const worldX = (longitude: number) => ((longitude + 180) / 360) * worldSize;
  const worldY = (latitude: number) =>
    ((Math.PI - Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360))) /
      (2 * Math.PI)) *
    worldSize;
  const metersPerPixel =
    (40_075_016.686 * Math.cos((fit.center.latitude * Math.PI) / 180)) / worldSize;
  const bearing = (fit.bearing * Math.PI) / 180;
  const pitch = Math.PI / 4;
  const distance = viewport.height / 2 / Math.tan((36.87 * Math.PI) / 360);
  return climb.map((point) => {
    const dx = worldX(point.longitude) - worldX(fit.center.longitude);
    const dy = worldY(point.latitude) - worldY(fit.center.latitude);
    const right = dx * Math.cos(bearing) + dy * Math.sin(bearing);
    const forward = dx * Math.sin(bearing) - dy * Math.cos(bearing);
    const up = (slope(point) - centerHeight) / metersPerPixel;
    const depth = distance + forward * Math.sin(pitch) - up * Math.cos(pitch);
    return {
      x: viewport.width / 2 + (distance * right) / depth,
      y:
        viewport.height / 2 -
        (distance * (forward * Math.cos(pitch) + up * Math.sin(pitch))) / depth,
    };
  });
}

function expectInsidePaddedViewport(positions: readonly { x: number; y: number }[]) {
  for (const { x, y } of positions) {
    expect(x).toBeGreaterThanOrEqual(padding.left - 1);
    expect(x).toBeLessThanOrEqual(viewport.width - padding.right + 1);
    expect(y).toBeGreaterThanOrEqual(padding.top - 1);
    expect(y).toBeLessThanOrEqual(viewport.height - padding.bottom + 1);
  }
}

describe('directedCameraFit', () => {
  it('fills the padded viewport with the start at the bottom and the finish at the top', () => {
    const fit = fitClimb(slope);
    const positions = projectClimb(fit, slope(fit.center));

    expectInsidePaddedViewport(positions);
    expect(positions[0]?.y).toBeCloseTo(viewport.height - padding.bottom, -1);
    expect(positions.at(-1)?.y).toBeCloseTo(padding.top, -1);
  });

  it('lifts the camera to the rendered terrain under the center', () => {
    // The climb follows a ridge; beside it the terrain under the view center lies 400 m
    // lower, which lowers the camera and raises every track point on screen.
    const ridge = (coordinate: MapCoordinate) =>
      climb.some(
        (point) =>
          point.longitude === coordinate.longitude &&
          point.latitude === coordinate.latitude,
      )
        ? slope(coordinate)
        : slope(coordinate) - 400 * exaggeration;
    const fit = fitClimb(ridge);

    expectInsidePaddedViewport(projectClimb(fit, ridge(fit.center)));
  });

  it('faces the travel direction, wrapping across the antimeridian', () => {
    const bearingFor = (from: MapCoordinate, to: MapCoordinate) =>
      directedCameraFit({
        path: { from, to, points: [from, to] },
        viewport,
        padding,
        pitchDegrees: 45,
        fieldOfViewDegrees: 36.87,
        terrainExaggeration: exaggeration,
        maxZoom: 18,
        renderedElevationAt: () => null,
      })?.bearing;

    expect(
      bearingFor({ longitude: 44.1, latitude: 42 }, { longitude: 44, latitude: 42 }),
    ).toBe(-90);
    expect(
      bearingFor({ longitude: 44, latitude: 42 }, { longitude: 44, latitude: 41.9 }),
    ).toBe(180);
    expect(
      bearingFor(
        { longitude: 179.99, latitude: 0 },
        { longitude: -179.99, latitude: 0 },
      ),
    ).toBeCloseTo(90, 6);
  });
});
