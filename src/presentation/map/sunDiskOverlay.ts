import { MercatorCoordinate, type Map as MapLibreMap } from 'maplibre-gl';

import type { SunlightColor } from '@/domain/terrain/atmosphericSunlight';
import { solarDiskRadiusDegrees } from '@/domain/terrain/solarPosition';
import { visibleSolarDiskFraction } from '@/domain/terrain/terrainShadow';

/** The Sun as seen from the map center at the shadow instant. */
export interface SunDiskSun {
  /** Clockwise from north. */
  readonly azimuthDegrees: number;
  readonly apparentElevationDegrees: number;
  /** Direct sunlight hue, brightest channel 1. */
  readonly color: SunlightColor;
}

/** Rotation, lens, and viewport of the rendered MapLibre camera, in CSS pixels. */
export interface SunDiskCamera {
  readonly bearingDegrees: number;
  readonly pitchDegrees: number;
  readonly rollDegrees: number;
  readonly verticalFieldOfViewDegrees: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
  /** Screen point the view axis passes through: the viewport center shifted by the padding. */
  readonly axisXPixels: number;
  readonly axisYPixels: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** The DEM tiles MapLibre currently draws, as indexed by `Terrain.getCoverageIndex()`. */
export interface RenderedTerrainIndex {
  /** Tile zooms, highest first. */
  readonly zooms: readonly number[];
  /** Keyed `wrap/z/x/y`; null while the tile's DEM is not loaded. */
  readonly samplerPerTile: ReadonlyMap<
    string,
    ((x: number, y: number, extent: number) => number) | null
  >;
  /** Exaggerated meters over every indexed tile. */
  readonly minElevation: number;
  readonly maxElevation: number;
}

/** What the skyline march sees: everything in Web Mercator units (world size 1). */
export interface SkylineScene {
  readonly eyeMercatorX: number;
  readonly eyeMercatorY: number;
  /** Camera altitude in exaggerated meters, like the terrain heights. */
  readonly eyeAltitudeMeters: number;
  /** MapLibre scales every height by the map center's mercator units per meter. */
  readonly mercatorPerMeter: number;
  /** Bounds of every terrain height `elevationAt` can return, in exaggerated meters. */
  readonly minimumElevationMeters: number;
  readonly maximumElevationMeters: number;
  /** Far clipping plane: no terrain is drawn beyond this view-axis depth. */
  readonly farDepth: number;
  /** View-axis depth gained per unit of height. */
  readonly depthPerHeight: number;
  /** Drawn terrain height in exaggerated meters, or null where no terrain is drawn. */
  readonly elevationAt: (mercatorX: number, mercatorY: number) => number | null;
}

/** One screen column across the halo, as the vertical plane through the eye it shows. */
export interface SkylineColumn {
  /** Ground direction of the column, clockwise from north. */
  readonly azimuthDegrees: number;
  /** View-axis depth gained per unit of ground distance along the azimuth. */
  readonly depthPerDistance: number;
  /** Elevation angles of the halo's lower and upper edge in this column. */
  readonly bottomDegrees: number;
  readonly topDegrees: number;
}

export const sunDiskModel = {
  /** The disk is drawn at least this wide even where the true Sun spans fewer pixels. */
  minimumCoreDiameterPixels: 10,
  /** Halo radius as a multiple of the core radius. */
  haloScale: 6,
  /** Below this apparent elevation the Sun is gone for any realistic camera height. */
  minimumApparentElevationDegrees: -1,
  /** While the camera keeps moving the skyline march repeats at most this often. */
  horizonMarchIntervalMs: 100,
  /** Skyline columns across the halo, in halo radii; ±core radius is added per frame. */
  columnOffsets: [-1, -0.5, 0, 0.5, 1],
  /** March step: this many meters near the eye, then this fraction of the distance. */
  minimumStepMeters: 20,
  distanceStepFraction: 0.02,
  maximumDistanceMeters: 1_500_000,
  /** Extra samples spread over the steps on both sides of the highest coarse sample. */
  refinementSamples: 8,
} as const;

const radiansPerDegree = Math.PI / 180;
const degreesPerRadian = 180 / Math.PI;
/** MapLibre's tile extent and its clamp below the tile edge (render/terrain.ts). */
const tileExtent = 8192;
const maximumTileCoordinate = tileExtent * (1 - 1e-12);

type Vector = readonly [x: number, y: number, z: number];

/** Pixels per unit tangent at the view axis: the perspective focal length in CSS pixels. */
export function focalLengthPixels(camera: SunDiskCamera): number {
  return (
    camera.heightPixels /
    2 /
    Math.tan((camera.verticalFieldOfViewDegrees * radiansPerDegree) / 2)
  );
}

/**
 * World direction (x east, y south, z up) in camera space, where the camera looks along −z
 * and y points up the screen. Mirrors `MercatorTransform._calcMatrices`: Rz(−bearing),
 * Rx(pitch), Rz(−roll), then a y flip; gl-matrix rotations are counterclockwise.
 */
function toCameraSpace([x0, y0, z0]: Vector, camera: SunDiskCamera): Vector {
  const bearing = -camera.bearingDegrees * radiansPerDegree;
  const x1 = x0 * Math.cos(bearing) - y0 * Math.sin(bearing);
  const y1 = x0 * Math.sin(bearing) + y0 * Math.cos(bearing);
  const pitch = camera.pitchDegrees * radiansPerDegree;
  const y2 = y1 * Math.cos(pitch) - z0 * Math.sin(pitch);
  const z2 = y1 * Math.sin(pitch) + z0 * Math.cos(pitch);
  const roll = -camera.rollDegrees * radiansPerDegree;
  const x3 = x1 * Math.cos(roll) - y2 * Math.sin(roll);
  const y3 = x1 * Math.sin(roll) + y2 * Math.cos(roll);
  return [x3, -y3, z2];
}

/** Inverse of `toCameraSpace`. */
function toWorldSpace([x0, y0, z0]: Vector, camera: SunDiskCamera): Vector {
  const roll = camera.rollDegrees * radiansPerDegree;
  const x1 = x0 * Math.cos(roll) + y0 * Math.sin(roll);
  const y1 = x0 * Math.sin(roll) - y0 * Math.cos(roll);
  const pitch = -camera.pitchDegrees * radiansPerDegree;
  const y2 = y1 * Math.cos(pitch) - z0 * Math.sin(pitch);
  const z2 = y1 * Math.sin(pitch) + z0 * Math.cos(pitch);
  const bearing = camera.bearingDegrees * radiansPerDegree;
  return [
    x1 * Math.cos(bearing) - y2 * Math.sin(bearing),
    x1 * Math.sin(bearing) + y2 * Math.cos(bearing),
    z2,
  ];
}

/** World direction of the view ray through a screen point. */
export function screenRayDirection(point: ScreenPoint, camera: SunDiskCamera): Vector {
  const focal = focalLengthPixels(camera);
  return toWorldSpace(
    [
      (point.x - camera.axisXPixels) / focal,
      (camera.axisYPixels - point.y) / focal,
      -1,
    ],
    camera,
  );
}

/**
 * Screen point of the direction to the Sun, or null when it lies behind the camera or more
 * than `marginPixels` outside the viewport. A direction has no translation, so the camera
 * position is irrelevant.
 */
export function projectSunDirection(
  azimuthDegrees: number,
  elevationDegrees: number,
  camera: SunDiskCamera,
  marginPixels: number,
): ScreenPoint | null {
  const azimuth = azimuthDegrees * radiansPerDegree;
  const elevation = elevationDegrees * radiansPerDegree;
  const cosElevation = Math.cos(elevation);
  const [x, y, z] = toCameraSpace(
    [
      Math.sin(azimuth) * cosElevation,
      -Math.cos(azimuth) * cosElevation,
      Math.sin(elevation),
    ],
    camera,
  );
  const depth = -z;
  if (depth <= 1e-6) return null;
  const focal = focalLengthPixels(camera);
  // Clip-space y points up and screen y down.
  const point = {
    x: camera.axisXPixels + (focal * x) / depth,
    y: camera.axisYPixels - (focal * y) / depth,
  };
  if (
    point.x < -marginPixels ||
    point.x > camera.widthPixels + marginPixels ||
    point.y < -marginPixels ||
    point.y > camera.heightPixels + marginPixels
  ) {
    return null;
  }
  return point;
}

/** View-axis depth of a unit world vector. */
export function viewDepth(vector: Vector, camera: SunDiskCamera): number {
  return -toCameraSpace(vector, camera)[2];
}

/**
 * Drawn terrain height at a mercator point, or null where MapLibre draws no loaded DEM
 * tile. Mirrors `sampleAt` in MapLibre's render/terrain.ts, which its own screen-to-terrain
 * raycast uses: the highest indexed zoom containing the point wins.
 */
export function renderedTerrainElevation(
  index: RenderedTerrainIndex,
  exaggeration: number,
  mercatorX: number,
  mercatorY: number,
): number | null {
  if (mercatorY < 0 || mercatorY >= 1) return null;
  const wrap = Math.floor(mercatorX);
  const wrappedX = mercatorX - wrap;
  for (const zoom of index.zooms) {
    const scale = 2 ** zoom;
    const scaledX = wrappedX * scale;
    const scaledY = mercatorY * scale;
    const tileX = Math.floor(scaledX);
    const tileY = Math.floor(scaledY);
    const key = `${String(wrap)}/${String(zoom)}/${String(tileX)}/${String(tileY)}`;
    if (!index.samplerPerTile.has(key)) continue;
    const sampler = index.samplerPerTile.get(key);
    if (sampler === undefined || sampler === null) return null;
    return (
      sampler(
        Math.min((scaledX - tileX) * tileExtent, maximumTileCoordinate),
        Math.min((scaledY - tileY) * tileExtent, maximumTileCoordinate),
        tileExtent,
      ) * exaggeration
    );
  }
  return null;
}

/**
 * Highest drawn terrain angle in one column, −90 when no drawn terrain lies in it. MapLibre
 * draws mercator terrain flat (no Earth curvature or refraction) and clips it at the far
 * plane, so the angle is the plain slope from the eye in mercator units and samples past
 * the far plane are ignored. Steps grow with distance; samples that no terrain up to the
 * drawn maximum could lift above max(skyline, halo bottom) are skipped, and the march
 * stops once the column is hidden past the halo top. The steps around the highest coarse
 * sample are then resampled, so a crest between two steps is not cut down.
 */
export function skylineElevationDegrees(
  scene: SkylineScene,
  column: SkylineColumn,
): number {
  const {
    minimumStepMeters,
    distanceStepFraction,
    maximumDistanceMeters,
    refinementSamples,
  } = sunDiskModel;
  const azimuth = column.azimuthDegrees * radiansPerDegree;
  const directionX = Math.sin(azimuth);
  const directionY = -Math.cos(azimuth);
  const perMeter = scene.mercatorPerMeter;
  const minimumStep = minimumStepMeters * perMeter;
  const maximumDistance = maximumDistanceMeters * perMeter;
  const bottomSlope = Math.tan(column.bottomDegrees * radiansPerDegree);
  const hiddenSlope = Math.tan(column.topDegrees * radiansPerDegree);
  const highestRise =
    (scene.maximumElevationMeters - scene.eyeAltitudeMeters) * perMeter;
  const lowestRise =
    (scene.minimumElevationMeters - scene.eyeAltitudeMeters) * perMeter;
  const nearestHeightDepth = Math.min(
    lowestRise * scene.depthPerHeight,
    highestRise * scene.depthPerHeight,
  );

  const slopeAt = (distance: number): number => {
    const elevation = scene.elevationAt(
      scene.eyeMercatorX + directionX * distance,
      scene.eyeMercatorY + directionY * distance,
    );
    if (elevation === null) return Number.NEGATIVE_INFINITY;
    const rise = (elevation - scene.eyeAltitudeMeters) * perMeter;
    if (
      distance * column.depthPerDistance + rise * scene.depthPerHeight >
      scene.farDepth
    ) {
      return Number.NEGATIVE_INFINITY;
    }
    return rise / distance;
  };

  let bestSlope = Number.NEGATIVE_INFINITY;
  let bestDistance = 0;
  let distance = minimumStep;
  while (distance <= maximumDistance && bestSlope < hiddenSlope) {
    if (distance * column.depthPerDistance + nearestHeightDepth > scene.farDepth) break;
    const threshold = Math.max(bestSlope, bottomSlope);
    if (highestRise < distance * threshold) {
      // A rising threshold line never comes back down to the terrain.
      if (threshold >= 0) break;
      // A falling one meets the highest terrain farther out: skip ahead to there.
      distance = highestRise / threshold;
      if (distance > maximumDistance) break;
    }
    const slope = slopeAt(distance);
    if (slope > bestSlope) {
      bestSlope = slope;
      bestDistance = distance;
    }
    distance += Math.max(minimumStep, distance * distanceStepFraction);
  }

  if (bestDistance > 0 && bestSlope < hiddenSlope) {
    const span = Math.max(minimumStep, bestDistance * distanceStepFraction);
    for (let sample = 1; sample <= refinementSamples; sample += 1) {
      const refined =
        bestDistance - span + (2 * span * sample) / (refinementSamples + 1);
      if (refined > 0) bestSlope = Math.max(bestSlope, slopeAt(refined));
    }
  }
  return bestSlope === Number.NEGATIVE_INFINITY
    ? -90
    : Math.atan(bestSlope) * degreesPerRadian;
}

function rgb(color: SunlightColor, alpha: number): string {
  const [red, green, blue] = color.map((channel) => Math.round(channel * 255));
  return `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${alpha.toFixed(2)})`;
}

function directionDegrees([x, y, z]: Vector): {
  readonly azimuthDegrees: number;
  readonly elevationDegrees: number;
} {
  return {
    azimuthDegrees: Math.atan2(x, -y) * degreesPerRadian,
    elevationDegrees: Math.atan2(z, Math.hypot(x, y)) * degreesPerRadian,
  };
}

interface MarchedColumn {
  /** Screen offset from the Sun when marched, in halo radii; used while unprojectable. */
  readonly offset: number;
  readonly azimuthDegrees: number;
  readonly skylineDegrees: number;
}

/**
 * One `pointer-events: none` element over the 3D map canvas showing the Sun with a soft
 * glow while sun shadows draw. Its position follows the camera on every `move`. Behind the
 * drawn terrain it is clipped below the skyline, marched in a few screen columns across
 * the halo; the halo fades with the visible part of the disk. No per-pixel work: a few
 * projections and style writes per camera frame, and a bounded march at most every 100 ms.
 */
export class SunDiskOverlay {
  readonly #map: MapLibreMap;
  readonly #element: HTMLDivElement;
  readonly #halo: HTMLDivElement;
  readonly #core: HTMLDivElement;
  #sun: SunDiskSun | null = null;
  #widthPixels: number;
  #heightPixels: number;
  #columns: readonly MarchedColumn[] = [];
  #horizonMarchedAtMs = Number.NEGATIVE_INFINITY;
  #visible = false;
  #sizePixels = 0;
  #coreSizePixels = 0;
  #color: SunlightColor | null = null;
  #clipPath = '';

