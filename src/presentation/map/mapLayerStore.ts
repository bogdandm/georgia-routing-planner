import { createStore } from 'zustand/vanilla';

import type { SatelliteSearchErrorCode } from '@/application/satellite/SatelliteSearchError';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import type {
  LogicalMapLayerId,
  SatelliteRenderingMode,
  SatelliteRenderingTuning,
  TerrainOverlayPreferences,
} from '@/application/ports/MapLayerPreferencesRepository';
import {
  defaultSatelliteRenderingMode,
  defaultSatelliteRenderingTuning,
  defaultTerrainOverlayPreferences,
  defaultWeatherMapOpacity,
} from '@/application/ports/MapLayerPreferencesRepository';
import type {
  TerrainComputeQueueState,
  TerrainComputeStatus,
} from '@/infrastructure/elevation/TerrainComputeBackend';
import { defaultTerrainContourQueueCapacity } from '@/infrastructure/elevation/TerrainComputeBackend';
import type { MapFailureReason } from '@/presentation/map/mapTypes';

/**
 * Why Sentinel imagery could not be applied. Satellite UI maps each code to localized
 * copy; `tile-failed` keeps only allowlisted transport evidence.
 */
export type SatelliteImageryProblem =
  | { readonly code: 'map-not-ready' }
  | { readonly code: 'unsupported-asset' }
  | { readonly code: 'unrenderable-geometry' }
  | { readonly code: 'too-many-scenes' }
  | { readonly code: 'tuning-out-of-range' }
  | { readonly code: 'no-applied-scene' }
  | { readonly code: 'scene-render-failed' }
  | { readonly code: 'mosaic-render-failed' }
  | { readonly code: 'mosaic-restore-failed' }
  | {
      readonly code: 'tile-failed';
      readonly reason: MapFailureReason;
      readonly httpStatus: number | null;
    }
  | {
      readonly code: 'search-failed';
      /** `null` when the search failed outside the satellite application boundary. */
      readonly searchErrorCode: SatelliteSearchErrorCode | null;
    };

export type AppliedSatelliteImagerySnapshot =
  | { readonly status: 'empty' }
  | {
      readonly status: 'loading';
      readonly sceneKey: string;
      readonly previousSceneKey: string | null;
      readonly stage: 'preparing' | 'requesting-tiles' | 'rendering' | 'finalizing';
      readonly startedAt: number;
    }
  | {
      readonly status: 'preview' | 'ready';
      readonly sceneKey: string;
      readonly sceneId: string;
      readonly visible: true;
    }
  | {
      readonly status: 'hidden';
      readonly sceneKey: string;
      readonly sceneId: string;
      readonly visible: false;
    }
  | {
      readonly status: 'failed';
      readonly sceneKey: string;
      readonly previousSceneKey: string | null;
      readonly problem: SatelliteImageryProblem;
    };

interface AppliedSatelliteMosaicFields {
  readonly selectedDate: string;
  readonly sceneKeys: readonly string[];
  readonly coveragePercent: number;
  readonly oldestAcquisitionDate: string | null;
}

export interface SatelliteMosaicRenderProgress {
  readonly renderedSceneCount: number;
  readonly totalSceneCount: number;
}

export type AppliedSatelliteMosaicSnapshot =
  | { readonly status: 'empty' }
  | ({
      readonly status: 'loading';
      readonly renderProgress: SatelliteMosaicRenderProgress | null;
    } & AppliedSatelliteMosaicFields)
  | ({ readonly status: 'ready' } & AppliedSatelliteMosaicFields)
  | ({
      readonly status: 'failed';
      readonly problem: SatelliteImageryProblem;
    } & AppliedSatelliteMosaicFields);

/**
 * Why a map-layer command failed. The layers panel maps each code to localized copy;
 * `satellite-imagery-failed` reuses the satellite imagery problem mapping.
 * `terrain-overlay-failed` is only returned by commands; the store publishes that
 * failure in `terrainOverlays.problem` instead of `layerProblem`.
 */
