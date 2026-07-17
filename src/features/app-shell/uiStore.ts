import { create } from 'zustand';

export type WorkspaceTab = 'tracks' | 'plan' | 'satellite';

interface UiState {
  readonly activeTab: WorkspaceTab;
  readonly developerDrawerOpen: boolean;
  readonly developerMode: boolean;
  readonly elevationExpanded: boolean;
  readonly settingsOpen: boolean;
  readonly setActiveTab: (value: WorkspaceTab) => void;
  readonly setDeveloperDrawerOpen: (value: boolean) => void;
  readonly setDeveloperMode: (value: boolean) => void;
  readonly setElevationExpanded: (value: boolean) => void;
  readonly setSettingsOpen: (value: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  activeTab: 'tracks',
  developerDrawerOpen: false,
  developerMode: false,
  elevationExpanded: true,
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
  setElevationExpanded: (elevationExpanded) => {
    set({ elevationExpanded });
  },
  setSettingsOpen: (settingsOpen) => {
    set({ settingsOpen });
  },
}));
