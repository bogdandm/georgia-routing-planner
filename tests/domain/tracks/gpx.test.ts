import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GpxParseError, parseGpx } from '@/domain/tracks/gpx';

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
  });

  it('preserves a Unicode track name and does not invent timestamps', async () => {
    const xml = await readFile(`${fixtures}/osmand-unicode-track.gpx`, 'utf8');
    const result = parseGpx(xml);

    expect(result.metadata.selectedName).toBe('მთის ბილიკი');
    expect(
      result.segments[0]?.points.every((point) => point.recordedAt === undefined),
    ).toBe(true);
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
