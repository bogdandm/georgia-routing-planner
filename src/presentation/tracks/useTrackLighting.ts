import { useEffect, useMemo, useState } from 'react';

import {
  computeTrackLighting,
  lightingMatchesStations,
  planTrackLightingStations,
  type TrackLightingStation,
} from '@/application/tracks/computeTrackLighting';
import {
  routeElapsedSeconds,
  type TrackTimingMetrics,
  type TrackTimingRoute,
  type TrackWeatherTimelineSettings,
} from '@/application/weather/TrackWeatherForecast';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { solarDayEvents } from '@/domain/terrain/solarPosition';
import {
  instantToZonedWallTime,
  routeTimeZone,
  zonedWallTimeToInstant,
  type ZonedWallTime,
} from '@/domain/time/zonedWallTime';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import {
  TRACK_LIGHTING_ALGORITHM_VERSION,
  type TrackLightingSample,
} from '@/domain/tracks/trackLighting';
import type { MapLibreLayerController } from '@/presentation/map/MapLibreLayerController';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';

/** Sunrise or sunset the hiker passes, placed on the route. */
export interface TrackSunEvent {
  readonly kind: 'sunrise' | 'sunset';
  readonly instantMs: number;
  readonly distanceMeters: number;
}

/** Terrain-cast light along the route; `off` without a DEM provider. */
export type TrackTerrainLighting =
  | { readonly status: 'off' }
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly samples: readonly TrackLightingSample[] };

/** The hike on its local date: sun events, terrain light, and the clock it runs on. */
export interface TrackLightingView {
  /** IANA zone at the route start; every clock time is shown in it. */
  readonly timeZone: string;
  /** Local `YYYY-MM-DD` of the hike: the track's own date or the forecast date. */
  readonly date: string;
  /** Local date the recording started at the route, if the track is recorded. */
  readonly recordedDate: string | null;
  readonly startMs: number;
  readonly finishMs: number;
  /**
   * The hike follows the recorded timestamps, only scaled by the pace, so its elapsed
   * time maps proportionally onto the profile's recorded Time axis.
   */
  readonly recordedTiming: boolean;
  readonly startCoordinate: TrackCoordinate;
  readonly finishCoordinate: TrackCoordinate;
  readonly sunEvents: readonly TrackSunEvent[];
  readonly terrain: TrackTerrainLighting;
}

interface TrackLightingInput {
  /** Saved tracks cache their lighting; preview and shared tracks keep it in memory. */
  readonly savedTrack: {
    readonly id: string;
    readonly contentHash: string | null;
  } | null;
  readonly route: TrackTimingRoute | null;
  readonly metrics: TrackTimingMetrics | null;
  readonly settings: TrackWeatherTimelineSettings;
  readonly recordedStartAt: string | undefined;
  /** The date selected in the track weather forecast; the hike date follows it by default. */
  readonly forecastDate: string;
}

const millisecondsPerMinute = 60_000;

/** `{ year, month, day }` of a `YYYY-MM-DD` date, or null when it is not one. */
export function parseIsoDate(
  value: string,
): Pick<ZonedWallTime, 'year' | 'month' | 'day'> | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? { year, month, day }
    : null;
}

/**
 * Sunrises and sunsets at `coordinate` within [startMs, finishMs), in time order. Each
 * step finds at least the next event a minute later, so the scan ends at the finish.
 */
function sunEventInstants(
  startMs: number,
  finishMs: number,
  [longitude, latitude]: TrackCoordinate,
): readonly Omit<TrackSunEvent, 'distanceMeters'>[] {
  const events: Omit<TrackSunEvent, 'distanceMeters'>[] = [];
  let fromMs = startMs;
  while (fromMs < finishMs) {
    const { sunrise, sunset } = solarDayEvents(
      new Date(fromMs),
      new Date(finishMs),
      latitude,
      longitude,
    );
    const next =
      sunrise !== null && (sunset === null || sunrise < sunset)
        ? { kind: 'sunrise' as const, instantMs: sunrise.getTime() }
        : sunset !== null
          ? { kind: 'sunset' as const, instantMs: sunset.getTime() }
          : null;
    if (next === null) break;
    events.push(next);
    fromMs = next.instantMs + millisecondsPerMinute;
  }
  return events;
}

