import { describe, expect, it } from 'vitest';

import {
  aggregateWeatherPeriodStatus,
  type WeatherPeriodHour,
  type Precipitation,
  type Sky,
} from '@/domain/weather/aggregateWeatherPeriodStatus';

function hour(overrides: Partial<WeatherPeriodHour> = {}): WeatherPeriodHour {
  return {
    time: '2026-07-18T12:00',
    precipitationMm: 0,
    rainMm: 0,
    showersMm: 0,
    snowfallCm: 0,
    precipitationType: 0,
    weatherCode: 0,
    cloudCoverPercent: 10,
    visibilityMeters: 20_000,
    isDay: true,
    ...overrides,
  };
}

function repeat(count: number, overrides: Partial<WeatherPeriodHour> = {}) {
  return Array.from({ length: count }, () => hour(overrides));
}

function rain(
  precipitationMm: number,
  overrides: Partial<WeatherPeriodHour> = {},
): WeatherPeriodHour {
  return hour({
    precipitationMm,
    rainMm: precipitationMm,
    precipitationType: 1,
    ...overrides,
  });
}

function shower(precipitationMm = 1): WeatherPeriodHour {
  return rain(precipitationMm, { showersMm: precipitationMm });
}

function snow(precipitationMm = 1): WeatherPeriodHour {
  return hour({ precipitationMm, snowfallCm: precipitationMm, precipitationType: 5 });
}

function expectPrimary(
  hours: readonly WeatherPeriodHour[],
  expected: {
    readonly sky: Sky;
    readonly precipitation: Precipitation;
    readonly label: string;
  },
) {
  expect(aggregateWeatherPeriodStatus(hours).primary).toMatchObject(expected);
}

