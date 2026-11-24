import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GpxParseError, parseGpx } from '@/domain/tracks/gpx';
import { MAXIMUM_TRACK_MARKERS } from '@/domain/tracks/localTrack';

const fixtures = join(process.cwd(), 'tests', 'fixtures', 'tracks');

function expectParseFailure(xml: string, code: GpxParseError['code']): void {
  try {
    parseGpx(xml);
    expect.fail('Expected parsing to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(GpxParseError);
    if (!(error instanceof GpxParseError)) return;
    expect(error.code).toBe(code);
    expect(error.message).not.toContain(xml);
  }
}

describe('parseGpx', () => {
  it('explains the companion route in the supplied OsmAnd export', async () => {
    const xml = await readFile(
      `${fixtures}/real-world/osmand-track-with-route.gpx`,
      'utf8',
    );
    const result = parseGpx(xml);

    expect(result.geometryKind).toBe('track');
    expect(result.pointCount).toBe(258);
    expect(result.warnings).toContainEqual({
      code: 'track-preferred-over-route',
      message: 'Detailed track geometry was used instead of companion route geometry.',
    });
  });

  it('prefers detailed track geometry over an OsmAnd companion route', async () => {
    const xml = await readFile(`${fixtures}/osmand-detailed-track.gpx`, 'utf8');
    const result = parseGpx(xml);

    expect(result.geometryKind).toBe('track');
    expect(result.pointCount).toBe(3);
    expect(result.metadata.selectedName).toBe('Mon 13 Jul 2026');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'track-preferred-over-route' }),
    );
    expect(result.waypoints).toEqual([]);
  });

  it('preserves a Unicode track name and does not invent timestamps', async () => {
    const xml = await readFile(`${fixtures}/osmand-unicode-track.gpx`, 'utf8');
    const result = parseGpx(xml);

    expect(result.metadata.selectedName).toBe('მთის ბილიკი');
    expect(
      result.segments[0]?.points.every((point) => point.recordedAt === undefined),
    ).toBe(true);
  });
  it('imports bounded root waypoints in document order', async () => {
    const xml = await readFile(`${fixtures}/track-with-waypoints.gpx`, 'utf8');
    const result = parseGpx(xml);

    expect(result.waypoints).toEqual([
      { name: 'Start flag', coordinate: [44.1, 41.1] },
      { name: 'Marker 1', coordinate: [44.2, 41.2] },
      { name: 'Rock & Ridge <camp>', coordinate: [44.3, 41.3] },
    ]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'invalid-waypoint', pointIndex: 3 }),
    );
  });

  it('caps waypoint names and retains only the first 100 valid coordinates', () => {
    const longName = 'a'.repeat(201);
    const waypoints = Array.from({ length: 101 }, (_, index) => {
      const name = index === 0 ? `<name>${longName}</name>` : '';
      const degrees = String(index / 10);
      return `<wpt lat="${degrees}" lon="${degrees}">${name}</wpt>`;
    }).join('');
    const result = parseGpx(
      `<gpx version="1.1">${waypoints}<trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="1" lon="1"/></trkseg></trk></gpx>`,
    );

    expect(result.waypoints).toHaveLength(100);
    expect(result.waypoints[0]?.name).toBe('a'.repeat(200));
    expect(result.waypoints[1]?.name).toBe('Marker 1');
    expect(result.waypoints[99]?.name).toBe('Marker 99');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'waypoint-limit-reached' }),
    );
  });

  it('drops implausible Komoot timestamps and planning-point waypoints', () => {
    const planningPoints = Array.from(
      { length: MAXIMUM_TRACK_MARKERS + 1 },
      (_, index) =>
        `<wpt lat="41.1" lon="44.1"><name>Position ${String(index)}</name></wpt>`,
    ).join('');
    const result = parseGpx(
      `<gpx version="1.1" creator="https://www.komoot.de">${planningPoints}` +
        '<wpt lat="41.2" lon="44.2"><name>62 2500 თიანეთის მუნიციპალიტე…</name></wpt>' +
        `<wpt lat="41.3" lon="44.3"><name>242 couldn't find, 2500 თიანე…</name></wpt>` +
        '<wpt lat="41.4" lon="44.4"><name>Hut at 2500 m</name></wpt>' +
        '<trk><trkseg>' +
        '<trkpt lat="41.0" lon="44.0"><time>2026-11-23T22:48:32Z</time></trkpt>' +
        '<trkpt lat="41.5" lon="44.5"><time>2026-11-24T02:44:46Z</time></trkpt>' +
        '</trkseg></trk></gpx>',
    );

    expect(result.waypoints).toEqual([
      { name: 'Hut at 2500 m', coordinate: [44.4, 41.4] },
    ]);
    expect(result.warnings).toEqual([]);
    expect(
      result.segments[0]?.points.every((point) => point.recordedAt === undefined),
    ).toBe(true);
    expect(result.implausibleTimesDropped).toBe(true);
  });

  it.each([
    { startUtc: '06:00', minutes: 46, kept: false },
    { startUtc: '06:00', minutes: 50, kept: true },
    { startUtc: '06:00', minutes: 70, kept: true },
    { startUtc: '06:00', minutes: 74, kept: false },
    { startUtc: '02:59', minutes: 60, kept: false },
    { startUtc: '03:00', minutes: 60, kept: true },
    { startUtc: '08:00', minutes: 60, kept: true },
    { startUtc: '08:01', minutes: 60, kept: false },
  ])(
    'keeps Komoot timestamps only for a 07:00-12:00 local start and 80-120% of the estimate (start $startUtc UTC, $minutes min)',
    ({ startUtc, minutes, kept }) => {
      // Asia/Tbilisi is UTC+4. 0.036° of latitude is about 4 km: a flat DIN 33466 hour.
      const start = new Date(`2026-07-13T${startUtc}:00.000Z`);
      const end = new Date(start.getTime() + minutes * 60_000).toISOString();
      const result = parseGpx(
        '<gpx version="1.1" creator="https://www.komoot.com">' +
          '<trk><trkseg>' +
          `<trkpt lat="41.0" lon="44.0"><time>${start.toISOString()}</time></trkpt>` +
          `<trkpt lat="41.036" lon="44.0"><time>${end}</time></trkpt>` +
          '</trkseg></trk></gpx>',
      );

      expect(result.segments[0]?.points.at(-1)?.recordedAt).toBe(
        kept ? end : undefined,
      );
      expect(result.implausibleTimesDropped).toBe(kept ? undefined : true);
    },
  );

  it('keeps timestamps and position-named waypoints from other creators', () => {
    const result = parseGpx(
      '<gpx version="1.1" creator="OsmAnd">' +
        '<wpt lat="41.1" lon="44.1"><name>Position 3</name></wpt>' +
        '<trk><trkseg>' +
        '<trkpt lat="41.0" lon="44.0"><time>2026-07-13T06:00:00Z</time></trkpt>' +
        '<trkpt lat="41.5" lon="44.5"><time>2026-07-13T07:00:00Z</time></trkpt>' +
        '</trkseg></trk></gpx>',
    );

    expect(result.waypoints).toEqual([
      { name: 'Position 3', coordinate: [44.1, 41.1] },
    ]);
    expect(result.segments[0]?.points[0]?.recordedAt).toBe('2026-07-13T06:00:00.000Z');
  });

  it('falls back to route geometry for GPX 1.0', () => {
    const result = parseGpx(
      '<gpx version="1.0"><rte><name>Route</name><rtept lat="1" lon="2"/><rtept lat="3" lon="4"/></rte></gpx>',
    );
    expect(result.geometryKind).toBe('route');
    expect(result.metadata.selectedName).toBe('Route');
  });

  it('keeps independent segments and skips invalid points', () => {
    const result = parseGpx(
      '<gpx version="1.1"><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="x" lon="1"/><trkpt lat="1" lon="1"/></trkseg><trkseg><trkpt lat="2" lon="2"/><trkpt lat="3" lon="3"/></trkseg></trk></gpx>',
    );
    expect(result.segments).toHaveLength(2);
    expect(result.pointCount).toBe(4);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'invalid-point',
        segmentIndex: 0,
        pointIndex: 1,
      }),
    );
  });

  it('projects bounded standard metadata and validated links', () => {
    const result = parseGpx(`
      <gpx version="1.1" creator="  Test recorder  ">
        <metadata>
          <name>Metadata name</name>
          <desc>Metadata description</desc>
          <time>2026-01-02T03:04:05Z</time>
          <keywords>hiking, ridge</keywords>
          <author><name>Track author</name></author>
          <copyright author="Map owner"><year>2026</year></copyright>
          <link href="https://example.test/track"><text>Track page</text></link>
          <link href="javascript:alert(1)"/>
          <link href="not a URL"/>
        </metadata>
        <trk>
          <name>Selected track</name>
          <desc>Selected description</desc>
          <cmt>Selected comment</cmt>
          <src>Survey</src>
          <type>Hiking</type>
          <number>7</number>
          <trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg>
        </trk>
      </gpx>
    `);

    expect(result.metadata).toEqual({
      version: '1.1',
      creator: 'Test recorder',
      name: 'Metadata name',
      description: 'Metadata description',
      time: '2026-01-02T03:04:05.000Z',
      keywords: 'hiking, ridge',
      authorName: 'Track author',
      copyrightLabel: 'Map owner',
      copyrightYear: 2026,
      links: [{ href: 'https://example.test/track', text: 'Track page' }],
      selectedName: 'Selected track',
      selectedDescription: 'Selected description',
      selectedComment: 'Selected comment',
      selectedSource: 'Survey',
      selectedType: 'Hiking',
      selectedNumber: 7,
    });
  });

  it('retains valid points while warning about invalid timestamps and short segments', () => {
    const result = parseGpx(`
      <gpx version="1.1">
        <metadata><time>not-a-time</time></metadata>
        <trk>
          <trkseg><trkpt lat="0" lon="0"/></trkseg>
          <trkseg>
            <trkpt lat="0" lon="0"><time>not-a-time</time></trkpt>
            <trkpt lat="1" lon="1"><ele> </ele></trkpt>
          </trkseg>
        </trk>
      </gpx>
    `);

    expect(result.metadata.time).toBeUndefined();
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'short-segment', segmentIndex: 0 }),
        expect.objectContaining({
          code: 'invalid-time',
          segmentIndex: 1,
          pointIndex: 0,
        }),
      ]),
    );
  });

  it('bounds repeated validation warnings', () => {
    const invalidPoints = '<trkpt lat="invalid" lon="0"/>'.repeat(60);
    const result = parseGpx(
      `<gpx version="1.1"><trk><trkseg>${invalidPoints}<trkpt lat="0" lon="0"/><trkpt lat="1" lon="1"/></trkseg></trk></gpx>`,
    );

    expect(result.warnings).toHaveLength(50);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'warning-limit-reached' }),
    );
  });

  it.each([
    ['unsafe-xml', '<!DOCTYPE gpx [<!ENTITY x "bad">]><gpx version="1.1">&x;</gpx>'],
    ['invalid-xml', '<gpx version="1.1"><trk></gpx>'],
    ['unsupported-version', '<gpx version="2.0"/>'],
    ['empty-geometry', '<gpx version="1.1"><wpt lat="1" lon="2"/></gpx>'],
  ] as const)('returns stable %s errors without echoing input', (code, xml) => {
    expectParseFailure(xml, code);
  });

  it('rejects a non-GPX root and explicit collection limits', () => {
    expectParseFailure('<root/>', 'invalid-xml');
    expectParseFailure(
      `<gpx version="1.1">${'<rte/>'.repeat(129)}</gpx>`,
      'limit-exceeded',
    );
    expectParseFailure(
      `<gpx version="1.1"><trk>${'<trkseg/>'.repeat(513)}</trk></gpx>`,
      'limit-exceeded',
    );
    expectParseFailure(
      `<gpx version="1.1">${'<extensions>'.repeat(33)}${'</extensions>'.repeat(33)}</gpx>`,
      'limit-exceeded',
    );
  });

  it('honors byte limits and cancellation', () => {
    expect(() => parseGpx('<gpx version="1.1"/>', { maximumBytes: 2 })).toThrow(
      GpxParseError,
    );
    try {
      parseGpx('<gpx version="1.1"/>', { maximumBytes: 2 });
    } catch (error) {
      expect(error).toBeInstanceOf(GpxParseError);
      if (error instanceof GpxParseError) expect(error.code).toBe('file-too-large');
    }
    const controller = new AbortController();
    controller.abort();
    try {
      parseGpx('<gpx version="1.1"/>', { signal: controller.signal });
      expect.fail('Expected cancellation to fail parsing.');
    } catch (error) {
      expect(error).toBeInstanceOf(GpxParseError);
      if (error instanceof GpxParseError) expect(error.code).toBe('aborted');
    }
  });
});
