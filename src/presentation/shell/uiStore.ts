import { create } from 'zustand';

import type { MapDebugOptions } from '@/presentation/map/mapTypes';

export type WorkspaceTab = 'tracks' | 'plan' | 'satellite';

interface UiState {
  readonly activeTab: WorkspaceTab;
  readonly developerDrawerOpen: boolean;
  readonly developerMode: boolean;
  readonly mapDebugOptions: MapDebugOptions;
  readonly settingsOpen: boolean;
  readonly setActiveTab: (value: WorkspaceTab) => void;
  readonly setDeveloperDrawerOpen: (value: boolean) => void;
  readonly setDeveloperMode: (value: boolean) => void;
  readonly setMapDebugOptions: (value: MapDebugOptions) => void;
  readonly setSettingsOpen: (value: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  activeTab: 'tracks',
  developerDrawerOpen: false,
  developerMode: false,
  mapDebugOptions: { showCollisionBoxes: false, showTileBoundaries: false },
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
  setSettingsOpen: (settingsOpen) => {
    set({ settingsOpen });
  },
}));
