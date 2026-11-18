import { describe, expect, it, vi } from 'vitest';

import type { TerrainSamplerSource } from '@/application/ports/ElevationProvider';
import {
  computeTrackLighting,
  lightingMatchesStations,
  planTrackLightingStations,
} from '@/application/tracks/computeTrackLighting';
import type { TrackTimingRoute } from '@/application/weather/TrackWeatherForecast';

/** 1 km east along 42° N in two source segments; the second starts an hour later. */
const route: TrackTimingRoute = {
  points: [
    { coordinate: [44, 42], distanceMeters: 0, sourceSegmentIndex: 0 },
    { coordinate: [44.004, 42], distanceMeters: 400, sourceSegmentIndex: 0 },
    { coordinate: [44.006, 42], distanceMeters: 400, sourceSegmentIndex: 1 },
    { coordinate: [44.0135, 42], distanceMeters: 1_000, sourceSegmentIndex: 1 },
  ],
};
const elapsedSeconds = [0, 1_200, 4_800, 6_600];

const loadFlatSampler: TerrainSamplerSource['loadTerrainSampler'] = () =>
  Promise.resolve({
    baseResolutionMeters: 10,
    maximumElevationMeters: 0,
    elevationAt: () => 0,
  });
const flatTerrain: TerrainSamplerSource = { loadTerrainSampler: loadFlatSampler };

describe('planTrackLightingStations', () => {
  it('places stations at most 25 m and 10 minutes apart from start to finish', () => {
    const stations = planTrackLightingStations(route, elapsedSeconds);

    // 40 steps of 25 m plus 11 of 10 minutes.
    expect(stations).toHaveLength(52);
    expect(stations[0]).toEqual({
      coordinate: [44, 42],
      distanceMeters: 0,
      elapsedSeconds: 0,
    });
    expect(stations.at(-1)).toEqual({
      coordinate: [44.0135, 42],
      distanceMeters: 1_000,
      elapsedSeconds: 6_600,
    });
    for (const [index, station] of stations.entries()) {
      const previous = stations[index - 1];
      if (previous === undefined) continue;
      expect(station.distanceMeters - previous.distanceMeters).toBeLessThanOrEqual(
        25.001,
      );
      expect(station.elapsedSeconds - previous.elapsedSeconds).toBeLessThanOrEqual(
        600.001,
      );
    }
  });

  it('waits at the end of a segment until the next one starts', () => {
    const waiting = planTrackLightingStations(route, elapsedSeconds).filter(
      (station) => station.elapsedSeconds > 1_200 && station.elapsedSeconds < 4_800,
    );

    expect(waiting).toHaveLength(5);
    for (const station of waiting) {
      expect(station.coordinate).toEqual([44.004, 42]);
      expect(station.distanceMeters).toBe(400);
    }
  });

  it('samples a recorded overnight stop through the night', () => {
    const camp: TrackTimingRoute = {
      points: [
        { coordinate: [44, 42], distanceMeters: 0, sourceSegmentIndex: 0 },
        { coordinate: [44.001, 42], distanceMeters: 100, sourceSegmentIndex: 0 },
        { coordinate: [44.001, 42], distanceMeters: 100, sourceSegmentIndex: 0 },
        { coordinate: [44.002, 42], distanceMeters: 200, sourceSegmentIndex: 0 },
      ],
    };
    const atCamp = planTrackLightingStations(camp, [0, 60, 36_060, 36_120]).filter(
      (station) => station.distanceMeters === 100,
    );

    expect(atCamp.length).toBeGreaterThanOrEqual(60);
    expect(atCamp.every((station) => station.coordinate[0] === 44.001)).toBe(true);
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
    // A walk from 30 minutes before a June sunrise in Tbilisi (~01:38 UTC) until 03:00 UTC.
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
    expect(samples.at(-1)?.elapsedSeconds).toBe(6_600);
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
