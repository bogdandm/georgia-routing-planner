import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
  type LocalTrackSummary,
} from '@/domain/tracks/localTrack';
import { parseGpx } from '@/domain/tracks/gpx';
import {
  exportTrackAsGpx,
  exportTrackAsKml,
  exportTracksAsZip,
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

  it('exports generated routes as segmented GPX tracks for downstream compatibility', () => {
    const routeSummary: LocalTrackSummary = {
      ...summary,
      geometryKind: 'route',
      sourceFilename: 'Planned route.gpx',
      sourceFormat: 'gpx',
      pointCount: 4,
      segmentCount: 2,
    };
    const routeContent: LocalTrackContent = {
      ...content,
      trackPoints: [
        [
          { coordinate: [44, 42], elevationMeters: 100 },
          { coordinate: [45, 43], elevationMeters: 110 },
        ],
        [
          { coordinate: [46, 44], elevationMeters: 120 },
          { coordinate: [47, 45], elevationMeters: 130 },
        ],
      ],
    };

    const gpx = exportTrackAsGpx(routeSummary, routeContent);
    const parsed = parseGpx(gpx);

    expect(gpx).toContain('<trk><name>Ridge &lt;loop&gt;</name>');
    expect(gpx.match(/<trk>/g)).toHaveLength(1);
    expect(gpx.match(/<trkseg>/g)).toHaveLength(2);
    expect(gpx).not.toContain('<rte>');
    expect(gpx).not.toContain('<rtept');
    expect(gpx.indexOf('lon="44"')).toBeLessThan(gpx.indexOf('lon="45"'));
    expect(gpx.indexOf('lon="45"')).toBeLessThan(gpx.indexOf('lon="46"'));
    expect(gpx.indexOf('lon="46"')).toBeLessThan(gpx.indexOf('lon="47"'));
    expect(parsed.geometryKind).toBe('track');
    expect(
      parsed.segments.map((segment) => segment.points.map((point) => point.coordinate)),
    ).toEqual([
      [
        [44, 42],
        [45, 43],
      ],
      [
        [46, 44],
        [47, 45],
      ],
    ]);
  });

  it('produces filesystem-safe names', () => {
    expect(safeTrackFilename('A/B:*?', 'gpx')).toBe('A-B---.gpx');
  });

  it('exports ordered GPX members with deterministic collision suffixes', () => {
    const tracks: readonly {
      readonly summary: LocalTrackSummary;
      readonly content: LocalTrackContent;
    }[] = [
      {
        summary: { ...summary, id: 'local:name-1', name: 'Name' },
        content: {
          ...content,
          trackId: 'local:name-1',
          trackPoints: [[{ coordinate: [44, 42], elevationMeters: 100 }]],
        },
      },
      {
        summary: { ...summary, id: 'local:name-2', name: 'Name (2)' },
        content: {
          ...content,
          trackId: 'local:name-2',
          trackPoints: [[{ coordinate: [45, 43], elevationMeters: 110 }]],
        },
      },
      {
        summary: { ...summary, id: 'local:name-3', name: 'Name' },
        content: {
          ...content,
          trackId: 'local:name-3',
          trackPoints: [[{ coordinate: [46, 44], elevationMeters: 120 }]],
        },
      },
    ];

    const bytes = exportTracksAsZip(tracks);
    const members = unzipSync(bytes);

    expect(Object.keys(members)).toEqual(['Name.gpx', 'Name (2).gpx', 'Name (3).gpx']);
    expect(strFromU8(members['Name.gpx'] ?? new Uint8Array())).toContain(
      '<name>Name</name>',
    );
    expect(strFromU8(members['Name.gpx'] ?? new Uint8Array())).toContain(
      'lat="42" lon="44"',
    );
    expect(strFromU8(members['Name.gpx'] ?? new Uint8Array())).not.toContain(
      'lat="43" lon="45"',
    );
    expect(strFromU8(members['Name (2).gpx'] ?? new Uint8Array())).toContain(
      '<name>Name (2)</name>',
    );
    expect(strFromU8(members['Name (2).gpx'] ?? new Uint8Array())).toContain(
      'lat="43" lon="45"',
    );
    expect(strFromU8(members['Name (3).gpx'] ?? new Uint8Array())).toContain(
      'lat="44" lon="46"',
    );
    expect(exportTracksAsZip(tracks)).toEqual(bytes);
  });
});