/** Route distance the hiker reaches `elapsedSeconds` after the start. */
function distanceAtElapsed(
  stations: readonly TrackLightingStation[],
  elapsedSeconds: number,
): number {
  const index = stations.findIndex(
    (station) => station.elapsedSeconds >= elapsedSeconds,
  );
  const after = stations[index];
  const before = stations[index - 1];
  if (after === undefined) return stations.at(-1)?.distanceMeters ?? 0;
  if (before === undefined) return after.distanceMeters;
  const span = after.elapsedSeconds - before.elapsedSeconds;
  const fraction = span <= 0 ? 1 : (elapsedSeconds - before.elapsedSeconds) / span;
  return (
    before.distanceMeters + (after.distanceMeters - before.distanceMeters) * fraction
  );
}

/** Local `YYYY-MM-DD` date of `instant` in `timeZone`. */
export function zonedIsoDate(instant: Date, timeZone: string): string {
  const wall = instantToZonedWallTime(instant, timeZone);
  return [
    String(wall.year).padStart(4, '0'),
    String(wall.month).padStart(2, '0'),
    String(wall.day).padStart(2, '0'),
  ].join('-');
}

/**
 * Moves the map's sun shadows to `date` in `timeZone`, keeping their local time of day,
 * so the relief shows the light of the chosen hike date. A map already on that date
 * stays untouched.
 */
export function showHikeDateOnMap(
  mapLayers: Pick<MapLibreLayerController, 'setSunShadow'> | null,
  date: string,
  timeZone: string,
): void {
  const day = parseIsoDate(date);
  if (mapLayers === null || day === null) return;
  const { enabled, instantMs } = mapLayerStore.getState().sunShadow;
  const wall = instantToZonedWallTime(new Date(instantMs), timeZone);
  const next = zonedWallTimeToInstant({ ...wall, ...day }, timeZone).getTime();
  if (next === instantMs) return;
  mapLayers.setSunShadow({ enabled, instantMs: next });
}

/**
 * Times the route on its hike date and lights it with the map's terrain-shadow model.
 * Saved tracks reuse their stored lighting while geometry, start, and timing are
 * unchanged; any change recomputes it, which mostly costs DEM tile loads.
 */