describe('aggregateWeatherPeriodStatus', () => {
  it('aggregates every hourly sample supplied for one period', () => {
    const status = aggregateWeatherPeriodStatus([
      rain(20, { isDay: false, cloudCoverPercent: 100, visibilityMeters: 100 }),
      hour({ cloudCoverPercent: 20 }),
      hour({ cloudCoverPercent: 40 }),
      hour({ cloudCoverPercent: 65 }),
      hour({ cloudCoverPercent: 85 }),
      hour({ cloudCoverPercent: 86 }),
    ]);

    expect(status).toMatchObject({
      primary: {
        sky: 'partly_cloudy',
        precipitation: 'occasional_rain',
        label: 'Partly cloudy with occasional rain',
      },
      visibility: { level: 'normal', period: 'none', label: null, icon: null },
      debug: {
        periodHours: 6,
        wetHours: 1,
        precipTotal: 20,
        clearFraction: 0.2,
        mostlyClearFraction: 0.2,
        partlyCloudyFraction: 0.2,
        mostlyCloudyFraction: 0.2,
        overcastFraction: 0.2,
        sunnyFraction: 0.4,
        cloudyFraction: 0.4,
        clearishFraction: 0.5,
        meanCloudCover: 59.2,
      },
    });
  });

  it.each([
    {
      name: 'nine clear and three overcast hours remain mostly clear',
      hours: [...repeat(9), ...repeat(3, { cloudCoverPercent: 100 })],
      expected: 'mostly_clear',
    },
    {
      name: 'eight clear, two partly cloudy, and two overcast hours remain mostly clear',
      hours: [
        ...repeat(8),
        ...repeat(2, { cloudCoverPercent: 60 }),
        ...repeat(2, { cloudCoverPercent: 100 }),
      ],
      expected: 'mostly_clear',
    },
    {
      name: 'six clear and six overcast hours are partly cloudy',
      hours: [...repeat(6), ...repeat(6, { cloudCoverPercent: 100 })],
      expected: 'partly_cloudy',
    },
    {
      name: 'seven clear and five overcast hours are partly cloudy',
      hours: [...repeat(7), ...repeat(5, { cloudCoverPercent: 100 })],
      expected: 'partly_cloudy',
    },
    {
      name: 'three clear and nine mostly-cloudy hours are mostly cloudy',
      hours: [...repeat(3), ...repeat(9, { cloudCoverPercent: 75 })],
      expected: 'mostly_cloudy',
    },
    {
      name: 'two clear and ten overcast hours are overcast',
      hours: [...repeat(2), ...repeat(10, { cloudCoverPercent: 100 })],
      expected: 'overcast',
    },
  ])('$name', ({ hours, expected }) => {
    expect(aggregateWeatherPeriodStatus(hours).primary.sky).toBe(expected);
  });

  it('excludes meaningful precipitation hours from the background sky distribution', () => {
    const status = aggregateWeatherPeriodStatus([...repeat(11), shower(1)]);

    expect(status.primary).toMatchObject({
      sky: 'clear',
      precipitation: 'isolated_showers',
      label: 'Clear with isolated showers',
    });
    expect(status.debug).toMatchObject({
      clearFraction: 1,
      meanCloudCover: 10,
      wetHours: 1,
      wetFraction: 1 / 12,
    });
  });

  it('uses all daylight hours for sky when every daylight hour is wet', () => {
    expectPrimary(
      repeat(4, {
        precipitationMm: 1,
        rainMm: 1,
        precipitationType: 1,
        cloudCoverPercent: 100,
      }),
      { sky: 'overcast', precipitation: 'rain', label: 'Rain' },
    );
  });

  it.each<{
    name: string;
    hours: readonly WeatherPeriodHour[];
    precipitation: Precipitation;
    label: string;
  }>([
    {
      name: 'an insignificant one-hour trace stays dry',
      hours: [rain(0.1), ...repeat(11)],
      precipitation: 'none',
      label: 'Clear',
    },
    {
      name: 'one shower is isolated',
      hours: [shower(), ...repeat(11)],
      precipitation: 'isolated_showers',
      label: 'Clear with isolated showers',
    },
    {
      name: 'three intermittent showers are showers',
      hours: [shower(), hour(), shower(), hour(), shower(), ...repeat(7)],
      precipitation: 'showers',
      label: 'Clear with showers',
    },
    {
      name: 'two short stratiform rain hours are occasional rain',
      hours: [rain(1), rain(1), ...repeat(10)],
      precipitation: 'occasional_rain',
      label: 'Mostly clear with occasional rain',
    },
    {
      name: 'persistent rain remains rain',
      hours: [...Array.from({ length: 8 }, () => rain(1)), ...repeat(4)],
      precipitation: 'rain',
      label: 'Rain with sunny intervals',
    },
    {
      name: 'persistent heavy rain remains heavy rain',
      hours: [...Array.from({ length: 8 }, () => rain(2)), ...repeat(4)],
      precipitation: 'heavy_rain',
      label: 'Heavy rain',
    },
    {
      name: 'one snow hour is a snow shower',
      hours: [snow(), ...repeat(11)],
      precipitation: 'snow_showers',
      label: 'Snow showers',
    },
    {
      name: 'two short snow hours are occasional snow',
      hours: [snow(), snow(), ...repeat(6)],
      precipitation: 'occasional_snow',
      label: 'Occasional snow',
    },
    {
      name: 'persistent snow remains snow',
      hours: [snow(), snow(), snow(), snow(), ...repeat(8)],
      precipitation: 'snow',
      label: 'Snow',
    },
    {
      name: 'mixed rain and snow is explicit',
      hours: [
        rain(1),
        rain(1),
        rain(1),
        hour({ precipitationMm: 1, precipitationType: 7 }),
      ],
      precipitation: 'mixed',
      label: 'Rain and snow',
    },
    {
      name: 'freezing precipitation retains priority',
      hours: [
        rain(2),
        hour({ precipitationMm: 0.1, precipitationType: 12 }),
        hour(),
        hour(),
      ],
      precipitation: 'freezing',
      label: 'Freezing precipitation',
    },
  ])('$name', ({ hours, precipitation, label }) => {
    expect(aggregateWeatherPeriodStatus(hours).primary).toMatchObject({
      precipitation,
      label,
    });
  });

  it.each([
    {
      sky: 'clear' as const,
      hours: [rain(1), rain(1), ...repeat(10, { cloudCoverPercent: 10 })],
      label: 'Mostly clear with occasional rain',
    },
    {
      sky: 'partly_cloudy' as const,
      hours: [rain(1), rain(1), ...repeat(10, { cloudCoverPercent: 55 })],
      label: 'Partly cloudy with occasional rain',
    },
    {
      sky: 'mostly_cloudy' as const,
      hours: [rain(1), rain(1), ...repeat(10, { cloudCoverPercent: 75 })],
      label: 'Mostly cloudy with occasional rain',
    },
    {
      sky: 'overcast' as const,
      hours: [rain(1), rain(1), ...repeat(10, { cloudCoverPercent: 95 })],
      label: 'Overcast with occasional rain',
    },
  ])('composes occasional rain with $sky background', ({ hours, label }) => {
    expect(aggregateWeatherPeriodStatus(hours).primary.label).toBe(label);
  });

  it('keeps two early foggy hours secondary to the dominant sky', () => {
    const status = aggregateWeatherPeriodStatus([
      hour({
        time: '2026-07-18T07:00',
        cloudCoverPercent: 100,
        visibilityMeters: 200,
      }),
      hour({
        time: '2026-07-18T08:00',
        cloudCoverPercent: 100,
        visibilityMeters: 200,
      }),
      ...repeat(10),
    ]);

    expect(status.primary).toEqual({
      sky: 'mostly_clear',
      precipitation: 'none',
      label: 'Mostly clear',
      icon: { sky: 'mostly_clear', phenomenon: null },
    });
    expect(status.visibility).toEqual({
      level: 'fog',
      period: 'morning',
      label: 'Morning fog',
      icon: 'fog',
    });
    expect(status.debug.visibility.fog).toEqual({
      affectedHours: 2,
      affectedFraction: 1 / 6,
      longestAffectedRun: 2,
      firstAffectedHour: '2026-07-18T07:00',
      lastAffectedHour: '2026-07-18T08:00',
    });
    expect(status.primary.icon).not.toHaveProperty('visibility');
  });

  it('does not report one isolated low-visibility hour', () => {
    const status = aggregateWeatherPeriodStatus([
      hour({ weatherCode: 45, visibilityMeters: 20_000 }),
      ...repeat(11),
    ]);

    expect(status.visibility).toEqual({
      level: 'normal',
      period: 'none',
      label: null,
      icon: null,
    });
    expect(status.primary.label).toBe('Clear');
  });

  it.each([
    {
      name: 'poor visibility in the afternoon',
      hours: [...repeat(4), ...repeat(3, { visibilityMeters: 4_000 }), ...repeat(5)],
      expected: {
        level: 'poor',
        period: 'afternoon',
        label: 'Poor visibility in the afternoon',
        icon: 'poor',
      },
    },
    {
      name: 'intermittent fog',
      hours: [
        hour(),
        ...repeat(2, { visibilityMeters: 500 }),
        ...repeat(5),
        ...repeat(2, { visibilityMeters: 500 }),
        ...repeat(2),
      ],
      expected: {
        level: 'fog',
        period: 'intermittent',
        label: 'Intermittent fog',
        icon: 'fog',
      },
    },
    {
      name: 'reduced visibility for most of the day',
      hours: [...repeat(8, { visibilityMeters: 6_000 }), ...repeat(4)],
      expected: {
        level: 'haze',
        period: 'most_of_period',
        label: 'Reduced visibility for most of the day',
        icon: 'haze',
      },
    },
    {
      name: 'evening reduced visibility',
      hours: [...repeat(8), ...repeat(4, { visibilityMeters: 6_000 })],
      expected: {
        level: 'haze',
        period: 'evening',
        label: 'Reduced visibility in the evening',
        icon: 'haze',
      },
    },
  ])('$name remains secondary', ({ hours, expected }) => {
    const status = aggregateWeatherPeriodStatus(hours);

    expect(status.visibility).toEqual(expected);
    expect(status.primary).toMatchObject({
      sky: 'clear',
      precipitation: 'none',
      label: 'Clear',
    });
  });

  it('keeps overnight visibility secondary to the night primary status', () => {
    const status = aggregateWeatherPeriodStatus(
      [...repeat(4), ...repeat(4, { visibilityMeters: 500 }), ...repeat(4)],
      'night',
    );

    expect(status.primary).toMatchObject({
      sky: 'clear',
      precipitation: 'none',
      label: 'Clear',
    });
    expect(status.visibility).toEqual({
      level: 'fog',
      period: 'overnight',
      label: 'Fog overnight',
      icon: 'fog',
    });
  });

  it('selects the most severe significant visibility level', () => {
    const status = aggregateWeatherPeriodStatus([
      ...repeat(2, { visibilityMeters: 500 }),
      ...repeat(6, { visibilityMeters: 4_000 }),
      ...repeat(4),
    ]);

    expect(status.visibility).toMatchObject({ level: 'fog', label: 'Morning fog' });
    expect(status.debug.visibility).toMatchObject({
      fog: { affectedHours: 2, longestAffectedRun: 2 },
      poor: { affectedHours: 6, longestAffectedRun: 6 },
      haze: { affectedHours: 0, longestAffectedRun: 0 },
    });
  });

  it('uses exact visibility severity boundaries without changing primary weather', () => {
    const status = aggregateWeatherPeriodStatus([
      ...repeat(2, { visibilityMeters: 1_000 }),
      ...repeat(2, { visibilityMeters: 5_000 }),
      ...repeat(2, { visibilityMeters: 10_000 }),
      ...repeat(6),
    ]);

    expect(status.primary.label).toBe('Clear');
    expect(status.debug.visibility).toMatchObject({
      fog: { affectedHours: 0 },
      poor: { affectedHours: 2 },
      haze: { affectedHours: 2 },
    });
    expect(status.visibility.level).toBe('poor');
  });

  it('rejects an empty period instead of fabricating status', () => {
    expect(() => aggregateWeatherPeriodStatus([])).toThrow(
      'requires at least one hourly sample',
    );
  });
});
