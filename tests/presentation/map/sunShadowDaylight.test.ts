import { describe, expect, it } from 'vitest';

import {
  clampToDaylight,
  type DaylightWindow,
  daylightFrameInstants,
  daylightWindow,
  sunlitNow,
} from '@/presentation/map/sunShadowDaylight';

const minute = 60_000;
const tchkhutkharo = { latitude: 42.71, longitude: 43.14 };
// Tbilisi is UTC+4 all year.
const tbilisiTime = (hour: number, minutes: number) =>
  Date.UTC(2026, 10, 15, hour - 4, minutes);

function novemberWindow(): DaylightWindow {
  const window = daylightWindow(tbilisiTime(13, 40), tchkhutkharo, 'Asia/Tbilisi');
  if (window === null) throw new Error('The Caucasus has a sunrise and sunset.');
  return window;
}

describe('daylightWindow', () => {
  it('finds the local sunrise and sunset of the day containing the instant', () => {
    for (const instant of [
      tbilisiTime(0, 5),
      tbilisiTime(13, 40),
      tbilisiTime(23, 55),
    ]) {
      const window = daylightWindow(instant, tchkhutkharo, 'Asia/Tbilisi');
      expect(
        Math.abs((window?.sunriseMs ?? 0) - tbilisiTime(7, 58)),
      ).toBeLessThanOrEqual(minute);
      expect(
        Math.abs((window?.sunsetMs ?? 0) - tbilisiTime(17, 45)),
      ).toBeLessThanOrEqual(minute);
    }
  });

  it('reports no window during polar night', () => {
    expect(
      daylightWindow(
        Date.UTC(2026, 11, 21, 12),
        { latitude: 78.2, longitude: 15.6 },
        'UTC',
      ),
    ).toBeNull();
  });

  it('keeps the two-hour margin inside the local calendar day', () => {
    // Helsinki midsummer: sunset near 22:50, so sunset + 2 h would pass midnight.
    const window = daylightWindow(
      Date.UTC(2026, 5, 21, 9),
      { latitude: 60.17, longitude: 24.94 },
      'Europe/Helsinki',
    );

    expect(window?.lastMinuteMs).toBe(Date.UTC(2026, 5, 21, 20, 59));
    expect(window?.firstMinuteMs).toBe(
      Math.ceil((window?.sunriseMs ?? 0) / minute) * minute - 120 * minute,
    );
  });
});

describe('clampToDaylight', () => {
  const window = novemberWindow();
  const firstMinute = Math.ceil(window.sunriseMs / minute) * minute - 120 * minute;
  const lastMinute = Math.floor(window.sunsetMs / minute) * minute + 120 * minute;

  it('moves night instants to two hours before sunrise or after sunset', () => {
    expect(clampToDaylight(tbilisiTime(3, 0), window)).toBe(firstMinute);
    expect(clampToDaylight(tbilisiTime(22, 0), window)).toBe(lastMinute);
  });

  it('keeps instants within two hours of daylight and instants without a window', () => {
    expect(clampToDaylight(tbilisiTime(6, 30), window)).toBe(tbilisiTime(6, 30));
    expect(clampToDaylight(tbilisiTime(19, 0), window)).toBe(tbilisiTime(19, 0));
    expect(clampToDaylight(tbilisiTime(23, 0), null)).toBe(tbilisiTime(23, 0));
  });
});

describe('daylightFrameInstants', () => {
  it('steps from two hours before sunrise to two hours after sunset without duplicates', () => {
    const window = novemberWindow();
    const frames = daylightFrameInstants(window, 10);

    expect(frames[0]).toBe(
      Math.ceil(window.sunriseMs / minute) * minute - 120 * minute,
    );
    expect(frames.at(-1)).toBe(
      Math.floor(window.sunsetMs / minute) * minute + 120 * minute,
    );
    expect(new Set(frames).size).toBe(frames.length);
    for (let index = 1; index < frames.length - 1; index += 1) {
      expect((frames[index] ?? 0) - (frames[index - 1] ?? 0)).toBe(10 * minute);
    }
    const lastStep = (frames.at(-1) ?? 0) - (frames.at(-2) ?? 0);
    expect(lastStep).toBeGreaterThan(0);
    expect(lastStep).toBeLessThanOrEqual(10 * minute);
  });
});

describe('sunlitNow', () => {
  it('keeps a current time while the Sun is up', () => {
    expect(sunlitNow(tbilisiTime(13, 40), tchkhutkharo, 'Asia/Tbilisi')).toBe(
      tbilisiTime(13, 40),
    );
  });

  it('replaces a dark current time with 11:00 of the same local day', () => {
    expect(sunlitNow(tbilisiTime(22, 30), tchkhutkharo, 'Asia/Tbilisi')).toBe(
      tbilisiTime(11, 0),
    );
    expect(sunlitNow(tbilisiTime(3, 15), tchkhutkharo, 'Asia/Tbilisi')).toBe(
      tbilisiTime(11, 0),
    );
    // Twilight still counts as dark: the Sun is below the horizon.
    expect(sunlitNow(tbilisiTime(18, 0), tchkhutkharo, 'Asia/Tbilisi')).toBe(
      tbilisiTime(11, 0),
    );
  });

  it('keeps the current time on a day without sunrise and sunset', () => {
    const polarNight = Date.UTC(2026, 11, 21, 12);
    expect(sunlitNow(polarNight, { latitude: 78.2, longitude: 15.6 }, 'UTC')).toBe(
      polarNight,
    );
  });
});
