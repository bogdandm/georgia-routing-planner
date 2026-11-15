import { describe, expect, it } from 'vitest';

import {
  atmosphericRefractionDegrees,
  solarDayEvents,
  solarPosition,
  subsolarPoint,
} from '@/domain/terrain/solarPosition';

const tbilisi = { latitude: 41.7151, longitude: 44.8271 };
const radiansToDegrees = 180 / Math.PI;

function minutesBetween(actual: Date | null, expectedIso: string): number {
  if (actual === null) throw new Error('Expected a solar event.');
  return Math.abs(actual.getTime() - Date.parse(expectedIso)) / 60_000;
}

describe('solar position', () => {
  it('matches the NREL SPA reference case within 0.05 degrees', () => {
    // Reda & Andreas (2004): topocentric zenith 50.11162° (with refraction), azimuth 194.34024°.
    const position = solarPosition(
      new Date('2003-10-17T19:30:30Z'),
      39.742476,
      -105.1786,
    );

    expect(Math.abs(90 - position.apparentElevationDegrees - 50.11162)).toBeLessThan(
      0.05,
    );
    expect(Math.abs(position.azimuthDegrees - 194.34024)).toBeLessThan(0.05);
  });

  it('puts the subsolar point on the equator at equinox and on the tropics at solstices', () => {
    const declinationAt = (iso: string) =>
      subsolarPoint(new Date(iso)).declinationRadians * radiansToDegrees;

    expect(Math.abs(declinationAt('2026-03-20T14:46:00Z'))).toBeLessThan(0.02);
    expect(declinationAt('2026-06-21T08:24:00Z')).toBeCloseTo(23.44, 1);
    expect(declinationAt('2026-12-21T20:50:00Z')).toBeCloseTo(-23.44, 1);
  });

  it('offsets the noon subsolar longitude from Greenwich by the equation of time', () => {
    // Early November the equation of time is about +16.4 min, so apparent noon at
    // Greenwich has already passed and the subsolar point is ~4.1° west at 12:00 UTC.
    const sun = subsolarPoint(new Date('2026-11-03T12:00:00Z'));

    expect(sun.longitudeRadians * radiansToDegrees).toBeCloseTo(-4.1, 1);
  });

  it('culminates due south of Tbilisi at the June solstice noon', () => {
    // NOAA spreadsheet algorithm: solar noon 09:02:29 UTC, elevation 71.72°.
    const position = solarPosition(
      new Date('2026-06-21T09:02:29Z'),
      tbilisi.latitude,
      tbilisi.longitude,
    );

    expect(position.elevationDegrees).toBeCloseTo(71.72, 1);
    expect(Math.abs(position.azimuthDegrees - 180)).toBeLessThan(0.1);
  });

  it('applies Sæmundsson refraction near the horizon and almost none near the zenith', () => {
    expect(atmosphericRefractionDegrees(0)).toBeCloseTo(0.483, 3);
    expect(Math.abs(atmosphericRefractionDegrees(89.9))).toBeLessThan(0.001);
    expect(atmosphericRefractionDegrees(-5)).toBe(atmosphericRefractionDegrees(-1));
  });
});

describe('solar day events', () => {
  it('finds Tbilisi sunrise and sunset within two minutes of the NOAA calculation', () => {
    // NOAA algorithm (zenith 90.833°): sunrise 01:26:11 UTC, sunset 16:38:48 UTC.
    const events = solarDayEvents(
      new Date('2026-06-20T20:00:00Z'),
      new Date('2026-06-21T20:00:00Z'),
      tbilisi.latitude,
      tbilisi.longitude,
    );

    expect(minutesBetween(events.sunrise, '2026-06-21T01:26:11Z')).toBeLessThan(2);
    expect(minutesBetween(events.sunset, '2026-06-21T16:38:48Z')).toBeLessThan(2);
  });

  it('finds the short Tbilisi winter day', () => {
    // NOAA algorithm: sunrise 04:24:17 UTC, sunset 13:33:07 UTC.
    const events = solarDayEvents(
      new Date('2026-12-20T20:00:00Z'),
      new Date('2026-12-21T20:00:00Z'),
      tbilisi.latitude,
      tbilisi.longitude,
    );

    expect(minutesBetween(events.sunrise, '2026-12-21T04:24:17Z')).toBeLessThan(2);
    expect(minutesBetween(events.sunset, '2026-12-21T13:33:07Z')).toBeLessThan(2);
  });

  it('ignores crossings outside the requested window', () => {
    const events = solarDayEvents(
      new Date('2026-06-21T03:00:00Z'),
      new Date('2026-06-21T12:00:00Z'),
      tbilisi.latitude,
      tbilisi.longitude,
    );

    expect(events).toEqual({ sunrise: null, sunset: null });
  });

  it('reports no events during the Longyearbyen polar night', () => {
    const events = solarDayEvents(
      new Date('2026-12-21T00:00:00Z'),
      new Date('2026-12-22T00:00:00Z'),
      78.2232,
      15.6267,
    );

    expect(events).toEqual({ sunrise: null, sunset: null });
  });
});
