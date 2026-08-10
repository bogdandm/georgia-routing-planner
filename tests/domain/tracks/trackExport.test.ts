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

  it('exports generated routes as one ordered GPX route', () => {
    const routeSummary: LocalTrackSummary = {
      ...summary,
      geometryKind: 'route',
      sourceFilename: 'Planned route.gpx',
      sourceFormat: 'gpx',
      pointCount: 3,
      segmentCount: 1,
    };
    const routeContent: LocalTrackContent = {
      ...content,
      trackPoints: [
        content.trackPoints[0] ?? [],
        [{ coordinate: [46, 44], elevationMeters: 120 }],
      ],
    };

    const gpx = exportTrackAsGpx(routeSummary, routeContent);

    expect(gpx).toContain('<rte><name>Ridge &lt;loop&gt;</name>');
    expect(gpx).toContain('<rtept lat="42" lon="44">');
    expect(gpx).not.toContain('<trk>');
    expect(gpx).not.toContain('<trkseg>');
    expect(gpx).not.toContain('<trkpt');
    expect(gpx.indexOf('lon="44"')).toBeLessThan(gpx.indexOf('lon="45"'));
    expect(gpx.indexOf('lon="45"')).toBeLessThan(gpx.indexOf('lon="46"'));
  });

  it('produces filesystem-safe names', () => {
    expect(safeTrackFilename('A/B:*?', 'gpx')).toBe('A-B---.gpx');
  });
});