export function useTrackLighting({
  savedTrack,
  route,
  metrics,
  settings,
  recordedStartAt,
  forecastDate,
}: TrackLightingInput): TrackLightingView | null {
  const { database, logger, terrainSampler } = useRuntimeServices();
  const { paceFactor, ignoreRecordedTime, startHour, hikeDate } = settings;
  const startCoordinate = route?.points[0]?.coordinate;
  const finishCoordinate = route?.points.at(-1)?.coordinate;
  const timeZone = useMemo(
    () => (startCoordinate === undefined ? null : routeTimeZone(startCoordinate)),
    [startCoordinate],
  );
  const recordedStart =
    recordedStartAt === undefined ? null : new Date(recordedStartAt);
  const recordedDate =
    timeZone !== null &&
    recordedStart !== null &&
    Number.isFinite(recordedStart.getTime())
      ? zonedIsoDate(recordedStart, timeZone)
      : null;
  const date = hikeDate ?? forecastDate;
  const startMs = useMemo(() => {
    const day = parseIsoDate(date);
    if (day === null || timeZone === null) return null;
    const minutes = Math.round(startHour * 60);
    return zonedWallTimeToInstant(
      { ...day, hour: Math.floor(minutes / 60), minute: minutes % 60 },
      timeZone,
    ).getTime();
  }, [date, startHour, timeZone]);
  const timing = useMemo(() => {
    if (route === null || metrics === null) return { stations: [], recorded: false };
    const { elapsed, recorded } = routeElapsedSeconds(route.points, metrics, {
      paceFactor,
      ignoreRecordedTime,
    });
    return { stations: planTrackLightingStations(route, elapsed), recorded };
  }, [ignoreRecordedTime, metrics, paceFactor, route]);
  const { stations } = timing;
  const finishSeconds = stations.at(-1)?.elapsedSeconds ?? 0;
  const sunEvents = useMemo(() => {
    if (startMs === null || startCoordinate === undefined) return [];
    return sunEventInstants(
      startMs,
      startMs + finishSeconds * 1_000,
      startCoordinate,
    ).map((event) => ({
      ...event,
      distanceMeters: distanceAtElapsed(stations, (event.instantMs - startMs) / 1_000),
    }));
  }, [finishSeconds, startCoordinate, startMs, stations]);

  // The result remembers what it was computed for, so a changed input reads as loading
  // without resetting state from the effect.
  const [computed, setComputed] = useState<{
    readonly stations: readonly TrackLightingStation[];
    readonly startMs: number;
    readonly result: TrackTerrainLighting;
  } | null>(null);
  const trackId = savedTrack?.id ?? null;
  const contentHash = savedTrack?.contentHash ?? null;
  useEffect(() => {
    if (terrainSampler === null || startMs === null || stations.length === 0) {
      return undefined;
    }
    const controller = new AbortController();
    const settle = (result: TrackTerrainLighting) => {
      if (!controller.signal.aborted) setComputed({ stations, startMs, result });
    };
    void (async () => {
      if (trackId !== null) {
        const stored = await database.loadTrackLighting(trackId).catch(() => null);
        if (
          stored !== null &&
          stored.contentHash === contentHash &&
          stored.startMs === startMs &&
          lightingMatchesStations(stored.samples, stations)
        ) {
          settle({ status: 'ready', samples: stored.samples });
          return;
        }
      }
      const samples = await computeTrackLighting(
        terrainSampler,
        stations,
        startMs,
        controller.signal,
      );
      settle({ status: 'ready', samples });
      if (trackId === null || controller.signal.aborted) return;
      await database
        .saveTrackLighting({
          trackId,
          contentHash,
          algorithmVersion: TRACK_LIGHTING_ALGORITHM_VERSION,
          startMs,
          samples,
        })
        .catch(() => {
          logger.log({ level: 'warn', name: 'storage.track-lighting.save-failed' });
        });
    })().catch(() => {
      if (controller.signal.aborted) return;
      logger.log({ level: 'warn', name: 'tracks.lighting.failed' });
      settle({ status: 'failed' });
    });
    return () => {
      controller.abort();
    };
  }, [contentHash, database, logger, startMs, stations, terrainSampler, trackId]);

  // One stable view per input, so its consumers' memos only change with the hike.
  const recordedTiming = timing.recorded;
  return useMemo(() => {
    if (
      timeZone === null ||
      startMs === null ||
      startCoordinate === undefined ||
      finishCoordinate === undefined
    ) {
      return null;
    }
    const terrain: TrackTerrainLighting =
      terrainSampler === null
        ? { status: 'off' }
        : computed !== null &&
            computed.stations === stations &&
            computed.startMs === startMs
          ? computed.result
          : { status: 'loading' };
    return {
      timeZone,
      date,
      recordedDate,
      startMs,
      finishMs: startMs + finishSeconds * 1_000,
      recordedTiming,
      startCoordinate,
      finishCoordinate,
      sunEvents,
      terrain,
    };
  }, [
    computed,
    date,
    finishCoordinate,
    finishSeconds,
    recordedDate,
    recordedTiming,
    startCoordinate,
    startMs,
    stations,
    sunEvents,
    terrainSampler,
    timeZone,
  ]);
}