  public constructor(map: MapLibreMap) {
    this.#map = map;
    const canvas = map.getCanvas();
    this.#widthPixels = canvas.clientWidth;
    this.#heightPixels = canvas.clientHeight;
    const element = document.createElement('div');
    element.style.cssText =
      'position:absolute;left:0;top:0;display:none;pointer-events:none;' +
      'will-change:transform;';
    const halo = element.appendChild(document.createElement('div'));
    halo.style.cssText = 'position:absolute;inset:0;border-radius:50%;';
    const core = element.appendChild(document.createElement('div'));
    core.style.cssText =
      'position:absolute;left:50%;top:50%;border-radius:50%;transform:translate(-50%,-50%);';
    // Right above the canvas, below markers, popups, and the separate control container.
    map.getCanvasContainer().insertBefore(element, canvas.nextSibling);
    this.#element = element;
    this.#halo = halo;
    this.#core = core;
    map.on('move', this.handleMove);
    map.on('moveend', this.handleChange);
    map.on('terrain', this.handleChange);
    map.on('idle', this.handleChange);
    map.on('resize', this.handleResize);
  }

  /**
   * Shows the Sun for `sun`, or hides it with null. Unchanged values do nothing. A new
   * color alone, which the sky sends on every rotation frame as the center's terrain
   * height shifts, only repaints: the skyline depends on the Sun's direction, not its color.
   */
  public setSun(sun: SunDiskSun | null): void {
    const current = this.#sun;
    const sameDirection =
      sun !== null &&
      current !== null &&
      sun.azimuthDegrees === current.azimuthDegrees &&
      sun.apparentElevationDegrees === current.apparentElevationDegrees;
    if (
      sun === current ||
      (sameDirection &&
        sun.color.every((channel, index) => channel === current.color[index]))
    ) {
      return;
    }
    this.#sun = sun;
    if (sameDirection) this.render();
    else this.handleChange();
  }

