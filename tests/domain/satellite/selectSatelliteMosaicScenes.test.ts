import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';

import { SatelliteGeometryError } from '@/domain/satellite/SatelliteGeometryError';
import type { SatelliteSearchViewport } from '@/domain/satellite/SatelliteSearchCriteria';
import type {
  SatelliteAcquisitionGroup,
  SatelliteSceneMatch,
} from '@/domain/satellite/SatelliteSearchResult';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import {
  maximumSatelliteMosaicSceneCount,
  SatelliteMosaicSelectionAccumulator,
  selectSatelliteMosaicScenes,
} from '@/domain/satellite/selectSatelliteMosaicScenes';

const viewport: SatelliteSearchViewport = {
  bounds: { west: 0, south: 0, east: 2, north: 2 },
  center: { longitude: 1, latitude: 1 },
};

function rectangle(west: number, south: number, east: number, north: number): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

function scene(
  id: string,
  acquiredAt: string,
  footprint: Polygon,
  productLevel: 'L1C' | 'L2A' = 'L2A',
): SatelliteScene {
  return {
    id,
    collection: productLevel === 'L2A' ? 'sentinel-2-l2a' : 'sentinel-2-l1c',
    platform: 'sentinel-2a',
    productLevel,
    acquiredAt,
    cloudCoverPercent: 0,
    footprint,
    tileId: null,
    orbit: null,
    productId: null,
    thumbnailHref: null,
    visualAsset: { kind: 'unavailable' },
    attribution: 'Copernicus Sentinel data',
  };
}

function match(value: SatelliteScene): SatelliteSceneMatch {
  return {
    scene: value,
    coverage: {
      viewportCoveragePercent: 0,
      interestPointRelation: 'outside',
      distanceToSceneEdgeKm: 0,
      hasEdgeWarning: false,
    },
  };
}

function group(
  date: string,
  scenes: readonly SatelliteScene[],
): SatelliteAcquisitionGroup {
  return { date, scenes: scenes.map(match) };
}

