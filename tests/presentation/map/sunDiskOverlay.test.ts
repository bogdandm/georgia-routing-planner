import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import {
  projectSunDirection,
  renderedTerrainElevation,
  screenRayDirection,
  skylineElevationDegrees,
  SunDiskOverlay,
  sunDiskModel,
  type RenderedTerrainIndex,
  type SkylineColumn,
  type SkylineScene,
  type SunDiskCamera,
  type SunDiskSun,
} from '@/presentation/map/sunDiskOverlay';

const radiansPerDegree = Math.PI / 180;

/** Looking north at the horizon; tan(36.87° / 2) = 1/3, so the focal length is 1200 px. */
const horizonCamera: SunDiskCamera = {
  bearingDegrees: 0,
  pitchDegrees: 90,
  rollDegrees: 0,
  verticalFieldOfViewDegrees: (2 * Math.atan(1 / 3)) / radiansPerDegree,
  widthPixels: 1000,
  heightPixels: 800,
  axisXPixels: 500,
  axisYPixels: 400,
};
const focal = 1200;

describe('projectSunDirection', () => {
  it('puts the Sun straight ahead at the screen center', () => {
    const point = projectSunDirection(0, 0, horizonCamera, 0);
    expect(point?.x).toBeCloseTo(500, 6);
    expect(point?.y).toBeCloseTo(400, 6);
  });

  it('moves an eastern Sun right and a higher Sun up', () => {
    const point = projectSunDirection(10, 5, horizonCamera, 0);
    expect(point?.x).toBeCloseTo(500 + focal * Math.tan(10 * radiansPerDegree), 6);
    expect(point?.y).toBeCloseTo(
      400 - (focal * Math.tan(5 * radiansPerDegree)) / Math.cos(10 * radiansPerDegree),
      6,
    );
  });

  it('hides a Sun beside or behind the camera', () => {
    expect(projectSunDirection(90, 0, horizonCamera, 1000)).toBeNull();
    expect(projectSunDirection(180, 10, horizonCamera, 1000)).toBeNull();
    // 30° east lies 693 px right of the center: off screen, but within a 200 px halo margin.
    expect(projectSunDirection(30, 0, horizonCamera, 0)).toBeNull();
    expect(projectSunDirection(30, 0, horizonCamera, 200)?.x).toBeCloseTo(
      500 + focal * Math.tan(30 * radiansPerDegree),
      6,
    );
  });

  it('follows the bearing, pitch, roll, and padded view axis', () => {
    const east = { ...horizonCamera, bearingDegrees: 90 };
    expect(projectSunDirection(90, 0, east, 0)?.x).toBeCloseTo(500, 6);

    // Pitched 80°, the view axis points 10° down, so the horizon sits above the center.
    const pitched = { ...horizonCamera, pitchDegrees: 80 };
    expect(projectSunDirection(0, 0, pitched, 0)?.y).toBeCloseTo(
      400 - focal * Math.tan(10 * radiansPerDegree),
      6,
    );

    const upsideDown = { ...horizonCamera, rollDegrees: 180 };
    const rolled = projectSunDirection(10, 5, upsideDown, 0);
    expect(rolled?.x).toBeLessThan(500);
    expect(rolled?.y).toBeGreaterThan(400);

    const padded = { ...horizonCamera, axisXPixels: 600, axisYPixels: 350 };
    const point = projectSunDirection(0, 0, padded, 0);
    expect(point?.x).toBeCloseTo(600, 6);
    expect(point?.y).toBeCloseTo(350, 6);
  });
});

describe('screenRayDirection', () => {
  it('inverts the projection for any camera pose', () => {
    const camera: SunDiskCamera = {
      ...horizonCamera,
      bearingDegrees: -130,
      pitchDegrees: 72,
      rollDegrees: 12,
      axisXPixels: 540,
      axisYPixels: 380,
    };
    const point = projectSunDirection(-115, 4, camera, Number.POSITIVE_INFINITY);
    if (point === null) throw new Error('The test direction must be in front.');
    const [x, y, z] = screenRayDirection(point, camera);
    expect(Math.atan2(x, -y) / radiansPerDegree).toBeCloseTo(-115, 6);
    expect(Math.atan2(z, Math.hypot(x, y)) / radiansPerDegree).toBeCloseTo(4, 6);
  });
});

