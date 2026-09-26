import { createStore } from 'zustand/vanilla';

type SatelliteRequestReadyContent =
  | { readonly code: 'ready' | 'catalog-ready' | 'search-cancelled' }
  | { readonly code: 'images-available'; readonly count: number };

type SatelliteRequestPendingContent =
  | { readonly code: 'searching-catalog' }
  | { readonly code: 'loading-month'; readonly month: string };

type SatelliteRequestStatus =
  | ({ readonly status: 'ready' } & SatelliteRequestReadyContent)
  | ({
      readonly status: 'pending';
      readonly startedAt: number;
    } & SatelliteRequestPendingContent)
  | { readonly status: 'error' };

export const satelliteRequestStatusStore = createStore<SatelliteRequestStatus>()(
  () => ({
    status: 'ready',
    code: 'ready',
  }),
);

export function beginSatelliteRequest(content: SatelliteRequestPendingContent): void {
  satelliteRequestStatusStore.setState({
    status: 'pending',
    ...content,
    startedAt: Date.now(),
  });
}

export function completeSatelliteRequest(
  content: SatelliteRequestReadyContent = { code: 'catalog-ready' },
): void {
  satelliteRequestStatusStore.setState({ status: 'ready', ...content });
}

export function failSatelliteRequest(): void {
  satelliteRequestStatusStore.setState({ status: 'error' });
}

export function resetSatelliteRequestStatus(): void {
  completeSatelliteRequest({ code: 'ready' });
}
