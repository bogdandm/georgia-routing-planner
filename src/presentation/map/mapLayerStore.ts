import { createStore } from 'zustand/vanilla';

import type { LogicalMapLayerId } from '@/presentation/map/MapLayerVisibility';
import type { AppliedSatelliteImagerySnapshot } from '@/presentation/map/SatelliteImageryMap';
import type { TerrainOverlayPreferences } from '@/application/ports/MapLayerPreferencesRepository';
import { defaultTerrainOverlayPreferences } from '@/application/ports/MapLayerPreferencesRepository';

export interface TerrainOverlaySnapshot {
  readonly initialized: boolean;
  readonly preferences: TerrainOverlayPreferences;
  readonly message: string | null;
}

export interface MapLayerState {
  readonly appliedImagery: AppliedSatelliteImagerySnapshot;
  readonly errorMessage: string | null;
  readonly visibility: Readonly<Record<LogicalMapLayerId, boolean>>;
  readonly terrainOverlays: TerrainOverlaySnapshot;
}

export const initialMapLayerState: MapLayerState = {
  appliedImagery: { status: 'empty' },
  errorMessage: null,
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
