import { describe, expect, it, vi } from 'vitest';

import type {
  HourlyWeatherForecast,
  WeatherForecastData,
  WeatherForecastGateway,
} from '@/application/ports/WeatherForecastGateway';
import { GetPointWeatherForecast } from '@/application/weather/GetPointWeatherForecast';
import {
  adjustedTrackRouteTiming,
  createTrackTimingRoute,
  defaultTrackWeatherDate,
  defaultTrackWeatherTimelineSettings,
  defaultTrackRouteTiming,
  planTrackClockTimes,
  planTrackMarkerTimes,
  planTrackWeatherTimeline,
  routeElapsedSeconds,
  selectTrackElevationLocations,
  summarizeTrackWeatherCheckpoint,
  trackWeatherDates,
  trackWeatherLocalTime,
  trackWeatherTimeline,
  trackWeatherWeekday,
  type TimedTrackWeatherSettings,
  type TrackWeatherCheckpoint,
  type TrackWeatherTiming,
} from '@/application/weather/TrackWeatherForecast';
import type {
  ElevationProfile,
  ElevationProfilePoint,
} from '@/domain/tracks/elevationProfile';
import type { TrackCoordinate, TrackPoint } from '@/domain/tracks/gpx';
import {
  DAY_HIKE_TIME_PRESET_ID,
  DIN_HIKING_TIME_PRESET_ID,
  builtInHikingTimePresets,
  dinHikingMovement,
  type HikingTimeParameters,
} from '@/domain/tracks/hikingTime';
import type { TrackMarker } from '@/domain/tracks/localTrack';
import * as trackCalculations from '@/domain/tracks/trackCalculations';

const hour = 3_600;

function presetParameters(id: string): HikingTimeParameters {
  const preset = builtInHikingTimePresets.find((value) => value.id === id);
  if (preset === undefined) throw new Error(`Missing built-in preset ${id}.`);
  return preset.parameters;
}

/** DIN 33466 without breaks or lunch: the estimate before hiking time presets. */
const dinHikingTime = presetParameters(DIN_HIKING_TIME_PRESET_ID);
const dinTiming: TrackWeatherTiming = {
  paceFactor: 1,
  stopFactor: 1,
  ignoreRecordedTime: false,
  hikingTime: dinHikingTime,
};
const dinSettings: TimedTrackWeatherSettings = {
  ...defaultTrackWeatherTimelineSettings,
  hikingTime: dinHikingTime,
};
/** Stored ascent and descent of `ridgeProfile`. */
const ridgeTotals = { ascentMeters: 900, descentMeters: 500 };

function profile(
  samples: readonly {
    readonly distanceMeters: number;
    readonly elevationMeters: number;
    readonly coordinate?: TrackCoordinate;
    readonly recordedAt?: string;
    readonly sourceSegmentIndex?: number;
  }[],
): ElevationProfile {
  const points = samples.map((sample, index): ElevationProfilePoint => {
    const point: ElevationProfilePoint = {
      coordinate: sample.coordinate ?? [44 + sample.distanceMeters / 100_000, 42],
      rawElevationMeters: sample.elevationMeters,
      elevationMeters: sample.elevationMeters,
      sourceSegmentIndex: sample.sourceSegmentIndex ?? 0,
      sampleIndex: index,
      distanceMeters: sample.distanceMeters,
      trendElevationMeters: sample.elevationMeters,
      localGradePct: 0,
    };
    return sample.recordedAt === undefined
      ? point
      : { ...point, recordedAt: sample.recordedAt };
  });
  const elevations = samples.map((sample) => sample.elevationMeters);
  return {
    points,
    segments: [],
    gradeSubsegments: [],
    minimumMeters: Math.min(...elevations),
    maximumMeters: Math.max(...elevations),
    algorithmVersion: 3,
  };
}

/** 12 km: 900 m up over 6 km, then 500 m down; DIN 33466 total is exactly 5.5 h. */
function ridgeProfile(): ElevationProfile {
  return profile(
    Array.from({ length: 13 }, (_, kilometre) => ({
      distanceMeters: kilometre * 1_000,
      elevationMeters:
        kilometre <= 6 ? 2_000 + 150 * kilometre : 2_900 - (500 / 6) * (kilometre - 6),
    })),
  );
}

function forecastData(): WeatherForecastData {
  const hourly: HourlyWeatherForecast[] = Array.from({ length: 8 * 24 }, (_, index) => {
    const day = 18 + Math.floor(index / 24);
    const time = index % 24;
    return {
      time: `2026-07-${String(day)}T${String(time).padStart(2, '0')}:00`,
      temperatureCelsius: time,
      apparentTemperatureCelsius: time,
      precipitationMm: 0,
      rainMm: 0,
      showersMm: 0,
      snowfallCm: 0,
      precipitationType: 0,
      weatherCode: 0,
      cloudCoverPercent: 0,
      visibilityMeters: 20_000,
      windSpeedKmh: 10,
      windGustsKmh: 20,
      isDay: time >= 6 && time < 20,
    };
  });
  const current = hourly[0];
  if (current === undefined)
    throw new Error('Forecast fixture requires hourly values.');
  return {
    requestedCoordinate: { longitude: 44.8, latitude: 41.7 },
    resolvedCoordinate: { longitude: 44.8, latitude: 41.7 },
    elevationMeters: 500,
    timezone: 'Asia/Tbilisi',
    timezoneAbbreviation: 'GMT+4',
    utcOffsetSeconds: 14_400,
    model: 'ecmwf_ifs',
    modelRunAt: null,
    fetchedAt: '2026-07-18T00:00:00.000Z',
    current,
    hourly,
  };
}

