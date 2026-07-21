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
        'Georgia Routing Planner diagnostics v3 (migrated from v1)',
        'Build: 0.0.0 (abc123, production)',
        'Browser: Synthetic Chrome',
        'Exported: 2026-07-18T00:00:00.000Z',
        'Health: 1 warning/failure(s) of 1',
        '- FAIL IndexedDB: Probe failed.',
        'Map: not captured in this bundle.',
        'Recent errors: 1',
        '- storage.failed: Storage unavailable.',
        'Slow operations: 1',
        'Next: investigate failed health checks, active map failures, and the newest error events.',
        '',
      ].join('\n'),
    );
  });

  it('rejects unsupported schema versions', () => {
    expect(() => {
      summarizeDiagnostics({ ...validBundle, schemaVersion: 4 });
    }).toThrow();
  });

  it('summarizes the current v3 map snapshot with safe source failure details', () => {
    const v2Bundle = {
      ...validBundle,
      schemaVersion: 3,
      map: {
        lifecycle: 'degraded',
        camera: {
          longitude: 44.8,
          latitude: 41.7,
          zoom: 8,
          bearing: 0,
          pitch: 0,
        },
        terrainMode: 'flat',
        styleId: 'Georgia hiking basemap v1',
        sourceIds: ['basemap-vector'],
        layerIds: ['background', 'water'],
        lastIdleAt: '2026-07-18T00:00:02.000Z',
        webGlContext: 'available',
        webGlCapabilities: {
          contextType: 'webgl2',
          version: 'WebGL 2.0',
          maxTextureSize: 16_384,
          antialias: true,
        },
        recoverableFailures: [
          {
            category: 'base-vector',
            sourceId: 'basemap-vector',
            reason: 'http-server',
            httpStatus: 503,
            count: 3,
            lastOccurredAt: '2026-07-18T00:00:03.000Z',
            recoveryState: 'scheduled',
            retryAttempt: 1,
          },
        ],
        message: 'Some basemap tiles could not load.',
      },
    } as const;

    const summary = summarizeDiagnostics(v2Bundle);
    expect(summary).toContain('Georgia Routing Planner diagnostics v3\n');
    expect(summary).toContain('Map: degraded, flat, 1 recoverable failure category(s)');
    expect(summary).toContain(
      'Map style: Georgia hiking basemap v1; 1 source(s), 2 layer(s)',
    );
    expect(summary).toContain(
      '- basemap-vector: http-server HTTP 503; scheduled; retry 1; 3 occurrence(s)',
    );
    expect(summary).toContain(
      'Next: investigate failed health checks, active map failures, and the newest error events.',
    );
  });
});
