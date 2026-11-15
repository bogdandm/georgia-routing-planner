import { describe, expect, it, vi } from 'vitest';

import type {
  HourlyWeatherForecast,
  WeatherForecastData,
  WeatherForecastGateway,
} from '@/application/ports/WeatherForecastGateway';
import { GetPointWeatherForecast } from '@/application/weather/GetPointWeatherForecast';
import {
  defaultTrackWeatherDate,
  defaultTrackWeatherPreferences,
  planTrackClockTimes,
  planTrackWeatherTimeline,
  selectTrackElevationLocations,
  summarizeTrackWeatherCheckpoint,
  trackWeatherDates,
  trackWeatherLocalTime,
  trackWeatherTimeline,
  trackWeatherWeekday,
  withTrackWeatherTimeline,
  type TrackWeatherCheckpoint,
} from '@/application/weather/TrackWeatherForecast';
import type {
  ElevationProfile,
  ElevationProfilePoint,
} from '@/domain/tracks/elevationProfile';

const hour = 3_600;

function profile(
  samples: readonly {
    readonly distanceMeters: number;
    readonly elevationMeters: number;
    readonly recordedAt?: string;
    readonly sourceSegmentIndex?: number;
  }[],
): ElevationProfile {
  const points = samples.map((sample, index): ElevationProfilePoint => {
    const point: ElevationProfilePoint = {
      coordinate: [44 + sample.distanceMeters / 100_000, 42],
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

function checkpoint(
  elapsedSeconds: number,
  untilElapsedSeconds: number,
): TrackWeatherCheckpoint {
  return {
    kind: 'interval',
    coordinate: [44.8, 41.7],
    elevationMeters: 2_000,
    distanceMeters: 0,
    elapsedSeconds,
    untilElapsedSeconds,
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
    const timeline = planTrackWeatherTimeline(ridgeProfile(), {
      distanceMeters: 12_000,
      estimatedSeconds: 5.5 * hour,
    });

    expect(timeline.status).toBe('available');
    if (timeline.status !== 'available') return;
    expect(timeline.durationSource).toBe('estimated');
    expect(timeline.durationSeconds).toBeCloseTo(5.5 * hour, 6);
    expect(
      timeline.checkpoints.map(({ kind, elapsedSeconds, untilElapsedSeconds }) => ({
        kind,
        elapsedSeconds,
        untilElapsedSeconds,
      })),
    ).toEqual([
      { kind: 'start', elapsedSeconds: 0, untilElapsedSeconds: 3 * hour },
      {
        kind: 'interval',
        elapsedSeconds: 3 * hour,
        untilElapsedSeconds: expect.closeTo(5.5 * hour, 6) as number,
      },
      {
        kind: 'finish',
        elapsedSeconds: expect.closeTo(5.5 * hour, 6) as number,
        untilElapsedSeconds: expect.closeTo(5.5 * hour, 6) as number,
      },
    ]);
    // On the climb 1 km takes 0.5 h of ascent plus half of 0.25 h walking: 3 h is 4.8 km.
    expect(timeline.checkpoints[1]?.distanceMeters).toBeCloseTo(4_800, 6);
    expect(timeline.checkpoints[1]?.elevationMeters).toBeCloseTo(2_720, 6);
    expect(timeline.checkpoints[0]?.elevationMeters).toBe(2_000);
    expect(timeline.checkpoints[2]?.distanceMeters).toBe(12_000);
  });

  it('scales the profile pace to the stored track estimate', () => {
    const timeline = planTrackWeatherTimeline(ridgeProfile(), {
      distanceMeters: 12_000,
      estimatedSeconds: 4.4 * hour,
    });

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

    const timeline = planTrackWeatherTimeline(recorded, {
      distanceMeters: 8_000,
      elapsedSeconds: 4.5 * hour,
    });

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

  it('falls back to the estimate when a profile sample has no timestamp', () => {
    const partial = profile([
      { distanceMeters: 0, elevationMeters: 1_000, recordedAt: '2026-06-01T05:00:00Z' },
      { distanceMeters: 4_000, elevationMeters: 1_000 },
    ]);

    expect(
      planTrackWeatherTimeline(partial, {
        distanceMeters: 4_000,
        elapsedSeconds: 3_600,
      }),
    ).toMatchObject({ status: 'available', durationSource: 'estimated' });
  });

  it('is unavailable for tracks of 30 km or 12 hours and longer', () => {
    expect(
      planTrackWeatherTimeline(ridgeProfile(), {
        distanceMeters: 30_000,
        estimatedSeconds: 5.5 * hour,
      }),
    ).toMatchObject({ status: 'too-long', distanceMeters: 30_000 });
    expect(
      planTrackWeatherTimeline(ridgeProfile(), {
        distanceMeters: 12_000,
        estimatedSeconds: 12 * hour,
      }),
    ).toMatchObject({ status: 'too-long', durationSeconds: 12 * hour });
    expect(
      planTrackWeatherTimeline(ridgeProfile(), {
        distanceMeters: 12_000,
        estimatedSeconds: 11.5 * hour,
      }),
    ).toMatchObject({ status: 'available' });
  });

  it('stretches or compresses the timeline by the pace factor', () => {
    const metrics = { distanceMeters: 12_000, estimatedSeconds: 5.5 * hour };

    const faster = planTrackWeatherTimeline(ridgeProfile(), metrics, 0.5);
    expect(faster).toMatchObject({ status: 'available' });
    if (faster.status !== 'available') return;
    expect(faster.durationSeconds).toBeCloseTo(2.75 * hour, 6);
    expect(faster.checkpoints.map((value) => value.kind)).toEqual(['start', 'finish']);
    // Slowed beyond the day-hike limit: 5.5 h × 2.2 = 12.1 h.
    expect(planTrackWeatherTimeline(ridgeProfile(), metrics, 2.2)).toMatchObject({
      status: 'too-long',
    });
  });
});

describe('planTrackClockTimes', () => {
  const settings = { startHour: 9.5, paceFactor: 1, timeMarkers: null };

  it('labels the start, the finish, and every full hour strictly between them', () => {
    const times = planTrackClockTimes(
      ridgeProfile(),
      { estimatedSeconds: 5.5 * hour },
      settings,
    );

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
      { startHour: 23, paceFactor: 1, timeMarkers: null },
    );
    expect(times).toMatchObject({ start: '23:00', finish: '01:00' });
    expect(times.hours).toEqual([
      { coordinate: [expect.closeTo(44.02, 9) as number, 42], time: '00:00' },
    ]);

    // 5.5 h × 2.5 is past the 12-hour forecast limit; labels still cover it.
    const slow = planTrackClockTimes(
      ridgeProfile(),
      { estimatedSeconds: 5.5 * hour },
      { startHour: 6, paceFactor: 2.5, timeMarkers: null },
    );
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
      { startHour: 8, paceFactor: 1, timeMarkers: null },
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
});

describe('per-track timeline settings', () => {
  const other = { startHour: 6, paceFactor: 1.5, timeMarkers: null };

  it('stores adjusted tracks only and keeps other tracks', () => {
    const adjusted = withTrackWeatherTimeline(
      { ...defaultTrackWeatherPreferences, timelines: { 'local:other': other } },
      'local:ridge',
      { startHour: 7, paceFactor: 1, timeMarkers: null },
    );
    expect(adjusted.timelines).toEqual({
      'local:other': other,
      'local:ridge': { startHour: 7, paceFactor: 1, timeMarkers: null },
    });
    expect(trackWeatherTimeline(adjusted, 'local:ridge')).toEqual({
      startHour: 7,
      paceFactor: 1,
      timeMarkers: null,
    });

    const reset = { startHour: 9, paceFactor: 1, timeMarkers: null };
    expect(withTrackWeatherTimeline(adjusted, 'local:ridge', reset).timelines).toEqual({
      'local:other': other,
    });
    expect(withTrackWeatherTimeline(adjusted, 'local:ridge', null).timelines).toEqual({
      'local:other': other,
    });
    expect(trackWeatherTimeline(null, 'local:ridge')).toEqual(reset);
  });

  it('keeps an explicit time-marker choice even when it matches the default', () => {
    const hidden = { startHour: 9, paceFactor: 1, timeMarkers: false };
    const shown = { startHour: 9, paceFactor: 1, timeMarkers: true };

    expect(
      withTrackWeatherTimeline(defaultTrackWeatherPreferences, 'local:ridge', hidden)
        .timelines,
    ).toEqual({ 'local:ridge': hidden });
    expect(
      withTrackWeatherTimeline(defaultTrackWeatherPreferences, 'local:ridge', shown)
        .timelines,
    ).toEqual({ 'local:ridge': shown });
  });

  it('treats prototype-named track IDs as ordinary entries', () => {
    expect(trackWeatherTimeline(defaultTrackWeatherPreferences, 'constructor')).toEqual(
      {
        startHour: 9,
        paceFactor: 1,
        timeMarkers: null,
      },
    );
    const stored = withTrackWeatherTimeline(
      defaultTrackWeatherPreferences,
      '__proto__',
      other,
    );
    expect(Object.keys(stored.timelines)).toEqual(['__proto__']);
    expect(trackWeatherTimeline(stored, '__proto__')).toEqual(other);
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
  it('summarizes the hours until the next checkpoint at the checkpoint location', async () => {
    const forecast = await pointForecast();

    expect(
      summarizeTrackWeatherCheckpoint(
        forecast,
        '2026-07-18',
        9,
        checkpoint(0, 3 * hour),
      ),
    ).toMatchObject({
      isDay: true,
      period: { temperatureMinCelsius: 9, temperatureMaxCelsius: 11 },
    });
    // An arrival at 13:47 still covers the 13:00 hour.
    const arrival = 4 * hour + 47 * 60;
    expect(
      summarizeTrackWeatherCheckpoint(
        forecast,
        '2026-07-18',
        9,
        checkpoint(arrival, arrival),
      ),
    ).toMatchObject({
      period: { temperatureMinCelsius: 13, temperatureMaxCelsius: 13 },
    });
    expect(
      summarizeTrackWeatherCheckpoint(
        forecast,
        '2026-07-18',
        9,
        checkpoint(12 * hour, 13 * hour),
      ),
    ).toMatchObject({ isDay: false, period: { temperatureMinCelsius: 21 } });
    // A 22:30 start covers 22:00–01:00, reading the next date's hours after midnight.
    expect(
      summarizeTrackWeatherCheckpoint(
        forecast,
        '2026-07-18',
        22.5,
        checkpoint(0, 3 * hour),
      ),
    ).toMatchObject({
      isDay: false,
      period: { temperatureMinCelsius: 0, temperatureMaxCelsius: 23 },
    });
    // On the forecast's last date the same start runs past its final hour.
    expect(
      summarizeTrackWeatherCheckpoint(
        forecast,
        '2026-07-25',
        22.5,
        checkpoint(0, 3 * hour),
      ),
    ).toBeNull();
    expect(
      summarizeTrackWeatherCheckpoint(
        forecast,
        '2026-07-30',
        9,
        checkpoint(0, 3 * hour),
      ),
    ).toBeNull();
  });
});
