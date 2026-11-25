import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_CUSTOM_HIKING_TIME_PRESETS,
  DAY_HIKE_TIME_PRESET_ID,
  DIN_HIKING_TIME_PRESET_ID,
  MULTI_DAY_HIKE_TIME_PRESET_ID,
  builtInHikingTimePresets,
  defaultHikingTimePresetSettings,
  dinHikingSeconds,
  estimateHikingTime,
  hikingPaceSecondsPerMeter,
  hikingTimePresets,
  isBuiltInHikingTimePreset,
  mergeHikingTimePresetSettings,
  resolveHikingTimePreset,
  validHikingTimeParameters,
  type HikingPaceKnot,
  type HikingTimeParameters,
  type HikingTimePoint,
  type HikingTimePreset,
} from '@/domain/tracks/hikingTime';

const hour = 3_600;
const unadjusted = { paceFactor: 1, stopFactor: 1 };

function builtIn(id: string): HikingTimePreset {
  const preset = builtInHikingTimePresets.find((value) => value.id === id);
  if (preset === undefined) throw new Error(`Missing built-in preset ${id}.`);
  return preset;
}

function gradeKnots(parameters: HikingTimeParameters): readonly HikingPaceKnot[] {
  if (parameters.movement.kind !== 'grade-curve') {
    throw new Error('Expected a grade-curve preset.');
  }
  return parameters.movement.knots;
}

/** 0.8 s/m at −10 %, 1 s/m on the flat, 2 s/m at +10 %. */
const knots: readonly HikingPaceKnot[] = [
  { gradePercent: -10, speedKmh: 4.5 },
  { gradePercent: 0, speedKmh: 3.6 },
  { gradePercent: 10, speedKmh: 1.8 },
];

/** One second per flat metre, without altitude slowdown, breaks, or lunch. */
const plain: HikingTimeParameters = {
  movement: { kind: 'grade-curve', knots },
  altitudeBands: [],
  breakMinutesPerMovingHour: 0,
  lunchMinutes: 0,
  lunchMinimumMovingHours: 2,
  movingHoursPerDay: 10,
};

function point(
  distanceMeters: number,
  elevationMeters?: number,
  sourceSegmentIndex = 0,
): HikingTimePoint {
  return elevationMeters === undefined
    ? { distanceMeters, sourceSegmentIndex }
    : { distanceMeters, elevationMeters, sourceSegmentIndex };
}

/** Points every `spacing` metres, flat at 1000 m. */
function flatRoute(lengthMeters: number, spacing: number): HikingTimePoint[] {
  return Array.from({ length: lengthMeters / spacing + 1 }, (_, index) =>
    point(index * spacing, 1_000),
  );
}

function steps(elapsed: readonly number[]): number[] {
  return elapsed.slice(1).map((seconds, index) => seconds - (elapsed[index] ?? 0));
}

describe('dinHikingSeconds', () => {
  it('counts the larger of horizontal and vertical time fully and the smaller by half', () => {
    // 12 km horizontal = 3 h; 900 m up + 500 m down = 4 h; 4 h + 3 h / 2.
    expect(dinHikingSeconds(12_000, 900, 500)).toBe(5.5 * hour);
    // 20 km horizontal = 5 h dominates 300 m up = 1 h.
    expect(dinHikingSeconds(20_000, 300, 0)).toBe(5.5 * hour);
  });
});

