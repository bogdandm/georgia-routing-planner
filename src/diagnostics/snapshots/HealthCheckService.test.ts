import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthCheckService } from '@/diagnostics/snapshots/HealthCheckService';
import { createTestServices } from '../../../test/helpers/createTestServices';
import { FakeMapFacade } from '../../../test/helpers/FakeMapFacade';
import { mswServer } from '../../../test/setup/mswServer';

let services: ReturnType<typeof createTestServices>;
let healthChecks: HealthCheckService;

beforeEach(async () => {
  services = createTestServices();
  await services.database.delete();
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      estimate: vi.fn().mockResolvedValue({ usage: 1_024, quota: 8_192 }),
    },
  });
  healthChecks = new HealthCheckService(
    services.clock,
    services.database,
    services.logger,
    services.mapDiagnostics,
    services.httpClient,
  );
});

afterEach(async () => {
  services.database.close();
  await services.database.delete();
});

describe('HealthCheckService', () => {
  it('reports map readiness from the serializable snapshot without probing providers', async () => {
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      lifecycle: 'degraded',
      webGlContext: 'available',
    });

    const results = await healthChecks.run();

    expect(results).toContainEqual(
      expect.objectContaining({ name: 'Map readiness', status: 'warn' }),
    );
  });

  it('probes only configured vector metadata and a bounded terrain range on request', async () => {
    const requests: { url: string; range: string | null }[] = [];
    mswServer.use(
      http.get('https://tiles.openfreemap.org/planet', ({ request }) => {
        requests.push({ url: request.url, range: request.headers.get('range') });
        return HttpResponse.json({ tilejson: '3.0.0', tiles: [] });
      }),
      http.get(
        'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/0/0/0.png',
        ({ request }) => {
          requests.push({ url: request.url, range: request.headers.get('range') });
          return new HttpResponse(new Uint8Array([137, 80, 78, 71]), {
            status: 206,
          });
        },
      ),
    );
    const configuration = services.mapProviderConfiguration;
    expect(configuration.status).toBe('valid');
    if (configuration.status !== 'valid') return;

    const results = await healthChecks.runProviderReachability(
      configuration.value,
      new AbortController().signal,
    );

    expect(results.map((result) => result.status)).toEqual(['pass', 'pass']);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.range).toBe('bytes=0-1023');
    expect(JSON.stringify(services.logger.getEvents())).not.toContain(
      'elevation-tiles-prod',
    );
  });
});
