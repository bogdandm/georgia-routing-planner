import { create } from 'zustand';

import type { MapDebugOptions } from '@/presentation/map/mapTypes';

export type WorkspaceTab = 'tracks' | 'satellite' | 'markers' | 'layers' | 'user';

interface UiState {
  readonly activeTab: WorkspaceTab;
  readonly developerDrawerOpen: boolean;
  readonly developerMode: boolean;
  readonly elevationGradeLegendDismissed: boolean;
  readonly mapDebugOptions: MapDebugOptions;
  readonly mobileWorkspaceOpen: boolean;
  readonly navigationCollapsed: boolean;
  readonly settingsOpen: boolean;
  readonly setActiveTab: (value: WorkspaceTab) => void;
  readonly setDeveloperDrawerOpen: (value: boolean) => void;
  readonly setDeveloperMode: (value: boolean) => void;
  readonly setElevationGradeLegendDismissed: (value: boolean) => void;
  readonly setMapDebugOptions: (value: MapDebugOptions) => void;
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