describe('estimateHikingTime with the DIN 33466 preset', () => {
  it('equals the DIN time of the route totals and adds no breaks or lunch', () => {
    // The samples climb only 600 m; the stored totals anchor the estimate.
    const route = Array.from({ length: 13 }, (_, kilometre) =>
      point(kilometre * 1_000, 1_000 + 50 * Math.min(kilometre, 12 - kilometre) * 2),
    );
    const totals = { ascentMeters: 900, descentMeters: 500 };

    const estimate = estimateHikingTime(
      route,
      builtIn(DIN_HIKING_TIME_PRESET_ID).parameters,
      unadjusted,
      totals,
    );

    const expected = dinHikingSeconds(12_000, 900, 500);
    expect(estimate.movingSeconds).toBeCloseTo(expected, 6);
    expect(estimate.totalSeconds).toBeCloseTo(expected, 6);
    expect(estimate.elapsedSeconds.at(-1)).toBeCloseTo(expected, 6);
    expect(estimate).toMatchObject({ breakSeconds: 0, lunchSeconds: 0, lunchCount: 0 });
  });

  it('adds no time between source segments, even across a gap in distance', () => {
    const route = [
      point(0, 1_000, 0),
      point(4_000, 1_000, 0),
      point(6_000, 2_000, 1),
      point(10_000, 2_000, 1),
    ];

    const estimate = estimateHikingTime(
      route,
      builtIn(DIN_HIKING_TIME_PRESET_ID).parameters,
      unadjusted,
    );

    expect(estimate.elapsedSeconds).toEqual([0, hour, hour, 2 * hour]);
  });
});

describe('hikingPaceSecondsPerMeter', () => {
  it('reads pace at the knots and interpolates it linearly between them', () => {
    expect(hikingPaceSecondsPerMeter(knots, 0)).toBeCloseTo(1, 9);
    expect(hikingPaceSecondsPerMeter(knots, 10)).toBeCloseTo(2, 9);
    expect(hikingPaceSecondsPerMeter(knots, -10)).toBeCloseTo(0.8, 9);
    expect(hikingPaceSecondsPerMeter(knots, 5)).toBeCloseTo(1.5, 9);
    expect(hikingPaceSecondsPerMeter(knots, -5)).toBeCloseTo(0.9, 9);
  });

  it('extends the end segments past the outer knots and caps the speed at 10 km/h', () => {
    expect(hikingPaceSecondsPerMeter(knots, 20)).toBeCloseTo(3, 9);
    expect(hikingPaceSecondsPerMeter(knots, -20)).toBeCloseTo(0.6, 9);
    expect(hikingPaceSecondsPerMeter(knots, -40)).toBeCloseTo(0.36, 9);
  });

  it('is fastest on a gentle descent in the built-in day-hike curve', () => {
    const dayHike = gradeKnots(builtIn(DAY_HIKE_TIME_PRESET_ID).parameters);
    const grades = Array.from({ length: 91 }, (_, index) => index - 45);
    const paces = grades.map((grade) => hikingPaceSecondsPerMeter(dayHike, grade));
    const fastest = grades[paces.indexOf(Math.min(...paces))] ?? 0;

    expect(fastest).toBeLessThan(0);
    expect(fastest).toBeGreaterThanOrEqual(-15);
  });
});