async function pointForecast() {
  const gateway: WeatherForecastGateway = {
    fetch: vi.fn().mockResolvedValue(forecastData()),
  };
  return await new GetPointWeatherForecast(
    gateway,
    null,
    { log: vi.fn(), getEvents: () => [], subscribe: () => () => undefined },
    { generate: () => 'track-weather' },
    { now: () => new Date(), monotonicNow: () => 0 },
  ).execute(
    { coordinate: { longitude: 44.8, latitude: 41.7 } },
    new AbortController().signal,
  );
}

/** A checkpoint whose window covers the given clock hours of the forecast date. */
function checkpoint(hours: readonly number[]): TrackWeatherCheckpoint {
  const location = {
    coordinate: [44.8, 41.7] as const,
    elevationMeters: 2_000,
    distanceMeters: 0,
  };
  return {
    ...location,
    kind: 'interval',
    elapsedSeconds: 0,
    hours: hours.map((hour) => ({ hour, location })),
  };
}

describe('selectTrackElevationLocations', () => {
  it('finds the highest, lowest, and median-elevation samples', () => {
    const locations = selectTrackElevationLocations(
      profile([
        { distanceMeters: 0, elevationMeters: 2_000 },
        { distanceMeters: 1_000, elevationMeters: 2_500 },
        { distanceMeters: 2_000, elevationMeters: 3_000 },
        { distanceMeters: 3_000, elevationMeters: 2_200 },
        { distanceMeters: 4_000, elevationMeters: 1_800 },
      ]),
    );

    expect(locations.highest).toMatchObject({
      elevationMeters: 3_000,
      distanceMeters: 2_000,
    });
    expect(locations.median).toMatchObject({
      elevationMeters: 2_200,
      distanceMeters: 3_000,
    });
    expect(locations.lowest).toMatchObject({
      elevationMeters: 1_800,
      distanceMeters: 4_000,
    });
  });
});