describe('renderedTerrainElevation', () => {
  const index: RenderedTerrainIndex = {
    zooms: [2, 1],
    samplerPerTile: new Map([
      ['0/2/0/0', null],
      ['0/1/0/0', (x: number, y: number, extent: number) => (x + y) / extent],
    ]),
    minElevation: 0,
    maxElevation: 2,
  };

  it('samples the highest drawn zoom with its tile coordinates and exaggeration', () => {
    // At zoom 1 the point (0.375, 0.25) lies in tile 0/0 at (0.75, 0.5) of its extent.
    expect(renderedTerrainElevation(index, 2, 0.375, 0.25)).toBeCloseTo(2.5, 9);
    // Another world copy is a different tile, not drawn here.
    expect(renderedTerrainElevation(index, 2, 1.375, 0.25)).toBeNull();
  });

  it('returns null where no loaded DEM tile is drawn', () => {
    expect(renderedTerrainElevation(index, 1, 0.1, 0.1)).toBeNull();
    expect(renderedTerrainElevation(index, 1, 0.75, 0.75)).toBeNull();
    expect(renderedTerrainElevation(index, 1, 0.25, 1.2)).toBeNull();
  });
});

describe('skylineElevationDegrees', () => {
  /** Mercator units are meters here; the eye looks north (−y) from the origin. */
  function scene(
    elevationAtDistance: (distanceMeters: number) => number | null,
    overrides: Partial<SkylineScene> = {},
  ): SkylineScene {
    return {
      eyeMercatorX: 0,
      eyeMercatorY: 0,
      eyeAltitudeMeters: 0,
      mercatorPerMeter: 1,
      minimumElevationMeters: -1_000,
      maximumElevationMeters: 100_000,
      farDepth: Number.POSITIVE_INFINITY,
      depthPerHeight: 0,
      elevationAt: (_mercatorX, mercatorY) => elevationAtDistance(-mercatorY),
      ...overrides,
    };
  }
  const column: SkylineColumn = {
    azimuthDegrees: 0,
    depthPerDistance: 1,
    bottomDegrees: -5,
    topDegrees: 5,
  };

  it('is −90 without drawn terrain', () => {
    expect(
      skylineElevationDegrees(
        scene(() => null),
        column,
      ),
    ).toBe(-90);
  });

  it('takes the plain slope, without an Earth-curvature drop', () => {
    const slope = Math.tan(2 * radiansPerDegree);
    const skyline = skylineElevationDegrees(
      scene((distance) => distance * slope),
      column,
    );
    expect(skyline).toBeCloseTo(2, 9);
  });

  it('finds a narrow crest between coarse steps', () => {
    // A 2000 m peak 50 km away, 3 km wide at its base; coarse steps there are 1 km.
    const skyline = skylineElevationDegrees(
      scene((distance) => Math.max(0, 2_000 - (Math.abs(distance - 50_000) * 2) / 3)),
      column,
    );
    expect(skyline).toBeGreaterThan(Math.atan(1_850 / 50_000) / radiansPerDegree);
    expect(skyline).toBeLessThanOrEqual(Math.atan(2_000 / 50_000) / radiansPerDegree);
  });

  it('ignores terrain beyond the far clipping plane', () => {
    const skyline = skylineElevationDegrees(
      scene((distance) => (distance < 30_000 ? 0 : 5_000), {
        eyeAltitudeMeters: 100,
        farDepth: 20_000,
      }),
      column,
    );
    expect(skyline).toBeLessThan(0);
  });

  it('skips near ground that cannot reach the halo below a high camera', () => {
    const distances: number[] = [];
    skylineElevationDegrees(
      scene(
        (distance) => {
          distances.push(distance);
          return 0;
        },
        { eyeAltitudeMeters: 9_000, maximumElevationMeters: 8_000 },
      ),
      { ...column, bottomDegrees: -1 },
    );
    const firstReachable = 1_000 / Math.tan(1 * radiansPerDegree);
    expect(distances.length).toBeGreaterThan(0);
    expect(Math.min(...distances)).toBeGreaterThanOrEqual(firstReachable * 0.98);
  });

  it('stops once the column is hidden past the halo top', () => {
    let samples = 0;
    skylineElevationDegrees(
      scene(() => {
        samples += 1;
        return 1_000;
      }),
      column,
    );
    expect(samples).toBe(1);
  });
});

