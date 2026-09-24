import { describe, expect, it } from 'vitest';

import { selectNearestForecastTimeIndex } from '@/domain/weather/selectNearestForecastTime';

describe('selectNearestForecastTimeIndex', () => {
  it('uses actual metadata timestamps when forecast intervals change', () => {
    const validTimes = [
      '2026-09-24T12:00Z',
      '2026-09-24T15:00Z',
      '2026-09-24T18:00Z',
      '2026-09-25T00:00Z',
      '2026-09-25T06:00Z',
    ];

    expect(
      selectNearestForecastTimeIndex(validTimes, new Date('2026-09-24T22:15:00Z')),
    ).toBe(3);
  });

  it('keeps the earlier metadata frame when a request is exactly between frames', () => {
    const validTimes = ['2026-09-24T12:00Z', '2026-09-24T18:00Z'];

    expect(
      selectNearestForecastTimeIndex(validTimes, new Date('2026-09-24T15:00:00Z')),
    ).toBe(0);
  });
});
