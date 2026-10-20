import { createStore } from 'zustand/vanilla';

import {
  type SatelliteScene,
  satelliteSceneKey,
} from '@/domain/satellite/SatelliteScene';
import { requestMapNavigation } from '@/presentation/map/mapInteractionStore';
import type { SatelliteCompareCamera } from '@/presentation/map/SatelliteCompareMaps';

export const minimumComparedScenes = 2;
export const maximumComparedScenes = 4;

/** A grid position: a scene, or an empty plain map whose date is still to be picked. */
export type ComparisonSlot = SatelliteScene | null;

/** Sentinel tiles of one pane's current view: finished (loaded or failed) of requested. */
export interface ComparisonTileProgress {
  readonly finished: number;
  readonly requested: number;
  /** Every tile of the current view is in; the next move starts a new count. */
  readonly complete: boolean;
}

/**
 * Transient Sentinel-2 comparison. Never persisted; a compare link carries the keys.
 *
 * `scenes` is the tray filled from result cards while the grid is closed, in acquisition
 * order. `slots` are the grid positions while it is open: two side by side, or four in
 * 2×2. Opening copies the tray into the slots; closing copies the filled slots back.
 */
interface SatelliteCompareState {
  readonly scenes: readonly SatelliteScene[];
  readonly slots: readonly ComparisonSlot[];
  /** Last settled grid camera; the main map returns to it when the grid closes. */
  readonly camera: SatelliteCompareCamera | null;
  /** A pane switched from TiTiler to slower browser-rendered imagery. */
  readonly directFallback: boolean;
  /** Imagery loading per grid position; positions without a report are still waiting. */
  readonly tileProgress: Readonly<Record<number, ComparisonTileProgress>>;
}

const initialState: SatelliteCompareState = {
  scenes: [],
  slots: [],
  camera: null,
  directFallback: false,
  tileProgress: {},
};

export const satelliteCompareStore = createStore<SatelliteCompareState>()(
  () => initialState,
);

export function isComparisonOpen(state: SatelliteCompareState): boolean {
  return state.slots.length > 0;
}

function chronological(scenes: readonly SatelliteScene[]): readonly SatelliteScene[] {
  return [...scenes].sort(
    (left, right) => Date.parse(left.acquiredAt) - Date.parse(right.acquiredAt),
  );
}

/** Two scenes sit side by side unless four positions are requested; otherwise 2×2. */
function gridSlots(
  scenes: readonly SatelliteScene[],
  minimumSlots: 2 | 4,
): readonly ComparisonSlot[] {
  const size = minimumSlots === 2 && scenes.length <= 2 ? 2 : maximumComparedScenes;
  return Array.from({ length: size }, (_, index) => scenes[index] ?? null);
}

export function isComparedScene(
  scenes: readonly ComparisonSlot[],
  sceneKey: string,
): boolean {
  return scenes.some(
    (scene) => scene !== null && satelliteSceneKey(scene) === sceneKey,
  );
}

/** Adds a scene to the tray unless it is already there or the tray is full. */
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

export function removeComparedScene(sceneKey: string): void {
  satelliteCompareStore.setState({
    scenes: satelliteCompareStore
      .getState()
      .scenes.filter((scene) => satelliteSceneKey(scene) !== sceneKey),
  });
}

export function clearComparedScenes(): void {
  satelliteCompareStore.setState({ scenes: [] });
}

/** Opens the tray's two to four scenes; two sit side by side. */
export function openComparison(camera: SatelliteCompareCamera): void {
  const { scenes } = satelliteCompareStore.getState();
  if (scenes.length < minimumComparedScenes) return;
  satelliteCompareStore.setState({
    slots: gridSlots(scenes, 2),
    camera,
    directFallback: false,
    tileProgress: {},
  });
}

/** Opens a 2×2 grid with the tray's scenes first and plain maps in the other cells. */
export function openComparisonGrid(camera: SatelliteCompareCamera): void {
  satelliteCompareStore.setState({
    slots: gridSlots(satelliteCompareStore.getState().scenes, 4),
    camera,
    directFallback: false,
    tileProgress: {},
  });
}

/** Opens a compare link: its scenes take the positions in link order. */
export function openSharedComparison(
  scenes: readonly SatelliteScene[],
  camera: SatelliteCompareCamera,
): void {
  if (scenes.length < minimumComparedScenes) return;
  satelliteCompareStore.setState({
    slots: gridSlots(scenes.slice(0, maximumComparedScenes), 2),
    camera,
    directFallback: false,
    tileProgress: {},
  });
}

/**
 * Shows a scene at a grid position. Returns false, leaving the grid unchanged, when the
 * scene is already shown at another position.
 */
export function setComparisonSlot(index: number, scene: SatelliteScene): boolean {
  const { slots } = satelliteCompareStore.getState();
  const sceneKey = satelliteSceneKey(scene);
  if (
    slots.some(
      (slot, slotIndex) =>
        slotIndex !== index && slot !== null && satelliteSceneKey(slot) === sceneKey,
    )
  ) {
    return false;
  }
  satelliteCompareStore.setState({
    slots: slots.map((slot, slotIndex) => (slotIndex === index ? scene : slot)),
  });
  return true;
}

/** Turns a grid position back into a plain map. */
export function clearComparisonSlot(index: number): void {
  satelliteCompareStore.setState({
    slots: satelliteCompareStore
      .getState()
      .slots.map((slot, slotIndex) => (slotIndex === index ? null : slot)),
  });
}

export function clearComparisonSlots(): void {
  satelliteCompareStore.setState({
    slots: satelliteCompareStore.getState().slots.map(() => null),
  });
}

/** Exchanges two grid positions, for dragging a date label onto another pane. */
export function swapComparisonSlots(from: number, to: number): void {
  const { slots } = satelliteCompareStore.getState();
  const fromSlot = slots[from];
  const toSlot = slots[to];
  if (from === to || fromSlot === undefined || toSlot === undefined) return;
  satelliteCompareStore.setState({
    slots: slots.map((slot, index) =>
      index === from ? toSlot : index === to ? fromSlot : slot,
    ),
  });
}

export function setComparisonCamera(camera: SatelliteCompareCamera): void {
  satelliteCompareStore.setState({ camera });
}

export function reportComparisonDirectFallback(): void {
  if (!satelliteCompareStore.getState().directFallback) {
    satelliteCompareStore.setState({ directFallback: true });
  }
}

/** A pane's imagery loading; null forgets it, as for a pane that lost its scene. */
export function setComparisonTileProgress(
  index: number,
  progress: ComparisonTileProgress | null,
): void {
  const { [index]: _previous, ...others } =
    satelliteCompareStore.getState().tileProgress;
  satelliteCompareStore.setState({
    tileProgress: progress === null ? others : { ...others, [index]: progress },
  });
}

/**
 * Closes the grid, keeps its scenes in the tray, and moves the main map to the area that
 * was being compared.
 */
export function closeComparison(): void {
  const { slots, camera } = satelliteCompareStore.getState();
  if (slots.length === 0) return;
  satelliteCompareStore.setState({
    scenes: chronological(slots.filter((slot) => slot !== null)),
    slots: [],
    directFallback: false,
    tileProgress: {},
  });
  if (camera !== null) {
    requestMapNavigation({
      longitude: camera.center.longitude,
      latitude: camera.center.latitude,
      zoom: camera.zoom,
      exactZoom: true,
    });
  }
}

export function resetSatelliteCompareStore(): void {
  satelliteCompareStore.setState(initialState, true);
}
