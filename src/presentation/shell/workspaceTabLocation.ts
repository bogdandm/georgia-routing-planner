import type { WorkspaceTab } from '@/presentation/shell/uiStore';

/* eslint-disable -- URL fragments are locale-independent machine data. */
const hashByTab: Readonly<Record<WorkspaceTab, string>> = {
  tracks: '#tracks',
  satellite: '#satellite',
  weather: '#weather',
  markers: '#markers',
  layers: '#layers',
  user: '#user',
};

/** The Satellite image comparison grid, opened and closed with its URL hash. */
export const comparisonHash = '#satellite/compare';

export function isComparisonHash(hash: string): boolean {
  return hash.toLowerCase() === comparisonHash;
}

/** Returns the workspace destination encoded by a URL hash, if it is recognized. */
export function workspaceTabFromHash(hash: string): WorkspaceTab | null {
  const normalized = hash.toLowerCase();
  for (const [tab, tabHash] of Object.entries(hashByTab)) {
    if (normalized === tabHash) return tab as WorkspaceTab;
  }
  if (normalized.startsWith('#tracks/share/')) return 'tracks';
  if (normalized === comparisonHash) return 'satellite';
  return normalized === '#satelite' ? 'satellite' : null;
}
/* eslint-enable */

/** Returns the stable shareable URL hash for a workspace destination. */
export function workspaceHashForTab(tab: WorkspaceTab): string {
  return hashByTab[tab];
}
