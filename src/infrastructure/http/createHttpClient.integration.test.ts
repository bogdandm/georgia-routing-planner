import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '../../../test/helpers/createTestServices';
import { mswServer } from '../../../test/setup/mswServer';

describe('createHttpClient', () => {
  it('uses the controlled HTTP boundary without contacting the network', async () => {
    mswServer.use(
      http.get('https://example.test/status', () => {
        return HttpResponse.json({ status: 'ok' });
      }),
    );
    const services = createTestServices();

    const response = await services.httpClient
      .get('https://example.test/status')
      .json<{ status: string }>();

    expect(response).toEqual({ status: 'ok' });
  });
});
