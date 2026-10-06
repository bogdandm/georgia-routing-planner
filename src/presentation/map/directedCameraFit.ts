import type {
  MapCoordinate,
  MapFitPadding,
  MapTravelPath,
} from '@/presentation/map/mapTypes';

/** MapLibre world units per tile at zoom 0. */
const tileSize = 512;
const earthCircumferenceMeters = 40_075_016.686;
/** Fitting cost grows with points; a stride keeps long tracks to about this many. */
const maximumFitPoints = 500;
const searchSteps = 40;

export interface DirectedCameraFitInput {
  readonly path: MapTravelPath;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly padding: MapFitPadding;
  readonly pitchDegrees: number;
  readonly fieldOfViewDegrees: number;
  readonly terrainExaggeration: number;
  readonly maxZoom: number;
  /**
   * Exaggerated terrain height the map renders at a location, or `null` when unknown.
   * Track lines drape on this surface and the camera centers on it, so it outranks
   * the track's own elevations.
   */
  readonly renderedElevationAt: (coordinate: MapCoordinate) => number | null;
}

export interface DirectedCameraFit {
  readonly center: MapCoordinate;
  readonly zoom: number;
  readonly bearing: number;
}

/** Web Mercator screen bearing from `from` to `to`, matching MapLibre's rotation. */
function travelBearingDegrees({
  from,
  to,
}: Pick<MapTravelPath, 'from' | 'to'>): number {
  const east = (wrapLongitudeDelta(to.longitude - from.longitude) * Math.PI) / 180;
  const north = mercatorY(to.latitude) - mercatorY(from.latitude);
  return (Math.atan2(east, north) * 180) / Math.PI;
}

/**
 * Finds the center and zoom that keep every path point inside the padded viewport of a
 * pitched camera facing `from` → `to`, with no transform padding.
 *
 * MapLibre's own fit ignores pitch and terrain: at 45° the far half of the view
 * compresses, and points above the terrain under the center rise toward the horizon,
 * so its fit leaves the top empty for descents and can push the top of a mountain climb
 * off screen. This solves the pinhole projection MapLibre renders: the camera sits
 * `height / 2 / tan(fov / 2)` pixels from the center, which is lifted to the rendered
 * terrain height there. Returns `null` when nothing fits.
 */
