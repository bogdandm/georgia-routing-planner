import type { ErrorEvent as MapLibreErrorEvent } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';

import { mapFailureDetails } from '@/presentation/map/mapFailureDetails';

function event(error: { readonly message: string; readonly status?: number }) {
  return { error } as unknown as MapLibreErrorEvent;
}

describe('mapFailureDetails', () => {
  it.each([
    [429, 'rate-limit', true],
    [500, 'http-server', true],
    [502, 'http-server', true],
    [503, 'http-server', true],
    [504, 'timeout', true],
    [400, 'http-client', false],
  ] as const)(
    'classifies HTTP %i without retaining provider data',
    (status, reason, retryable) => {
      expect(
        mapFailureDetails(
          event({
            message: `AJAXError: provider response (${String(status)}): https://private.example/tile?token=secret`,
            status,
          }),
        ),
      ).toEqual({ reason, httpStatus: status, retryable });
    },
  );

  it('distinguishes timeouts, connection failures, and unknown errors', () => {
    expect(mapFailureDetails(event({ message: 'Request timed out' }))).toEqual({
      reason: 'timeout',
      httpStatus: null,
      retryable: true,
    });
    expect(mapFailureDetails(event({ message: 'Failed to fetch' }))).toEqual({
      reason: 'network',
      httpStatus: null,
      retryable: true,
    });
    expect(mapFailureDetails(event({ message: 'image decode failed' }))).toEqual({
      reason: 'unknown',
      httpStatus: null,
      retryable: false,
    });
  });
});
