import { describe, expect, it } from 'vitest';

import {
  clampToDaylight,
  type DaylightWindow,
  daylightFrameInstants,
  daylightWindow,
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
});

describe('clampToDaylight', () => {
  const window = novemberWindow();
  const firstMinute = Math.ceil(window.sunriseMs / minute) * minute;
  const lastMinute = Math.floor(window.sunsetMs / minute) * minute;

  it('moves night instants to the nearest whole daylight minute', () => {
    expect(clampToDaylight(tbilisiTime(5, 0), window)).toBe(firstMinute);
    expect(clampToDaylight(tbilisiTime(20, 0), window)).toBe(lastMinute);
  });

  it('keeps daylight instants and instants without a window', () => {
    expect(clampToDaylight(tbilisiTime(12, 0), window)).toBe(tbilisiTime(12, 0));
    expect(clampToDaylight(tbilisiTime(23, 0), null)).toBe(tbilisiTime(23, 0));
  });
});

describe('daylightFrameInstants', () => {
  it('steps from the first to the last daylight minute without duplicates', () => {
    const window = novemberWindow();
    const frames = daylightFrameInstants(window, 10);

    expect(frames[0]).toBe(Math.ceil(window.sunriseMs / minute) * minute);
    expect(frames.at(-1)).toBe(Math.floor(window.sunsetMs / minute) * minute);
    expect(new Set(frames).size).toBe(frames.length);
    for (let index = 1; index < frames.length - 1; index += 1) {
      expect((frames[index] ?? 0) - (frames[index - 1] ?? 0)).toBe(10 * minute);
    }
    const lastStep = (frames.at(-1) ?? 0) - (frames.at(-2) ?? 0);
    expect(lastStep).toBeGreaterThan(0);
    expect(lastStep).toBeLessThanOrEqual(10 * minute);
  });
});
