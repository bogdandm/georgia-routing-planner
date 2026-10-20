import { createStore } from 'zustand/vanilla';

import {
  type SatelliteScene,
  satelliteSceneKey,
} from '@/domain/satellite/SatelliteScene';
import { requestMapNavigation } from '@/presentation/map/mapInteractionStore';
import type { SatelliteCompareCamera } from '@/presentation/map/SatelliteCompareMaps';

export const minimumComparedScenes = 2;
export const maximumComparedScenes = 4;

/**
 * Transient Sentinel-2 comparison: the scenes picked from result cards, in acquisition
 * order, and whether the comparison grid replaces the main map. `open` implies at least
 * `minimumComparedScenes` scenes. Never persisted; a compare link carries the keys.
 */
interface SatelliteCompareState {
  readonly scenes: readonly SatelliteScene[];
  readonly open: boolean;
  /** Last settled grid camera; the main map returns to it when the grid closes. */
  readonly camera: SatelliteCompareCamera | null;
}

const initialState: SatelliteCompareState = { scenes: [], open: false, camera: null };

export const satelliteCompareStore = createStore<SatelliteCompareState>()(
  () => initialState,
);

function chronological(scenes: readonly SatelliteScene[]): readonly SatelliteScene[] {
  return [...scenes].sort(
    (left, right) => Date.parse(left.acquiredAt) - Date.parse(right.acquiredAt),
  );
}

export function isComparedScene(
  scenes: readonly SatelliteScene[],
  sceneKey: string,
): boolean {
  return scenes.some((scene) => satelliteSceneKey(scene) === sceneKey);
}

/** Adds a scene unless it is already compared or the comparison is full. */
export function addComparedScene(scene: SatelliteScene): void {
  const { scenes } = satelliteCompareStore.getState();
  if (
    scenes.length >= maximumComparedScenes ||
    isComparedScene(scenes, satelliteSceneKey(scene))
  ) {
    return;
  }
  satelliteCompareStore.setState({ scenes: chronological([...scenes, scene]) });
}

/** Removes a scene; an open grid closes when fewer than two scenes remain. */
export function removeComparedScene(sceneKey: string): void {
  const scenes = satelliteCompareStore
    .getState()
    .scenes.filter((scene) => satelliteSceneKey(scene) !== sceneKey);
  satelliteCompareStore.setState({ scenes });
  if (scenes.length < minimumComparedScenes) closeComparison();
}

export function clearComparedScenes(): void {
  closeComparison();
  satelliteCompareStore.setState({ scenes: [] });
}

export function openComparison(camera: SatelliteCompareCamera): void {
  if (satelliteCompareStore.getState().scenes.length < minimumComparedScenes) return;
  satelliteCompareStore.setState({ open: true, camera });
}

/** Opens a compare link: its scenes replace the current comparison. */
export function openSharedComparison(
  scenes: readonly SatelliteScene[],
  camera: SatelliteCompareCamera,
): void {
  if (scenes.length < minimumComparedScenes) return;
  satelliteCompareStore.setState({
    scenes: chronological(scenes.slice(0, maximumComparedScenes)),
    open: true,
    camera,
  });
}

export function setComparisonCamera(camera: SatelliteCompareCamera): void {
  satelliteCompareStore.setState({ camera });
}

/** Closes the grid and moves the main map to the area that was being compared. */
export function closeComparison(): void {
  const { open, camera } = satelliteCompareStore.getState();
  if (!open) return;
  satelliteCompareStore.setState({ open: false });
  if (camera !== null) {
    requestMapNavigation({
      longitude: camera.center.longitude,
      latitude: camera.center.latitude,
      zoom: camera.zoom,
    });
  }
}

export function resetSatelliteCompareStore(): void {
  satelliteCompareStore.setState(initialState, true);
}
