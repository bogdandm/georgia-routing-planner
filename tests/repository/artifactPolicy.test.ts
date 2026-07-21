import { describe, expect, it } from 'vitest';

import {
  classifyTrackedPath,
  findTrackedArtifactViolations,
} from '../../tools/repository/artifactPolicy';

describe('repository artifact policy', () => {
  it.each([
    'node_modules/maplibre-gl/package.json',
    '.pnpm-store/v3/files/index.json',
    'dist/assets/index.js',
    'coverage/index.html',
    'playwright-report/index.html',
    'test-results/map/trace.zip',
    'debug.log',
    '.env.production',
    'diagnostics-2026-07-18.json',
    '.vscode/settings.json',
    'private-key.pem',
  ])('rejects %s', (trackedPath) => {
    expect(classifyTrackedPath(trackedPath)).not.toBeNull();
  });

  it.each([
    'pnpm-lock.yaml',
    '.env.example',
    '.vscode/extensions.json',
    'tests/fixtures/source-map.json',
    'tests/fixtures/diagnostics/valid-redacted.json',
    'src/presentation/map/mapStyleFactory.ts',
  ])('allows intentional repository input %s', (trackedPath) => {
    expect(classifyTrackedPath(trackedPath)).toBeNull();
  });

  it('returns every violation with a human-readable reason', () => {
    const violations = findTrackedArtifactViolations([
      'src/main.tsx',
      'dist/index.html',
      '.env.local',
    ]);

    expect(violations).toEqual([
      {
        path: 'dist/index.html',
        reason: 'generated or local-only directory: dist',
      },
      { path: '.env.local', reason: 'environment or secret file' },
    ]);
  });
});