describe('planTrackWeatherTimeline', () => {
  it('places the hiker every three hours by DIN 33466 pace, climbing slower than walking', () => {
    const timeline = planTrackWeatherTimeline(
      ridgeProfile(),
      { distanceMeters: 12_000, ...ridgeTotals },
      dinTiming,
      9,
    );

    expect(timeline.status).toBe('available');
    if (timeline.status !== 'available') return;
    expect(timeline.durationSource).toBe('estimated');
    expect(timeline.durationSeconds).toBeCloseTo(5.5 * hour, 6);
    expect(
      timeline.checkpoints.map(({ kind, elapsedSeconds, hours }) => ({
        kind,
        elapsedSeconds,
        hours: hours.map((value) => value.hour),
      })),
    ).toEqual([
      { kind: 'start', elapsedSeconds: 0, hours: [9, 10, 11] },
      { kind: 'interval', elapsedSeconds: 3 * hour, hours: [12, 13, 14] },
      {
        kind: 'finish',
        elapsedSeconds: expect.closeTo(5.5 * hour, 6) as number,
        hours: [14],
      },
    ]);
    // On the climb 1 km takes 0.5 h of ascent plus half of 0.25 h walking: 3 h is 4.8 km.
    expect(timeline.checkpoints[1]?.distanceMeters).toBeCloseTo(4_800, 6);
    expect(timeline.checkpoints[1]?.elevationMeters).toBeCloseTo(2_720, 6);
    expect(timeline.checkpoints[0]?.elevationMeters).toBe(2_000);
    expect(timeline.checkpoints[2]?.distanceMeters).toBe(12_000);
  });

  it('locates each forecast hour where the hiker is at that hour', () => {
    const timeline = planTrackWeatherTimeline(
      ridgeProfile(),
      { distanceMeters: 12_000, ...ridgeTotals },
      dinTiming,
      9.5,
    );

    expect(timeline.status).toBe('available');
    if (timeline.status !== 'available') return;
    const hours = timeline.checkpoints.map((value) =>
      value.hours.map(({ hour: clockHour, location }) => ({
        clockHour,
        distanceMeters: location.distanceMeters,
      })),
    );
    // 1 km of climbing takes 0.625 h. At 09:00 the hiker waits at the start, and the
    // 12:00 hour ends the start's window and begins the 12:30 checkpoint's.
    const climb = [
      { clockHour: 9, distanceMeters: 0 },
      { clockHour: 10, distanceMeters: expect.closeTo(800, 6) as number },
      { clockHour: 11, distanceMeters: expect.closeTo(2_400, 6) as number },
      { clockHour: 12, distanceMeters: expect.closeTo(4_000, 6) as number },
    ];
    expect(hours[0]).toEqual(climb);
    expect(hours[1]?.[0]).toEqual(climb[3]);
    expect(hours[1]?.map((value) => value.clockHour)).toEqual([12, 13, 14]);
    expect(hours[1]?.[1]?.distanceMeters).toBeCloseTo(5_600, 6);
    // The hiker finishes at 15:00, so the finish's only hour is at the finish.
    expect(hours[2]).toEqual([{ clockHour: 15, distanceMeters: 12_000 }]);
  });

  it('anchors the profile pace to the stored ascent and descent totals', () => {
    // The profile climbs 900 m, but the stored 600 m up and 400 m down make a 4.4 h DIN
    // total: 2.8 h vertical plus half of 3 h walking.
    const timeline = planTrackWeatherTimeline(
      ridgeProfile(),
      { distanceMeters: 12_000, ascentMeters: 600, descentMeters: 400 },
      dinTiming,
      9,
    );

    expect(timeline).toMatchObject({ status: 'available' });
    if (timeline.status !== 'available') return;
    expect(timeline.durationSeconds).toBeCloseTo(4.4 * hour, 6);
    expect(timeline.checkpoints[1]?.distanceMeters).toBeCloseTo(6_000, 6);
  });

  it('follows recorded timestamps, including pauses, when the track has recorded time', () => {
    const recorded = profile([
      { distanceMeters: 0, elevationMeters: 1_000, recordedAt: '2026-06-01T05:00:00Z' },
      {
        distanceMeters: 4_000,
        elevationMeters: 1_400,
        recordedAt: '2026-06-01T07:00:00Z',
      },
      {
        distanceMeters: 4_000,
        elevationMeters: 1_400,
        recordedAt: '2026-06-01T07:30:00Z',
      },
      {
        distanceMeters: 8_000,
        elevationMeters: 1_000,
        recordedAt: '2026-06-01T09:30:00Z',
      },
    ]);

    const timeline = planTrackWeatherTimeline(
      recorded,
      { distanceMeters: 8_000, elapsedSeconds: 4.5 * hour },
      dinTiming,
      9,
    );

    expect(timeline).toMatchObject({
      status: 'available',
      durationSource: 'recorded',
      durationSeconds: 4.5 * hour,
    });
    if (timeline.status !== 'available') return;
    // At 3 h the hiker has rested half an hour at 4 km and walked half an hour more.
    expect(timeline.checkpoints.map((value) => value.distanceMeters)).toEqual([
      0, 5_000, 8_000,
    ]);
  });

  it('times the route by the stored-metric estimate when recorded time is ignored', () => {
    const recorded = profile([
      { distanceMeters: 0, elevationMeters: 1_000, recordedAt: '2026-06-01T05:00:00Z' },
      {
        distanceMeters: 4_000,
        elevationMeters: 1_400,
        recordedAt: '2026-06-01T07:00:00Z',
      },
    ]);
    // Like real recorded summaries, no stored estimate. The stored 600 m ascent, not the
    // 400 m between samples, sets the DIN total: 2 h climbing plus half of 1 h walking.
    const metrics = {
      distanceMeters: 4_000,
      elapsedSeconds: 2 * hour,
      ascentMeters: 600,
      descentMeters: 0,
    };
    const ignoring = { ...dinSettings, ignoreRecordedTime: true };

    expect(planTrackWeatherTimeline(recorded, metrics, ignoring, 9)).toMatchObject({
      status: 'available',
      durationSource: 'estimated',
      durationSeconds: expect.closeTo(2.5 * hour, 6) as number,
    });
    expect(planTrackClockTimes(recorded, metrics, dinSettings).finish).toBe('11:00');
    expect(planTrackClockTimes(recorded, metrics, ignoring).finish).toBe('11:30');
  });

  it('falls back to the estimate when a profile sample has no timestamp', () => {
    const partial = profile([
      { distanceMeters: 0, elevationMeters: 1_000, recordedAt: '2026-06-01T05:00:00Z' },
      { distanceMeters: 4_000, elevationMeters: 1_000 },
    ]);

    expect(
      planTrackWeatherTimeline(
        partial,
        { distanceMeters: 4_000, elapsedSeconds: 3_600 },
        dinTiming,
        9,
      ),
    ).toMatchObject({ status: 'available', durationSource: 'estimated' });
  });

  it('is unavailable for tracks of 30 km or 12 hours and longer', () => {
    expect(
      planTrackWeatherTimeline(
        ridgeProfile(),
        { distanceMeters: 30_000, ...ridgeTotals },
        dinTiming,
        9,
      ),
    ).toMatchObject({ status: 'too-long', distanceMeters: 30_000 });
    // A steady 3150 m climb over 12 km: 10.5 h of ascent plus half of 3 h walking.
    const climb = (ascentMeters: number) =>
      planTrackWeatherTimeline(
        profile([
          { distanceMeters: 0, elevationMeters: 1_000 },
          { distanceMeters: 12_000, elevationMeters: 1_000 + ascentMeters },
        ]),
        { distanceMeters: 12_000, ascentMeters, descentMeters: 0 },
        dinTiming,
        9,
      );
    expect(climb(3_150)).toMatchObject({
      status: 'too-long',
      durationSeconds: 12 * hour,
    });
    expect(climb(3_000)).toMatchObject({
      status: 'available',
      durationSeconds: 11.5 * hour,
    });
  });

  it('retains the recorded or estimated duration source beyond the forecast limit', () => {
    const recorded = profile([
      { distanceMeters: 0, elevationMeters: 1_000, recordedAt: '2026-06-01T05:00:00Z' },
      {
        distanceMeters: 30_000,
        elevationMeters: 1_000,
        recordedAt: '2026-06-02T07:00:00Z',
      },
    ]);
    // 30 km of flat walking is a 7.5 h DIN estimate.
    const metrics = {
      distanceMeters: 30_000,
      elapsedSeconds: 26 * hour,
      ascentMeters: 0,
      descentMeters: 0,
    };

    expect(planTrackWeatherTimeline(recorded, metrics, dinTiming, 9)).toMatchObject({
      status: 'too-long',
      durationSource: 'recorded',
      durationSeconds: 26 * hour,
    });
    expect(
      planTrackWeatherTimeline(
        recorded,
        metrics,
        {
          ...dinTiming,
          paceFactor: 2,
          ignoreRecordedTime: true,
        },
        9,
      ),
    ).toMatchObject({
      status: 'too-long',
      durationSource: 'estimated',
      durationSeconds: 15 * hour,
    });
  });

  it('stretches or compresses the timeline by the pace factor', () => {
    const metrics = { distanceMeters: 12_000, ...ridgeTotals };

    const faster = planTrackWeatherTimeline(
      ridgeProfile(),
      metrics,
      {
        ...dinTiming,
        paceFactor: 0.5,
      },
      9,
    );
    expect(faster).toMatchObject({ status: 'available' });
    if (faster.status !== 'available') return;
    expect(faster.durationSeconds).toBeCloseTo(2.75 * hour, 6);
    expect(faster.checkpoints.map((value) => value.kind)).toEqual(['start', 'finish']);
    // Slowed beyond the day-hike limit: 5.5 h × 2.2 = 12.1 h.
    expect(
      planTrackWeatherTimeline(
        ridgeProfile(),
        metrics,
        {
          ...dinTiming,
          paceFactor: 2.2,
        },
        9,
      ),
    ).toMatchObject({
      status: 'too-long',
    });
  });

  it('stretches recorded time by the pace factor and ignores the stop factor for it', () => {
    const recorded = profile([
      { distanceMeters: 0, elevationMeters: 1_000, recordedAt: '2026-06-01T05:00:00Z' },
      {
        distanceMeters: 4_000,
        elevationMeters: 1_400,
        recordedAt: '2026-06-01T07:00:00Z',
      },
    ]);
    const metrics = { distanceMeters: 4_000, elapsedSeconds: 2 * hour };

    for (const stopFactor of [0, 1, 3]) {
      expect(
        planTrackWeatherTimeline(
          recorded,
          metrics,
          {
            ...dinTiming,
            paceFactor: 1.5,
            stopFactor,
          },
          9,
        ),
      ).toMatchObject({
        status: 'available',
        durationSource: 'recorded',
        durationSeconds: 3 * hour,
      });
    }
  });

  it('stretches only the recorded walking by the pace factor and keeps its stops', () => {
    const recorded = profile([
      { distanceMeters: 0, elevationMeters: 1_000, recordedAt: '2026-06-01T05:00:00Z' },
      {
        distanceMeters: 2_000,
        elevationMeters: 1_000,
        recordedAt: '2026-06-01T05:30:00Z',
      },
      {
        distanceMeters: 2_000,
        elevationMeters: 1_000,
        recordedAt: '2026-06-01T05:40:00Z',
      },
      {
        distanceMeters: 4_000,
        elevationMeters: 1_000,
        recordedAt: '2026-06-01T06:10:00Z',
      },
    ]);

    const { elapsed } = routeElapsedSeconds(
      recorded.points,
      { elapsedSeconds: 70 * 60 },
      { ...dinTiming, paceFactor: 2 },
    );

    expect(elapsed).toEqual([0, 60 * 60, 70 * 60, 130 * 60]);
  });

  it('pauses for lunch in place between two neighbouring points of a v2 estimate', () => {
    const flat = profile(
      Array.from({ length: 14 }, (_, kilometre) => ({
        distanceMeters: kilometre * 1_000,
        elevationMeters: 1_000,
      })),
    );
    const hikingTime = presetParameters(DAY_HIKE_TIME_PRESET_ID);
    const timing = { ...dinTiming, hikingTime };

    const { elapsed, recorded, estimate } = routeElapsedSeconds(
      flat.points,
      {},
      timing,
    );

    expect(recorded).toBe(false);
    expect(estimate).toMatchObject({
      lunchCount: 1,
      lunchSeconds: hikingTime.lunchMinutes * 60,
    });
    const steps = elapsed
      .slice(1)
      .map((seconds, index) => seconds - (elapsed[index] ?? 0));
    const walking = Math.min(...steps);
    // Lunch falls at half the moving time, 6.5 km along: between the 6th and 7th point.
    expect(steps.map((step) => step - walking)).toEqual(
      steps.map(
        (_, index) =>
          expect.closeTo(index === 6 ? hikingTime.lunchMinutes * 60 : 0, 6) as number,
      ),
    );
    expect(
      planTrackWeatherTimeline(flat, { distanceMeters: 13_000 }, timing, 9),
    ).toMatchObject({
      durationSource: 'estimated',
      durationSeconds: expect.closeTo(estimate?.totalSeconds ?? 0, 6) as number,
    });
  });
});

