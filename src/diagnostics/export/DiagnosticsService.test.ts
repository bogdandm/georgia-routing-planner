import { afterEach, describe, expect, it, vi } from 'vitest';

import { DiagnosticsService } from '@/diagnostics/export/DiagnosticsService';
import { HealthCheckService } from '@/diagnostics/snapshots/HealthCheckService';
import { createTestServices } from '../../../test/helpers/createTestServices';

afterEach(async () => {
  const services = createTestServices();
  services.database.close();
  await services.database.delete();
});

describe('DiagnosticsService', () => {
  it('creates a versioned bundle from redacted events', () => {
    const services = createTestServices();
    services.logger.log({
      level: 'error',
      name: 'sample.failed',
      message: 'token=private 41.7151,44.8271 secret.gpx',
    });

    const bundle = services.diagnostics.createBundle('Bearer private-token');
    const serialized = JSON.stringify(bundle);

    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.build.commit).toBe('test-commit');
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('41.7151');
    expect(serialized).not.toContain('secret.gpx');
  });

  it('records health results and downloads the current JSON bundle', async () => {
    const services = createTestServices();
    const healthService = new HealthCheckService(
      services.clock,
      services.database,
      services.logger,
    );
    vi.spyOn(healthService, 'run').mockResolvedValue([
      {
        name: 'Synthetic check',
        status: 'pass',
        durationMs: 1,
        summary: 'Healthy.',
      },
    ]);
    const diagnostics = new DiagnosticsService(
      services.buildInfo,
      services.logger,
      healthService,
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:test');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL');

    await expect(diagnostics.runHealthChecks()).resolves.toHaveLength(1);
    diagnostics.downloadBundle('steps');

    expect(diagnostics.createBundle().healthChecks).toHaveLength(1);
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:test');
  });
});
