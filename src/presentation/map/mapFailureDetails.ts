import type { ErrorEvent as MapLibreErrorEvent } from 'maplibre-gl';

import type { MapFailureReason } from '@/presentation/map/mapTypes';

export interface MapFailureDetails {
  readonly reason: MapFailureReason;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
}

function statusFromError(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { readonly status?: unknown }).status;
    if (typeof status === 'number' && Number.isInteger(status)) return status;
  }
  if (typeof error !== 'object' || error === null || !('message' in error)) return null;
  const message = (error as { readonly message?: unknown }).message;
  if (typeof message !== 'string') return null;
  const match =
    /(?:ajaxerror|http|status|response)[^\d]{0,24}\b([1-5]\d{2})\b/iu.exec(message) ??
    /\(([1-5]\d{2})\)\s*:/u.exec(message);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** Extracts only allowlisted transport evidence; URLs and response bodies stay private. */
export function mapFailureDetails(event: MapLibreErrorEvent): MapFailureDetails {
  const status = statusFromError(event.error);
  const message = event.error.message.toLowerCase();
  // Fetch/XHR uses status 0 when no HTTP response was available (network, CORS,
  // cancellation, or an opaque failure). It is not an HTTP client rejection.
  if (status === 0) {
    return { reason: 'no-response', httpStatus: null, retryable: true };
  }
  if (status === 429) {
    return { reason: 'rate-limit', httpStatus: status, retryable: true };
  }
  if (status === 408 || status === 504) {
    return { reason: 'timeout', httpStatus: status, retryable: true };
  }
  if (status !== null && status >= 500) {
    return { reason: 'http-server', httpStatus: status, retryable: true };
  }
  if (status !== null) {
    return { reason: 'http-client', httpStatus: status, retryable: false };
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return { reason: 'timeout', httpStatus: null, retryable: true };
  }
  if (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network error') ||
    message.includes('load failed') ||
    message.includes('connection')
  ) {
    return { reason: 'network', httpStatus: null, retryable: true };
  }
  return { reason: 'unknown', httpStatus: null, retryable: false };
}