describe('full-route label timing', () => {
  it('keeps the unprofiled prefix and suffix in recorded and estimated marker times', () => {
    const raw: readonly (readonly TrackPoint[])[] = [
      [
        { coordinate: [44, 42], recordedAt: '2026-06-01T05:00:00Z' },
        {
          coordinate: [44.02, 42],
          elevationMeters: 1000,
          recordedAt: '2026-06-01T06:00:00Z',
        },
        {
          coordinate: [44.04, 42],
          elevationMeters: 1000,
          recordedAt: '2026-06-01T07:00:00Z',
        },
        { coordinate: [44.06, 42], recordedAt: '2026-06-01T08:00:00Z' },
      ],
    ];
    const metrics = trackCalculations.calculateTrackMetrics(
      raw.map((points) => ({ points })),
    );
    const partial = profile([
      {
        coordinate: [44.02, 42],
        distanceMeters: 0,
        elevationMeters: 1000,
        recordedAt: '2026-06-01T06:00:00Z',
      },
      {
        coordinate: [44.04, 42],
        distanceMeters: 2000,
        elevationMeters: 1000,
        recordedAt: '2026-06-01T07:00:00Z',
      },
    ]);
    const route = createTrackTimingRoute(partial, raw, metrics.distanceMeters);
    const settings = { ...dinSettings, timeMarkers: true };
    const markers: readonly TrackMarker[] = [
      { id: 'prefix', name: 'Prefix', coordinate: [44, 42] },
      { id: 'interior', name: 'Interior', coordinate: [44.02, 42] },
      { id: 'suffix', name: 'Suffix', coordinate: [44.06, 42] },
    ];
    expect(planTrackClockTimes(route, metrics, settings).finish).toBe('12:00');
    expect(planTrackMarkerTimes(route, metrics, settings, markers)).toEqual(
      new Map([
        ['prefix', '09:00'],
        ['interior', '10:00'],
        ['suffix', '12:00'],
      ]),
    );
    // A pace that walks the route in 6 h takes 9 h at a 1.5 pace factor.
    const sixHourPace: TimedTrackWeatherSettings = {
      ...settings,
      ignoreRecordedTime: true,
      paceFactor: 1.5,
      hikingTime: {
        ...dinHikingTime,
        movement: {
          ...dinHikingMovement,
          horizontalKmh: (route.points.at(-1)?.distanceMeters ?? 0) / 6_000,
        },
      },
    };
    expect(planTrackMarkerTimes(route, metrics, sixHourPace, markers)).toEqual(
      new Map([
        ['prefix', '09:00'],
        ['interior', '12:00'],
        ['suffix', '18:00'],
      ]),
    );
  });

  it('does not charge a climb between disconnected flat segments', () => {
    const route = profile([
      { distanceMeters: 0, elevationMeters: 1000, sourceSegmentIndex: 0 },
      { distanceMeters: 4000, elevationMeters: 1000, sourceSegmentIndex: 0 },
      { distanceMeters: 4000, elevationMeters: 2000, sourceSegmentIndex: 1 },
      { distanceMeters: 8000, elevationMeters: 2000, sourceSegmentIndex: 1 },
    ]);
    const settings = {
      ...dinSettings,
      ignoreRecordedTime: true,
      timeMarkers: true,
    };
    expect(planTrackClockTimes(route, {}, settings).finish).toBe('11:00');
    expect(
      planTrackMarkerTimes(route, {}, settings, [
        { id: 'first-leg-end', name: 'First leg end', coordinate: [44.04, 42] },
      ]).get('first-leg-end'),
    ).toBe('10:00');
    expect(
      planTrackWeatherTimeline(route, { distanceMeters: 8000 }, settings, 9),
    ).toMatchObject({ durationSeconds: 2 * hour });
  });
});

