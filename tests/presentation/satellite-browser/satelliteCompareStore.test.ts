import { beforeEach, describe, expect, it } from 'vitest';

import {
  addComparedScene,
  clearComparisonSlot,
  closeComparison,
  openComparison,
  restorePreferredComparisonLayout,
  resetSatelliteCompareStore,
  satelliteCompareStore,
  setComparisonLayout,
  setComparisonSlot,
  swapComparisonSlots,
  type ComparisonSlot,
} from '@/presentation/satellite-browser/satelliteCompareStore';
import {
  syntheticSatelliteScene,
  testViewport,
} from '@test/helpers/workspaceShellTestSupport';

const camera = { center: { longitude: 44.5, latitude: 42.5 }, zoom: 11 };
const scene2019 = syntheticSatelliteScene('2019', '2019-08-14T07:52:00.000Z');
const scene2023 = syntheticSatelliteScene('2023', '2023-08-04T07:56:00.000Z');
const scene2017 = syntheticSatelliteScene('2017', '2017-08-20T07:50:00.000Z');
/** A view west of the synthetic footprint (44–45° E). */
const viewportElsewhere = {
  bounds: { west: 41.6, south: 41.9, east: 42.0, north: 42.3 },
  center: { longitude: 41.8, latitude: 42.1 },
};
const slotIds = (slots: readonly ComparisonSlot[]) =>
  slots.map((slot) => (typeof slot === 'string' ? slot : (slot?.id ?? null)));

describe('satelliteCompareStore', () => {
  beforeEach(() => {
    resetSatelliteCompareStore();
    addComparedScene(scene2023);
    addComparedScene(scene2019);
  });

  it('opens two tray scenes side by side or in a 2×2 grid', () => {
    openComparison(camera, testViewport, 2);
    expect(slotIds(satelliteCompareStore.getState().slots)).toEqual(['2019', '2023']);

    openComparison(camera, testViewport, 4);
    expect(slotIds(satelliteCompareStore.getState().slots)).toEqual([
      '2019',
      '2023',
      null,
      null,
    ]);
  });

  it('refuses an image already shown at another position', () => {
    openComparison(camera, testViewport, 4);

    expect(setComparisonSlot(3, scene2019)).toBe(false);
    expect(setComparisonSlot(3, scene2017)).toBe(true);
    expect(setComparisonSlot(2, 'google-satellite')).toBe(true);
    expect(setComparisonSlot(3, 'google-satellite')).toBe(false);
    expect(slotIds(satelliteCompareStore.getState().slots)).toEqual([
      '2019',
      '2023',
      'google-satellite',
      '2017',
    ]);
  });

  it('swaps positions and returns the shown images to the tray, scenes in date order', () => {
    openComparison(camera, testViewport, 4);
    setComparisonSlot(2, scene2017);
    setComparisonSlot(3, 'esri-satellite');
    swapComparisonSlots(0, 3);
    expect(slotIds(satelliteCompareStore.getState().slots)).toEqual([
      'esri-satellite',
      '2023',
      '2017',
      '2019',
    ]);

    closeComparison();

    expect(satelliteCompareStore.getState().slots).toEqual([]);
    expect(slotIds(satelliteCompareStore.getState().images)).toEqual([
      '2017',
      '2019',
      '2023',
      'esri-satellite',
    ]);
  });

  it('reopens without the scenes that no longer reach the view but keeps basemaps', () => {
    openComparison(camera, testViewport, 4);
    setComparisonSlot(2, 'bing-satellite');
    closeComparison();

    openComparison(camera, viewportElsewhere, 4);
    expect(slotIds(satelliteCompareStore.getState().slots)).toEqual([
      'bing-satellite',
      null,
      null,
      null,
    ]);

    closeComparison();
    addComparedScene(scene2019);
    openComparison(camera, viewportElsewhere, 2);
    expect(slotIds(satelliteCompareStore.getState().slots)).toEqual([
      'bing-satellite',
      null,
    ]);
  });

  it('shrinks to 2×1 only with at most two images and grows back with plain maps', () => {
    openComparison(camera, testViewport, 4);
    setComparisonSlot(3, 'napr-orthophoto');

    setComparisonLayout(2);
    expect(satelliteCompareStore.getState().slots).toHaveLength(4);

    // Positions: 2019, plain, plain, NAPR; the shown images move together, in order.
    clearComparisonSlot(1);
    setComparisonLayout(2);
    expect(slotIds(satelliteCompareStore.getState().slots)).toEqual([
      '2019',
      'napr-orthophoto',
    ]);

    setComparisonLayout(4);
    expect(slotIds(satelliteCompareStore.getState().slots)).toEqual([
      '2019',
      'napr-orthophoto',
      null,
      null,
    ]);
  });

  it('opens in the preferred layout, where a pick in this session beats the stored one', () => {
    restorePreferredComparisonLayout(4);
    openComparison(camera, testViewport, 2);
    expect(satelliteCompareStore.getState().slots).toHaveLength(4);

    setComparisonLayout(2);
    closeComparison();
    restorePreferredComparisonLayout(4);
    openComparison(camera, testViewport, 4);
    expect(slotIds(satelliteCompareStore.getState().slots)).toEqual(['2019', '2023']);
  });
});
