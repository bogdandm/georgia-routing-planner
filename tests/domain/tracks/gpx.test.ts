import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GpxParseError, parseGpx } from '@/domain/tracks/gpx';

const fixtures = join(process.cwd(), 'tests', 'fixtures', 'tracks');

describe('parseGpx', () => {
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

  it.each([
    ['unsafe-xml', '<!DOCTYPE gpx [<!ENTITY x "bad">]><gpx version="1.1">&x;</gpx>'],
    ['invalid-xml', '<gpx version="1.1"><trk></gpx>'],
    ['unsupported-version', '<gpx version="2.0"/>'],
    ['empty-geometry', '<gpx version="1.1"><wpt lat="1" lon="2"/></gpx>'],
  ] as const)('returns stable %s errors without echoing input', (code, xml) => {
    try {
      parseGpx(xml);
      expect.fail('Expected parsing to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(GpxParseError);
      expect((error as GpxParseError).code).toBe(code);
      expect((error as Error).message).not.toContain(xml);
    }
  });

  it('honors byte limits and cancellation', () => {
    expect(() => parseGpx('<gpx version="1.1"/>', { maximumBytes: 2 })).toThrow(
      GpxParseError,
    );
    try {
      parseGpx('<gpx version="1.1"/>', { maximumBytes: 2 });
    } catch (error) {
      expect((error as GpxParseError).code).toBe('file-too-large');
    }
    const controller = new AbortController();
    controller.abort();
    try {
      parseGpx('<gpx version="1.1"/>', { signal: controller.signal });
      expect.fail('Expected cancellation to fail parsing.');
    } catch (error) {
      expect((error as GpxParseError).code).toBe('aborted');
    }
  });
});
