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
  it('keeps the even schedule frame count but packs whole minutes around sunrise and sunset', () => {
    const window = novemberWindow();
    const frames = daylightFrameInstants(window, 10);
    const evenCount =
      Math.ceil((window.lastMinuteMs - window.firstMinuteMs) / (10 * minute)) + 1;

    expect(frames[0]).toBe(window.firstMinuteMs);
    expect(frames.at(-1)).toBe(window.lastMinuteMs);
    expect(frames.length).toBeLessThanOrEqual(evenCount);
    expect(frames.length).toBeGreaterThanOrEqual(evenCount - 3);
    const steps = frames.slice(1).map((frame, index) => frame - (frames[index] ?? 0));
    for (const step of steps) {
      expect(step % minute).toBe(0);
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThanOrEqual(30 * minute);
    }
    // Every minute within a few minutes of either event is a frame.
    for (const event of [window.sunriseMs, window.sunsetMs]) {
      const eventMinute = Math.floor(event / minute) * minute;
      for (let offset = -3; offset <= 3; offset += 1) {
        expect(frames).toContain(eventMinute + offset * minute);
      }
    }
    // Midday moves in the longest steps.
    const noon = (window.sunriseMs + window.sunsetMs) / 2;
    const middayIndex = frames.findIndex((frame) => frame >= noon);
    expect(steps[middayIndex]).toBe(30 * minute);
  });

  it('shows every minute of a window shorter than the frame count needs', () => {
    const window: DaylightWindow = {
      sunriseMs: 10 * minute,
      sunsetMs: 15 * minute,
      firstMinuteMs: 9 * minute,
      lastMinuteMs: 13 * minute,
    };
    expect(daylightFrameInstants(window, 1)).toEqual(
      [9, 10, 11, 12, 13].map((m) => m * minute),
    );
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