describe('estimateHikingTime with a grade curve', () => {
  it('takes longer to climb than to walk the same distance on the flat', () => {
    const parameters = builtIn(DAY_HIKE_TIME_PRESET_ID).parameters;
    const flat = flatRoute(3_000, 100);
    // A steady 20 % climb.
    const climb = flat.map((value) =>
      point(value.distanceMeters, 1_000 + value.distanceMeters * 0.2),
    );

    const flatTime = estimateHikingTime(flat, parameters, unadjusted);
    const climbTime = estimateHikingTime(climb, parameters, unadjusted);

    expect(flatTime.movingSeconds).toBeCloseTo(
      3_000 * hikingPaceSecondsPerMeter(gradeKnots(parameters), 0),
      6,
    );
    expect(climbTime.movingSeconds).toBeGreaterThan(flatTime.movingSeconds);
  });

  it('measures grade on the elevation trend, so sample noise does not slow walking', () => {
    const parameters = builtIn(DAY_HIKE_TIME_PRESET_ID).parameters;
    const flat = flatRoute(3_000, 10);
    // ±3 m alternating sample noise is a 60 % grade between neighbouring samples.
    const noisy = flat.map((value, index) =>
      point(value.distanceMeters, 1_000 + (index % 2 === 0 ? 3 : -3)),
    );

    const flatTime = estimateHikingTime(flat, parameters, unadjusted);
    const noisyTime = estimateHikingTime(noisy, parameters, unadjusted);

    expect(noisyTime.movingSeconds / flatTime.movingSeconds).toBeLessThan(1.01);
  });

  it('slows only the steps at or above an altitude band', () => {
    const route = [
      point(0, 1_900, 0),
      point(1_000, 1_900, 0),
      point(1_000, 2_100, 1),
      point(2_000, 2_100, 1),
    ];
    const banded = {
      ...plain,
      altitudeBands: [{ fromMeters: 2_000, speedFactor: 0.5 }],
    };

    expect(estimateHikingTime(route, plain, unadjusted).movingElapsedSeconds).toEqual([
      0, 1_000, 1_000, 2_000,
    ]);
    expect(estimateHikingTime(route, banded, unadjusted).movingElapsedSeconds).toEqual([
      0, 1_000, 1_000, 3_000,
    ]);
  });

  it('adds no time between points of different source segments', () => {
    const route = [
      point(0, 1_000, 0),
      point(1_000, 1_000, 0),
      point(3_000, 1_500, 1),
      point(4_000, 1_500, 1),
    ];

    expect(estimateHikingTime(route, plain, unadjusted).elapsedSeconds).toEqual([
      0, 1_000, 1_000, 2_000,
    ]);
  });

  it('adds only horizontal time where elevation is missing', () => {
    // With the middle elevation the route would climb 25 %.
    const route = [point(0, 1_000), point(1_000), point(2_000, 1_500)];
    const unknown = [point(0), point(1_000), point(2_000)];

    expect(estimateHikingTime(route, plain, unadjusted).movingSeconds).toBeCloseTo(
      2_000,
      6,
    );
    expect(estimateHikingTime(unknown, plain, unadjusted).movingSeconds).toBeCloseTo(
      2_000,
      6,
    );
  });
});

