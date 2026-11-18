import { describe, expect, it } from 'vitest';

import { appColors } from '@/presentation/theme/appColors';
import {
  trackLightColor,
  trackLightMapSegments,
} from '@/presentation/tracks/trackLightColor';

function channels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function brightness(hex: string): number {
  const [red, green, blue] = channels(hex);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Each channel within `tolerance` of the expected color's. */
function expectNear(actual: string, expected: string, tolerance = 20): void {
  const target = channels(expected);
  for (const [index, value] of channels(actual).entries()) {
    expect(Math.abs(value - (target[index] ?? 0))).toBeLessThanOrEqual(tolerance);
  }
}

const open = { skyView: 1, groundElevationMeters: 0 };

describe('trackLightColor', () => {
  it('shows the legend colors for open ground in full sun and in shade', () => {
    // A 60° Sun is barely reddened by its 1.15 air masses.
    expectNear(
      trackLightColor({ ...open, sunlitFraction: 1, sunElevationDegrees: 60 }),
      appColors.trackLight.sun,
    );
    expectNear(
      trackLightColor({ ...open, sunlitFraction: 0, sunElevationDegrees: 60 }),
      appColors.trackLight.shade,
    );
  });

  it("darkens a gorge's shade below a boulder's", () => {
    const boulder = trackLightColor({
      ...open,
      skyView: 0.97,
      sunlitFraction: 0,
      sunElevationDegrees: 40,
    });
    const gorge = trackLightColor({
      ...open,
      skyView: 0.6,
      sunlitFraction: 0,
      sunElevationDegrees: 40,
    });

    expect(brightness(gorge)).toBeLessThan(brightness(boulder) - 25);
  });

  it('dims and reddens sunlight toward sunset', () => {
    const noon = trackLightColor({
      ...open,
      sunlitFraction: 1,
      sunElevationDegrees: 60,
    });
    const golden = trackLightColor({
      ...open,
      sunlitFraction: 1,
      sunElevationDegrees: 3,
    });

    expect(brightness(golden)).toBeLessThan(brightness(noon));
    const [noonRed, noonGreen] = channels(noon);
    const [goldenRed, goldenGreen] = channels(golden);
    expect(goldenGreen / goldenRed).toBeLessThan(noonGreen / noonRed);
  });

  it('fades through twilight to the night color', () => {
    const civilDusk = trackLightColor({
      ...open,
      sunlitFraction: 0,
      sunElevationDegrees: -2,
    });
    const civilEnd = trackLightColor({
      ...open,
      sunlitFraction: 0,
      sunElevationDegrees: -6,
    });

    expect(brightness(civilEnd)).toBeLessThan(brightness(civilDusk));
    expect(
      trackLightColor({ ...open, sunlitFraction: 0, sunElevationDegrees: -20 }),
    ).toBe(appColors.trackLight.dark.toLowerCase());
  });
});

describe('trackLightMapSegments', () => {
  const sample = (distanceMeters: number, sunlitFraction: number) => ({
    ...open,
    distanceMeters,
    elapsedSeconds: distanceMeters,
    sunlitFraction,
    sunElevationDegrees: 40,
  });
  const points = [0, 100, 200, 300, 400].map((distanceMeters) => ({
    distanceMeters,
    coordinate: [44 + distanceMeters / 100_000, 42] as const,
  }));
  const coordinates = (...indexes: number[]) =>
    indexes.map((index) => points[index]?.coordinate);

  it('colors each step by the light at its midpoint and joins equal neighbours', () => {
    const segments = trackLightMapSegments(points, [
      sample(0, 1),
      sample(200, 1),
      sample(400, 0),
    ]);

    expect(segments).toEqual([
      { coordinates: coordinates(0, 1, 2), color: trackLightColor(sample(0, 1)) },
      { coordinates: coordinates(2, 3), color: trackLightColor(sample(250, 0.75)) },
      { coordinates: coordinates(3, 4), color: trackLightColor(sample(350, 0.25)) },
    ]);
  });

  it('keeps the nearest light past either end of the samples', () => {
    const segments = trackLightMapSegments(points, [sample(150, 1), sample(250, 0)]);

    expect(segments.at(0)?.color).toBe(trackLightColor(sample(0, 1)));
    expect(segments.at(-1)?.color).toBe(trackLightColor(sample(0, 0)));
  });
});
