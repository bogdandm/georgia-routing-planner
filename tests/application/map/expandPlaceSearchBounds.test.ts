import { describe, expect, it } from 'vitest';

import {
  expandPlaceSearchBounds,
  largerPlaceSearchSideKm,
  limitPlaceSearchBounds,
  maximumPlaceSearchSideKm,
} from '@/application/map/expandPlaceSearchBounds';

describe('expandPlaceSearchBounds', () => {
  it('doubles a viewport-centred area while it remains below the limit', () => {
    const initial = { west: 44.7, south: 41.6, east: 44.9, north: 41.8 };

    const expanded = expandPlaceSearchBounds(initial);

    expect(expanded?.west).toBeCloseTo(44.6);
    expect(expanded?.south).toBeCloseTo(41.5);
    expect(expanded?.east).toBeCloseTo(45);
    expect(expanded?.north).toBeCloseTo(41.9);
    expect(largerPlaceSearchSideKm(expanded ?? initial)).toBeCloseTo(
      largerPlaceSearchSideKm(initial) * 2,
      0,
    );
  });

  it('caps the larger side at the 500 km radius and does not expand it again', () => {
    let bounds = { west: 44.7, south: 41.6, east: 44.9, north: 41.8 };
    let expanded = expandPlaceSearchBounds(bounds);
    while (expanded !== null) {
      bounds = expanded;
      expanded = expandPlaceSearchBounds(bounds);
    }

    expect(largerPlaceSearchSideKm(bounds)).toBeCloseTo(maximumPlaceSearchSideKm, 0);
  });

  it('terminates when floating-point scaling lands just below the cap', () => {
    const almostCapped = {
      west: 44.7,
      south: 37.503_402_677_979_12,
      east: 44.8,
      north: 46.496_597_322_020_88,
    };

    expect(largerPlaceSearchSideKm(almostCapped)).toBeLessThan(
      maximumPlaceSearchSideKm,
    );
    expect(expandPlaceSearchBounds(almostCapped)).toBeNull();
  });

  it('scales an oversized initial viewport down to the radius cap', () => {
    const limited = limitPlaceSearchBounds({
      west: 35,
      south: 35,
      east: 55,
      north: 50,
    });

    expect(largerPlaceSearchSideKm(limited)).toBeCloseTo(maximumPlaceSearchSideKm, 0);
  });

  it('rejects zero-size and non-finite areas', () => {
    expect(
      expandPlaceSearchBounds({ west: 44.8, south: 41.7, east: 44.8, north: 41.7 }),
    ).toBeNull();
    expect(
      expandPlaceSearchBounds({
        west: Number.NaN,
        south: 41.7,
        east: 44.8,
        north: 41.8,
      }),
    ).toBeNull();
  });

  it('terminates when coordinate clamping prevents meaningful growth', () => {
    expect(
      expandPlaceSearchBounds({ west: -180, south: 0, east: 180, north: 0 }),
    ).toBeNull();
  });
});