  public dispose(): void {
    this.#map.off('move', this.handleMove);
    this.#map.off('moveend', this.handleChange);
    this.#map.off('terrain', this.handleChange);
    this.#map.off('idle', this.handleChange);
    this.#map.off('resize', this.handleResize);
    this.#element.remove();
  }

  private readonly handleMove = (): void => {
    this.render();
  };

  /**
   * Settled camera, new Sun, terrain toggled, or DEM tiles loaded since (`idle`): the
   * skyline is marched again.
   */
  private readonly handleChange = (): void => {
    this.#horizonMarchedAtMs = Number.NEGATIVE_INFINITY;
    this.render();
  };

  private readonly handleResize = (): void => {
    const canvas = this.#map.getCanvas();
    this.#widthPixels = canvas.clientWidth;
    this.#heightPixels = canvas.clientHeight;
    this.render();
  };

  private render(): void {
    const sun = this.#sun;
    const map = this.#map;
    if (
      sun === null ||
      map.getTerrain() === null ||
      sun.apparentElevationDegrees <= sunDiskModel.minimumApparentElevationDegrees
    ) {
      this.hide();
      return;
    }
    // The padded center is MapLibre's center of perspective (`centerOffset`).
    const { top = 0, right = 0, bottom = 0, left = 0 } = map.getPadding();
    const camera: SunDiskCamera = {
      bearingDegrees: map.getBearing(),
      pitchDegrees: map.getPitch(),
      rollDegrees: map.getRoll(),
      verticalFieldOfViewDegrees: map.getVerticalFieldOfView(),
      widthPixels: this.#widthPixels,
      heightPixels: this.#heightPixels,
      axisXPixels: (this.#widthPixels + left - right) / 2,
      axisYPixels: (this.#heightPixels + top - bottom) / 2,
    };
    const coreRadius = Math.max(
      sunDiskModel.minimumCoreDiameterPixels / 2,
      focalLengthPixels(camera) * Math.tan(solarDiskRadiusDegrees * radiansPerDegree),
    );
    const haloRadius = coreRadius * sunDiskModel.haloScale;
    const point = projectSunDirection(
      sun.azimuthDegrees,
      sun.apparentElevationDegrees,
      camera,
      haloRadius,
    );
    if (point === null) {
      this.hide();
      return;
    }

    const now = performance.now();
    if (now - this.#horizonMarchedAtMs >= sunDiskModel.horizonMarchIntervalMs) {
      this.#horizonMarchedAtMs = now;
      this.#columns = this.marchSkyline(camera, point, haloRadius, coreRadius);
    }
    const sunColumn = this.#columns.find((column) => column.offset === 0);
    const fraction = visibleSolarDiskFraction(
      sun.apparentElevationDegrees,
      sunColumn?.skylineDegrees ?? -90,
    );
    if (fraction <= 0) {
      // Behind terrain the throttled march above keeps checking the skyline.
      this.hide(true);
      return;
    }

    const size = Math.round(haloRadius * 2);
    const originX = point.x - size / 2;
    const originY = point.y - size / 2;
    const clipPath = this.skylineClipPath(
      sun,
      camera,
      size,
      originX,
      originY,
      haloRadius,
    );
    const style = this.#element.style;
    if (size !== this.#sizePixels) {
      this.#sizePixels = size;
      style.width = `${String(size)}px`;
      style.height = `${String(size)}px`;
    }
    const coreSize = Math.round(coreRadius * 2.5);
    if (coreSize !== this.#coreSizePixels) {
      this.#coreSizePixels = coreSize;
      this.#core.style.width = `${String(coreSize)}px`;
      this.#core.style.height = `${String(coreSize)}px`;
    }
    if (this.#color !== sun.color) {
      this.#color = sun.color;
      this.applyColor(sun.color);
    }
    if (clipPath !== this.#clipPath) {
      this.#clipPath = clipPath;
      style.clipPath = clipPath;
    }
    style.transform = `translate3d(${originX.toFixed(1)}px, ${originY.toFixed(1)}px, 0)`;
    // The visible part of the disk keeps its brightness; its glow scales with it.
    this.#halo.style.opacity = fraction.toFixed(3);
    if (!this.#visible) {
      this.#visible = true;
      style.display = 'block';
    }
  }

  /**
   * Skyline angle in each column across the halo. The core edges are marched too, so a
   * ridge crossing the disk clips it closely. The eye pose, far plane, and drawn-terrain
   * index are only exposed on MapLibre's rendered transform and terrain, underscored or
   * internal but part of its typings; without drawn terrain nothing occludes the Sun.
   */
  private marchSkyline(
    camera: SunDiskCamera,
    point: ScreenPoint,
    haloRadius: number,
    coreRadius: number,
  ): readonly MarchedColumn[] {
    const map = this.#map;
    const terrain = map.terrain as MapLibreMap['terrain'] | null;
    const index = terrain?.getCoverageIndex() ?? null;
    if (index === null) return [];
    const { transform } = map._camera;
    const eye = MercatorCoordinate.fromLngLat(transform.getCameraLngLat());
    const exaggeration = map.getTerrain()?.exaggeration ?? 1;
    const scene: SkylineScene = {
      eyeMercatorX: eye.x,
      eyeMercatorY: eye.y,
      eyeAltitudeMeters: transform.getCameraAltitude(),
      mercatorPerMeter: MercatorCoordinate.fromLngLat(
        map.getCenter(),
      ).meterInMercatorCoordinateUnits(),
      minimumElevationMeters: index.minElevation,
      maximumElevationMeters: index.maxElevation,
      // `farZ` is in world pixels; mercator units are world pixels over the world size.
      farDepth: transform.farZ / transform.worldSize,
      depthPerHeight: viewDepth([0, 0, 1], camera),
      elevationAt: (mercatorX, mercatorY) =>
        renderedTerrainElevation(index, exaggeration, mercatorX, mercatorY),
    };
    const coreOffset = coreRadius / haloRadius;
    const offsets = [...sunDiskModel.columnOffsets, -coreOffset, coreOffset];
    return offsets.map((offset) => {
      const x = point.x + offset * haloRadius;
      const { azimuthDegrees } = directionDegrees(
        screenRayDirection({ x, y: point.y }, camera),
      );
      const azimuth = azimuthDegrees * radiansPerDegree;
      const column: SkylineColumn = {
        azimuthDegrees,
        depthPerDistance: viewDepth([Math.sin(azimuth), -Math.cos(azimuth), 0], camera),
        bottomDegrees: directionDegrees(
          screenRayDirection({ x, y: point.y + haloRadius }, camera),
        ).elevationDegrees,
        topDegrees: directionDegrees(
          screenRayDirection({ x, y: point.y - haloRadius }, camera),
        ).elevationDegrees,
      };
      return {
        offset,
        azimuthDegrees,
        skylineDegrees: skylineElevationDegrees(scene, column),
      };
    });
  }

  /**
   * Polygon keeping the part of the element above the skyline. The marched angles are
   * projected again every frame, so the cut follows a turning camera between marches.
   */
  private skylineClipPath(
    sun: SunDiskSun,
    camera: SunDiskCamera,
    size: number,
    originX: number,
    originY: number,
    haloRadius: number,
  ): string {
    const clamp = (value: number) => Math.min(size + 1, Math.max(-1, value));
    const points = this.#columns.map((column) => {
      const projected =
        column.skylineDegrees === -90
          ? null
          : projectSunDirection(
              column.azimuthDegrees,
              column.skylineDegrees,
              camera,
              Number.POSITIVE_INFINITY,
            );
      if (projected !== null) {
        return { x: clamp(projected.x - originX), y: clamp(projected.y - originY) };
      }
      return {
        x: clamp(size / 2 + column.offset * haloRadius),
        y: column.skylineDegrees > sun.apparentElevationDegrees ? -1 : size + 1,
      };
    });
    if (points.every((skyline) => skyline.y >= size)) return 'none';
    points.sort((first, second) => second.x - first.x);
    const rightmost = points[0];
    const leftmost = points[points.length - 1];
    if (rightmost === undefined || leftmost === undefined) return 'none';
    const vertex = (x: number, y: number) => `${x.toFixed(1)}px ${y.toFixed(1)}px`;
    const edge = size + 1;
    return `polygon(${[
      vertex(-1, -1),
      vertex(edge, -1),
      vertex(edge, rightmost.y),
      ...points.map((skyline) => vertex(skyline.x, skyline.y)),
      vertex(-1, leftmost.y),
    ].join(', ')})`;
  }

