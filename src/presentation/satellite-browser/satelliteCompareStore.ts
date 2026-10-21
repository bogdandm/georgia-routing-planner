import { createStore } from 'zustand/vanilla';

import { calculateSatelliteCoverage } from '@/domain/satellite/calculateSatelliteCoverage';
import {
  type SatelliteScene,
  satelliteSceneBounds,
  satelliteSceneKey,
} from '@/domain/satellite/SatelliteScene';
import type { SatelliteSearchViewport } from '@/domain/satellite/SatelliteSearchCriteria';
import { requestMapNavigation } from '@/presentation/map/mapInteractionStore';
import type { SatelliteBasemap } from '@/presentation/map/mapShareUrl';
import { defaultGeorgiaCamera, type MapCamera } from '@/presentation/map/mapTypes';
import type { SatelliteCompareCamera } from '@/presentation/map/SatelliteCompareMaps';

export const minimumComparedScenes = 2;
export const maximumComparedScenes = 4;

/**
 * A compared image: a Sentinel-2 scene or a static basemap (satellite imagery or the
 * Soviet topographic map). A basemap covers all of Georgia, so it never leaves the
 * comparison when the view moves elsewhere.
 */
export type ComparisonImage = SatelliteScene | SatelliteBasemap;

/** A grid position: an image, or an empty plain map whose image is still to be picked. */
export type ComparisonSlot = ComparisonImage | null;

/** Grid positions: two side by side (2×1) or four in a 2×2 grid. */
export type ComparisonLayout = 2 | 4;

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
 * `images` is the tray filled from result cards while the grid is closed: scenes in
 * acquisition order, then basemaps. `slots` are the grid positions while it is open: two
 * side by side, or four in 2×2. Opening copies the tray into the slots; closing copies
 * the filled slots back.
 */
interface SatelliteCompareState {
  readonly images: readonly ComparisonImage[];
  readonly slots: readonly ComparisonSlot[];
  /** Last settled grid camera; the main map returns to it when the grid closes. */
  readonly camera: SatelliteCompareCamera | null;
  /** A pane switched from TiTiler to slower browser-rendered imagery. */
  readonly directFallback: boolean;
  /** Imagery loading per grid position; positions without a report are still waiting. */
  readonly tileProgress: Readonly<Record<number, ComparisonTileProgress>>;
  /** Month (`YYYY-MM`) last shown by any pane's calendar; the next calendar opens on it. */
  readonly calendarMonth: string | null;
  /** Layout last picked in the sidebar, kept in the browser; null before any pick. */
  readonly preferredLayout: ComparisonLayout | null;
}

const initialState: SatelliteCompareState = {
  images: [],
  slots: [],
  camera: null,
  directFallback: false,
  tileProgress: {},
  calendarMonth: null,
  preferredLayout: null,
};

export const satelliteCompareStore = createStore<SatelliteCompareState>()(
  () => initialState,
);

export function isComparisonOpen(state: SatelliteCompareState): boolean {
  return state.slots.length > 0;
}

export function isComparisonBasemap(image: ComparisonImage): image is SatelliteBasemap {
  return typeof image === 'string';
}

/** A scene's catalog key or a basemap's ID; compare links carry these in pane order. */
export function comparisonImageKey(image: ComparisonImage): string {
  return isComparisonBasemap(image) ? image : satelliteSceneKey(image);
}

function trayOrder(images: readonly ComparisonImage[]): readonly ComparisonImage[] {
  const scenes = images.flatMap((image) => (isComparisonBasemap(image) ? [] : [image]));
  return [
    ...scenes.sort(
      (left, right) => Date.parse(left.acquiredAt) - Date.parse(right.acquiredAt),
    ),
    ...images.filter(isComparisonBasemap),
  ];
}

/** Two images sit side by side unless four positions are requested; otherwise 2×2. */
function gridSlots(
  images: readonly ComparisonImage[],
  minimumSlots: ComparisonLayout,
): readonly ComparisonSlot[] {
  const size = minimumSlots === 2 && images.length <= 2 ? 2 : maximumComparedScenes;
  return Array.from({ length: size }, (_, index) => images[index] ?? null);
}

/**
 * The tray images that still reach the main map's view. A scene whose footprint no
 * longer overlaps the view is dropped, so its pane opens empty; basemaps always stay.
 */
function imagesInView(
  images: readonly ComparisonImage[],
  viewport: SatelliteSearchViewport | null,
): readonly ComparisonImage[] {
  if (viewport === null) return images;
  return images.filter(
    (image) =>
      isComparisonBasemap(image) ||
      calculateSatelliteCoverage(viewport, image.footprint).viewportCoveragePercent > 0,
  );
}

export function isComparedImage(
  images: readonly ComparisonSlot[],
  imageKey: string,
): boolean {
  return images.some(
    (image) => image !== null && comparisonImageKey(image) === imageKey,
  );
}