describe('SunDiskOverlay', () => {
  /** Meters per mercator unit at the equator for MapLibre's Earth radius. */
  const meridianMetersPerMercator = 2 * Math.PI * 6_371_008.8;

  /** One zoom-0 tile whose terrain rises at `slopeDegrees` from the eye at (0°, 0°), northward. */
  function createMap(slopeDegrees: number) {
    const listeners = new Map<string, () => void>();
    const container = document.createElement('div');
    const canvas = container.appendChild(document.createElement('canvas'));
    Object.defineProperty(canvas, 'clientWidth', { value: 1000 });
    Object.defineProperty(canvas, 'clientHeight', { value: 800 });
    const slope = Math.tan(slopeDegrees * radiansPerDegree);
    const index: RenderedTerrainIndex = {
      zooms: [0],
      samplerPerTile: new Map([
        [
          '0/0/0/0',
          (_x: number, y: number, extent: number) =>
            (0.5 - y / extent) * meridianMetersPerMercator * slope,
        ],
      ]),
      minElevation: -1e6,
      maxElevation: 1e6,
    };
    const fake = {
      terrainSpecification: { source: 'dem', exaggeration: 1 } as unknown,
      listeners,
      terrain: { getCoverageIndex: (): RenderedTerrainIndex | null => index },
      on: (type: string, listener: () => void) => listeners.set(type, listener),
      off: (type: string) => listeners.delete(type),
      getCanvas: () => canvas,
      getCanvasContainer: () => container,
      getTerrain: () => fake.terrainSpecification,
      getCenter: () => ({ lng: 0, lat: 0 }),
      getPadding: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
      getBearing: () => horizonCamera.bearingDegrees,
      getPitch: () => horizonCamera.pitchDegrees,
      getRoll: () => horizonCamera.rollDegrees,
      getVerticalFieldOfView: () => horizonCamera.verticalFieldOfViewDegrees,
      _camera: {
        transform: {
          getCameraLngLat: () => ({ lng: 0, lat: 0 }),
          getCameraAltitude: () => 0,
          farZ: 1e9,
          worldSize: 1,
        },
      },
    };
    return { fake, container, map: fake as unknown as MapLibreMap };
  }

  const lowSun: SunDiskSun = {
    azimuthDegrees: 0,
    apparentElevationDegrees: 3,
    color: [1, 0.6, 0.3],
  };

  function parts(container: HTMLElement) {
    const element = container.lastElementChild as HTMLElement;
    return { element, halo: element.firstElementChild as HTMLElement };
  }

  it('draws the whole Sun above low terrain and removes it on dispose', () => {
    const { fake, container, map } = createMap(-1);
    const overlay = new SunDiskOverlay(map);
    const { element, halo } = parts(container);
    expect(container.firstElementChild?.tagName).toBe('CANVAS');
    expect(element.style.display).toBe('none');
    expect(element.style.pointerEvents).toBe('none');

    overlay.setSun(lowSun);
    expect(element.style.display).toBe('block');
    expect(Number(halo.style.opacity)).toBe(1);
    expect(element.style.clipPath).toBe('none');
    const size = Number.parseFloat(element.style.width);
    expect(size).toBeGreaterThanOrEqual(60);
    const y = 400 - focal * Math.tan(3 * radiansPerDegree) - size / 2;
    expect(element.style.transform).toBe(
      `translate3d(${(500 - size / 2).toFixed(1)}px, ${y.toFixed(1)}px, 0)`,
    );
    expect(halo.style.background).toContain('radial-gradient');

    fake.terrainSpecification = null;
    fake.listeners.get('terrain')?.();
    expect(element.style.display).toBe('none');

    overlay.dispose();
    expect(element.isConnected).toBe(false);
    expect(fake.listeners.size).toBe(0);
  });

  it('clips the disk at a skyline crossing it and dims the glow to the visible half', () => {
    const { container, map } = createMap(3);
    const overlay = new SunDiskOverlay(map);
    const { element, halo } = parts(container);
    overlay.setSun(lowSun);
    expect(element.style.display).toBe('block');
    expect(Number(halo.style.opacity)).toBeCloseTo(0.5, 2);
    // The skyline runs through the disk center, half way down the element.
    const half = (Number.parseFloat(element.style.width) / 2).toFixed(1);
    expect(element.style.clipPath).toMatch(/^polygon\(/u);
    expect(element.style.clipPath).toContain(`${half}px ${half}px`);
    overlay.dispose();
  });

  it('hides the Sun behind a ridge and without a Sun', () => {
    const { container, map } = createMap(10);
    const overlay = new SunDiskOverlay(map);
    const { element } = parts(container);
    overlay.setSun(lowSun);
    expect(element.style.display).toBe('none');

    overlay.setSun(null);
    expect(element.style.display).toBe('none');
    overlay.dispose();
  });

  it('hides the Sun behind a ridge whose DEM tiles load after the camera settles', () => {
    const { fake, container, map } = createMap(10);
    const ridge = fake.terrain;
    fake.terrain = { getCoverageIndex: () => null };
    const overlay = new SunDiskOverlay(map);
    const { element } = parts(container);
    overlay.setSun(lowSun);
    expect(element.style.display).toBe('block');

    fake.terrain = ridge;
    fake.listeners.get('idle')?.();
    expect(element.style.display).toBe('none');
    overlay.dispose();
  });

  it('recolors without marching the skyline again until the Sun moves', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const { fake, container, map } = createMap(-1);
    const index = fake.terrain.getCoverageIndex();
    const getCoverageIndex = vi.fn(() => index);
    fake.terrain = { getCoverageIndex };
    const overlay = new SunDiskOverlay(map);
    const { halo } = parts(container);
    overlay.setSun(lowSun);
    const background = halo.style.background;
    expect(getCoverageIndex).toHaveBeenCalledOnce();

    overlay.setSun({ ...lowSun, color: [1, 0.5, 0.2] });
    expect(halo.style.background).not.toBe(background);
    expect(getCoverageIndex).toHaveBeenCalledOnce();

    overlay.setSun({ ...lowSun, azimuthDegrees: 1, color: [1, 0.5, 0.2] });
    expect(getCoverageIndex).toHaveBeenCalledTimes(2);
    overlay.dispose();
  });

  it('marches no more often than its interval while terrain hides the moving Sun', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const { fake, container, map } = createMap(10);
    const index = fake.terrain.getCoverageIndex();
    const getCoverageIndex = vi.fn(() => index);
    fake.terrain = { getCoverageIndex };
    const overlay = new SunDiskOverlay(map);
    const { element } = parts(container);
    overlay.setSun(lowSun);
    expect(element.style.display).toBe('none');

    fake.listeners.get('move')?.();
    expect(getCoverageIndex).toHaveBeenCalledOnce();
    now.mockReturnValue(1_000 + sunDiskModel.horizonMarchIntervalMs);
    fake.listeners.get('move')?.();
    expect(getCoverageIndex).toHaveBeenCalledTimes(2);
    overlay.dispose();
  });
});
