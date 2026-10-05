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

interface TerrainOverlaySnapshot {
  readonly initialized: boolean;
  readonly preferences: TerrainOverlayPreferences;
  readonly message: string | null;
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
  readonly message: string | null;
}

interface MapLayerState {
  readonly appliedImagery: AppliedSatelliteImagerySnapshot;
  readonly appliedMosaic: AppliedSatelliteMosaicSnapshot;
  readonly automaticAlternativeProviderState: 'inactive' | 'switching' | 'active';
  readonly errorMessage: string | null;
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
  errorMessage: null,
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
    message: null,
  },
  weatherMap: {
    enabled: false,
    status: 'idle',
    opacity: defaultWeatherMapOpacity,
    referenceTime: null,
    validTimes: [],
    selectedTimeIndex: null,
    renderProgress: null,
    message: null,
  },
};

/** Serializable map-layer state shared by map controls and feature panels. */
export const mapLayerStore = createStore<MapLayerState>()(() => initialMapLayerState);

export function resetMapLayerStore(): void {
  mapLayerStore.setState(initialMapLayerState, true);
}
