import { describe, expect, it } from 'vitest';

import { createEmergencyBootstrapBundle } from '@/bootstrap/mountBootstrapFallback';

describe('createEmergencyBootstrapBundle', () => {
  it('creates a minimal privacy-safe bundle without runtime services', () => {
    const bundle = createEmergencyBootstrapBundle(
      new Error(
        'Failed at https://example.test/start?token=secret from /home/person/private.gpx',
      ),
      new Date('2026-07-19T00:00:00.000Z'),
    );

    expect(bundle).toEqual({
      schemaVersion: 1,
      kind: 'bootstrap-failure',
      exportedAt: '2026-07-19T00:00:00.000Z',
      failure: {
        code: 'app.bootstrap.failed',
        message: 'Failed at [remote-url] from [local-path]',
      },
    });
    expect(JSON.stringify(bundle)).not.toContain('secret');
    expect(JSON.stringify(bundle)).not.toContain('person');
  });
});
