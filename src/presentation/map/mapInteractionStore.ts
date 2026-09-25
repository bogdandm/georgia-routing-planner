import { createStore } from 'zustand/vanilla';

import type { PointWeatherForecastPeriod } from '@/application/weather/GetPointWeatherForecast';
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
  readonly refreshNearbyPoiOnIdle: boolean;
}

interface SatelliteSearchRequest {
  readonly id: number;
}
export interface SelectedWeatherForecastPoint {
  readonly coordinate: MapCoordinate;
  readonly placeLabel?: string;
  readonly elevationMeters?: number;
}
export interface WeatherForecastRequest extends SelectedWeatherForecastPoint {
  readonly id: number;
}
export interface WeatherMapForecastMarker {
  readonly coordinate: MapCoordinate;
  readonly isDay: boolean;
  readonly period: PointWeatherForecastPeriod;
}
export type MarkerPlacementTarget =
  | { readonly kind: 'saved-marker' }
  | { readonly kind: 'track-marker'; readonly trackId: string };

interface MarkerPlacement {
  readonly id: number;
  readonly target: MarkerPlacementTarget;
}

interface MarkerCreationCommand {
  readonly id: number;
  readonly coordinate: MapCoordinate;
  readonly suggestedName?: string;
  readonly target: MarkerPlacementTarget;
}

interface MapInteractionState {
  readonly navigationCommand: MapNavigationCommand | null;
  readonly fitBoundsCommand: MapFitBoundsCommand | null;
  readonly pointInspectionCommand: MapPointInspectionCommand | null;
  readonly satelliteSearchAnchor: MapCoordinate | null;
  readonly satelliteSearchRequest: SatelliteSearchRequest | null;
  readonly weatherForecastRequest: WeatherForecastRequest | null;
  readonly selectedWeatherForecastPoint: SelectedWeatherForecastPoint | null;
  readonly weatherPointSelectionActive: boolean;
  readonly weatherMapForecastMarker: WeatherMapForecastMarker | null;
  readonly markerPlacement: MarkerPlacement | null;
  readonly markerCreationCommand: MarkerCreationCommand | null;
}

export const mapInteractionStore = createStore<MapInteractionState>()(() => ({
  navigationCommand: null,
  fitBoundsCommand: null,
  satelliteSearchAnchor: null,
  pointInspectionCommand: null,
  satelliteSearchRequest: null,
  weatherForecastRequest: null,
  selectedWeatherForecastPoint: null,
  weatherPointSelectionActive: false,
  weatherMapForecastMarker: null,
  markerPlacement: null,
  markerCreationCommand: null,
}));

let nextCommandId = 0;
let nextSatelliteSearchRequestId = 0;
let nextMarkerCommandId = 0;
let nextWeatherForecastRequestId = 0;

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
  options?: { readonly refreshNearbyPoiOnIdle?: boolean },
): void {
  nextCommandId += 1;
  mapInteractionStore.setState({
    pointInspectionCommand: {
      id: nextCommandId,
      coordinate: { ...coordinate },
      refreshNearbyPoiOnIdle: options?.refreshNearbyPoiOnIdle ?? false,
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

export function requestWeatherForecast(
  coordinate: MapCoordinate,
  placeLabel?: string,
  elevationMeters?: number,
): void {
  nextWeatherForecastRequestId += 1;
  const selectedPoint: {
    coordinate: MapCoordinate;
    placeLabel?: string;
    elevationMeters?: number;
  } = {
    coordinate: { ...coordinate },
  };
  if (placeLabel !== undefined) selectedPoint.placeLabel = placeLabel;
  if (elevationMeters !== undefined) selectedPoint.elevationMeters = elevationMeters;
  const request: WeatherForecastRequest = {
    id: nextWeatherForecastRequestId,
    ...selectedPoint,
  };
  mapInteractionStore.setState({
    weatherPointSelectionActive: false,
    selectedWeatherForecastPoint: selectedPoint,
    weatherForecastRequest: request,
  });
}

export function consumeWeatherForecastRequest(requestId: number): void {
  if (mapInteractionStore.getState().weatherForecastRequest?.id !== requestId) return;
  mapInteractionStore.setState({ weatherForecastRequest: null });
}
export function startWeatherPointSelection(): void {
  mapInteractionStore.setState({
    markerPlacement: null,
    weatherPointSelectionActive: true,
  });
}

export function cancelWeatherPointSelection(): void {
  if (!mapInteractionStore.getState().weatherPointSelectionActive) return;
  mapInteractionStore.setState({ weatherPointSelectionActive: false });
}

export function completeWeatherPointSelection(
  coordinate: MapCoordinate,
  placeLabel?: string,
): void {
  if (!mapInteractionStore.getState().weatherPointSelectionActive) return;
  requestWeatherForecast(coordinate, placeLabel);
}

export function setWeatherMapForecastMarker(
  marker: WeatherMapForecastMarker | null,
): void {
  mapInteractionStore.setState({
    weatherMapForecastMarker:
      marker === null
        ? null
        : {
            coordinate: { ...marker.coordinate },
            isDay: marker.isDay,
            period: marker.period,
          },
  });
}

export function requestMarkerPlacement(target: MarkerPlacementTarget): void {
  nextMarkerCommandId += 1;
  mapInteractionStore.setState({
    markerPlacement: { id: nextMarkerCommandId, target },
    markerCreationCommand: null,
    weatherPointSelectionActive: false,
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
    target: MarkerPlacementTarget;
  } = {
    id: nextMarkerCommandId,
    coordinate: { ...coordinate },
    target: { kind: 'saved-marker' },
  };
  if (suggestedName !== undefined) command.suggestedName = suggestedName;
  mapInteractionStore.setState({
    markerPlacement: null,
    markerCreationCommand: command,
  });
}

export function completeMarkerPlacement(
  coordinate: MapCoordinate,
  suggestedName?: string,
): void {
  const placement = mapInteractionStore.getState().markerPlacement;
  if (placement === null) return;
  nextMarkerCommandId += 1;
  const command: {
    id: number;
    coordinate: MapCoordinate;
    suggestedName?: string;
    target: MarkerPlacementTarget;
  } = {
    id: nextMarkerCommandId,
    coordinate: { ...coordinate },
    target: placement.target,
  };
  if (suggestedName !== undefined) command.suggestedName = suggestedName;
  mapInteractionStore.setState({
    markerPlacement: null,
    markerCreationCommand: command,
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
  nextWeatherForecastRequestId = 0;
  mapInteractionStore.setState({
    navigationCommand: null,
    fitBoundsCommand: null,
    pointInspectionCommand: null,
    satelliteSearchAnchor: null,
    satelliteSearchRequest: null,
    weatherForecastRequest: null,
    selectedWeatherForecastPoint: null,
    weatherPointSelectionActive: false,
    weatherMapForecastMarker: null,
    markerPlacement: null,
    markerCreationCommand: null,
  });
}