  /** Hot core (sunlight mixed toward white) inside a halo of the sunlight color. */
  private applyColor(color: SunlightColor): void {
    const core: SunlightColor = [
      (color[0] + 1) / 2,
      (color[1] + 1) / 2,
      (color[2] + 1) / 2,
    ];
    this.#core.style.background =
      `radial-gradient(circle closest-side, ${rgb(core, 1)} 0%, ` +
      `${rgb(core, 1)} 75%, ${rgb(core, 0)} 100%)`;
    const edge = 100 / sunDiskModel.haloScale;
    const percent = (value: number) => `${value.toFixed(1)}%`;
    this.#halo.style.background =
      `radial-gradient(circle closest-side, ${rgb(color, 0.8)} 0%, ` +
      `${rgb(color, 0.75)} ${percent(edge)}, ${rgb(color, 0.3)} ${percent(edge * 1.8)}, ` +
      `${rgb(color, 0.1)} ${percent(edge * 3.5)}, ${rgb(color, 0)} 100%)`;
  }

  /**
   * Without a Sun, terrain, or a projectable direction no march runs, so the skyline is
   * stale by the time the Sun shows again unless `skylineCurrent`.
   */
  private hide(skylineCurrent = false): void {
    if (!skylineCurrent) this.#horizonMarchedAtMs = Number.NEGATIVE_INFINITY;
    if (!this.#visible) return;
    this.#visible = false;
    this.#element.style.display = 'none';
  }
}
