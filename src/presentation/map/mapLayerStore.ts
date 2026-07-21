import { createStore } from 'zustand/vanilla';

import type { LogicalMapLayerId } from '@/presentation/map/MapLayerVisibility';
import type { AppliedSatelliteImagerySnapshot } from '@/presentation/map/SatelliteImageryMap';
import type {
  SatelliteRenderingMode,
  TerrainOverlayPreferences,
} from '@/application/ports/MapLayerPreferencesRepository';
import {
  defaultSatelliteRenderingMode,
  defaultTerrainOverlayPreferences,
} from '@/application/ports/MapLayerPreferencesRepository';
import type {
  TerrainComputeQueueState,
  TerrainComputeStatus,
} from '@/infrastructure/elevation/TerrainComputeBackend';
import { defaultTerrainContourQueueCapacity } from '@/infrastructure/elevation/TerrainComputeBackend';

export interface TerrainOverlaySnapshot {
  readonly initialized: boolean;
  readonly preferences: TerrainOverlayPreferences;
  readonly message: string | null;
}

export interface MapLayerState {
  readonly appliedImagery: AppliedSatelliteImagerySnapshot;
  readonly automaticBrowserFallbackActive: boolean;
  readonly errorMessage: string | null;
  readonly terrainComputeStatus: TerrainComputeStatus;
  readonly terrainComputeQueue: TerrainComputeQueueState;
  readonly visibility: Readonly<Record<LogicalMapLayerId, boolean>>;
  readonly openStreetMapOpacity: number;
  readonly satelliteRenderingMode: SatelliteRenderingMode;
  readonly terrainOverlays: TerrainOverlaySnapshot;
}

export const initialMapLayerState: MapLayerState = {
  appliedImagery: { status: 'empty' },
  automaticBrowserFallbackActive: false,
  errorMessage: null,
  terrainComputeStatus: 'worker',
  terrainComputeQueue: {
    executionMode: 'worker',
    activeCount: 0,
    queuedContourCount: 0,
    queueCapacity: defaultTerrainContourQueueCapacity,
  },
  visibility: {
    'satellite-imagery': true,
    'scene-footprint': true,
    'terrain-relief': true,
    'elevation-isolines': true,
    'natural-features': true,
    'restricted-areas': true,
    'hiking-paths': true,
    roads: true,
    'places-and-pois': true,
  },
  openStreetMapOpacity: 1,
  satelliteRenderingMode: defaultSatelliteRenderingMode,
  terrainOverlays: {
    initialized: false,
    preferences: defaultTerrainOverlayPreferences,
    message: null,
  },
};

/** Serializable state shared by Satellite and Layers; stable choices persist in Dexie. */
export const mapLayerStore = createStore<MapLayerState>()(() => initialMapLayerState);

export function resetMapLayerStore(): void {
  mapLayerStore.setState(initialMapLayerState, true);
}
