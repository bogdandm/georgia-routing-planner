import { describe, expect, it } from 'vitest';

import {
  aggregateDailyWeatherStatus,
  type DailyWeatherHour,
  type Precipitation,
  type Sky,
  type Visibility,
} from '@/domain/weather/aggregateDailyWeatherStatus';

function hour(overrides: Partial<DailyWeatherHour> = {}): DailyWeatherHour {
  return {
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

function rain(
  precipitationMm: number,
  overrides: Partial<DailyWeatherHour> = {},
): DailyWeatherHour {
  return hour({
    precipitationMm,
    rainMm: precipitationMm,
    precipitationType: 1,
    ...overrides,
  });
}

describe('aggregateDailyWeatherStatus', () => {
  it('ignores night precipitation and averages sky over dry daylight hours', () => {
    const status = aggregateDailyWeatherStatus([
      rain(20, { isDay: false, cloudCoverPercent: 100, visibilityMeters: 300 }),
      hour({ cloudCoverPercent: 10 }),
      hour({ cloudCoverPercent: 20 }),
    ]);

    expect(status).toMatchObject({
      sky: 'clear',
      precipitation: 'none',
      visibility: 'normal',
      label: 'Clear',
      debug: {
        daylightHours: 2,
        wetHours: 0,
        precipTotal: 0,
        meanCloudCover: 15,
      },
    });
  });

  it('keeps a one-hour shower over its dry mostly-clear background', () => {
    const status = aggregateDailyWeatherStatus([
      hour({ cloudCoverPercent: 30 }),
      hour({
        precipitationMm: 1,
        rainMm: 1,
        showersMm: 1,
        precipitationType: 1,
        cloudCoverPercent: 100,
      }),
    ]);

    expect(status).toMatchObject({
      sky: 'mostly_clear',
      precipitation: 'showers',
      label: 'Mostly clear with showers',
      debug: {
        wetHours: 1,
        wetFraction: 0.5,
        precipTotal: 1,
        showersTotal: 1,
        longestWetRun: 1,
        meanCloudCover: 30,
        showerRatio: 1,
      },
    });
  });

  it('suppresses one trace wet hour before phase classification', () => {
    const status = aggregateDailyWeatherStatus([
      hour({
        precipitationMm: 0.1,
        snowfallCm: 0.1,
        precipitationType: 6,
      }),
      hour(),
    ]);

    expect(status).toMatchObject({
      precipitation: 'none',
      label: 'Clear',
      debug: { wetHours: 1, precipTotal: 0.1, mixedHours: 1, snowTypeHours: 1 },
    });
  });

  it('gives any meaningful freezing phase priority', () => {
    const status = aggregateDailyWeatherStatus([
      rain(2),
      hour({ precipitationMm: 0.1, precipitationType: 12 }),
      hour(),
      hour(),
    ]);

    expect(status).toMatchObject({
      precipitation: 'freezing',
      label: 'Freezing precipitation',
      debug: { freezingHours: 1, wetHours: 2 },
    });
  });

  it('classifies mixed precipitation at the exact quarter boundary', () => {
    const status = aggregateDailyWeatherStatus([
      rain(1),
      rain(1),
      rain(1),
      hour({ precipitationMm: 1, precipitationType: 7 }),
    ]);

    expect(status).toMatchObject({
      precipitation: 'mixed',
      label: 'Rain and snow',
      debug: { wetHours: 4, mixedHours: 1 },
    });
  });

  it.each([
    {
      name: 'intermittent snow at both boundaries',
      hours: [
        hour({ precipitationMm: 1, snowfallCm: 1, precipitationType: 5 }),
        hour(),
        hour(),
        hour(),
      ],
      precipitation: 'snow_showers',
      label: 'Snow showers',
      wetFraction: 0.25,
      longestWetRun: 1,
    },
    {
      name: 'persistent snow above the wet-fraction boundary',
      hours: [
        hour({ precipitationMm: 1, snowfallCm: 1, precipitationType: 5 }),
        hour({ precipitationMm: 1, snowfallCm: 1, precipitationType: 5 }),
        hour(),
        hour(),
      ],
      precipitation: 'snow',
      label: 'Snow',
      wetFraction: 0.5,
      longestWetRun: 2,
    },
  ])('$name', ({ hours, precipitation, label, wetFraction, longestWetRun }) => {
    const status = aggregateDailyWeatherStatus(hours);

    expect(status).toMatchObject({
      precipitation,
      label,
      debug: { wetFraction, longestWetRun },
    });
  });

  it.each([
    {
      name: 'shower ratio equals 0.4 and wet fraction equals 0.5',
      hours: [rain(1, { showersMm: 0.4 }), rain(1, { showersMm: 0.4 }), hour(), hour()],
      expected: 'showers',
    },
    {
      name: 'short wet run permits showers above half-day wet fraction',
      hours: [
        rain(1, { showersMm: 0.4 }),
        rain(1, { showersMm: 0.4 }),
        hour(),
        rain(1, { showersMm: 0.4 }),
      ],
      expected: 'showers',
    },
    {
      name: 'persistent low-ratio precipitation remains rain',
      hours: [rain(1), rain(1), rain(1), hour()],
      expected: 'rain',
    },
  ])('$name', ({ hours, expected }) => {
    expect(aggregateDailyWeatherStatus(hours).precipitation).toBe(expected);
  });

  it.each([
    {
      name: 'light rain below both strict thresholds',
      hours: [rain(0.4), rain(0.4), hour()],
      precipitation: 'light_rain',
    },
    {
      name: 'ordinary rain at the total boundary',
      hours: [rain(0.5), rain(0.5), hour()],
      precipitation: 'rain',
    },
    {
      name: 'heavy rain at the hourly boundary',
      hours: [rain(4), hour()],
      precipitation: 'heavy_rain',
    },
    {
      name: 'heavy rain at the daily-total boundary',
      hours: [rain(3), rain(3), rain(3), rain(3)],
      precipitation: 'heavy_rain',
    },
  ])('$name', ({ hours, precipitation }) => {
    expect(aggregateDailyWeatherStatus(hours).precipitation).toBe(precipitation);
  });

  it.each([
    {
      name: 'fog at the quarter-day fraction boundary',
      hours: [hour({ visibilityMeters: 999 }), hour(), hour(), hour()],
      visibility: 'fog',
      debug: { fogFraction: 0.25, longestFogRun: 1 },
    },
    {
      name: 'fog from a two-hour run below the fraction boundary',
      hours: [
        hour({ weatherCode: 45 }),
        hour({ weatherCode: 48 }),
        hour(),
        hour(),
        hour(),
        hour(),
        hour(),
        hour(),
        hour(),
        hour(),
      ],
      visibility: 'fog',
      debug: { fogFraction: 0.2, longestFogRun: 2 },
    },
    {
      name: 'poor visibility from median',
      hours: [hour({ visibilityMeters: 4_999 }), hour({ visibilityMeters: 4_999 })],
      visibility: 'poor',
      debug: { medianVisibility: 4_999 },
    },
    {
      name: 'poor visibility from fraction below five kilometres',
      hours: [
        hour({ visibilityMeters: 4_999 }),
        hour({ visibilityMeters: 20_000 }),
        hour({ visibilityMeters: 20_000 }),
      ],
      visibility: 'poor',
      debug: { fractionBelow5km: 1 / 3 },
    },
    {
      name: 'dry haze from the dry non-fog median',
      hours: [hour({ visibilityMeters: 9_000 }), hour({ visibilityMeters: 11_000 })],
      visibility: 'haze',
      debug: { hazeMedianVisibility: 10_000, hazeFraction: 0.5 },
    },
    {
      name: 'wet low visibility does not become haze',
      hours: [rain(1, { visibilityMeters: 8_000 }), hour(), hour()],
      visibility: 'normal',
      debug: { hazeMedianVisibility: 20_000, hazeFraction: 0 },
    },
  ])('$name', ({ hours, visibility, debug }) => {
    expect(aggregateDailyWeatherStatus(hours)).toMatchObject({ visibility, debug });
  });

  it.each<{
    name: string;
    hours: readonly DailyWeatherHour[];
    sky: Sky;
    precipitation: Precipitation;
    visibility: Visibility;
    label: string;
  }>([
    {
      name: 'clear',
      hours: [hour({ cloudCoverPercent: 20 })],
      sky: 'clear',
      precipitation: 'none',
      visibility: 'normal',
      label: 'Clear',
    },
    {
      name: 'mostly clear',
      hours: [hour({ cloudCoverPercent: 40 })],
      sky: 'mostly_clear',
      precipitation: 'none',
      visibility: 'normal',
      label: 'Mostly clear',
    },
    {
      name: 'partly cloudy',
      hours: [hour({ cloudCoverPercent: 65 })],
      sky: 'partly_cloudy',
      precipitation: 'none',
      visibility: 'normal',
      label: 'Partly cloudy',
    },
    {
      name: 'mostly cloudy',
      hours: [hour({ cloudCoverPercent: 85 })],
      sky: 'mostly_cloudy',
      precipitation: 'none',
      visibility: 'normal',
      label: 'Mostly cloudy',
    },
    {
      name: 'overcast',
      hours: [hour({ cloudCoverPercent: 86 })],
      sky: 'overcast',
      precipitation: 'none',
      visibility: 'normal',
      label: 'Overcast',
    },
    {
      name: 'clear showers',
      hours: [
        rain(1, { showersMm: 1, cloudCoverPercent: 20 }),
        hour({ cloudCoverPercent: 20 }),
      ],
      sky: 'clear',
      precipitation: 'showers',
      visibility: 'normal',
      label: 'Clear with showers',
    },
    {
      name: 'mostly clear showers',
      hours: [rain(1, { showersMm: 1 }), hour({ cloudCoverPercent: 40 })],
      sky: 'mostly_clear',
      precipitation: 'showers',
      visibility: 'normal',
      label: 'Mostly clear with showers',
    },
    {
      name: 'partly cloudy showers',
      hours: [rain(1, { showersMm: 1 }), hour({ cloudCoverPercent: 65 })],
      sky: 'partly_cloudy',
      precipitation: 'showers',
      visibility: 'normal',
      label: 'Partly cloudy with showers',
    },
    {
      name: 'mostly cloudy showers',
      hours: [rain(1, { showersMm: 1 }), hour({ cloudCoverPercent: 85 })],
      sky: 'mostly_cloudy',
      precipitation: 'showers',
      visibility: 'normal',
      label: 'Mostly cloudy with showers',
    },
    {
      name: 'overcast showers',
      hours: [rain(1, { showersMm: 1 }), hour({ cloudCoverPercent: 86 })],
      sky: 'overcast',
      precipitation: 'showers',
      visibility: 'normal',
      label: 'Overcast with showers',
    },
    {
      name: 'light rain',
      hours: [rain(0.4), rain(0.4), hour()],
      sky: 'clear',
      precipitation: 'light_rain',
      visibility: 'normal',
      label: 'Light rain',
    },
    {
      name: 'rain with sunny intervals',
      hours: [rain(1), hour({ cloudCoverPercent: 65 })],
      sky: 'partly_cloudy',
      precipitation: 'rain',
      visibility: 'normal',
      label: 'Rain with sunny intervals',
    },
    {
      name: 'overcast with rain',
      hours: [rain(1), hour({ cloudCoverPercent: 86 })],
      sky: 'overcast',
      precipitation: 'rain',
      visibility: 'normal',
      label: 'Overcast with rain',
    },
    {
      name: 'heavy rain',
      hours: [rain(4), hour()],
      sky: 'clear',
      precipitation: 'heavy_rain',
      visibility: 'normal',
      label: 'Heavy rain',
    },
    {
      name: 'snow showers',
      hours: [
        hour({ precipitationMm: 1, snowfallCm: 1, precipitationType: 5 }),
        hour(),
        hour(),
        hour(),
      ],
      sky: 'clear',
      precipitation: 'snow_showers',
      visibility: 'normal',
      label: 'Snow showers',
    },
    {
      name: 'cloudy snow showers',
      hours: [
        hour({ precipitationMm: 1, snowfallCm: 1, precipitationType: 5 }),
        hour({ cloudCoverPercent: 86 }),
        hour({ cloudCoverPercent: 86 }),
        hour({ cloudCoverPercent: 86 }),
      ],
      sky: 'overcast',
      precipitation: 'snow_showers',
      visibility: 'normal',
      label: 'Mostly cloudy with snow showers',
    },
    {
      name: 'persistent snow',
      hours: [
        hour({ precipitationMm: 1, snowfallCm: 1, precipitationType: 5 }),
        hour({ precipitationMm: 1, snowfallCm: 1, precipitationType: 5 }),
        hour(),
        hour(),
      ],
      sky: 'clear',
      precipitation: 'snow',
      visibility: 'normal',
      label: 'Snow',
    },
    {
      name: 'rain and snow',
      hours: [
        rain(1),
        hour({ precipitationMm: 1, precipitationType: 7 }),
        rain(1),
        rain(1),
      ],
      sky: 'clear',
      precipitation: 'mixed',
      visibility: 'normal',
      label: 'Rain and snow',
    },
    {
      name: 'freezing precipitation',
      hours: [hour({ precipitationMm: 1, precipitationType: 3 })],
      sky: 'clear',
      precipitation: 'freezing',
      visibility: 'normal',
      label: 'Freezing precipitation',
    },
    {
      name: 'dry fog replacement',
      hours: [hour({ weatherCode: 45 }), hour({ weatherCode: 45 })],
      sky: 'clear',
      precipitation: 'none',
      visibility: 'fog',
      label: 'Fog',
    },
    {
      name: 'wet fog suffix',
      hours: [rain(1, { weatherCode: 45 }), hour({ weatherCode: 45 })],
      sky: 'clear',
      precipitation: 'rain',
      visibility: 'fog',
      label: 'Rain with sunny intervals · Fog',
    },
    {
      name: 'poor visibility suffix',
      hours: [hour({ visibilityMeters: 4_000 }), hour({ visibilityMeters: 6_000 })],
      sky: 'clear',
      precipitation: 'none',
      visibility: 'poor',
      label: 'Clear · Poor visibility',
    },
    {
      name: 'haze suffix',
      hours: [hour({ visibilityMeters: 9_000 }), hour({ visibilityMeters: 12_000 })],
      sky: 'clear',
      precipitation: 'none',
      visibility: 'haze',
      label: 'Clear · Haze',
    },
  ])(
    '$name label and dimensions stay aligned',
    ({ hours, sky, precipitation, visibility, label }) => {
      const status = aggregateDailyWeatherStatus(hours);

      expect(status).toMatchObject({
        sky,
        precipitation,
        visibility,
        label,
        icon: {
          sky,
          phenomenon: precipitation === 'none' ? null : precipitation,
          visibility: visibility === 'normal' ? null : visibility,
        },
      });
    },
  );

  it('rejects a day without daylight instead of fabricating status', () => {
    expect(() => aggregateDailyWeatherStatus([hour({ isDay: false })])).toThrow(
      'requires at least one daylight hour',
    );
  });
});
