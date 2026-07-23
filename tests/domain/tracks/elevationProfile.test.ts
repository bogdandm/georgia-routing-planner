import { describe, expect, it } from 'vitest';

import { calculateElevationProfile } from '@/domain/tracks/elevationProfile';

describe('calculateElevationProfile', () => {
  it('filters small elevation noise without removing geographic points', () => {
    const segments = [
      [
        { coordinate: [44, 42] as const, elevationMeters: 100 },
        { coordinate: [44.001, 42] as const, elevationMeters: 102 },
        { coordinate: [44.002, 42] as const, elevationMeters: 110 },
      ],
    ];

    const profile = calculateElevationProfile(segments, 3);

    expect(profile?.points).toHaveLength(3);
    expect(profile?.ascentMeters).toBe(10);
    expect(profile?.minimumMeters).toBe(100);
    expect(profile?.maximumMeters).toBe(110);
  });

  it('does not invent elevation changes across segment gaps', () => {
    const profile = calculateElevationProfile(
      [
        [
          { coordinate: [44, 42] as const, elevationMeters: 100 },
          { coordinate: [44.01, 42] as const, elevationMeters: 120 },
        ],
        [
          { coordinate: [45, 43] as const, elevationMeters: 500 },
          { coordinate: [45.01, 43] as const, elevationMeters: 510 },
        ],
      ],
      3,
    );

    expect(profile?.ascentMeters).toBe(30);
  });
});