describe('planTrackClockTimes', () => {
  const settings = { ...dinSettings, startHour: 9.5 };

  it('labels the start, the finish, and every full hour strictly between them', () => {
    const times = planTrackClockTimes(ridgeProfile(), ridgeTotals, settings);

    expect(times.start).toBe('09:30');
    // The scaled estimate ends a hair off 5.5 h; the finish still reads 15:00, unlabelled.
    expect(times.finish).toBe('15:00');
    expect(times.hours.map((value) => value.time)).toEqual([
      '10:00',
      '11:00',
      '12:00',
      '13:00',
      '14:00',
    ]);
    // Half an hour into the climb: 1 km takes 0.5 h of ascent plus 0.125 h walking.
    expect(times.hours[0]?.coordinate[0]).toBeCloseTo(44 + 0.8 / 100, 9);
  });

  it('wraps past midnight on recorded time and ignores the forecast length limit', () => {
    const recorded = profile([
      { distanceMeters: 0, elevationMeters: 1_000, recordedAt: '2026-06-01T05:00:00Z' },
      {
        distanceMeters: 4_000,
        elevationMeters: 1_400,
        recordedAt: '2026-06-01T07:00:00Z',
      },
    ]);

    const times = planTrackClockTimes(
      recorded,
      { elapsedSeconds: 2 * hour },
      { ...dinSettings, startHour: 23 },
    );
    expect(times).toMatchObject({ start: '23:00', finish: '01:00' });
    expect(times.hours).toEqual([
      { coordinate: [expect.closeTo(44.02, 9) as number, 42], time: '00:00' },
    ]);

    // 5.5 h × 2.5 is past the 12-hour forecast limit; labels still cover it.
    const slow = planTrackClockTimes(ridgeProfile(), ridgeTotals, {
      ...dinSettings,
      startHour: 6,
      paceFactor: 2.5,
    });
    expect(slow.finish).toBe('19:45');
    expect(slow.hours).toHaveLength(13);
  });

  it('keeps hours in a recorded break between segments at the earlier segment end', () => {
    const overnight = profile([
      { distanceMeters: 0, elevationMeters: 1_000, recordedAt: '2026-06-01T05:00:00Z' },
      {
        distanceMeters: 2_000,
        elevationMeters: 1_000,
        recordedAt: '2026-06-01T06:00:00Z',
      },
      {
        distanceMeters: 3_000,
        elevationMeters: 1_000,
        recordedAt: '2026-06-01T09:00:00Z',
        sourceSegmentIndex: 1,
      },
      {
        distanceMeters: 5_000,
        elevationMeters: 1_000,
        recordedAt: '2026-06-01T10:00:00Z',
        sourceSegmentIndex: 1,
      },
    ]);

    const times = planTrackClockTimes(
      overnight,
      { elapsedSeconds: 5 * hour },
      { ...dinSettings, startHour: 8 },
    );
    expect(
      times.hours.map(({ coordinate, time }) => [time, coordinate[0].toFixed(2)]),
    ).toEqual([
      ['09:00', '44.02'],
      ['10:00', '44.02'],
      ['11:00', '44.02'],
      ['12:00', '44.03'],
    ]);
  });

  it('counts relative times from 00:00 at the start without wrapping past a day', () => {
    const relative = { ...settings, relativeTimeMarkers: true };
    const times = planTrackClockTimes(ridgeProfile(), ridgeTotals, relative);

    expect(times.start).toBe('00:00');
    expect(times.finish).toBe('05:30');
    expect(times.hours.map((value) => value.time)).toEqual([
      '01:00',
      '02:00',
      '03:00',
      '04:00',
      '05:00',
    ]);

    const long = planTrackClockTimes(ridgeProfile(), ridgeTotals, {
      ...relative,
      paceFactor: 5,
    });
    expect(long.finish).toBe('27:30');
    expect(long.hours.at(-1)?.time).toBe('27:00');
  });
});