export type MapLayerProblem =
  | { readonly code: 'map-not-ready' }
  | { readonly code: 'weather-hides-terrain' }
  | { readonly code: 'scene-required' }
  | { readonly code: 'preset-requires-scene' }
  | { readonly code: 'layer-unavailable' }
  | { readonly code: 'opacity-out-of-range' }
  | { readonly code: 'track-geometry-invalid' }
  | { readonly code: 'track-render-failed' }
  | { readonly code: 'planned-line-geometry-invalid' }
  | { readonly code: 'planned-line-render-failed' }
  | {
      readonly code: 'satellite-imagery-failed';
      readonly problem: SatelliteImageryProblem;
    }
  | {
      readonly code: 'terrain-overlay-failed';
      readonly problem: TerrainOverlayProblem;
    };

/** Why terrain relief or contour overlays could not be configured or rendered. */
export type TerrainOverlayProblem =
  | 'map-not-ready'
  | 'unsupported-contour-interval'
  | 'relief-render-failed'
  | 'contours-failed';

/** Why the weather map could not be enabled or changed. */
export type WeatherMapProblem =
  | 'map-not-ready'
  | 'provider-unavailable'
  | 'data-unavailable'
  | 'no-forecast-time'
  | 'frame-failed'
  | 'not-enabled'
  | 'time-unavailable'
  | 'opacity-out-of-range';

interface TerrainOverlaySnapshot {
  readonly initialized: boolean;
  readonly preferences: TerrainOverlayPreferences;
  readonly problem: TerrainOverlayProblem | null;
}
export interface WeatherMapSnapshot {
  readonly enabled: boolean;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly opacity: number;
  readonly referenceTime: string | null;
  readonly validTimes: readonly string[];
  readonly selectedTimeIndex: number | null;
  readonly renderProgress: {
    readonly loadedSourceCount: number;
    readonly totalSourceCount: number;
  } | null;
  readonly problem: WeatherMapProblem | null;
}

interface MapLayerState {
  readonly appliedImagery: AppliedSatelliteImagerySnapshot;
  readonly appliedMosaic: AppliedSatelliteMosaicSnapshot;
  readonly automaticAlternativeProviderState: 'inactive' | 'switching' | 'active';
  readonly layerProblem: MapLayerProblem | null;
  readonly terrainComputeStatus: TerrainComputeStatus;
  readonly terrainComputeQueue: TerrainComputeQueueState;
  readonly visibility: Readonly<Record<LogicalMapLayerId, boolean>>;
  readonly openStreetMapOpacity: number;
  readonly importedTrackOpacity: number;
  readonly satelliteRenderingMode: SatelliteRenderingMode;
  readonly satelliteRenderingTuning: SatelliteRenderingTuning;
  readonly selectedScene: SatelliteScene | null;
  readonly terrainOverlays: TerrainOverlaySnapshot;
  readonly weatherMap: WeatherMapSnapshot;
}

const initialMapLayerState: MapLayerState = {
  appliedImagery: { status: 'empty' },
  appliedMosaic: { status: 'empty' },
  automaticAlternativeProviderState: 'inactive',
  layerProblem: null,
  terrainComputeStatus: 'worker',
  terrainComputeQueue: {
    executionMode: 'worker',
    activeCount: 0,
    queuedContourCount: 0,
    queueCapacity: defaultTerrainContourQueueCapacity,
  },
  visibility: {
    'google-satellite': false,
    'bing-satellite': false,
    'esri-satellite': false,
    'napr-orthophoto': false,
    'satellite-imagery': true,
    'scene-footprint': true,
    'terrain-relief': true,
    'elevation-isolines': true,
    'natural-features': true,
    'restricted-areas': true,
    'detail-context': true,
    'hiking-paths': true,
    roads: true,
    'places-and-pois': true,
    'imported-tracks': true,
    'track-elevation-gradient': true,
  },
  openStreetMapOpacity: 1,
  importedTrackOpacity: 1,
  satelliteRenderingMode: defaultSatelliteRenderingMode,
  satelliteRenderingTuning: defaultSatelliteRenderingTuning,
  selectedScene: null,
  terrainOverlays: {
    initialized: false,
    preferences: defaultTerrainOverlayPreferences,
    problem: null,
  },
  weatherMap: {
    enabled: false,
    status: 'idle',
    opacity: defaultWeatherMapOpacity,
    referenceTime: null,
    validTimes: [],
    selectedTimeIndex: null,
    renderProgress: null,
    problem: null,
  },
};

/** Serializable map-layer state shared by map controls and feature panels. */
export const mapLayerStore = createStore<MapLayerState>()(() => initialMapLayerState);

export function resetMapLayerStore(): void {
  mapLayerStore.setState(initialMapLayerState, true);
}
