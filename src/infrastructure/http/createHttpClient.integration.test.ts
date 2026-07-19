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
      .get('https://example.test/status', {
        context: { operationId: 'catalog-operation-1' },
      })
      .json<{ status: string }>();

    expect(response).toEqual({ status: 'ok' });
    const events = services.logger.getEvents();
    const started = events.find(({ name }) => name === 'http.request.started');
    const completed = events.find(({ name }) => name === 'http.request.completed');
    expect(started?.data?.origin).toBe('https://example.test');
    expect(started?.data?.operationId).toBe('catalog-operation-1');
    expect(completed?.data?.origin).toBe('https://example.test');
    expect(completed?.data?.operationId).toBe('catalog-operation-1');
    expect(completed?.data?.status).toBe(200);
  });

  it('records sanitized HTTP failures without request paths or query values', async () => {
    mswServer.use(
      http.get('https://example.test/private', () => {
        return HttpResponse.json({ token: 'must-not-be-exported' }, { status: 503 });
      }),
    );
    const services = createTestServices();

    await expect(
      services.httpClient.get('https://example.test/private?token=secret'),
    ).rejects.toThrow();

    const event = services.logger
      .getEvents()
      .find(({ name }) => name === 'http.request.failed');
    expect(event?.data).toMatchObject({
      code: 'http-status',
      origin: 'https://example.test',
      status: 503,
    });
    expect(JSON.stringify(event)).not.toContain('private');
    expect(JSON.stringify(event)).not.toContain('secret');
  });
});