export function directedCameraFit(
  input: DirectedCameraFitInput,
): DirectedCameraFit | null {
  const { path, viewport, padding } = input;
  const bearing = travelBearingDegrees(path);
  const bearingRadians = (bearing * Math.PI) / 180;
  const pitch = (input.pitchDegrees * Math.PI) / 180;
  const cameraDistance =
    viewport.height / 2 / Math.tan((input.fieldOfViewDegrees * Math.PI) / 360);
  const limits = {
    left: padding.left - viewport.width / 2,
    right: viewport.width / 2 - padding.right,
    bottom: padding.bottom - viewport.height / 2,
    top: viewport.height / 2 - padding.top,
  };
  if (limits.left >= limits.right || limits.bottom >= limits.top) return null;

  // View frame at zoom 0, origin at `from`: x to the screen right, y away from the camera.
  const originX = mercatorX(path.from.longitude);
  const originY = mercatorWorldY(path.from.latitude);
  const metersPerUnit =
    (earthCircumferenceMeters * Math.cos((path.from.latitude * Math.PI) / 180)) /
    tileSize;
  const stride = Math.max(1, Math.ceil(path.points.length / maximumFitPoints));
  const samples = path.points.filter(
    (_, index) => index % stride === 0 || index === path.points.length - 1,
  );
  if (samples.length === 0) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  const renderedHeights: (number | undefined)[] = [];
  for (const point of samples) {
    const dx =
      mercatorX(
        path.from.longitude + wrapLongitudeDelta(point.longitude - path.from.longitude),
      ) - originX;
    const dy = mercatorWorldY(point.latitude) - originY;
    xs.push(dx * Math.cos(bearingRadians) + dy * Math.sin(bearingRadians));
    ys.push(dx * Math.sin(bearingRadians) - dy * Math.cos(bearingRadians));
    renderedHeights.push(
      input.renderedElevationAt(point) ??
        (point.elevationMeters === undefined
          ? undefined
          : point.elevationMeters * input.terrainExaggeration),
    );
  }
  const knownHeights = renderedHeights.filter(
    (height): height is number => height !== undefined,
  );
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);

  const count = xs.length;
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);
  const heights = new Float64Array(count);
  const screenX = new Float64Array(count);
  const xScale = new Float64Array(count);
  // Unpitched fit zoom: the solution lies within a few zoom levels of it.
  const flatZoom = Math.log2(
    Math.min(
      (limits.right - limits.left) / Math.max(maximumX - minimumX, 1e-12),
      (limits.top - limits.bottom) / Math.max(maximumY - minimumY, 1e-12),
    ),
  );

  const solve = (centerHeight: number) => {
    for (let index = 0; index < count; index += 1) {
      const height = renderedHeights[index];
      heights[index] =
        height === undefined ? 0 : (height - centerHeight) / metersPerUnit;
    }
    // Highest and lowest screen offsets above the viewport center; `null` when a point
    // reaches the camera plane. Fills `screenX` (center x at zero) and `xScale`, the
    // per-point screen shift for one world unit of center x.
    const projectVertical = (scale: number, centerY: number) => {
      let lowest = Number.POSITIVE_INFINITY;
      let highest = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < count; index += 1) {
        const forward = scale * ((ys[index] ?? 0) - centerY);
        const height = scale * (heights[index] ?? 0);
        const depth = cameraDistance + forward * sinPitch - height * cosPitch;
        if (depth <= cameraDistance * 0.05) return null;
        const up = (cameraDistance * (forward * cosPitch + height * sinPitch)) / depth;
        if (up < lowest) lowest = up;
        if (up > highest) highest = up;
        xScale[index] = (cameraDistance * scale) / depth;
        screenX[index] = (xScale[index] ?? 0) * (xs[index] ?? 0);
      }
      return { lowest, highest };
    };
    const horizontalExtent = (centerX: number) => {
      let leftmost = Number.POSITIVE_INFINITY;
      let rightmost = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < count; index += 1) {
        const x = (screenX[index] ?? 0) - (xScale[index] ?? 0) * centerX;
        if (x < leftmost) leftmost = x;
        if (x > rightmost) rightmost = x;
      }
      return { leftmost, rightmost };
    };
    const fits = (scale: number) => {
      // Moving the center forward lowers every point on screen; balance top and bottom.
      const reach = (viewport.height * 10) / scale;
      let low = minimumY - reach;
      let high = maximumY + reach;
      for (let step = 0; step < searchSteps; step += 1) {
        const middle = (low + high) / 2;
        const extent = projectVertical(scale, middle);
        const imbalance =
          extent === null
            ? Number.NEGATIVE_INFINITY
            : extent.highest - limits.top - (limits.bottom - extent.lowest);
        if (imbalance > 0) low = middle;
        else high = middle;
      }
      const centerY = (low + high) / 2;
      const vertical = projectVertical(scale, centerY);
      if (vertical === null) return null;
      // Moving the center right shifts every point left; balance both sides.
      low = minimumX - viewport.width / scale;
      high = maximumX + viewport.width / scale;
      for (let step = 0; step < searchSteps; step += 1) {
        const middle = (low + high) / 2;
        const { leftmost, rightmost } = horizontalExtent(middle);
        if (limits.left - leftmost > rightmost - limits.right) high = middle;
        else low = middle;
      }
      const centerX = (low + high) / 2;
      const { leftmost, rightmost } = horizontalExtent(centerX);
      const inside =
        leftmost >= limits.left - 0.5 &&
        rightmost <= limits.right + 0.5 &&
        vertical.lowest >= limits.bottom - 0.5 &&
        vertical.highest <= limits.top + 0.5;
      return inside ? { centerX, centerY } : null;
    };
    let high = Math.min(input.maxZoom, flatZoom + 3);
    const highest = fits(2 ** high);
    if (highest !== null) return { zoom: high, ...highest };
    let low = Math.min(high, flatZoom - 3);
    let best = fits(2 ** low);
    if (best === null) {
      low = 0;
      best = fits(1);
      if (best === null) return null;
    }
    let zoom = low;
    for (let step = 0; step < searchSteps / 2; step += 1) {
      const middle = (low + high) / 2;
      const candidate = fits(2 ** middle);
      if (candidate === null) {
        high = middle;
      } else {
        low = middle;
        zoom = middle;
        best = candidate;
      }
    }
    return { zoom, ...best };
  };

  const coordinateAt = (centerX: number, centerY: number): MapCoordinate => {
    const worldX =
      originX + centerX * Math.cos(bearingRadians) + centerY * Math.sin(bearingRadians);
    const worldY =
      originY + centerX * Math.sin(bearingRadians) - centerY * Math.cos(bearingRadians);
    return {
      longitude: wrapLongitudeDelta((worldX / tileSize) * 360 - 180),
      latitude:
        (Math.atan(Math.sinh(Math.PI - (2 * Math.PI * worldY) / tileSize)) * 180) /
        Math.PI,
    };
  };
  // The terrain under the solved center lifts the camera, so re-solve against it; the
  // nearest track point stands in where the map has no terrain loaded.
  let centerHeight =
    knownHeights.length === 0
      ? 0
      : (Math.min(...knownHeights) + Math.max(...knownHeights)) / 2;
  let solution = solve(centerHeight);
  for (let refinement = 0; refinement < 8 && solution !== null; refinement += 1) {
    const { centerX, centerY } = solution;
    let nearestHeight: number | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [index, x] of xs.entries()) {
      const height = renderedHeights[index];
      const distance = (x - centerX) ** 2 + ((ys[index] ?? 0) - centerY) ** 2;
      if (height !== undefined && distance < nearestDistance) {
        nearestDistance = distance;
        nearestHeight = height;
      }
    }
    const nextHeight =
      input.renderedElevationAt(coordinateAt(centerX, centerY)) ?? nearestHeight;
    if (nextHeight === undefined || Math.abs(nextHeight - centerHeight) < 1) break;
    centerHeight = nextHeight;
    solution = solve(centerHeight);
  }
  if (solution === null) return null;
  return {
    center: coordinateAt(solution.centerX, solution.centerY),
    zoom: solution.zoom,
    bearing,
  };
}

function wrapLongitudeDelta(delta: number): number {
  return ((((delta + 180) % 360) + 360) % 360) - 180;
}

function mercatorY(latitude: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
}

function mercatorX(longitude: number): number {
  return ((longitude + 180) / 360) * tileSize;
}

function mercatorWorldY(latitude: number): number {
  return ((Math.PI - mercatorY(latitude)) / (2 * Math.PI)) * tileSize;
}
