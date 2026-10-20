import { beforeEach, describe, expect, it } from 'vitest';

import {
  addComparedScene,
  closeComparison,
  openComparison,
  openComparisonGrid,
  resetSatelliteCompareStore,
  satelliteCompareStore,
  setComparisonSlot,
  swapComparisonSlots,
} from '@/presentation/satellite-browser/satelliteCompareStore';
import { syntheticSatelliteScene } from '@test/helpers/workspaceShellTestSupport';

const camera = { center: { longitude: 44.5, latitude: 42.5 }, zoom: 11 };
const scene2019 = syntheticSatelliteScene('2019', '2019-08-14T07:52:00.000Z');
const scene2023 = syntheticSatelliteScene('2023', '2023-08-04T07:56:00.000Z');
const scene2017 = syntheticSatelliteScene('2017', '2017-08-20T07:50:00.000Z');
const slotIds = () =>
  satelliteCompareStore.getState().slots.map((scene) => scene?.id ?? null);

describe('satelliteCompareStore', () => {
  beforeEach(() => {
    resetSatelliteCompareStore();
    addComparedScene(scene2023);
    addComparedScene(scene2019);
  });

  it('opens two tray scenes side by side and a 2×2 grid from the shortcut', () => {
    openComparison(camera);
    expect(slotIds()).toEqual(['2019', '2023']);

    openComparisonGrid(camera);
    expect(slotIds()).toEqual(['2019', '2023', null, null]);
  });

  it('refuses a scene already shown at another position', () => {
    openComparisonGrid(camera);

    expect(setComparisonSlot(3, scene2019)).toBe(false);
    expect(setComparisonSlot(3, scene2017)).toBe(true);
    expect(slotIds()).toEqual(['2019', '2023', null, '2017']);
  });

  it('swaps positions and returns the shown scenes to the tray in date order', () => {
    openComparisonGrid(camera);
    setComparisonSlot(2, scene2017);
    swapComparisonSlots(0, 2);
    expect(slotIds()).toEqual(['2017', '2023', '2019', null]);

    closeComparison();

    expect(satelliteCompareStore.getState().slots).toEqual([]);
    expect(satelliteCompareStore.getState().scenes.map((scene) => scene.id)).toEqual([
      '2017',
      '2019',
      '2023',
    ]);
  });
});
