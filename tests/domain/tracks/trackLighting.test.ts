import { describe, expect, it } from 'vitest';

import { solarPosition } from '@/domain/terrain/solarPosition';
import {
  terrainShadowModel,
  type TerrainElevationSampler,
  type TerrainMarchOptions,
} from '@/domain/terrain/terrainShadow';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import {
  stationSunlight,
  trackLightDurations,
  trackLightShares,
  type TrackLightingSample,
} from '@/domain/tracks/trackLighting';

const station: TrackCoordinate = [44, 42];
const metersPerDegree = (terrainShadowModel.earthRadiusMeters * Math.PI) / 180;
/** Solar noon at 44° E on the June solstice: the Sun stands about 71.4° due south. */
const solsticeNoon = new Date('2026-06-21T09:05:00Z');
const solsticeNight = new Date('2026-06-21T22:00:00Z');

/** Flat ground with an east–west wall from `startMeters` south of the station onward. */
function southWall(
  startMeters: number,
  heightMeters: number,
): TerrainElevationSampler & TerrainMarchOptions {
  return {
    baseResolutionMeters: 10,
    maximumElevationMeters: heightMeters,
    elevationAt(latitudeDegrees) {
      const southMeters = (station[1] - latitudeDegrees) * metersPerDegree;
      return southMeters >= startMeters ? heightMeters : 0;
    },
  };
}

function sample(
  elapsedSeconds: number,
  sunlitFraction: number,
  sunElevationDegrees: number,
): TrackLightingSample {
  return {
    distanceMeters: elapsedSeconds,
    elapsedSeconds,
    sunlitFraction,
    sunElevationDegrees,
    skyView: 1,
    groundElevationMeters: 0,
  };
}

describe('stationSunlight', () => {
  it('lights open ground fully while the Sun is up', () => {
    const light = stationSunlight(southWall(Infinity, 0), station, solsticeNoon);

    expect(light.sunlitFraction).toBe(1);
    expect(light.sunElevationDegrees).toBeCloseTo(
      solarPosition(solsticeNoon, station[1], station[0]).apparentElevationDegrees,
      9,
    );
  });

  it('reports the open sky and ground height the station stands on', () => {
    /** A north–south gorge floor at 1,000 m between walls rising 400 m within 200 m. */
    const gorge: TerrainElevationSampler & TerrainMarchOptions = {
      baseResolutionMeters: 10,
      maximumElevationMeters: 1_400,
      elevationAt(_latitude, longitudeDegrees) {
        const eastMeters =
          (longitudeDegrees - station[0]) *
          metersPerDegree *
          Math.cos((42 * Math.PI) / 180);
        return Math.abs(eastMeters) >= 200 ? 1_400 : 1_000;
      },
    };
    /** A 10 m boulder 20 m east of open ground. */
    const boulder: TerrainElevationSampler & TerrainMarchOptions = {
      baseResolutionMeters: 10,
      maximumElevationMeters: 1_010,
      elevationAt(latitudeDegrees, longitudeDegrees) {
        const eastMeters =
          (longitudeDegrees - station[0]) *
          metersPerDegree *
          Math.cos((42 * Math.PI) / 180);
        const northMeters = (latitudeDegrees - station[1]) * metersPerDegree;
        return Math.abs(eastMeters - 20) < 5 && Math.abs(northMeters) < 5
          ? 1_010
          : 1_000;
      },
    };

    const open = stationSunlight(southWall(Infinity, 0), station, solsticeNoon);
    const inGorge = stationSunlight(gorge, station, solsticeNoon);
    const byBoulder = stationSunlight(boulder, station, solsticeNoon);

    expect(open.skyView).toBe(1);
    expect(inGorge.groundElevationMeters).toBe(1_000);
    expect(byBoulder.skyView).toBeLessThan(1);
    expect(inGorge.skyView).toBeLessThan(byBoulder.skyView - 0.2);
  });

  it('averages the 50 m disk, so a shadow edge through it gives partial sunlight', () => {
    // The 320 m wall from 95 m south hides the Sun from the centre and the three southern
    // ring observers (58–77 m from the wall) but not the three northern ones (≥ 113 m).
    const light = stationSunlight(southWall(95, 320), station, solsticeNoon);

    expect(light.sunlitFraction).toBeCloseTo(3 / 7, 9);
  });

  it('keeps the whole disk in shade behind a wall that hides every observer', () => {
    expect(
      stationSunlight(southWall(100, 5_000), station, solsticeNoon).sunlitFraction,
    ).toBe(0);
  });

  it('has no sunlight at night without marching the terrain', () => {
    const marchedDistances: number[] = [];
    const sampler: TerrainElevationSampler & TerrainMarchOptions = {
      ...southWall(Infinity, 0),
      elevationAt(_latitude, _longitude, distanceMeters) {
        marchedDistances.push(distanceMeters);
        return 0;
      },
    };
    const light = stationSunlight(sampler, station, solsticeNight);

    expect(light.sunlitFraction).toBe(0);
    expect(light.sunElevationDegrees).toBeLessThan(-6);
    // Only the observers' own ground elevation was read.
    expect(marchedDistances.every((distance) => distance === 0)).toBe(true);
  });

  it('treats a station outside DEM coverage as open sea-level ground', () => {
    const uncovered: TerrainElevationSampler & TerrainMarchOptions = {
      baseResolutionMeters: 10,
      maximumElevationMeters: 0,
      elevationAt: () => null,
    };

    expect(stationSunlight(uncovered, station, solsticeNoon).sunlitFraction).toBe(1);
    expect(stationSunlight(uncovered, station, solsticeNight).sunlitFraction).toBe(0);
  });
});

describe('trackLightShares', () => {
  it('splits a risen Sun into sun and terrain shade', () => {
    expect(trackLightShares({ sunlitFraction: 0.25, sunElevationDegrees: 12 })).toEqual(
      {
        sun: 0.25,
        shade: 0.75,
        twilight: 0,
        dark: 0,
      },
    );
  });

  it('counts the unlit share as the blue hour until civil twilight ends', () => {
    // Just below the astronomical horizon a summit can still see the Sun.
    expect(trackLightShares({ sunlitFraction: 0.5, sunElevationDegrees: -1 })).toEqual({
      sun: 0.5,
      shade: 0,
      twilight: 0.5,
      dark: 0,
    });
    expect(
      trackLightShares({ sunlitFraction: 0, sunElevationDegrees: -6 }).twilight,
    ).toBe(1);
  });

  it('is dark once the Sun is more than 6° below the horizon', () => {
    expect(trackLightShares({ sunlitFraction: 0, sunElevationDegrees: -6.01 })).toEqual(
      {
        sun: 0,
        shade: 0,
        twilight: 0,
        dark: 1,
      },
    );
  });
});

describe('trackLightDurations', () => {
  it('integrates the shares linearly between samples and skips stops in place', () => {
    const durations = trackLightDurations([
      sample(0, 1, 30),
      sample(3_600, 1, 20),
      sample(3_600, 0, 20),
      sample(7_200, 0, 10),
      sample(9_000, 0, -3),
      sample(10_800, 0, -9),
    ]);

    expect(durations).toEqual({
      sun: 3_600,
      shade: 3_600 + 900,
      twilight: 900 + 900,
      dark: 900,
    });
  });
});