describe('planTrackMarkerTimes', () => {
  const settings = { ...dinSettings, timeMarkers: true };

  function marker(id: string, coordinate: TrackCoordinate): TrackMarker {
    return { id, name: id, coordinate };
  }

  it('uses the nearest discrete geographic point, not a projected position on the line', () => {
    const route = profile([
      { distanceMeters: 0, elevationMeters: 1_000, coordinate: [0, 0] },
      { distanceMeters: 800, elevationMeters: 1_000, coordinate: [0.008, 0] },
    ]);
    const markers = [marker('near-finish', [0.005, 0.001])];
    const originalRoute = structuredClone(route);
    const originalMarkers = structuredClone(markers);

    // 800 m of flat walking at 4 km/h takes 12 minutes.
    expect(planTrackMarkerTimes(route, {}, settings, markers)).toEqual(
      new Map([['near-finish', '09:12']]),
    );
    expect(route).toEqual(originalRoute);
    expect(markers).toEqual(originalMarkers);
  });

  it('does not label a marker on the line when both discrete points are over 500 m away', () => {
    const route = profile([
      { distanceMeters: 0, elevationMeters: 1_000, coordinate: [0, 0] },
      { distanceMeters: 2_000, elevationMeters: 1_000, coordinate: [0.02, 0] },
    ]);

    expect(
      planTrackMarkerTimes(route, {}, settings, [
        marker('line-midpoint', [0.01, 0]),
        marker('near-start', [0.001, 0]),
      ]),
    ).toEqual(new Map([['near-start', '09:00']]));
  });

  it('includes exactly 500 m but excludes any distance greater than 500 m', () => {
    const route = profile([{ distanceMeters: 0, elevationMeters: 1_000 }]);
    const distance = vi.spyOn(trackCalculations, 'geodesicDistanceMeters');
    distance.mockReturnValueOnce(500).mockReturnValueOnce(500.001);
    try {
      expect(
        planTrackMarkerTimes(route, {}, settings, [
          marker('boundary', [44, 42]),
          marker('outside', [44, 42]),
        ]),
      ).toEqual(new Map([['boundary', '09:00']]));
    } finally {
      distance.mockRestore();
    }
  });

  it('keeps the first passage when equally near points revisit the same coordinate', () => {
    const route = profile([
      { distanceMeters: 0, elevationMeters: 1_000, coordinate: [44, 42] },
      { distanceMeters: 2_000, elevationMeters: 1_000, coordinate: [44.02, 42] },
      { distanceMeters: 4_000, elevationMeters: 1_000, coordinate: [44, 42] },
    ]);

    expect(
      planTrackMarkerTimes(route, {}, settings, [marker('revisited', [44, 42])]).get(
        'revisited',
      ),
    ).toBe('09:00');
  });

  it('uses the climbing estimate without recorded time and accepts inherited label settings', () => {
    expect(
      planTrackMarkerTimes(ridgeProfile(), {}, { ...settings, timeMarkers: null }, [
        marker('summit', [44.06, 42]),
      ]).get('summit'),
    ).toBe('12:45');
  });

  it('uses recorded point timestamps and applies ignored recording, pace, and start time', () => {
    const route = profile([
      { distanceMeters: 0, elevationMeters: 1_000, recordedAt: '2026-06-01T05:00:00Z' },
      {
        distanceMeters: 2_000,
        elevationMeters: 1_000,
        recordedAt: '2026-06-01T05:30:00Z',
      },
      {
        distanceMeters: 4_000,
        elevationMeters: 1_000,
        recordedAt: '2026-06-01T07:00:00Z',
      },
    ]);
    const markers = [marker('middle', [44.02, 42]), marker('finish', [44.04, 42])];
    // Recorded tracks store no estimate; 4 km and 300 m up make a 1.5 h DIN total.
    const metrics = { elapsedSeconds: 2 * hour, ascentMeters: 300, descentMeters: 0 };
    const timing = { ...settings, startHour: 23.5, paceFactor: 1.5 };

    expect(planTrackMarkerTimes(route, metrics, timing, markers)).toEqual(
      new Map([
        ['middle', '00:15'],
        ['finish', '02:30'],
      ]),
    );
    expect(
      planTrackMarkerTimes(
        route,
        metrics,
        { ...timing, ignoreRecordedTime: true },
        markers,
      ),
    ).toEqual(
      new Map([
        ['middle', '00:37'],
        ['finish', '01:45'],
      ]),
    );
  });

  it('keeps relative times beyond 24 hours and rounds point elapsed time to whole seconds', () => {
    const route = ridgeProfile();
    const markers = [marker('finish', [44.12, 42])];
    // A micrometre less ascent ends 5 × 5.5 h a fraction of a second before 27.5 h.
    const metrics = { ascentMeters: 900 - 0.000_001, descentMeters: 500 };

    expect(
      planTrackMarkerTimes(
        route,
        metrics,
        { ...settings, relativeTimeMarkers: true, startHour: 18, paceFactor: 5 },
        markers,
      ).get('finish'),
    ).toBe('27:30');
    expect(
      planTrackMarkerTimes(
        route,
        metrics,
        { ...settings, startHour: 18, paceFactor: 5 },
        markers,
      ).get('finish'),
    ).toBe('21:30');
  });

  it('returns no times when labels are off, or there are no markers or profile points', () => {
    const route = ridgeProfile();
    const markers = [marker('finish', [44.12, 42])];

    expect(
      planTrackMarkerTimes(route, {}, { ...settings, timeMarkers: false }, markers),
    ).toEqual(new Map());
    expect(planTrackMarkerTimes(route, {}, settings, [])).toEqual(new Map());
    expect(planTrackMarkerTimes(profile([]), {}, settings, markers)).toEqual(new Map());
  });
});

