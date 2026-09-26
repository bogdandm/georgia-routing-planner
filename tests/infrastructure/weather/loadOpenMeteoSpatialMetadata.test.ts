import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { loadOpenMeteoSpatialMetadata } from '@/infrastructure/weather/loadOpenMeteoSpatialMetadata';
import { createTestServices } from '@test/helpers/createTestServices';
import { mswServer } from '@test/setup/mswServer';

const metadataUrl = 'https://example.test/data_spatial/ecmwf_ifs025/latest.json';

describe('loadOpenMeteoSpatialMetadata', () => {
  it('rejects metadata that cannot provide both wind components for arrows', async () => {
    mswServer.use(
      http.get(metadataUrl, () =>
        HttpResponse.json({
          completed: true,
          reference_time: '2026-09-24T00:00:00Z',
          valid_times: ['2026-09-24T00:00:00Z'],
          variables: ['cloud_cover', 'precipitation', 'wind_u_component_10m'],
        }),
      ),
    );
    const services = createTestServices();

    await expect(
      loadOpenMeteoSpatialMetadata(
        services.httpClient,
        metadataUrl,
        5_000,
        new AbortController().signal,
      ),
    ).rejects.toThrow('wind_v_component_10m');
  });
});
