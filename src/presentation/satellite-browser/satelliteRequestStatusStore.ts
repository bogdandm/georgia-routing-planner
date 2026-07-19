import { createStore } from 'zustand/vanilla';

export type SatelliteRequestStatus =
  | { readonly status: 'ready'; readonly message: string }
  | {
      readonly status: 'pending';
      readonly message: string;
      readonly startedAt: number;
    }
  | { readonly status: 'error'; readonly message: string };

export const satelliteRequestStatusStore = createStore<SatelliteRequestStatus>()(
  () => ({
    status: 'ready',
    message: 'Ready',
  }),
);

export function beginSatelliteRequest(message: string): void {
  satelliteRequestStatusStore.setState({
    status: 'pending',
    message,
    startedAt: Date.now(),
  });
}

export function completeSatelliteRequest(message = 'Sentinel catalog ready'): void {
  satelliteRequestStatusStore.setState({ status: 'ready', message });
}

export function failSatelliteRequest(message: string): void {
  satelliteRequestStatusStore.setState({ status: 'error', message });
}

export function resetSatelliteRequestStatus(): void {
  completeSatelliteRequest('Ready');
}