describe('breaks and lunch', () => {
  it('spreads breaks proportionally along the unadjusted moving time', () => {
    const parameters = { ...plain, breakMinutesPerMovingHour: 15 };

    // 3600 s moving at 15 min per hour: 900 s of breaks.
    const estimate = estimateHikingTime(
      flatRoute(3_600, 1_200),
      parameters,
      unadjusted,
    );

    expect(estimate.breakSeconds).toBeCloseTo(900, 6);
    expect(estimate.elapsedSeconds).toEqual(
      [0, 1_500, 3_000, 4_500].map((seconds) => expect.closeTo(seconds, 6) as number),
    );
  });

  it('stops once for lunch halfway when the day is long enough', () => {
    const parameters = { ...plain, lunchMinutes: 40 };

    const estimate = estimateHikingTime(
      flatRoute(12_000, 1_000),
      parameters,
      unadjusted,
    );

    expect(estimate).toMatchObject({ lunchCount: 1, lunchSeconds: 2_400 });
    expect(estimate.totalSeconds).toBeCloseTo(12_000 + 2_400, 6);
    // Lunch starts after 6000 s of walking, between the 6th and 7th kilometre.
    expect(steps(estimate.elapsedSeconds)).toEqual(
      Array.from(
        { length: 12 },
        (_, index) => expect.closeTo(index === 6 ? 3_400 : 1_000, 6) as number,
      ),
    );
  });

  it('skips lunch on a day shorter than the minimum', () => {
    const parameters = { ...plain, lunchMinutes: 40 };

    // 7000 s moving is under the 2 h minimum.
    const estimate = estimateHikingTime(
      flatRoute(7_000, 1_000),
      parameters,
      unadjusted,
    );

    expect(estimate).toMatchObject({ lunchCount: 0, lunchSeconds: 0 });
    expect(estimate.totalSeconds).toBeCloseTo(7_000, 6);
  });

  it('stops for lunch once per day on a route longer than one day', () => {
    const parameters = {
      ...plain,
      lunchMinutes: 40,
      lunchMinimumMovingHours: 1,
      movingHoursPerDay: 2,
    };

    // 12000 s moving makes two days of 6000 s, each with lunch halfway.
    const estimate = estimateHikingTime(
      flatRoute(12_000, 1_000),
      parameters,
      unadjusted,
    );

    expect(estimate).toMatchObject({ lunchCount: 2, lunchSeconds: 4_800 });
    expect(steps(estimate.elapsedSeconds)).toEqual(
      Array.from(
        { length: 12 },
        (_, index) =>
          expect.closeTo(index === 3 || index === 9 ? 3_400 : 1_000, 6) as number,
      ),
    );
  });

  it('changes only moving time with the pace factor', () => {
    const parameters = { ...plain, breakMinutesPerMovingHour: 15, lunchMinutes: 40 };
    const route = flatRoute(12_000, 1_000);

    const base = estimateHikingTime(route, parameters, unadjusted);
    const slow = estimateHikingTime(route, parameters, {
      paceFactor: 1.5,
      stopFactor: 1,
    });

    expect(base.movingSeconds).toBeCloseTo(12_000, 6);
    expect(slow.movingSeconds).toBeCloseTo(18_000, 6);
    expect(slow.breakSeconds).toBeCloseTo(base.breakSeconds, 6);
    expect(slow.breakSeconds).toBeCloseTo(3_000, 6);
    expect(slow).toMatchObject({ lunchCount: 1, lunchSeconds: base.lunchSeconds });
    expect(slow.totalSeconds).toBeCloseTo(18_000 + 3_000 + 2_400, 6);
  });

  it('scales only breaks and lunch with the stop factor', () => {
    const parameters = { ...plain, breakMinutesPerMovingHour: 15, lunchMinutes: 40 };

    const estimate = estimateHikingTime(flatRoute(12_000, 1_000), parameters, {
      paceFactor: 1,
      stopFactor: 0.5,
    });

    expect(estimate.movingSeconds).toBeCloseTo(12_000, 6);
    expect(estimate.breakSeconds).toBeCloseTo(1_500, 6);
    expect(estimate).toMatchObject({ lunchCount: 1, lunchSeconds: 1_200 });
    expect(estimate.totalSeconds).toBeCloseTo(12_000 + 1_500 + 1_200, 6);
  });
});

describe('hiking time presets', () => {
  const custom: HikingTimePreset = {
    id: 'custom:fast',
    name: 'Fast',
    parameters: plain,
  };
  const settings = { defaultPresetId: custom.id, custom: [custom] };

  it('lists built-in presets before the user presets', () => {
    expect(hikingTimePresets(settings).map((preset) => preset.id)).toEqual([
      DIN_HIKING_TIME_PRESET_ID,
      DAY_HIKE_TIME_PRESET_ID,
      MULTI_DAY_HIKE_TIME_PRESET_ID,
      custom.id,
    ]);
    expect(isBuiltInHikingTimePreset(MULTI_DAY_HIKE_TIME_PRESET_ID)).toBe(true);
    expect(isBuiltInHikingTimePreset(custom.id)).toBe(false);
  });

  it('resolves the chosen preset, then the default, then the day-hike preset', () => {
    expect(resolveHikingTimePreset(settings, MULTI_DAY_HIKE_TIME_PRESET_ID).id).toBe(
      MULTI_DAY_HIKE_TIME_PRESET_ID,
    );
    expect(resolveHikingTimePreset(settings, null)).toBe(custom);
    expect(resolveHikingTimePreset(settings, 'custom:deleted')).toBe(custom);
    expect(
      resolveHikingTimePreset({ defaultPresetId: 'custom:deleted', custom: [] }, null)
        .id,
    ).toBe(DAY_HIKE_TIME_PRESET_ID);
    expect(resolveHikingTimePreset(defaultHikingTimePresetSettings, null).id).toBe(
      DAY_HIKE_TIME_PRESET_ID,
    );
  });
});

