import { describe, expect, it } from 'vitest';

import {
  directSunlightColor,
  horizonAirMass,
  relativeOpticalAirMass,
} from '@/domain/terrain/atmosphericSunlight';
import { seaLevelHorizonDegrees } from '@/domain/terrain/terrainShadow';

describe('relativeOpticalAirMass', () => {
  it('is 1 for the zenith Sun at sea level and about 38 on the horizon', () => {
    expect(relativeOpticalAirMass(90, 0)).toBeCloseTo(1, 3);
    expect(horizonAirMass).toBeCloseTo(37.9, 1);
    expect(relativeOpticalAirMass(0, 0)).toBe(horizonAirMass);
  });

  it('gives summits less air than valleys under the same Sun', () => {
    expect(relativeOpticalAirMass(5, 5000)).toBeLessThan(
      relativeOpticalAirMass(5, 500) * 0.6,
    );
  });

  it('grows continuously below a summit level up to the horizontal air mass at sea level', () => {
    const summit = 5000;
    const limb = seaLevelHorizonDegrees(summit);

    expect(relativeOpticalAirMass(-1e-6, summit)).toBeCloseTo(
      relativeOpticalAirMass(0, summit),
      3,
    );
    expect(relativeOpticalAirMass(limb / 2, summit)).toBeGreaterThan(
      relativeOpticalAirMass(0, summit),
    );
    expect(relativeOpticalAirMass(limb, summit)).toBeCloseTo(horizonAirMass, 6);
  });
});

describe('directSunlightColor', () => {
  it('is white for the zenith Sun at sea level', () => {
    expect(directSunlightColor(1)).toEqual([1, 1, 1]);
  });

  it('turns from yellow through orange to red as the air mass grows', () => {
    const [, tenDegreesGreen, tenDegreesBlue] = directSunlightColor(
      relativeOpticalAirMass(10, 0),
    );
    const [, threeDegreesGreen, threeDegreesBlue] = directSunlightColor(
      relativeOpticalAirMass(3, 0),
    );
    const [horizonRed, horizonGreen, horizonBlue] = directSunlightColor(horizonAirMass);

    expect(tenDegreesGreen).toBeGreaterThan(0.8);
    expect(tenDegreesBlue).toBeGreaterThan(0.5);
    expect(threeDegreesGreen).toBeLessThan(tenDegreesGreen);
    expect(threeDegreesBlue).toBeLessThan(0.25);
    expect(horizonRed).toBe(1);
    expect(horizonGreen).toBeLessThan(0.3);
    expect(horizonBlue).toBeLessThan(0.01);
  });
});
