import { describe, expect, it } from 'vitest';

import {
  instantToZonedWallTime,
  timeZoneOffsetMinutes,
  zonedWallTimeToInstant,
} from '@/domain/time/zonedWallTime';

describe('zoned wall time', () => {
  it('reads Tbilisi wall time at a fixed +4 offset in every season', () => {
    const summer = new Date('2026-06-21T20:15:42Z');
    const winter = new Date('2026-12-21T22:05:00Z');

    expect(instantToZonedWallTime(summer, 'Asia/Tbilisi')).toEqual({
      year: 2026,
      month: 6,
      day: 22,
      hour: 0,
      minute: 15,
    });
    expect(timeZoneOffsetMinutes(summer, 'Asia/Tbilisi')).toBe(240);
    expect(timeZoneOffsetMinutes(winter, 'Asia/Tbilisi')).toBe(240);
  });

  it('round-trips Tbilisi wall times to the same instant', () => {
    const wall = { year: 2026, month: 1, day: 1, hour: 3, minute: 7 };

    const instant = zonedWallTimeToInstant(wall, 'Asia/Tbilisi');

    expect(instant.toISOString()).toBe('2025-12-31T23:07:00.000Z');
    expect(instantToZonedWallTime(instant, 'Asia/Tbilisi')).toEqual(wall);
  });

  it('moves a wall time skipped by the spring transition forward by the gap', () => {
    const instant = zonedWallTimeToInstant(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
      'Europe/Berlin',
    );

    expect(instant.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(instantToZonedWallTime(instant, 'Europe/Berlin')).toEqual({
      year: 2026,
      month: 3,
      day: 29,
      hour: 3,
      minute: 30,
    });
  });

  it('resolves a wall time repeated by the autumn transition to the earlier instant', () => {
    const instant = zonedWallTimeToInstant(
      { year: 2026, month: 10, day: 25, hour: 2, minute: 30 },
      'Europe/Berlin',
    );

    expect(instant.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(timeZoneOffsetMinutes(instant, 'Europe/Berlin')).toBe(120);
  });
});
