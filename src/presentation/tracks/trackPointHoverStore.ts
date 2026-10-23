import { createStore } from 'zustand/vanilla';

/** Where the pointer is: the profile draws its own map marker at the exact sample. */
export type TrackPointHoverSource = 'list' | 'map' | 'profile';

interface TrackPointHover {
  /** Anchor index of the listed path, or null while nothing is hovered. */
  readonly index: number | null;
  readonly source: TrackPointHoverSource | null;
}

/**
 * The listed track point under the pointer in the Points list, on the map, or on the
 * elevation profile. A store rather than workspace state: pointer moves re-render only
 * the list rows and the profile marker that change, and the workspace draws the orange
 * map marker imperatively.
 */
export const trackPointHoverStore = createStore<TrackPointHover>(() => ({
  index: null,
  source: null,
}));

export function setHoveredTrackPoint(
  index: number | null,
  source: TrackPointHoverSource,
): void {
  const current = trackPointHoverStore.getState();
  if (index === null) {
    // Leaving one view must not clear a hover another view started since.
    if (current.index !== null && current.source === source) {
      trackPointHoverStore.setState({ index: null, source: null });
    }
    return;
  }
  if (current.index !== index || current.source !== source) {
    trackPointHoverStore.setState({ index, source });
  }
}

export function clearHoveredTrackPoint(): void {
  trackPointHoverStore.setState({ index: null, source: null });
}
