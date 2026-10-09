import { describe, expect, it } from 'vitest';

import type { TrackPoint } from '@/domain/tracks/gpx';
import { reverseTrack } from '@/domain/tracks/reverseTrack';
import {
  calculateTrackMetrics,
  estimateHikingSeconds,
} from '@/domain/tracks/trackCalculations';

function point(
  longitude: number,
  elevationMeters?: number,
  recordedAt?: string,
): TrackPoint {
  const result: {
    coordinate: readonly [number, number];
    elevationMeters?: number;
    recordedAt?: string;
  } = { coordinate: [longitude, 0] };
  if (elevationMeters !== undefined) result.elevationMeters = elevationMeters;
  if (recordedAt !== undefined) result.recordedAt = recordedAt;
  return result;
}

function savedTrack(
  trackPoints: readonly (readonly TrackPoint[])[],
  calculatedTrackPoints?: readonly (readonly TrackPoint[])[],
) {
  const metrics = calculateTrackMetrics(trackPoints.map((points) => ({ points })));
  if (calculatedTrackPoints === undefined) {
    return { summary: { metrics }, content: { trackPoints } };
  }
  return {
    summary: {
      metrics,
      calculatedMetrics: calculateTrackMetrics(
        calculatedTrackPoints.map((points) => ({ points })),
        'dem-assisted',
      ),
    },
    content: { trackPoints, calculatedTrackPoints },
  };
}

describe('reverseTrack', () => {
  it('re-estimates a climbing track walked downhill and drops its recorded time', () => {
    const { summary, content } = savedTrack([
      [point(0, 100, '2026-01-01T08:00:00Z'), point(0.01, 400, '2026-01-01T09:00:00Z')],
      [
        point(0.02, 400, '2026-01-01T09:30:00Z'),
        point(0.03, 300, '2026-01-01T10:00:00Z'),
      ],
    ]);
    expect(summary.metrics.elapsedSeconds).toBe(7_200);

    const reversed = reverseTrack(summary, content);

    expect(reversed.trackPoints).toEqual([
      [point(0.03, 300), point(0.02, 400)],
      [point(0.01, 400), point(0, 100)],
    ]);
    expect(reversed.metrics.elapsedSeconds).toBeUndefined();
    expect(reversed.metrics.ascentMeters).toBe(summary.metrics.descentMeters);
    expect(reversed.metrics.descentMeters).toBe(summary.metrics.ascentMeters);
    expect(reversed.metrics.estimatedSeconds).toBe(
      estimateHikingSeconds(reversed.metrics.distanceMeters, 100, 300),
    );
  });

  it('keeps the recorded duration and pauses of a completely flat track', () => {
    const { summary, content } = savedTrack([
      [
        point(0, 50, '2026-01-01T08:00:00Z'),
        point(0.01, 50, '2026-01-01T08:10:00Z'),
        point(0.02, 50, '2026-01-01T08:40:00Z'),
      ],
    ]);

    const reversed = reverseTrack(summary, content);

    expect(reversed.trackPoints).toEqual([
      [
        point(0.02, 50, '2026-01-01T08:00:00.000Z'),
        point(0.01, 50, '2026-01-01T08:30:00.000Z'),
        point(0, 50, '2026-01-01T08:40:00.000Z'),
      ],
    ]);
    expect(reversed.metrics.elapsedSeconds).toBe(summary.metrics.elapsedSeconds);
    expect(reversed.metrics.estimatedSeconds).toBeUndefined();
  });

  it('drops recorded time when terrain shows a climb the source elevation lacks', () => {
    const { summary, content } = savedTrack(
      [[point(0, 50, '2026-01-01T08:00:00Z'), point(0.01, 50, '2026-01-01T09:00:00Z')]],
      [[point(0, 50), point(0.005, 150), point(0.01, 250)]],
    );
    expect(summary.metrics.ascentMeters).toBe(0);

    const reversed = reverseTrack(summary, content);

    expect(reversed.metrics.elapsedSeconds).toBeUndefined();
    expect(reversed.calculatedTrackPoints).toEqual([
      [point(0.01, 250), point(0.005, 150), point(0, 50)],
    ]);
    expect(reversed.calculatedMetrics?.elevationSource).toBe('dem-assisted');
    expect(reversed.calculatedMetrics?.descentMeters).toBe(200);
    expect(reversed.calculatedMetrics?.ascentMeters).toBe(0);
  });

  it('drops recorded time when no elevation proves the track flat', () => {
    const { summary, content } = savedTrack([
      [
        point(0, undefined, '2026-01-01T08:00:00Z'),
        point(0.01, undefined, '2026-01-01T09:00:00Z'),
      ],
    ]);

    const reversed = reverseTrack(summary, content);

    expect(reversed.trackPoints).toEqual([[point(0.01), point(0)]]);
    expect(reversed.metrics.elapsedSeconds).toBeUndefined();
  });
});
