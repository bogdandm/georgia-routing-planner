import { beforeEach, describe, expect, it } from 'vitest';

import {
  openSharedComparison,
  replaceComparedScene,
  resetSatelliteCompareStore,
  satelliteCompareStore,
} from '@/presentation/satellite-browser/satelliteCompareStore';
import { syntheticSatelliteScene } from '@test/helpers/workspaceShellTestSupport';

const camera = { center: { longitude: 44.5, latitude: 42.5 }, zoom: 11 };
const ids = () => satelliteCompareStore.getState().scenes.map((scene) => scene.id);

describe('satelliteCompareStore', () => {
  beforeEach(() => {
    resetSatelliteCompareStore();
    openSharedComparison(
      [
        syntheticSatelliteScene('2019', '2019-08-14T07:52:00.000Z'),
        syntheticSatelliteScene('2023', '2023-08-04T07:56:00.000Z'),
      ],
      camera,
    );
  });

  it('keeps a replaced scene in acquisition order', () => {
    expect(
      replaceComparedScene(
        'sentinel-2-l2a:2023',
        syntheticSatelliteScene('2017', '2017-08-20T07:50:00.000Z'),
      ),
    ).toBe(true);

    expect(ids()).toEqual(['2017', '2019']);
    expect(satelliteCompareStore.getState().open).toBe(true);
  });

  it('refuses a replacement that is already compared', () => {
    expect(
      replaceComparedScene(
        'sentinel-2-l2a:2023',
        syntheticSatelliteScene('2019', '2019-08-14T07:52:00.000Z'),
      ),
    ).toBe(false);

    expect(ids()).toEqual(['2019', '2023']);
  });
});
