import type { TerrainSamplerSource } from '@/application/ports/ElevationProvider';
import type { TrackTimingRoute } from '@/application/weather/TrackWeatherForecast';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import {
  stationSunlight,
  type TrackLightingSample,
} from '@/domain/tracks/trackLighting';

/**
 * One station step is 25 m along the route or 10 minutes of the hike, whichever comes
 * first, so stops and recorded gaps are sampled through time; long routes use fewer,
 * longer steps to stay within the count.
 */
const stationStepMeters = 25;
const stationStepSeconds = 600;
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
 * Stations spread evenly over the hike's combined distance and time progress, including
 * its start and finish. Between two source segments the hiker waits at the end of the
 * first until the next one starts, as the rest of the route timing assumes.
 */
export function planTrackLightingStations(
  route: TrackTimingRoute,
  elapsedSeconds: readonly number[],
): readonly TrackLightingStation[] {
  const { points } = route;
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return [];
  // Distance and elapsed time never decrease, so neither does their weighted sum.
  const startSeconds = elapsedSeconds[0] ?? 0;
  const progress = points.map(
    (point, index) =>
      (point.distanceMeters - first.distanceMeters) / stationStepMeters +
      ((elapsedSeconds[index] ?? startSeconds) - startSeconds) / stationStepSeconds,
  );
  const total = progress.at(-1) ?? 0;
  const count = Math.min(maximumStationCount, Math.ceil(total) + 1);
  const step = count > 1 ? total / (count - 1) : 0;
  const stations: TrackLightingStation[] = [];
  let index = Math.min(1, points.length - 1);
  for (let station = 0; station < count; station += 1) {
    const target = Math.min(total, station * step);
    while (index < points.length - 1 && (progress[index] ?? Infinity) < target) {
      index += 1;
    }
    const after = points[index] ?? last;
    const before = points[index - 1] ?? first;
    const beforeProgress = progress[index - 1] ?? 0;
    const span = (progress[index] ?? beforeProgress) - beforeProgress;
    const fraction = span <= 0 ? 1 : (target - beforeProgress) / span;
    // Across a segment boundary the hiker stays at the earlier end until the next start.
    const moving = before.sourceSegmentIndex === after.sourceSegmentIndex;
    const travelled = moving ? fraction : fraction < 1 ? 0 : 1;
    const beforeSeconds = elapsedSeconds[index - 1] ?? 0;
    const afterSeconds = elapsedSeconds[index] ?? beforeSeconds;
    stations.push({
      coordinate: [
        before.coordinate[0] + (after.coordinate[0] - before.coordinate[0]) * travelled,
        before.coordinate[1] + (after.coordinate[1] - before.coordinate[1]) * travelled,
      ],
      distanceMeters:
        before.distanceMeters +
        (after.distanceMeters - before.distanceMeters) * travelled,
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
