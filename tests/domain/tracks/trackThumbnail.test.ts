import { describe, expect, it } from 'vitest';

import type { TrackCoordinate } from '@/domain/tracks/gpx';
import { createTrackThumbnail } from '@/domain/tracks/trackThumbnail';

describe('createTrackThumbnail', () => {
  it('keeps only the corner of a long L-shaped segment', () => {
    const east = Array.from(
      { length: 501 },
      (_, index): TrackCoordinate => [44 + index * 0.00002, 42],
    );
    const north = Array.from(
      { length: 500 },
      (_, index): TrackCoordinate => [44.01, 42 + (index + 1) * 0.00002],
    );

    const thumbnail = createTrackThumbnail('local:l-shape', null, [[...east, ...north]]);

    expect(thumbnail.segments).toEqual([[east[0], east[500], north[499]]]);
    expect(thumbnail.loop).toBe(false);
  });

  it('keeps segments separate, drops empty ones, and preserves single points', () => {
    const thumbnail = createTrackThumbnail('local:segments', null, [
      [
        [44, 42],
        [44.01, 42],
      ],
      [],
      [[44.02, 42.01]],
    ]);

    expect(thumbnail.segments).toEqual([
      [
        [44, 42],
        [44.01, 42],
      ],
      [[44.02, 42.01]],
    ]);
  });

  it('keeps only the endpoints of a track without extent', () => {
    const thumbnail = createTrackThumbnail('local:still', null, [
      [
        [44, 42],
        [44, 42],
        [44, 42],
      ],
    ]);

    expect(thumbnail.segments).toEqual([
      [
        [44, 42],
        [44, 42],
      ],
    ]);
    expect(thumbnail.loop).toBe(false);
  });

  it('marks a closed track as a loop and records its source identity', () => {
    const square: readonly TrackCoordinate[] = [
      [44, 42],
      [44.01, 42],
      [44.01, 42.01],
      [44, 42.01],
      [44, 42.0005],
    ];

    expect(createTrackThumbnail('local:loop', 'a'.repeat(64), [square])).toEqual({
      trackId: 'local:loop',
      contentHash: 'a'.repeat(64),
      algorithmVersion: 1,
      loop: true,
      segments: [square],
    });
  });
});