describe('per-track timeline settings', () => {
  const ridge = { ...defaultTrackRouteTiming, startHour: 7 };

  it('stores adjusted route timing only and reads it back with light coloring off', () => {
    const litRidge = { ...ridge, lightOnMap: true };
    expect(adjustedTrackRouteTiming(litRidge)).toEqual(ridge);
    expect(trackWeatherTimeline(ridge)).toEqual({ ...ridge, lightOnMap: false });
    expect(adjustedTrackRouteTiming(defaultTrackRouteTiming)).toBeNull();
    expect(trackWeatherTimeline(undefined)).toEqual(
      defaultTrackWeatherTimelineSettings,
    );
  });

  it('never stores light coloring on its own', () => {
    const lit = { ...defaultTrackWeatherTimelineSettings, lightOnMap: true };
    expect(adjustedTrackRouteTiming(lit)).toBeNull();
  });

  it('keeps an explicit time-marker choice even when it matches the default', () => {
    const hidden = { ...defaultTrackRouteTiming, timeMarkers: false };
    const shown = { ...defaultTrackRouteTiming, timeMarkers: true };

    expect(adjustedTrackRouteTiming(hidden)).toEqual(hidden);
    expect(adjustedTrackRouteTiming(shown)).toEqual(shown);
  });

  it('stores tracks that only ignore recorded time, count relative times, or pick a date', () => {
    for (const settings of [
      { ...defaultTrackRouteTiming, ignoreRecordedTime: true },
      { ...defaultTrackRouteTiming, relativeTimeMarkers: true },
      { ...defaultTrackRouteTiming, hikeDate: '2026-07-15' },
    ]) {
      expect(adjustedTrackRouteTiming(settings)).toEqual(settings);
    }
  });
});

