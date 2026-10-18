import { createStore } from 'zustand/vanilla';

import type { PointWeatherForecastPeriod } from '@/application/weather/GetPointWeatherForecast';
import type {
  MapCoordinate,
  MapFitPadding,
  MapTravelPath,
  MapViewportBounds,
} from '@/presentation/map/mapTypes';
import type {
  RenderBenchmarkReport,
  RenderBenchmarkStep,
} from '@/presentation/map/renderBenchmark';

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
  readonly path?: MapTravelPath;
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

/** An open map share dialog; links keep the query and tab hash of `pageUrl`. */
interface MapShareRequest {
  readonly pageUrl: string;
  /** A right-clicked point that replaces the camera center, or `null` for the center. */
  readonly center: MapCoordinate | null;
}

/** Developer render benchmark: requested by the developer drawer, run by the map. */
export type RenderBenchmarkState =
  | { readonly status: 'idle' }
  | { readonly status: 'requested' }
  | {
      readonly status: 'running';
      readonly step: RenderBenchmarkStep;
      /** `Date.now()` when the step began, so the drawer can show how long it runs. */
      readonly stepStartedAt: number;
    }
  | { readonly status: 'complete'; readonly report: RenderBenchmarkReport }
  | { readonly status: 'failed'; readonly message: string };

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
  readonly shareRequest: MapShareRequest | null;
  readonly renderBenchmark: RenderBenchmarkState;
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
  shareRequest: null,
  renderBenchmark: { status: 'idle' },
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
  options: {
    readonly padding?: MapFitPadding;
    readonly path?: MapTravelPath;
  } = {},
): void {
  nextCommandId += 1;
  const command: {
    id: number;
    bounds: MapViewportBounds;
    maxZoom: number;
    padding?: MapFitPadding;
    path?: MapTravelPath;
  } = { id: nextCommandId, bounds: { ...bounds }, maxZoom };
  if (options.padding !== undefined) command.padding = { ...options.padding };
  if (options.path !== undefined) {
    command.path = {
      from: { ...options.path.from },
      to: { ...options.path.to },
      points: options.path.points.map((point) => ({ ...point })),
    };
  }
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

/** Requests the selected point again without changing an active point selection. */
export function refreshWeatherForecast(): void {
  const selectedPoint = mapInteractionStore.getState().selectedWeatherForecastPoint;
  if (selectedPoint === null) return;
  nextWeatherForecastRequestId += 1;
  mapInteractionStore.setState({
    weatherForecastRequest: { id: nextWeatherForecastRequestId, ...selectedPoint },
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

export function openMapShare(pageUrl: string, center: MapCoordinate | null): void {
  mapInteractionStore.setState({
    shareRequest: { pageUrl, center: center === null ? null : { ...center } },
  });
}

export function closeMapShare(): void {
  mapInteractionStore.setState({ shareRequest: null });
}

export function requestRenderBenchmark(): void {
  const { status } = mapInteractionStore.getState().renderBenchmark;
  if (status === 'requested' || status === 'running') return;
  mapInteractionStore.setState({ renderBenchmark: { status: 'requested' } });
}

export function setRenderBenchmarkState(renderBenchmark: RenderBenchmarkState): void {
  mapInteractionStore.setState({ renderBenchmark });
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
    shareRequest: null,
    renderBenchmark: { status: 'idle' },
  });
}
