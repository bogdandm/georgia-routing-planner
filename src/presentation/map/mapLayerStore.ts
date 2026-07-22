import { createStore } from 'zustand/vanilla';

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
} from '@/application/ports/MapLayerPreferencesRepository';
import type {
  TerrainComputeQueueState,
  TerrainComputeStatus,
} from '@/infrastructure/elevation/TerrainComputeBackend';
import { defaultTerrainContourQueueCapacity } from '@/infrastructure/elevation/TerrainComputeBackend';

export type AppliedSatelliteImagerySnapshot =
  | { readonly status: 'empty' }
  | {
      readonly status: 'loading';
      readonly sceneKey: string;
      readonly previousSceneKey: string | null;
      readonly stage: 'preparing' | 'requesting-tiles' | 'rendering' | 'finalizing';
      readonly message: string;
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
      readonly message: string;
    };

interface TerrainOverlaySnapshot {
  readonly initialized: boolean;
  readonly preferences: TerrainOverlayPreferences;
  readonly message: string | null;
}

interface MapLayerState {
  readonly appliedImagery: AppliedSatelliteImagerySnapshot;
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
}

const initialMapLayerState: MapLayerState = {
  appliedImagery: { status: 'empty' },
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
    'satellite-imagery': true,
    'scene-footprint': true,
    'terrain-relief': true,
    'elevation-isolines': true,
    'natural-features': true,
    'restricted-areas': true,
    'hiking-paths': true,
    roads: true,
    'places-and-pois': true,
    'imported-tracks': true,
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
};

/** Serializable state shared by Satellite and Layers; stable choices persist in Dexie. */
export const mapLayerStore = createStore<MapLayerState>()(() => initialMapLayerState);

export function resetMapLayerStore(): void {
  mapLayerStore.setState(initialMapLayerState, true);
}
