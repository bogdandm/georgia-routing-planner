import type { TrackPoint } from '@/domain/tracks/gpx';
import type { LocalTrackContent, LocalTrackSummary } from '@/domain/tracks/localTrack';
import {
  calculateTrackMetrics,
  type TrackMetrics,
} from '@/domain/tracks/trackCalculations';

type TrackPoints = readonly (readonly TrackPoint[])[];

export interface ReversedTrack {
  readonly trackPoints: TrackPoints;
  readonly calculatedTrackPoints?: TrackPoints;
  readonly metrics: TrackMetrics;
  readonly calculatedMetrics?: TrackMetrics;
}

/** Flat only when some elevation is known and every known gain and loss is zero. */
function isCompletelyFlat(
  summary: Pick<LocalTrackSummary, 'metrics' | 'calculatedMetrics'>,
): boolean {
  const known = [summary.metrics, summary.calculatedMetrics].filter(
    (metrics): metrics is TrackMetrics =>
      metrics?.ascentMeters !== undefined && metrics.descentMeters !== undefined,
  );
  return (
    known.length > 0 &&
    known.every((metrics) => metrics.ascentMeters === 0 && metrics.descentMeters === 0)
  );
}

/**
 * Reverses the walking direction of a saved track: segment order and point order flip,
 * and metrics are recalculated, so gain and loss swap and the DIN 33466 estimate follows.
 * Recorded time only carries over on a completely flat track, where direction cannot
 * change it: timestamps mirror around the recording window, preserving the duration and
 * pauses. On any other track the timestamps are dropped, so the time is re-estimated.
 */
export function reverseTrack(
  summary: Pick<LocalTrackSummary, 'metrics' | 'calculatedMetrics'>,
  content: Pick<LocalTrackContent, 'trackPoints' | 'calculatedTrackPoints'>,
): ReversedTrack {
  const firstTime = content.trackPoints[0]?.[0]?.recordedAt;
  const lastTime = content.trackPoints.at(-1)?.at(-1)?.recordedAt;
  const mirrorTimeSum =
    summary.metrics.elapsedSeconds !== undefined &&
    firstTime !== undefined &&
    lastTime !== undefined &&
    isCompletelyFlat(summary)
      ? Date.parse(firstTime) + Date.parse(lastTime)
      : undefined;

  const reversePoint = (point: TrackPoint): TrackPoint => {
    const reversed: { -readonly [Key in keyof TrackPoint]: TrackPoint[Key] } = {
      coordinate: point.coordinate,
    };
    if (point.elevationMeters !== undefined) {
      reversed.elevationMeters = point.elevationMeters;
    }
    if (mirrorTimeSum !== undefined && point.recordedAt !== undefined) {
      reversed.recordedAt = new Date(
        mirrorTimeSum - Date.parse(point.recordedAt),
      ).toISOString();
    }
    return reversed;
  };
  const reversePoints = (trackPoints: TrackPoints): TrackPoints =>
    trackPoints.toReversed().map((segment) => segment.toReversed().map(reversePoint));
  const segmentsOf = (trackPoints: TrackPoints) =>
    trackPoints.map((points) => ({ points }));

  const trackPoints = reversePoints(content.trackPoints);
  const result: { -readonly [Key in keyof ReversedTrack]: ReversedTrack[Key] } = {
    trackPoints,
    metrics: calculateTrackMetrics(
      segmentsOf(trackPoints),
      summary.metrics.elevationSource ?? 'gpx',
    ),
  };
  if (content.calculatedTrackPoints !== undefined) {
    result.calculatedTrackPoints = reversePoints(content.calculatedTrackPoints);
    result.calculatedMetrics = calculateTrackMetrics(
      segmentsOf(result.calculatedTrackPoints),
      'dem-assisted',
    );
  }
  return result;
}
