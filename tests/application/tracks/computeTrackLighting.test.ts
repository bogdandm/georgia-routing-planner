import { describe, expect, it, vi } from 'vitest';

import type { TerrainSamplerSource } from '@/application/ports/ElevationProvider';
import {
  computeTrackLighting,
  lightingMatchesStations,
  planTrackLightingStations,
} from '@/application/tracks/computeTrackLighting';
import type { TrackTimingRoute } from '@/application/weather/TrackWeatherForecast';

/** 1 km east along 42° N in two source segments; the second starts after a gap. */
const route: TrackTimingRoute = {
  points: [
    { coordinate: [44, 42], distanceMeters: 0, sourceSegmentIndex: 0 },
    { coordinate: [44.004, 42], distanceMeters: 400, sourceSegmentIndex: 0 },
    { coordinate: [44.006, 42], distanceMeters: 400, sourceSegmentIndex: 1 },
    { coordinate: [44.0135, 42], distanceMeters: 1_000, sourceSegmentIndex: 1 },
  ],
};
const elapsedSeconds = [0, 1_200, 1_800, 3_600];

const loadFlatSampler: TerrainSamplerSource['loadTerrainSampler'] = () =>
  Promise.resolve({
    baseResolutionMeters: 10,
    maximumElevationMeters: 0,
    elevationAt: () => 0,
  });
const flatTerrain: TerrainSamplerSource = { loadTerrainSampler: loadFlatSampler };

describe('planTrackLightingStations', () => {
  it('spaces stations every 25 m from start to finish, timed along the route', () => {
    const stations = planTrackLightingStations(route, elapsedSeconds);

    expect(stations).toHaveLength(41);
    expect(stations[0]).toEqual({
      coordinate: [44, 42],
      distanceMeters: 0,
      elapsedSeconds: 0,
    });
    expect(stations[8]?.distanceMeters).toBe(200);
    expect(stations[8]?.elapsedSeconds).toBeCloseTo(600, 9);
    expect(stations[8]?.coordinate[0]).toBeCloseTo(44.002, 9);
    expect(stations.at(-1)).toEqual({
      coordinate: [44.0135, 42],
      distanceMeters: 1_000,
      elapsedSeconds: 3_600,
    });
  });

  it('places a station at a segment gap on the next segment after the wait', () => {
    const atGap = planTrackLightingStations(route, elapsedSeconds)[16];

    expect(atGap?.distanceMeters).toBe(400);
    expect(atGap?.coordinate).toEqual([44.004, 42]);
    expect(atGap?.elapsedSeconds).toBe(1_200);
    expect(planTrackLightingStations(route, elapsedSeconds)[17]?.elapsedSeconds).toBe(
      1_800 + 1_800 / 24,
    );
  });

  it('caps long routes at 400 stations', () => {
    const long: TrackTimingRoute = {
      points: [
        { coordinate: [44, 42], distanceMeters: 0, sourceSegmentIndex: 0 },
        { coordinate: [45, 42], distanceMeters: 80_000, sourceSegmentIndex: 0 },
      ],
    };

    expect(planTrackLightingStations(long, [0, 36_000])).toHaveLength(400);
    expect(planTrackLightingStations({ points: [] }, [])).toEqual([]);
  });
});

describe('lightingMatchesStations', () => {
  it('accepts samples only for the same stations and timing', () => {
    const stations = planTrackLightingStations(route, elapsedSeconds);
    const samples = stations.map((station) => ({
      distanceMeters: station.distanceMeters,
      elapsedSeconds: station.elapsedSeconds,
      sunlitFraction: 1,
      sunElevationDegrees: 30,
    }));
    const slower = planTrackLightingStations(
      route,
      elapsedSeconds.map((seconds) => seconds * 1.1),
    );

    expect(lightingMatchesStations(samples, stations)).toBe(true);
    expect(lightingMatchesStations(samples, slower)).toBe(false);
    expect(lightingMatchesStations(samples.slice(1), stations)).toBe(false);
  });
});

describe('computeTrackLighting', () => {
  it('lights each station at the instant the hiker passes it', async () => {
    const loadTerrainSampler = vi.fn(loadFlatSampler);
    const stations = planTrackLightingStations(route, elapsedSeconds);
    // An hour-long walk starting 30 minutes before a June sunrise in Tbilisi (~01:38 UTC).
    const samples = await computeTrackLighting(
      { loadTerrainSampler },
      stations,
      Date.parse('2026-06-21T01:10:00Z'),
      new AbortController().signal,
    );

    expect(loadTerrainSampler).toHaveBeenCalledOnce();
    expect(loadTerrainSampler.mock.calls[0]?.[0]).toHaveLength(stations.length);
    expect(loadTerrainSampler.mock.calls[0]?.[0][0]).toEqual({
      longitude: 44,
      latitude: 42,
    });
    expect(samples).toHaveLength(stations.length);
    expect(samples[0]?.sunlitFraction).toBe(0);
    expect(samples[0]?.sunElevationDegrees).toBeLessThan(0);
    expect(samples.at(-1)?.sunlitFraction).toBe(1);
    expect(samples.at(-1)?.elapsedSeconds).toBe(3_600);
  });

  it('stops when the signal aborts', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      computeTrackLighting(
        flatTerrain,
        planTrackLightingStations(route, elapsedSeconds),
        0,
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});
