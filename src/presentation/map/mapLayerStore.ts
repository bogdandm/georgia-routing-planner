import { createStore } from 'zustand/vanilla';

import type { LogicalMapLayerId } from '@/presentation/map/MapLayerVisibility';
import type { AppliedSatelliteImagerySnapshot } from '@/presentation/map/SatelliteImageryMap';

export interface MapLayerState {
  readonly appliedImagery: AppliedSatelliteImagerySnapshot;
  readonly errorMessage: string | null;
  readonly visibility: Readonly<Record<LogicalMapLayerId, boolean>>;
}

export const initialMapLayerState: MapLayerState = {
  appliedImagery: { status: 'empty' },
  errorMessage: null,
  visibility: {
    'satellite-imagery': true,
    'scene-footprint': true,
    'hiking-paths': true,
    roads: true,
    'places-and-pois': true,
  },
};

/** Session-only serializable state shared by Satellite and Layers presentation. */
export const mapLayerStore = createStore<MapLayerState>()(() => initialMapLayerState);

export function resetMapLayerStore(): void {
  mapLayerStore.setState(initialMapLayerState, true);
}
