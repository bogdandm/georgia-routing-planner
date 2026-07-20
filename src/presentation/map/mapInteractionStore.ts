import { createStore } from 'zustand/vanilla';

import type { MapCoordinate } from '@/presentation/map/mapTypes';
import type { MapViewportBounds } from '@/application/ports/MapViewportProvider';

export interface MapNavigationTarget extends MapCoordinate {
  readonly zoom?: number;
}

interface MapNavigationCommand {
  readonly id: number;
  readonly target: MapNavigationTarget;
}

interface MapFitBoundsCommand {
  readonly id: number;
  readonly bounds: MapViewportBounds;
  readonly maxZoom: number;
}

interface SatelliteSearchRequest {
  readonly id: number;
}

interface MapInteractionState {
  readonly navigationCommand: MapNavigationCommand | null;
  readonly fitBoundsCommand: MapFitBoundsCommand | null;
  readonly satelliteSearchAnchor: MapCoordinate | null;
  readonly satelliteSearchRequest: SatelliteSearchRequest | null;
}

export const mapInteractionStore = createStore<MapInteractionState>()(() => ({
  navigationCommand: null,
  fitBoundsCommand: null,
  satelliteSearchAnchor: null,
  satelliteSearchRequest: null,
}));

let nextCommandId = 0;
let nextSatelliteSearchRequestId = 0;

export function requestMapNavigation(target: MapNavigationTarget): void {
  nextCommandId += 1;
  mapInteractionStore.setState({
    navigationCommand: { id: nextCommandId, target: { ...target } },
  });
}

export function requestMapFitBounds(bounds: MapViewportBounds, maxZoom: number): void {
  nextCommandId += 1;
  mapInteractionStore.setState({
    fitBoundsCommand: { id: nextCommandId, bounds: { ...bounds }, maxZoom },
  });
}

export function consumeMapNavigationCommand(commandId: number): void {
  if (mapInteractionStore.getState().navigationCommand?.id !== commandId) return;
  mapInteractionStore.setState({ navigationCommand: null });
}

export function consumeMapFitBoundsCommand(commandId: number): void {
  if (mapInteractionStore.getState().fitBoundsCommand?.id !== commandId) return;
  mapInteractionStore.setState({ fitBoundsCommand: null });
}

export function setSatelliteSearchAnchor(anchor: MapCoordinate | null): void {
  mapInteractionStore.setState({
    satelliteSearchAnchor: anchor === null ? null : { ...anchor },
  });
}

export function requestSatelliteSearch(anchor: MapCoordinate): void {
  nextSatelliteSearchRequestId += 1;
  mapInteractionStore.setState({
    satelliteSearchAnchor: { ...anchor },
    satelliteSearchRequest: { id: nextSatelliteSearchRequestId },
  });
}

export function consumeSatelliteSearchRequest(requestId: number): void {
  if (mapInteractionStore.getState().satelliteSearchRequest?.id !== requestId) return;
  mapInteractionStore.setState({ satelliteSearchRequest: null });
}

export function resetMapInteractionStore(): void {
  nextCommandId = 0;
  nextSatelliteSearchRequestId = 0;
  mapInteractionStore.setState({
    navigationCommand: null,
    fitBoundsCommand: null,
    satelliteSearchAnchor: null,
    satelliteSearchRequest: null,
  });
}
