import { describe, expect, it } from 'vitest';

import {
  redactDiagnosticInput,
  sanitizeDiagnosticText,
} from '@/diagnostics/redaction/redactDiagnosticData';

describe('diagnostic redaction', () => {
  it('removes secrets, local paths, GPX names, and coordinate pairs from text', () => {
    const value = sanitizeDiagnosticText(
      'Bearer abc.def token=hunter2 C:\\Users\\me\\track.gpx secret.gpx 41.7151, 44.8271',
    );

    expect(value).not.toContain('abc.def');
    expect(value).not.toContain('hunter2');
    expect(value).not.toContain('track.gpx');
    expect(value).not.toContain('secret.gpx');
    expect(value).not.toContain('41.7151');
    expect(value).toContain('[redacted]');
  });

  it('removes URL query data, fragments, protocol-relative URLs, and POSIX paths', () => {
    const value = sanitizeDiagnosticText(
      'GET https://host.test/items/42?email=user@example.com&trip=private#token ' +
        '//tiles.test/private?key=value /home/alice/private/track.geojson ' +
        'file:///Users/alice/secret.txt mailto:alice@example.com',
    );

    expect(value).not.toContain('host.test');
    expect(value).not.toContain('tiles.test');
    expect(value).not.toContain('user@example.com');
    expect(value).not.toContain('trip=private');
    expect(value).not.toContain('/home/alice');
    expect(value).not.toContain('/Users/alice');
    expect(value).toContain('[remote-url]');
    expect(value).toContain('[local-path]');
  });

  it('exports only fields on the central allowlist', () => {
    const result = redactDiagnosticInput({
      level: 'warn',
      name: 'test.event',
      message: 'authorization=private',
      data: {
        status: 'failed',
        durationMs: 25,
        filename: 'private.gpx',
        token: 'private-token',
      },
    });

    expect(result).toEqual({
      level: 'warn',
      name: 'test.event',
      message: 'authorization=[redacted]',
      data: { status: 'failed', durationMs: 25 },
    });
  });

  it('retains exact HTTP origins but redacts origin-shaped values with paths', () => {
    const result = redactDiagnosticInput({
      level: 'info',
      name: 'http.request.started',
      data: {
        origin: 'https://catalog.test',
        satelliteOrigin: 'https://catalog.test/private?token=secret',
      },
    });

    expect(result.data).toEqual({
      origin: 'https://catalog.test',
      satelliteOrigin: '[remote-url]',
    });
  });

  it('retains only aggregate DEM repair evidence', () => {
    const result = redactDiagnosticInput({
      level: 'debug',
      name: 'map.dem.tile-filtered',
      data: {
        durationMs: 82,
        noDataCount: 1,
        sentinelCount: 2,
        impossibleCount: 256,
        spikeCount: 3,
        repairedCount: 262,
        unrepairedCount: 0,
        tileUrl: 'https://tiles.example/15/20448/12164.png',
        coordinates: '42.0003, 44.6486',
      },
    });

    expect(result.data).toEqual({
      durationMs: 82,
      noDataCount: 1,
      sentinelCount: 2,
      impossibleCount: 256,
      spikeCount: 3,
      repairedCount: 262,
      unrepairedCount: 0,
    });
  });

  it('omits empty optional data and preserves safe scalar values', () => {
    expect(
      redactDiagnosticInput({ level: 'info', name: 'empty', data: { unknown: true } }),
    ).toEqual({ level: 'info', name: 'empty' });
    expect(sanitizeDiagnosticText('ordinary message')).toBe('ordinary message');
  });
});
