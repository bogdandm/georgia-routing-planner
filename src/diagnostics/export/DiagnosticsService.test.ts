import { afterEach, describe, expect, it, vi } from 'vitest';

import { DiagnosticsService } from '@/diagnostics/export/DiagnosticsService';
import { diagnosticBundleSchema } from '@/diagnostics/export/diagnosticBundleSchema';
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

    expect(bundle.schemaVersion).toBe(3);
    expect(bundle.build.commit).toBe('test-commit');
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('41.7151');
    expect(serialized).not.toContain('secret.gpx');
  });

  it('exports a coarse camera and serializable map evidence without exact location data', () => {
    const services = createTestServices();
    services.mapDiagnostics.update({
      lifecycle: 'ready',
      camera: {
        longitude: 44.8271,
        latitude: 41.7151,
        zoom: 9.876,
        bearing: 12.34,
        pitch: 35.67,
      },
      terrainMode: 'terrain',
      styleId: 'fixture-style',
      sourceIds: ['basemap-vector', 'terrain-dem'],
      layerIds: ['background'],
      lastIdleAt: '2026-07-18T00:00:00.000Z',
      webGlContext: 'available',
      webGlCapabilities: {
        contextType: 'webgl2',
        version: 'WebGL 2.0',
        maxTextureSize: 16_384,
        antialias: true,
      },
      recoverableFailures: [],
      message: null,
    });

    const bundle = services.diagnostics.createBundle();
    expect(diagnosticBundleSchema.parse(bundle).map).toMatchObject({
      camera: {
        longitude: 44.8,
        latitude: 41.7,
        zoom: 9.88,
        bearing: 12.3,
        pitch: 35.7,
      },
      terrainMode: 'terrain',
    });
    expect(JSON.stringify(bundle)).not.toContain('44.8271');
    expect(JSON.stringify(bundle)).not.toContain('41.7151');
  });

  it('records health results and downloads the current JSON bundle', async () => {
    const services = createTestServices();
    const healthService = new HealthCheckService(
      services.clock,
      services.database,
      services.logger,
      services.mapDiagnostics,
      services.httpClient,
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
      services.mapDiagnostics,
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