describe('validHikingTimeParameters', () => {
  it('accepts every built-in preset', () => {
    for (const preset of builtInHikingTimePresets) {
      expect(validHikingTimeParameters(preset.parameters)).toBe(true);
    }
    expect(validHikingTimeParameters(plain)).toBe(true);
  });

  it.each<[string, HikingTimeParameters]>([
    [
      'descending knots',
      { ...plain, movement: { kind: 'grade-curve', knots: [...knots].reverse() } },
    ],
    [
      'repeated knot grades',
      {
        ...plain,
        movement: {
          kind: 'grade-curve',
          knots: [
            { gradePercent: 0, speedKmh: 4 },
            { gradePercent: 0, speedKmh: 3 },
          ],
        },
      },
    ],
    [
      'a single knot',
      {
        ...plain,
        movement: { kind: 'grade-curve', knots: [{ gradePercent: 0, speedKmh: 4 }] },
      },
    ],
    [
      'a standing speed',
      {
        ...plain,
        movement: {
          kind: 'grade-curve',
          knots: [
            { gradePercent: 0, speedKmh: 0 },
            { gradePercent: 10, speedKmh: 2 },
          ],
        },
      },
    ],
    [
      'a non-finite grade',
      {
        ...plain,
        movement: {
          kind: 'grade-curve',
          knots: [
            { gradePercent: Number.NaN, speedKmh: 4 },
            { gradePercent: 10, speedKmh: 2 },
          ],
        },
      },
    ],
    [
      'a DIN horizontal speed of zero',
      {
        ...plain,
        movement: {
          kind: 'din',
          horizontalKmh: 0,
          ascentMetersPerHour: 300,
          descentMetersPerHour: 500,
        },
      },
    ],
    [
      'descending altitude bands',
      {
        ...plain,
        altitudeBands: [
          { fromMeters: 2_500, speedFactor: 0.8 },
          { fromMeters: 2_000, speedFactor: 0.9 },
        ],
      },
    ],
    [
      'an altitude speed factor of zero',
      { ...plain, altitudeBands: [{ fromMeters: 2_000, speedFactor: 0 }] },
    ],
    ['breaks over an hour per hour', { ...plain, breakMinutesPerMovingHour: 61 }],
    ['negative breaks', { ...plain, breakMinutesPerMovingHour: -1 }],
    ['a lunch over four hours', { ...plain, lunchMinutes: 241 }],
    ['a lunch minimum over a day', { ...plain, lunchMinimumMovingHours: 25 }],
    ['a day under an hour', { ...plain, movingHoursPerDay: 0.5 }],
    ['a day over 24 hours', { ...plain, movingHoursPerDay: 25 }],
  ])('rejects %s', (_, parameters) => {
    expect(validHikingTimeParameters(parameters)).toBe(false);
  });
});

