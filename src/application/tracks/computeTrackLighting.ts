import type { TerrainSamplerSource } from '@/application/ports/ElevationProvider';
import type { TrackTimingRoute } from '@/application/weather/TrackWeatherForecast';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import {
  stationSunlight,
  type TrackLightingSample,
} from '@/domain/tracks/trackLighting';

/** Stations are at most this far apart, or farther on long routes to stay within the count. */
const maximumStationSpacingMeters = 25;
const maximumStationCount = 400;
/** Stations computed between yields, keeping each main-thread task short. */
const stationsPerTask = 16;

/** A route position at which lighting is evaluated, timed from the route start. */
export interface TrackLightingStation {
  readonly coordinate: TrackCoordinate;
  readonly distanceMeters: number;
  readonly elapsedSeconds: number;
}

/**
 * Evenly spaced stations along the timed route, including its start and finish. Where
 * source segments meet, a station between them takes the next segment's start.
 */
export function planTrackLightingStations(
  route: TrackTimingRoute,
  elapsedSeconds: readonly number[],
): readonly TrackLightingStation[] {
  const { points } = route;
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return [];
  const totalMeters = last.distanceMeters - first.distanceMeters;
  const count = Math.min(
    maximumStationCount,
    Math.ceil(totalMeters / maximumStationSpacingMeters) + 1,
  );
  const spacing = count > 1 ? totalMeters / (count - 1) : 0;
  const stations: TrackLightingStation[] = [];
  let index = 1;
  for (let station = 0; station < count; station += 1) {
    const distanceMeters = Math.min(
      last.distanceMeters,
      first.distanceMeters + station * spacing,
    );
    while (
      index < points.length - 1 &&
      (points[index]?.distanceMeters ?? Infinity) < distanceMeters
    ) {
      index += 1;
    }
    const after = points[index] ?? last;
    const before = points[index - 1] ?? first;
    const span = after.distanceMeters - before.distanceMeters;
    const fraction =
      span <= 0 || before.sourceSegmentIndex !== after.sourceSegmentIndex
        ? 1
        : (distanceMeters - before.distanceMeters) / span;
    const beforeSeconds = elapsedSeconds[index - 1] ?? 0;
    const afterSeconds = elapsedSeconds[index] ?? beforeSeconds;
    stations.push({
      coordinate: [
        before.coordinate[0] + (after.coordinate[0] - before.coordinate[0]) * fraction,
        before.coordinate[1] + (after.coordinate[1] - before.coordinate[1]) * fraction,
      ],
      distanceMeters,
      elapsedSeconds: beforeSeconds + (afterSeconds - beforeSeconds) * fraction,
    });
  }
  return stations;
}

/** Whether stored samples were computed for exactly these stations. */
export function lightingMatchesStations(
  samples: readonly TrackLightingSample[],
  stations: readonly TrackLightingStation[],
): boolean {
  return (
    samples.length === stations.length &&
    stations.every((station, index) => {
      const sample = samples[index];
      return (
        sample !== undefined &&
        Math.abs(sample.distanceMeters - station.distanceMeters) < 0.5 &&
        Math.abs(sample.elapsedSeconds - station.elapsedSeconds) < 0.5
      );
    })
  );
}

/**
 * Lights every station at the instant the hiker passes it, starting at `startMs`. DEM
 * loading dominates; the march itself yields to the event loop between short batches.
 */
export async function computeTrackLighting(
  terrain: TerrainSamplerSource,
  stations: readonly TrackLightingStation[],
  startMs: number,
  signal: AbortSignal,
): Promise<readonly TrackLightingSample[]> {
  const sampler = await terrain.loadTerrainSampler(
    stations.map((station) => ({
      longitude: station.coordinate[0],
      latitude: station.coordinate[1],
    })),
    signal,
  );
  const samples: TrackLightingSample[] = [];
  for (const [index, station] of stations.entries()) {
    if (index > 0 && index % stationsPerTask === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    signal.throwIfAborted();
    samples.push({
      distanceMeters: station.distanceMeters,
      elapsedSeconds: station.elapsedSeconds,
      ...stationSunlight(
        sampler,
        station.coordinate,
        new Date(startMs + station.elapsedSeconds * 1_000),
      ),
    });
  }
  return samples;
}
