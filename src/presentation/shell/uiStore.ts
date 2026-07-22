import { create } from 'zustand';

import type { MapDebugOptions } from '@/presentation/map/mapTypes';

export type WorkspaceTab = 'tracks' | 'satellite' | 'markers' | 'layers';

interface UiState {
  readonly activeTab: WorkspaceTab;
  readonly developerDrawerOpen: boolean;
  readonly developerMode: boolean;
  readonly mapDebugOptions: MapDebugOptions;
  readonly navigationCollapsed: boolean;
  readonly settingsOpen: boolean;
  readonly setActiveTab: (value: WorkspaceTab) => void;
  readonly setDeveloperDrawerOpen: (value: boolean) => void;
  readonly setDeveloperMode: (value: boolean) => void;
  readonly setMapDebugOptions: (value: MapDebugOptions) => void;
  readonly setNavigationCollapsed: (value: boolean) => void;
  readonly setSettingsOpen: (value: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  activeTab: 'satellite',
  developerDrawerOpen: false,
  developerMode: false,
  mapDebugOptions: { showCollisionBoxes: false, showTileBoundaries: false },
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
  setMapDebugOptions: (mapDebugOptions) => {
    set({ mapDebugOptions });
  },
  setNavigationCollapsed: (navigationCollapsed) => {
    set({ navigationCollapsed });
  },
  setSettingsOpen: (settingsOpen) => {
    set({ settingsOpen });
  },
}));