describe('mergeHikingTimePresetSettings', () => {
  const dayHike = builtIn(DAY_HIKE_TIME_PRESET_ID);
  function custom(id: string, lunchMinutes = 30): HikingTimePreset {
    return {
      id: `custom:${id}`,
      name: `Preset ${id}`,
      parameters: { ...dayHike.parameters, lunchMinutes },
    };
  }
  const settings = (
    custom: readonly HikingTimePreset[],
    defaultPresetId = DAY_HIKE_TIME_PRESET_ID,
  ) => ({ defaultPresetId, custom });

  it('keeps presets added concurrently on two devices', () => {
    const base = settings([custom('a')]);
    expect(
      mergeHikingTimePresetSettings(
        base,
        settings([custom('a'), custom('local')]),
        settings([custom('a'), custom('remote')]),
      ),
    ).toEqual(settings([custom('a'), custom('remote'), custom('local')]));
  });

  it('propagates deletions of unchanged presets from either side', () => {
    const base = settings([custom('a'), custom('b')]);
    expect(
      mergeHikingTimePresetSettings(
        base,
        settings([custom('b')]),
        settings([custom('a'), custom('b')]),
      ),
    ).toEqual(settings([custom('b')]));
    expect(
      mergeHikingTimePresetSettings(
        base,
        settings([custom('a'), custom('b')]),
        settings([custom('a')]),
      ),
    ).toEqual(settings([custom('a')]));
  });

  it('keeps an edit over a concurrent delete on either side', () => {
    const base = settings([custom('a')]);
    expect(
      mergeHikingTimePresetSettings(base, settings([]), settings([custom('a', 60)])),
    ).toEqual(settings([custom('a', 60)]));
    expect(
      mergeHikingTimePresetSettings(base, settings([custom('a', 60)]), settings([])),
    ).toEqual(settings([custom('a', 60)]));
  });

  it('keeps a one-sided edit and lets the account win edits made on both sides', () => {
    const base = settings([custom('a'), custom('b'), custom('c')]);
    expect(
      mergeHikingTimePresetSettings(
        base,
        settings([custom('a', 45), custom('b'), custom('c', 75)]),
        settings([custom('a', 60), custom('b', 90), custom('c')]),
      ),
    ).toEqual(settings([custom('a', 60), custom('b', 90), custom('c', 75)]));
  });

  it('unites both sides without a base, the account winning same-ID clashes', () => {
    expect(
      mergeHikingTimePresetSettings(
        null,
        settings([custom('local'), custom('a', 45)], 'custom:local'),
        settings([custom('a', 60)], 'custom:a'),
      ),
    ).toEqual(settings([custom('a', 60), custom('local')], 'custom:a'));
  });

  it('caps the merge at the custom preset limit, keeping account presets first', () => {
    const remote = Array.from(
      { length: MAXIMUM_CUSTOM_HIKING_TIME_PRESETS },
      (_, index) => custom(`remote-${String(index)}`),
    );
    const merged = mergeHikingTimePresetSettings(
      null,
      settings([custom('local')]),
      settings(remote),
    );
    expect(merged.custom).toEqual(remote);
  });

  it('resolves the default from the side that changed it to an existing preset', () => {
    const base = settings([custom('a'), custom('b')], 'custom:a');
    expect(
      mergeHikingTimePresetSettings(
        base,
        settings([custom('a'), custom('b')], 'custom:b'),
        base,
      ).defaultPresetId,
    ).toBe('custom:b');
    // Both devices changed it: the account's choice wins.
    expect(
      mergeHikingTimePresetSettings(
        base,
        settings([custom('a'), custom('b')], 'custom:b'),
        settings([custom('a'), custom('b')], DIN_HIKING_TIME_PRESET_ID),
      ).defaultPresetId,
    ).toBe(DIN_HIKING_TIME_PRESET_ID);
    expect(
      mergeHikingTimePresetSettings(
        base,
        settings([custom('a'), custom('b')], 'custom:a'),
        settings([custom('a'), custom('b')], MULTI_DAY_HIKE_TIME_PRESET_ID),
      ).defaultPresetId,
    ).toBe(MULTI_DAY_HIKE_TIME_PRESET_ID);
    // The local default was deleted remotely: the remote default applies.
    expect(
      mergeHikingTimePresetSettings(
        base,
        settings([custom('a'), custom('b')], 'custom:b'),
        settings([custom('a')], DIN_HIKING_TIME_PRESET_ID),
      ).defaultPresetId,
    ).toBe(DIN_HIKING_TIME_PRESET_ID);
    // A default this version does not know falls back to the day hike.
    expect(
      mergeHikingTimePresetSettings(
        base,
        base,
        settings([custom('a')], 'future-preset'),
      ).defaultPresetId,
    ).toBe(DAY_HIKE_TIME_PRESET_ID);
  });
});
