import { create } from 'zustand';

import type { MarkerSort } from '@/domain/markers/savedMarker';
import type { TrackSort } from '@/domain/tracks/localTrack';

import type { MapDebugOptions } from '@/presentation/map/mapTypes';

export type WorkspaceTab = 'tracks' | 'satellite' | 'markers' | 'layers' | 'user';

interface UiState {
  readonly activeTab: WorkspaceTab;
  readonly developerDrawerOpen: boolean;
  readonly developerMode: boolean;
  readonly elevationGradeLegendDismissed: boolean;
  readonly mapDebugOptions: MapDebugOptions;
  readonly markerSort: MarkerSort;
  readonly trackSort: TrackSort;
  readonly mobileWorkspaceOpen: boolean;
  readonly navigationCollapsed: boolean;
  readonly settingsOpen: boolean;
  readonly setActiveTab: (value: WorkspaceTab) => void;
  readonly setDeveloperDrawerOpen: (value: boolean) => void;
  readonly setDeveloperMode: (value: boolean) => void;
  readonly setElevationGradeLegendDismissed: (value: boolean) => void;
  readonly setMapDebugOptions: (value: MapDebugOptions) => void;
  readonly setMarkerSort: (value: MarkerSort) => void;
  readonly setTrackSort: (value: TrackSort) => void;
  readonly setMobileWorkspaceOpen: (value: boolean) => void;
  readonly setNavigationCollapsed: (value: boolean) => void;
  readonly setSettingsOpen: (value: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  activeTab: 'satellite',
  developerDrawerOpen: false,
  developerMode: false,
  elevationGradeLegendDismissed: false,
  mapDebugOptions: { showCollisionBoxes: false, showTileBoundaries: false },
  markerSort: 'created',
  trackSort: 'created',
  mobileWorkspaceOpen: false,
  navigationCollapsed: false,
  settingsOpen: false,
  setActiveTab: (activeTab) => {
    set({ activeTab });
  },
  setDeveloperDrawerOpen: (developerDrawerOpen) => {
    set({ developerDrawerOpen });
  },
  setDeveloperMode: (developerMode) => {
    set({ developerMode });
  },
  setElevationGradeLegendDismissed: (elevationGradeLegendDismissed) => {
    set({ elevationGradeLegendDismissed });
  },
  setMapDebugOptions: (mapDebugOptions) => {
    set({ mapDebugOptions });
  },
  setMarkerSort: (markerSort) => {
    set({ markerSort });
  },
  setTrackSort: (trackSort) => {
    set({ trackSort });
  },
  setMobileWorkspaceOpen: (mobileWorkspaceOpen) => {
    set({ mobileWorkspaceOpen });
  },
  setNavigationCollapsed: (navigationCollapsed) => {
    set({ navigationCollapsed });
  },
  setSettingsOpen: (settingsOpen) => {
    set({ settingsOpen });
  },
}));