describe('selectSatelliteMosaicScenes', () => {
  it('keeps only coverage-contributing L2A boundaries from the newest day', () => {
    const full = scene('full', '2026-07-20T11:00:00.000Z', rectangle(0, 0, 2, 2));
    const redundant = scene(
      'redundant',
      '2026-07-20T10:00:00.000Z',
      rectangle(1.5, 0, 2.5, 2),
    );
    const older = scene('older', '2026-07-19T10:00:00.000Z', rectangle(0, 0, 1, 2));

    const result = selectSatelliteMosaicScenes(viewport, [
      group('2026-07-19', [older]),
      group('2026-07-20', [full, redundant]),
    ]);

    expect(result.scenes.map(({ id }) => id)).toEqual(['full']);
    expect(result.coveragePercent).toBe(100);
    expect(result.oldestAcquisitionDate).toBe('2026-07-20');
  });

  it('keeps the later scene when an older scene has the same exact bounds', () => {
    const bounds = rectangle(0, 0, 1, 2);
    const later = scene('later', '2026-07-20T10:00:00.000Z', bounds);
    const duplicate = scene('duplicate', '2026-07-19T10:00:00.000Z', bounds);
    const fill = scene('fill', '2026-07-18T10:00:00.000Z', rectangle(1, 0, 2, 2));

    const result = selectSatelliteMosaicScenes(viewport, [
      group('2026-07-20', [later]),
      group('2026-07-19', [duplicate]),
      group('2026-07-18', [fill]),
    ]);

    expect(result.scenes.map(({ id }) => id)).toEqual(['later', 'fill']);
    expect(result.oldestAcquisitionDate).toBe('2026-07-18');
    expect(result.coveragePercent).toBe(100);
  });

  it('measures overlapping footprints by their union rather than summing them', () => {
    const left = scene('left', '2026-07-20T10:00:00.000Z', rectangle(0, 0, 1.2, 2));
    const overlap = scene(
      'overlap',
      '2026-07-20T09:00:00.000Z',
      rectangle(0.8, 0, 1.6, 2),
    );

    const result = selectSatelliteMosaicScenes(viewport, [
      group('2026-07-20', [left, overlap]),
    ]);

    expect(result.coveragePercent).toBeCloseTo(80, 5);
  });

  it('accepts the whole date group that completes coverage and ignores older groups', () => {
    const first = scene('first', '2026-07-20T10:00:00.000Z', rectangle(0, 0, 0.5, 2));
    const completing = scene(
      'completing',
      '2026-07-19T11:00:00.000Z',
      rectangle(0.5, 0, 2, 2),
    );
    const sameDayExtra = scene(
      'same-day-extra',
      '2026-07-19T10:00:00.000Z',
      rectangle(1.5, 0, 2.5, 2),
    );
    const ignored = scene('ignored', '2026-07-18T10:00:00.000Z', rectangle(0, 0, 2, 2));

    const result = selectSatelliteMosaicScenes(viewport, [
      group('2026-07-20', [first]),
      group('2026-07-19', [completing, sameDayExtra]),
      group('2026-07-18', [ignored]),
    ]);

    expect(result.scenes.map(({ id }) => id)).toEqual(['first', 'completing']);
    expect(result.coveragePercent).toBe(100);
    expect(result.oldestAcquisitionDate).toBe('2026-07-19');
  });

  it('extends monthly selections without retaining duplicate older boundaries', () => {
    const leftBounds = rectangle(0, 0, 1, 2);
    const newest = scene('newest', '2026-07-20T10:00:00.000Z', leftBounds);
    const olderDuplicate = scene(
      'older-duplicate',
      '2026-06-20T10:00:00.000Z',
      leftBounds,
    );
    const olderFill = scene(
      'older-fill',
      '2026-06-20T09:00:00.000Z',
      rectangle(1, 0, 2, 2),
    );
    const accumulator = new SatelliteMosaicSelectionAccumulator(viewport);

    accumulator.addGroups([group('2026-07-20', [newest])]);
    const result = accumulator.addGroups([
      group('2026-06-20', [olderDuplicate, olderFill]),
    ]);

    expect(result.scenes.map(({ id }) => id)).toEqual(['newest', 'older-fill']);
    expect(result.coveragePercent).toBe(100);
    expect(result.oldestAcquisitionDate).toBe('2026-06-20');
  });

  it('keeps a regional mosaic that needs more than 32 source footprints', () => {
    const regionalScenes = Array.from({ length: 40 }, (_, index) =>
      scene(
        `regional-${String(index)}`,
        '2026-07-20T10:00:00.000Z',
        rectangle(index / 20, 0, (index + 1) / 20, 2),
      ),
    );

    const result = selectSatelliteMosaicScenes(viewport, [
      group('2026-07-20', regionalScenes),
    ]);

    expect(result.scenes).toHaveLength(40);
    expect(result.coveragePercent).toBe(100);
  });

  it('bounds a partial selection to the native raster-source budget', () => {
    const candidates = Array.from(
      { length: maximumSatelliteMosaicSceneCount + 1 },
      (_, index) =>
        scene(
          `candidate-${String(index)}`,
          '2026-07-20T10:00:00.000Z',
          rectangle(
            (2 * index) / (maximumSatelliteMosaicSceneCount + 1),
            0,
            (2 * (index + 1)) / (maximumSatelliteMosaicSceneCount + 1),
            2,
          ),
        ),
    );

    const result = selectSatelliteMosaicScenes(viewport, [
      group('2026-07-20', candidates),
    ]);

    expect(result.scenes).toHaveLength(maximumSatelliteMosaicSceneCount);
    expect(result.coveragePercent).toBeLessThan(100);
    const accumulator = new SatelliteMosaicSelectionAccumulator(viewport);
    accumulator.addGroups([group('2026-07-20', candidates)]);
    expect(accumulator.limitReached).toBe(true);
  });

  it('returns complete coverage when the final budgeted scene fills the viewport', () => {
    const completingCandidates = Array.from(
      { length: maximumSatelliteMosaicSceneCount },
      (_, index) =>
        scene(
          `completing-${String(index)}`,
          '2026-07-20T10:00:00.000Z',
          rectangle(
            (2 * index) / maximumSatelliteMosaicSceneCount,
            0,
            (2 * (index + 1)) / maximumSatelliteMosaicSceneCount,
            2,
          ),
        ),
    );
    const extra = scene('extra', '2026-07-20T09:00:00.000Z', rectangle(-1, 0, 0.5, 2));
    const accumulator = new SatelliteMosaicSelectionAccumulator(viewport);

    const result = accumulator.addGroups([
      group('2026-07-20', [...completingCandidates, extra]),
    ]);

    expect(result.scenes).toHaveLength(maximumSatelliteMosaicSceneCount);
    expect(result.coveragePercent).toBe(100);
    expect(accumulator.limitReached).toBe(false);
  });

  it('ignores a redundant candidate at capacity before evaluating an older contributor', () => {
    const partialCandidates = Array.from(
      { length: maximumSatelliteMosaicSceneCount },
      (_, index) =>
        scene(
          `partial-${String(index)}`,
          '2026-07-20T10:00:00.000Z',
          rectangle(
            index / maximumSatelliteMosaicSceneCount,
            0,
            (index + 1) / maximumSatelliteMosaicSceneCount,
            2,
          ),
        ),
    );
    const redundant = scene(
      'redundant-at-capacity',
      '2026-07-20T09:00:00.000Z',
      rectangle(-1, 0, 0.5, 2),
    );
    const olderContributor = scene(
      'older-contributor',
      '2026-07-19T10:00:00.000Z',
      rectangle(1, 0, 2, 2),
    );
    const accumulator = new SatelliteMosaicSelectionAccumulator(viewport);

    const current = accumulator.addGroups([
      group('2026-07-20', [...partialCandidates, redundant]),
    ]);

    expect(current.scenes).toHaveLength(maximumSatelliteMosaicSceneCount);
    expect(current.coveragePercent).toBeCloseTo(50, 5);
    expect(accumulator.limitReached).toBe(false);

    const older = accumulator.addGroups([group('2026-07-19', [olderContributor])]);

    expect(older.scenes).toHaveLength(maximumSatelliteMosaicSceneCount);
    expect(older.coveragePercent).toBeCloseTo(50, 5);
    expect(accumulator.limitReached).toBe(true);
  });

  it('rejects invalid viewports and malformed or degenerate scene geometry', () => {
    const invalidViewport = {
      ...viewport,
      bounds: { ...viewport.bounds, west: 2 },
    };
    expect(() => selectSatelliteMosaicScenes(invalidViewport, [])).toThrow(
      SatelliteGeometryError,
    );
    expect(() =>
      selectSatelliteMosaicScenes(
        {
          bounds: { west: -170, south: -10, east: 170, north: 10 },
          center: { longitude: 0, latitude: 0 },
        },
        [],
      ),
    ).toThrow(SatelliteGeometryError);

    const incomplete = scene('incomplete', '2026-07-20T10:00:00.000Z', {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [0, 0],
        ],
      ],
    });
    expect(() =>
      selectSatelliteMosaicScenes(viewport, [group('2026-07-20', [incomplete])]),
    ).toThrow(SatelliteGeometryError);

    const degenerate = scene(
      'degenerate',
      '2026-07-20T10:00:00.000Z',
      rectangle(0, 0, 0, 2),
    );
    expect(() =>
      selectSatelliteMosaicScenes(viewport, [group('2026-07-20', [degenerate])]),
    ).toThrow(SatelliteGeometryError);
  });
});