describe('recorded route-start defaults', () => {
  /** A recorded start at a Tbilisi (UTC+4) clock time. */
  const tbilisiStart = (hours: number, minutes: number) => ({
    at: new Date(Date.UTC(2026, 6, 22, hours - 4, minutes)).toISOString(),
    timeZone: 'Asia/Tbilisi',
  });

  it.each([
    [8, 14, 8],
    [8, 15, 8.5],
    [8, 44, 8.5],
    [8, 45, 9],
    [23, 46, 0],
  ])(
    'rounds a recorded start at %i:%i on the route clock to %s hours',
    (hours, minutes, expected) => {
      expect(
        trackWeatherTimeline(undefined, tbilisiStart(hours, minutes)).startHour,
      ).toBe(expected);
    },
  );

  it('reads the recorded start on the route clock, not the browser one', () => {
    const instant = new Date(Date.UTC(2026, 6, 22, 2, 0)).toISOString();

    expect(
      trackWeatherTimeline(undefined, { at: instant, timeZone: 'Asia/Tbilisi' })
        .startHour,
    ).toBe(6);
    expect(
      trackWeatherTimeline(undefined, { at: instant, timeZone: 'America/New_York' })
        .startHour,
    ).toBe(22);
  });

  it('retains a manual 09:00 override instead of treating it as the recorded default', () => {
    const recordedStart = tbilisiStart(7, 16);
    const manual = adjustedTrackRouteTiming(defaultTrackRouteTiming, recordedStart);
    expect(manual).not.toBeNull();
    expect(trackWeatherTimeline(manual ?? undefined, recordedStart).startHour).toBe(9);
    expect(
      adjustedTrackRouteTiming(
        trackWeatherTimeline(undefined, recordedStart),
        recordedStart,
      ),
    ).toBeNull();
    expect(trackWeatherTimeline(undefined, recordedStart).startHour).toBe(7.5);
  });
});

describe('track weather dates', () => {
  it('offers seven local dates and opens the next preferred weekday', () => {
    const dates = trackWeatherDates('2026-07-28');

    expect(dates).toEqual([
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
    expect(defaultTrackWeatherDate(dates, 6)).toBe('2026-08-01');
    expect(defaultTrackWeatherDate(dates, 2)).toBe('2026-07-28');
    expect(trackWeatherWeekday('2026-08-02')).toBe(0);
    expect(() => trackWeatherDates('28.07.2026')).toThrow(RangeError);
  });

  it('places arrivals after the chosen local start, past midnight into the next date', () => {
    expect(trackWeatherLocalTime('2026-07-18', 9, 3.5 * hour)).toBe('2026-07-18T12:30');
    expect(trackWeatherLocalTime('2026-07-18', 9, 15 * hour)).toBe('2026-07-19T00:00');
    expect(trackWeatherLocalTime('2026-07-18', 22.5, 2 * hour)).toBe(
      '2026-07-19T00:30',
    );
  });
});

describe('summarizeTrackWeatherCheckpoint', () => {
  it('reads each window hour from the forecast at its own location', async () => {
    const forecast = await pointForecast();
    // Higher up the route, every hour is 10 °C colder.
    const higher = {
      ...forecast,
      hourly: forecast.hourly.map((value) => ({
        ...value,
        temperatureCelsius: value.temperatureCelsius - 10,
      })),
    };

    expect(
      summarizeTrackWeatherCheckpoint('2026-07-18', checkpoint([9, 10, 11]), [
        forecast,
        forecast,
        forecast,
      ]),
    ).toMatchObject({
      isDay: true,
      period: { temperatureMinCelsius: 9, temperatureMaxCelsius: 11 },
    });
    expect(
      summarizeTrackWeatherCheckpoint('2026-07-18', checkpoint([15, 16, 17, 18]), [
        higher,
        higher,
        forecast,
        forecast,
      ]),
    ).toMatchObject({
      period: { temperatureMinCelsius: 5, temperatureMaxCelsius: 18 },
    });
    expect(
      summarizeTrackWeatherCheckpoint('2026-07-18', checkpoint([21]), [forecast]),
    ).toMatchObject({ isDay: false, period: { temperatureMinCelsius: 21 } });
  });

  it('reads hours after midnight from the next date and needs every hour', async () => {
    const forecast = await pointForecast();
    const lateStart = checkpoint([22, 23, 24]);

    expect(
      summarizeTrackWeatherCheckpoint('2026-07-18', lateStart, [
        forecast,
        forecast,
        forecast,
      ]),
    ).toMatchObject({
      isDay: false,
      period: { temperatureMinCelsius: 0, temperatureMaxCelsius: 23 },
    });
    // On the forecast's last date the same hours run past its final hour.
    expect(
      summarizeTrackWeatherCheckpoint('2026-07-25', lateStart, [
        forecast,
        forecast,
        forecast,
      ]),
    ).toBeNull();
    expect(
      summarizeTrackWeatherCheckpoint('2026-07-30', checkpoint([9]), [forecast]),
    ).toBeNull();
  });
});
