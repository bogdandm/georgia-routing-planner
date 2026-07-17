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

  it('omits empty optional data and preserves safe scalar values', () => {
    expect(
      redactDiagnosticInput({ level: 'info', name: 'empty', data: { unknown: true } }),
    ).toEqual({ level: 'info', name: 'empty' });
    expect(sanitizeDiagnosticText('ordinary message')).toBe('ordinary message');
  });
});
