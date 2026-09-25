import { describe, expect, it } from 'vitest';

import {
  weatherCloudCoverColorScale,
  weatherCloudLegendStops,
  weatherPrecipitationColorScale,
  weatherPrecipitationLegendStops,
} from '@/presentation/weather/weatherMapStyle';

describe('weather map style', () => {
  it('keeps sub-30% clouds transparent and starts visible cover at 31%', () => {
    expect(weatherCloudCoverColorScale.breakpoints.slice(0, 3)).toEqual([0, 30, 31]);
    expect(weatherCloudCoverColorScale.colors.slice(0, 3)).toEqual([
      [66, 72, 78, 0],
      [66, 72, 78, 0],
      [224, 224, 224, 0.3],
    ]);
    expect(weatherCloudCoverColorScale.colors.at(-1)).toEqual([128, 128, 128, 1]);
    expect(weatherCloudLegendStops.map(({ value }) => value)).toContain(31);
    expect(weatherCloudLegendStops.map(({ value }) => value)).toContain(100);
  });

  it('keeps precipitation below 0.5 mm transparent and shares its visible scale with the legend', () => {
    expect(weatherPrecipitationColorScale.breakpoints).toEqual([
      0, 0.5, 1.5, 2, 3, 7, 10, 20, 30,
    ]);
    expect(weatherPrecipitationColorScale.colors[0]?.[3]).toBe(0);
    expect(weatherPrecipitationColorScale.colors[1]?.[3]).toBe(0);
    expect(weatherPrecipitationColorScale.colors[2]?.[3]).toBeGreaterThan(0);
    expect(weatherPrecipitationLegendStops.map(({ value }) => value)).toEqual([
      0.5, 1.5, 2, 3, 7, 10, 20, 30,
    ]);
  });
});
