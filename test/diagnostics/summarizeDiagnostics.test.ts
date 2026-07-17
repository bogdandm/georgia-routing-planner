import { describe, expect, it } from 'vitest';

import { summarizeDiagnostics } from '../../tools/diagnostics/summarizeDiagnostics';

const validBundle = {
  schemaVersion: 1,
  exportedAt: '2026-07-18T00:00:00.000Z',
  build: {
    appVersion: '0.0.0',
    commit: 'abc123',
    timestamp: '2026-07-18T00:00:00.000Z',
    mode: 'production',
  },
  runtime: { userAgent: 'Synthetic Chrome', language: 'en', online: true },
  reproductionNotes: '',
  healthChecks: [
    {
      name: 'IndexedDB',
      status: 'fail',
      durationMs: 5,
      summary: 'Probe failed.',
      remediation: 'Check storage.',
    },
  ],
  events: [
    {
      id: 'event-1',
      timestamp: '2026-07-18T00:00:01.000Z',
      level: 'error',
      name: 'storage.failed',
      message: 'Storage unavailable.',
      data: { durationMs: 1_200 },
    },
  ],
} as const;

describe('summarizeDiagnostics', () => {
  it('prints a deterministic safe troubleshooting summary', () => {
    expect(summarizeDiagnostics(validBundle)).toBe(
      [
        'Georgia Routing Planner diagnostics v1',
        'Build: 0.0.0 (abc123, production)',
        'Browser: Synthetic Chrome',
        'Exported: 2026-07-18T00:00:00.000Z',
        'Health: 1 warning/failure(s) of 1',
        '- FAIL IndexedDB: Probe failed.',
        'Recent errors: 1',
        '- storage.failed: Storage unavailable.',
        'Slow operations: 1',
        'Next: investigate failed health checks and the newest error events.',
        '',
      ].join('\n'),
    );
  });

  it('rejects unsupported schema versions', () => {
    expect(() => {
      summarizeDiagnostics({ ...validBundle, schemaVersion: 2 });
    }).toThrow();
  });
});
