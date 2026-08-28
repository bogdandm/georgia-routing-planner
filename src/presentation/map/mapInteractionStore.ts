import { createStore } from 'zustand/vanilla';

import type {
  MapCoordinate,
  MapFitPadding,
  MapViewportBounds,
} from '@/presentation/map/mapTypes';

interface MapNavigationTarget extends MapCoordinate {
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
  readonly padding?: MapFitPadding;
}

interface MapPointInspectionCommand {
  readonly id: number;
  readonly coordinate: MapCoordinate;
  readonly waitForCameraSettle: boolean;
}

interface SatelliteSearchRequest {
  readonly id: number;
}

interface MarkerPlacement {
  readonly id: number;
}

interface MarkerCreationCommand {
  readonly id: number;
  readonly coordinate: MapCoordinate;
  readonly suggestedName?: string;
}

interface MapInteractionState {
  readonly navigationCommand: MapNavigationCommand | null;
  readonly fitBoundsCommand: MapFitBoundsCommand | null;
  readonly pointInspectionCommand: MapPointInspectionCommand | null;
  readonly satelliteSearchAnchor: MapCoordinate | null;
  readonly satelliteSearchRequest: SatelliteSearchRequest | null;
  readonly markerPlacement: MarkerPlacement | null;
  readonly markerCreationCommand: MarkerCreationCommand | null;
}

export const mapInteractionStore = createStore<MapInteractionState>()(() => ({
  navigationCommand: null,
  fitBoundsCommand: null,
  satelliteSearchAnchor: null,
  pointInspectionCommand: null,
  satelliteSearchRequest: null,
  markerPlacement: null,
  markerCreationCommand: null,
}));

let nextCommandId = 0;
let nextSatelliteSearchRequestId = 0;
let nextMarkerCommandId = 0;

export function requestMapNavigation(target: MapNavigationTarget): void {
  nextCommandId += 1;
  mapInteractionStore.setState({
    navigationCommand: { id: nextCommandId, target: { ...target } },
    pointInspectionCommand: null,
  });
}

export function requestMapFitBounds(
  bounds: MapViewportBounds,
  maxZoom: number,
  padding?: MapFitPadding,
): void {
  nextCommandId += 1;
  const command: {
    id: number;
    bounds: MapViewportBounds;
    maxZoom: number;
    padding?: MapFitPadding;
  } = { id: nextCommandId, bounds: { ...bounds }, maxZoom };
  if (padding !== undefined) command.padding = { ...padding };
  mapInteractionStore.setState({
    fitBoundsCommand: command,
    pointInspectionCommand: null,
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

export function requestMapPointInspection(
  coordinate: MapCoordinate,
  waitForCameraSettle = false,
): void {
  nextCommandId += 1;
  mapInteractionStore.setState({
    pointInspectionCommand: {
      id: nextCommandId,
      coordinate: { ...coordinate },
      waitForCameraSettle,
    },
  });
}

export function consumeMapPointInspectionCommand(commandId: number): void {
  if (mapInteractionStore.getState().pointInspectionCommand?.id !== commandId) return;
  mapInteractionStore.setState({ pointInspectionCommand: null });
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

export function requestMarkerPlacement(): void {
  nextMarkerCommandId += 1;
  mapInteractionStore.setState({
    markerPlacement: { id: nextMarkerCommandId },
    markerCreationCommand: null,
    pointInspectionCommand: null,
  });
}

export function cancelMarkerPlacement(): void {
  if (mapInteractionStore.getState().markerPlacement === null) return;
  mapInteractionStore.setState({ markerPlacement: null });
}

export function requestMarkerCreationAt(
  coordinate: MapCoordinate,
  suggestedName?: string,
): void {
  nextMarkerCommandId += 1;
  const command: {
    id: number;
    coordinate: MapCoordinate;
    suggestedName?: string;
  } = {
    id: nextMarkerCommandId,
    coordinate: { ...coordinate },
  };
  if (suggestedName !== undefined) command.suggestedName = suggestedName;
  mapInteractionStore.setState({
    markerPlacement: null,
    markerCreationCommand: command,
    pointInspectionCommand: null,
  });
}

export function completeMarkerPlacement(
  coordinate: MapCoordinate,
  suggestedName?: string,
): void {
  if (mapInteractionStore.getState().markerPlacement === null) return;
  nextMarkerCommandId += 1;
  const command: {
    id: number;
    coordinate: MapCoordinate;
    suggestedName?: string;
  } = {
    id: nextMarkerCommandId,
    coordinate: { ...coordinate },
  };
  if (suggestedName !== undefined) command.suggestedName = suggestedName;
  mapInteractionStore.setState({
    markerPlacement: null,
    markerCreationCommand: command,
    pointInspectionCommand: null,
  });
}

export function consumeMarkerCreationCommand(commandId: number): void {
  if (mapInteractionStore.getState().markerCreationCommand?.id !== commandId) return;
  mapInteractionStore.setState({ markerCreationCommand: null });
}

export function resetMapInteractionStore(): void {
  nextCommandId = 0;
  nextSatelliteSearchRequestId = 0;
  nextMarkerCommandId = 0;
  mapInteractionStore.setState({
    navigationCommand: null,
    fitBoundsCommand: null,
    pointInspectionCommand: null,
    satelliteSearchAnchor: null,
    satelliteSearchRequest: null,
    markerPlacement: null,
    markerCreationCommand: null,
  });
}
