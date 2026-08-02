import { describe, expect, it } from 'vitest';

import {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
  type LocalTrackSummary,
} from '@/domain/tracks/localTrack';
import {
  exportTrackAsGpx,
  exportTrackAsKml,
  safeTrackFilename,
} from '@/domain/tracks/trackExport';

const summary: LocalTrackSummary = {
  schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
  id: 'local:1',
  name: 'Ridge <loop>',
  normalizedName: 'ridge <loop>',
  savedAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  sourceFilename: 'source.fit',
  sourceFormat: 'fit' as const,
  favorite: false,
  geometryKind: 'track' as const,
  pointCount: 2,
  segmentCount: 1,
  metrics: {
    distanceMeters: 1,
    distanceAlgorithmVersion: 1 as const,
    startCoordinate: [44, 42] as const,
    endCoordinate: [45, 43] as const,
    bounds: {
      west: 44,
      south: 42,
      east: 45,
      north: 43,
      crossesAntimeridian: false,
    },
    center: [44.5, 42.5] as const,
  },
  metadata: { version: '1.1' as const, links: [] },
  warnings: [],
};
const content: LocalTrackContent = {
  schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
  trackId: 'local:1',
  trackPoints: [
    [
      {
        coordinate: [44, 42] as const,
        elevationMeters: 100,
        recordedAt: '2026-07-01T10:00:00.000Z',
      },
      { coordinate: [45, 43] as const, elevationMeters: 110 },
    ],
  ],
};

describe('track export', () => {
  it('preserves points and names without exporting descriptions', () => {
    const gpx = exportTrackAsGpx(summary, content);
    const kml = exportTrackAsKml(summary, content);

    expect(gpx).toContain('<name>Ridge &lt;loop&gt;</name>');
    expect(gpx).toContain('creator="Trail Planner"');
    expect(gpx).not.toContain('<desc>');
    expect(gpx).toContain('<ele>100</ele>');
    expect(gpx).toContain('<time>2026-07-01T10:00:00.000Z</time>');
    expect(kml).not.toContain('<description>');
    expect(kml).toContain('44,42,100 45,43,110');
  });

  it('produces filesystem-safe names', () => {
    expect(safeTrackFilename('A/B:*?', 'gpx')).toBe('A-B---.gpx');
  });
});
