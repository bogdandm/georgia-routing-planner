import type { WorkspaceTab } from '@/presentation/shell/uiStore';

const hashByTab: Readonly<Record<WorkspaceTab, string>> = {
  tracks: '#tracks',
  satellite: '#satellite',
  markers: '#markers',
  layers: '#layers',
};

/** Returns the workspace destination encoded by a URL hash, if it is recognized. */
export function workspaceTabFromHash(hash: string): WorkspaceTab | null {
  const normalized = hash.toLowerCase();
  for (const [tab, tabHash] of Object.entries(hashByTab)) {
    if (normalized === tabHash) return tab as WorkspaceTab;
  }
  return normalized === '#satelite' ? 'satellite' : null;
}

/** Returns the stable shareable URL hash for a workspace destination. */
export function workspaceHashForTab(tab: WorkspaceTab): string {
  return hashByTab[tab];
}