/** Adds a scene to the tray unless it is already there or the tray is full. */
export function addComparedScene(scene: SatelliteScene): void {
  const { images } = satelliteCompareStore.getState();
  if (
    images.length >= maximumComparedScenes ||
    isComparedImage(images, satelliteSceneKey(scene))
  ) {
    return;
  }
  satelliteCompareStore.setState({ images: trayOrder([...images, scene]) });
}

export function removeComparedScene(sceneKey: string): void {
  satelliteCompareStore.setState({
    images: satelliteCompareStore
      .getState()
      .images.filter((image) => comparisonImageKey(image) !== sceneKey),
  });
}

export function clearComparedImages(): void {
  satelliteCompareStore.setState({ images: [] });
}

/** Zoom used when the main map has no camera yet, roughly one Sentinel tile. */
const fallbackComparisonZoom = 10;

/** The main map's camera, else the first tray scene, else the Georgia overview. */
function startingComparisonCamera(
  mainCamera: MapCamera | undefined,
  images: readonly ComparisonImage[],
): SatelliteCompareCamera {
  if (mainCamera !== undefined) {
    return {
      center: { longitude: mainCamera.longitude, latitude: mainCamera.latitude },
      zoom: mainCamera.zoom,
    };
  }
  const firstScene = images.find(
    (image): image is SatelliteScene => !isComparisonBasemap(image),
  );
  if (firstScene !== undefined) {
    const [west, south, east, north] = satelliteSceneBounds(firstScene);
    return {
      center: { longitude: (west + east) / 2, latitude: (south + north) / 2 },
      zoom: fallbackComparisonZoom,
    };
  }
  return {
    center: {
      longitude: defaultGeorgiaCamera.longitude,
      latitude: defaultGeorgiaCamera.latitude,
    },
    zoom: defaultGeorgiaCamera.zoom,
  };
}

/**
 * Opens the tray's images over the main map's view, with plain maps in the other
 * positions, in the preferred layout, else `defaultLayout`. Layout 2 sits two images
 * side by side and becomes 2×2 for three or four. `mainCamera` and `viewport` are the
 * main map's camera and view, absent before the map has them.
 */
export function openComparison(
  mainCamera: MapCamera | undefined,
  viewport: SatelliteSearchViewport | null,
  defaultLayout: ComparisonLayout,
): void {
  const { images, preferredLayout } = satelliteCompareStore.getState();
  satelliteCompareStore.setState({
    slots: gridSlots(imagesInView(images, viewport), preferredLayout ?? defaultLayout),
    camera: startingComparisonCamera(mainCamera, images),
    directFallback: false,
    tileProgress: {},
  });
}

/** Opens a compare link: its images take the positions in link order. */
export function openSharedComparison(
  images: readonly ComparisonImage[],
  camera: SatelliteCompareCamera,
): void {
  if (images.length < minimumComparedScenes) return;
  satelliteCompareStore.setState({
    slots: gridSlots(images.slice(0, maximumComparedScenes), 2),
    camera,
    directFallback: false,
    tileProgress: {},
  });
}

/**
 * Shows an image at a grid position. Returns false, leaving the grid unchanged, when the
 * image is already shown at another position.
 */
export function setComparisonSlot(index: number, image: ComparisonImage): boolean {
  const { slots } = satelliteCompareStore.getState();
  const imageKey = comparisonImageKey(image);
  if (
    slots.some(
      (slot, slotIndex) =>
        slotIndex !== index && slot !== null && comparisonImageKey(slot) === imageKey,
    )
  ) {
    return false;
  }
  satelliteCompareStore.setState({
    slots: slots.map((slot, slotIndex) => (slotIndex === index ? image : slot)),
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

/**
 * Switches between 2×1 and 2×2 and makes that the preferred layout. Growing keeps every
 * position and adds plain maps; shrinking moves the shown images, in grid order, into the
 * two remaining positions and is refused while more than two images are shown.
 */
export function setComparisonLayout(layout: ComparisonLayout): void {
  const { slots } = satelliteCompareStore.getState();
  if (slots.length === 0 || slots.length === layout) return;
  const images = slots.filter((slot) => slot !== null);
  if (images.length > layout) return;
  satelliteCompareStore.setState({
    slots:
      layout === maximumComparedScenes
        ? Array.from({ length: layout }, (_, index) => slots[index] ?? null)
        : gridSlots(images, layout),
    preferredLayout: layout,
  });
}

/** The layout stored in the browser; a pick made in this session wins. */
export function restorePreferredComparisonLayout(layout: ComparisonLayout): void {
  if (satelliteCompareStore.getState().preferredLayout === null) {
    satelliteCompareStore.setState({ preferredLayout: layout });
  }
}

export function setComparisonCalendarMonth(month: string): void {
  if (satelliteCompareStore.getState().calendarMonth !== month) {
    satelliteCompareStore.setState({ calendarMonth: month });
  }
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
 * Closes the grid, keeps its images in the tray, and moves the main map to the area that
 * was being compared.
 */
export function closeComparison(): void {
  const { slots, camera } = satelliteCompareStore.getState();
  if (slots.length === 0) return;
  satelliteCompareStore.setState({
    images: trayOrder(slots.filter((slot) => slot !== null)),
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
