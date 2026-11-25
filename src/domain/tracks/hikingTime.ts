/**
 * Hiking time presets: moving time from a pace model, slowed at altitude, plus regular
 * breaks and lunch. The v1 preset is the DIN 33466 estimate without breaks; the v2
 * presets come from a calibration on recorded hikes (grade pace curve scaled end to
 * end through this estimate, altitude bands, measured breaks and lunch).
 */

/** Walking speed at one grade; speeds between knots interpolate linearly in pace. */
export interface HikingPaceKnot {
  readonly gradePercent: number;
  readonly speedKmh: number;
}

/** From this elevation up, moving speed is multiplied by `speedFactor`. */
export interface HikingAltitudeBand {
  readonly fromMeters: number;
  readonly speedFactor: number;
}

export type HikingMovementModel =
  | {
      /**
       * DIN 33466 on the route totals: horizontal and vertical hours, the larger
       * counting fully and the smaller by half.
       */
      readonly kind: 'din';
      readonly horizontalKmh: number;
      readonly ascentMetersPerHour: number;
      readonly descentMetersPerHour: number;
    }
  | {
      /** Pace per horizontal metre at the local grade, summed along the route. */
      readonly kind: 'grade-curve';
      /** Strictly ascending grades; at least two. */
      readonly knots: readonly HikingPaceKnot[];
    };

export interface HikingTimeParameters {
  readonly movement: HikingMovementModel;
  /** Ascending `fromMeters`; the highest band at or below a step's elevation applies. */
  readonly altitudeBands: readonly HikingAltitudeBand[];
  /** Short stops and rests, spread evenly along moving time. */
  readonly breakMinutesPerMovingHour: number;
  /** One lunch in the middle of each hiking day; zero disables it. */
  readonly lunchMinutes: number;
  /** A day with less moving time than this has no lunch. */
  readonly lunchMinimumMovingHours: number;
  /** Moving time of one hiking day; a longer route takes several days, each with lunch. */
  readonly movingHoursPerDay: number;
}

export interface HikingTimePreset {
  readonly id: string;
  readonly name: string;
  readonly parameters: HikingTimeParameters;
}

export const DIN_HIKING_TIME_PRESET_ID = 'din-33466';
export const DAY_HIKE_TIME_PRESET_ID = 'day-hike';
export const MULTI_DAY_HIKE_TIME_PRESET_ID = 'multi-day';

export const MAXIMUM_HIKING_TIME_PRESET_NAME_LENGTH = 60;
export const MAXIMUM_CUSTOM_HIKING_TIME_PRESETS = 50;
export const MAXIMUM_HIKING_PACE_KNOTS = 20;
export const MAXIMUM_HIKING_ALTITUDE_BANDS = 10;

/** DIN 33466 constants; trail routing and Komoot detection also use them. */
export const dinHikingMovement = {
  kind: 'din',
  horizontalKmh: 4,
  ascentMetersPerHour: 300,
  descentMetersPerHour: 500,
} as const satisfies HikingMovementModel;

/**
 * Altitude slowdown from the calibration (speed relative to below 2000 m), after
 * separating terrain and pack effects. Every kept effect exceeds its standard error
 * across hikes; above 3000 m the extra slowdown (×0.80 against ×0.84) did not, so
 * both upper bands merge into one, weighted by distance walked.
 */
const calibratedAltitudeBands: readonly HikingAltitudeBand[] = [
  { fromMeters: 2_000, speedFactor: 0.944 },
  { fromMeters: 2_500, speedFactor: 0.825 },
];

/**
 * How `estimateHikingTime` with a built-in preset scattered around the recorded time
 * on the calibration hikes (day hikes for Day hike, multi-day days for Multi-day trek,
 * all for DIN 33466), cross-validated by trip for the fitted presets: P10 and P90 of
 * the estimate/recorded ratio, and the share of hikes within 10 % and 20 %. Total time
 * is measured from the first to the last movement. Breaks vary more between hikes than
 * walking does, so total time is less certain than moving time. User presets have no
 * such statistics.
 */
export interface HikingTimeAccuracy {
  readonly hikes: number;
  readonly moving: HikingTimeRatioSpread;
  readonly total: HikingTimeRatioSpread;
}

export interface HikingTimeRatioSpread {
  readonly ratioP10: number;
  readonly ratioP90: number;
  readonly withinTenPercent: number;
  readonly withinTwentyPercent: number;
}

export const builtInHikingTimeAccuracy: Readonly<
  Record<string, HikingTimeAccuracy | undefined>
> = {
  [DIN_HIKING_TIME_PRESET_ID]: {
    hikes: 115,
    moving: {
      ratioP10: 1.119,
      ratioP90: 1.681,
      withinTenPercent: 0.08,
      withinTwentyPercent: 0.19,
    },
    total: {
      ratioP10: 0.65,
      ratioP90: 1.169,
      withinTenPercent: 0.37,
      withinTwentyPercent: 0.62,
    },
  },
  [DAY_HIKE_TIME_PRESET_ID]: {
    hikes: 51,
    moving: {
      ratioP10: 0.873,
      ratioP90: 1.234,
      withinTenPercent: 0.47,
      withinTwentyPercent: 0.8,
    },
    total: {
      ratioP10: 0.828,
      ratioP90: 1.331,
      withinTenPercent: 0.49,
      withinTwentyPercent: 0.78,
    },
  },
  [MULTI_DAY_HIKE_TIME_PRESET_ID]: {
    hikes: 64,
    moving: {
      ratioP10: 0.867,
      ratioP90: 1.146,
      withinTenPercent: 0.64,
      withinTwentyPercent: 0.92,
    },
    total: {
      ratioP10: 0.665,
      ratioP90: 1.209,
      withinTenPercent: 0.39,
      withinTwentyPercent: 0.66,
    },
  },
};

export const builtInHikingTimePresets: readonly HikingTimePreset[] = [
  {
    id: DIN_HIKING_TIME_PRESET_ID,
    name: 'DIN 33466 (standard)',
    parameters: {
      movement: dinHikingMovement,
      altitudeBands: [],
      breakMinutesPerMovingHour: 0,
      lunchMinutes: 0,
      lunchMinimumMovingHours: 2,
      movingHoursPerDay: 10,
    },
  },
  {
    // The calibration's grade curve (median speed per grade band), scaled end to end
    // through this estimate so the median day hike's moving time matches the recording
    // (×0.954). Calibrated across seasons: summer runs about 3 % long, winter about 6 %
    // short. Breaks are stationary time per moving hour on day hikes; lunch is its
    // expected length: 38.5 min in the 71 % of hikes that had one.
    id: DAY_HIKE_TIME_PRESET_ID,
    name: 'Day hike',
    parameters: {
      movement: {
        kind: 'grade-curve',
        knots: [
          { gradePercent: -45, speedKmh: 0.91 },
          { gradePercent: -24, speedKmh: 2.9 },
          { gradePercent: -10, speedKmh: 4.12 },
          { gradePercent: 0, speedKmh: 3.74 },
          { gradePercent: 12, speedKmh: 3.16 },
          { gradePercent: 15, speedKmh: 2.31 },
          { gradePercent: 45, speedKmh: 0.86 },
        ],
      },
      altitudeBands: calibratedAltitudeBands,
      breakMinutesPerMovingHour: 18.8,
      lunchMinutes: 27,
      lunchMinimumMovingHours: 2,
      movingHoursPerDay: 10,
    },
  },
  {
    // The day-hike curve shape with its own end-to-end scale (×0.956): a grade-dependent
    // pack penalty did not hold on whole days. Longer breaks and lunch, the expected
    // 51 min in the 63 % of multi-day days that had one, and 8-hour days (the longest
    // recorded multi-day day moved 7.9 h).
    id: MULTI_DAY_HIKE_TIME_PRESET_ID,
    name: 'Multi-day trek',
    parameters: {
      movement: {
        kind: 'grade-curve',
        knots: [
          { gradePercent: -45, speedKmh: 0.91 },
          { gradePercent: -24, speedKmh: 2.91 },
          { gradePercent: -10, speedKmh: 4.13 },
          { gradePercent: 0, speedKmh: 3.75 },
          { gradePercent: 12, speedKmh: 3.16 },
          { gradePercent: 15, speedKmh: 2.31 },
          { gradePercent: 45, speedKmh: 0.86 },
        ],
      },
      altitudeBands: calibratedAltitudeBands,
      breakMinutesPerMovingHour: 21.7,
      lunchMinutes: 32,
      lunchMinimumMovingHours: 2,
      movingHoursPerDay: 8,
    },
  },
];

/** User presets and the preset tracks use unless they choose another one. */
export interface HikingTimePresetSettings {
  readonly defaultPresetId: string;
  readonly custom: readonly HikingTimePreset[];
}

export const defaultHikingTimePresetSettings: HikingTimePresetSettings = {
  defaultPresetId: DAY_HIKE_TIME_PRESET_ID,
  custom: [],
};

/** Built-in presets first, then the user's in saved order. */
export function hikingTimePresets(
  settings: HikingTimePresetSettings,
): readonly HikingTimePreset[] {
  return [...builtInHikingTimePresets, ...settings.custom];
}

export function isBuiltInHikingTimePreset(presetId: string): boolean {
  return builtInHikingTimePresets.some((preset) => preset.id === presetId);
}

/**
 * The track's preset; null follows the default. A preset deleted since, or not synced
 * to this browser, falls back to the default and then to the day-hike preset.
 */
export function resolveHikingTimePreset(
  settings: HikingTimePresetSettings,
  presetId: string | null,
): HikingTimePreset {
  const presets = hikingTimePresets(settings);
  const preset =
    presets.find((value) => value.id === presetId) ??
    presets.find((value) => value.id === settings.defaultPresetId) ??
    presets.find((value) => value.id === DAY_HIKE_TIME_PRESET_ID);
  if (preset === undefined) throw new RangeError('The day-hike preset is missing.');
  return preset;
}

function within(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function strictlyAscending(values: readonly number[]): boolean {
  return values.every(
    (value, index) => index === 0 || value > (values[index - 1] ?? value),
  );
}

/**
 * Whether parameters describe a usable model: positive speeds within walking range,
 * ascending knots and bands, and break and day lengths within a day. Settings and
 * storage share these bounds.
 */
export function validHikingTimeParameters(parameters: HikingTimeParameters): boolean {
  const { movement, altitudeBands } = parameters;
  const movementValid =
    movement.kind === 'din'
      ? within(movement.horizontalKmh, 0.1, 15) &&
        within(movement.ascentMetersPerHour, 10, 3_000) &&
        within(movement.descentMetersPerHour, 10, 5_000)
      : movement.knots.length >= 2 &&
        movement.knots.length <= MAXIMUM_HIKING_PACE_KNOTS &&
        movement.knots.every(
          (knot) =>
            within(knot.gradePercent, -100, 100) && within(knot.speedKmh, 0.1, 15),
        ) &&
        strictlyAscending(movement.knots.map((knot) => knot.gradePercent));
  return (
    movementValid &&
    altitudeBands.length <= MAXIMUM_HIKING_ALTITUDE_BANDS &&
    altitudeBands.every(
      (band) =>
        within(band.fromMeters, -500, 9_000) && within(band.speedFactor, 0.1, 2),
    ) &&
    strictlyAscending(altitudeBands.map((band) => band.fromMeters)) &&
    within(parameters.breakMinutesPerMovingHour, 0, 60) &&
    within(parameters.lunchMinutes, 0, 240) &&
    within(parameters.lunchMinimumMovingHours, 0, 24) &&
    within(parameters.movingHoursPerDay, 1, 24)
  );
}

/**
 * DIN 33466 hiking time for distance, ascent, and descent totals. Monotonic in each
 * argument, so it also yields elapsed time from cumulative values along a route.
 */
export function dinHikingSeconds(
  distanceMeters: number,
  ascentMeters: number,
  descentMeters: number,
  movement: Extract<HikingMovementModel, { kind: 'din' }> = dinHikingMovement,
): number {
  const horizontalHours = distanceMeters / (movement.horizontalKmh * 1_000);
  const verticalHours =
    ascentMeters / movement.ascentMetersPerHour +
    descentMeters / movement.descentMetersPerHour;
  return (
    (Math.max(horizontalHours, verticalHours) +
      Math.min(horizontalHours, verticalHours) / 2) *
    3_600
  );
}

/** Seconds per horizontal metre at a grade; linear in pace, extended past the ends. */
export function hikingPaceSecondsPerMeter(
  knots: readonly HikingPaceKnot[],
  gradePercent: number,
): number {
  const pace = (knot: HikingPaceKnot) => 3.6 / knot.speedKmh;
  let upper = 1;
  while (upper < knots.length - 1 && (knots[upper]?.gradePercent ?? 0) < gradePercent) {
    upper += 1;
  }
  const high = knots[upper];
  const low = knots[upper - 1];
  if (low === undefined || high === undefined) {
    throw new RangeError('A pace curve needs at least two knots.');
  }
  const fraction =
    (gradePercent - low.gradePercent) / (high.gradePercent - low.gradePercent);
  // A custom curve extended past its ends could imply any speed; cap it at 10 km/h.
  return Math.max(pace(low) + (pace(high) - pace(low)) * fraction, 0.36);
}

/** A route sample; points of different source segments are not walked between. */
export interface HikingTimePoint {
  readonly distanceMeters: number;
  readonly elevationMeters?: number;
  readonly sourceSegmentIndex: number;
}

/** Per-track adjustments: `paceFactor` scales moving time, `stopFactor` breaks and lunch. */
export interface HikingTimeAdjustments {
  readonly paceFactor: number;
  readonly stopFactor: number;
}

export interface HikingTimeEstimate {
  /** Elapsed seconds at each point, breaks and lunch included. */
  readonly elapsedSeconds: readonly number[];
  /** Moving seconds at each point. */
  readonly movingElapsedSeconds: readonly number[];
  readonly movingSeconds: number;
  readonly breakSeconds: number;
  readonly lunchSeconds: number;
  readonly lunchCount: number;
  readonly totalSeconds: number;
}

/** Totals a DIN estimate is anchored to; per-sample sums are noisier. */
export interface HikingTimeRouteTotals {
  readonly ascentMeters?: number;
  readonly descentMeters?: number;
}

/**
 * Grade is the slope over this distance of the elevation trend, the mean elevation of
 * points within the trend window: the elevation profile's local grade, which the pace
 * curve was calibrated on. Raw sample noise would steepen grades, and since pace grows
 * faster on steep ground than it falls on gentle ground, it would lengthen walking.
 */
const gradeWindowMeters = 120;
const trendWindowMeters = 200;

interface ElevationRun {
  readonly distances: readonly number[];
  /** Trend elevation at each distance. */
  readonly elevations: readonly number[];
}

/** Mean elevation of the run's points within half the trend window either side. */
function trendElevations(
  distances: readonly number[],
  elevations: readonly number[],
): number[] {
  const trends: number[] = [];
  let windowStart = 0;
  let windowEnd = 0;
  let sum = 0;
  for (const distance of distances) {
    while (
      windowEnd < distances.length &&
      (distances[windowEnd] ?? 0) <= distance + trendWindowMeters / 2
    ) {
      sum += elevations[windowEnd] ?? 0;
      windowEnd += 1;
    }
    while (
      windowStart < windowEnd &&
      (distances[windowStart] ?? 0) < distance - trendWindowMeters / 2
    ) {
      sum -= elevations[windowStart] ?? 0;
      windowStart += 1;
    }
    trends.push(sum / (windowEnd - windowStart));
  }
  return trends;
}

/** Points with elevation per source segment, for interpolating the trend by distance. */
function elevationRuns(points: readonly HikingTimePoint[]): Map<number, ElevationRun> {
  const samples = new Map<number, { distances: number[]; elevations: number[] }>();
  for (const point of points) {
    if (point.elevationMeters === undefined) continue;
    let run = samples.get(point.sourceSegmentIndex);
    if (run === undefined) {
      run = { distances: [], elevations: [] };
      samples.set(point.sourceSegmentIndex, run);
    }
    run.distances.push(point.distanceMeters);
    run.elevations.push(point.elevationMeters);
  }
  const runs = new Map<number, ElevationRun>();
  for (const [segment, run] of samples) {
    runs.set(segment, {
      distances: run.distances,
      elevations: trendElevations(run.distances, run.elevations),
    });
  }
  return runs;
}

/** Linear elevation at a distance, clamped to the run; `hint` speeds ascending queries. */
function elevationAt(
  run: ElevationRun,
  distanceMeters: number,
  hint: { index: number },
): number {
  const { distances, elevations } = run;
  const last = distances.length - 1;
  if (hint.index > last) hint.index = last;
  while (hint.index > 0 && (distances[hint.index] ?? 0) > distanceMeters)
    hint.index -= 1;
  while (hint.index < last && (distances[hint.index + 1] ?? 0) <= distanceMeters) {
    hint.index += 1;
  }
  const start = distances[hint.index] ?? 0;
  const end = distances[hint.index + 1];
  const startElevation = elevations[hint.index] ?? 0;
  if (end === undefined || end <= start || distanceMeters <= start)
    return startElevation;
  const endElevation = elevations[hint.index + 1] ?? startElevation;
  const fraction = Math.min((distanceMeters - start) / (end - start), 1);
  return startElevation + (endElevation - startElevation) * fraction;
}

function altitudeSpeedFactor(
  bands: readonly HikingAltitudeBand[],
  elevationMeters: number | undefined,
): number {
  if (elevationMeters === undefined) return 1;
  let factor = 1;
  for (const band of bands) {
    if (elevationMeters >= band.fromMeters) factor = band.speedFactor;
  }
  return factor;
}

/** Grade and trend elevation of each step `index - 1 → index`, shared with reports. */
export interface HikingTimeSteps {
  /** Zero for the first point, across source segments, and without elevation. */
  readonly gradePercent: readonly number[];
  /** Trend elevation at the step's middle; undefined where the segment has none. */
  readonly elevationMeters: readonly (number | undefined)[];
}

export function hikingTimeSteps(points: readonly HikingTimePoint[]): HikingTimeSteps {
  const gradePercent = points.map(() => 0);
  const elevationMeters: (number | undefined)[] = points.map(() => undefined);
  const runs = elevationRuns(points);
  const lowHint = { index: 0 };
  const highHint = { index: 0 };
  const midHint = { index: 0 };
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous === undefined || point === undefined) continue;
    if (previous.sourceSegmentIndex !== point.sourceSegmentIndex) {
      lowHint.index = 0;
      highHint.index = 0;
      midHint.index = 0;
      continue;
    }
    const run = runs.get(point.sourceSegmentIndex);
    if (run === undefined) continue;
    const middle = (previous.distanceMeters + point.distanceMeters) / 2;
    elevationMeters[index] = elevationAt(run, middle, midHint);
    // Missing elevation adds horizontal travel only, never an invented slope.
    if (previous.elevationMeters === undefined || point.elevationMeters === undefined) {
      continue;
    }
    const runStart = run.distances[0] ?? 0;
    const runEnd = run.distances.at(-1) ?? runStart;
    const low = Math.max(middle - gradeWindowMeters / 2, runStart);
    const high = Math.min(middle + gradeWindowMeters / 2, runEnd);
    if (high - low > 1) {
      gradePercent[index] =
        ((elevationAt(run, high, highHint) - elevationAt(run, low, lowHint)) /
          (high - low)) *
        100;
    }
  }
  return { gradePercent, elevationMeters };
}

/** Unadjusted moving seconds of each step `index - 1 → index`; zero across segments. */
function movingStepSeconds(
  points: readonly HikingTimePoint[],
  parameters: HikingTimeParameters,
  totals: HikingTimeRouteTotals,
): number[] {
  const steps = points.map(() => 0);
  const { gradePercent, elevationMeters } = hikingTimeSteps(points);
  const movement = parameters.movement;

  // DIN works on cumulative totals: its elapsed time is a function of distance, ascent,
  // and descent so far, scaled so the finish matches the route totals.
  let ascent = 0;
  let descent = 0;
  let previousDin = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous === undefined || point === undefined) continue;
    if (previous.sourceSegmentIndex !== point.sourceSegmentIndex) {
      if (movement.kind === 'din') {
        previousDin = dinHikingSeconds(point.distanceMeters, ascent, descent, movement);
      }
      continue;
    }
    let seconds: number;
    if (movement.kind === 'din') {
      if (
        previous.elevationMeters !== undefined &&
        point.elevationMeters !== undefined
      ) {
        const change = point.elevationMeters - previous.elevationMeters;
        if (change > 0) ascent += change;
        else descent -= change;
      }
      const din = dinHikingSeconds(point.distanceMeters, ascent, descent, movement);
      seconds = din - previousDin;
      previousDin = din;
    } else {
      seconds =
        (point.distanceMeters - previous.distanceMeters) *
        hikingPaceSecondsPerMeter(movement.knots, gradePercent[index] ?? 0);
    }
    steps[index] =
      seconds / altitudeSpeedFactor(parameters.altitudeBands, elevationMeters[index]);
  }

  if (
    movement.kind === 'din' &&
    totals.ascentMeters !== undefined &&
    totals.descentMeters !== undefined
  ) {
    const sampledDin = previousDin;
    const anchoredDin = dinHikingSeconds(
      points.at(-1)?.distanceMeters ?? 0,
      totals.ascentMeters,
      totals.descentMeters,
      movement,
    );
    // Altitude bands scale the anchored total the same way they scaled the samples.
    if (sampledDin > 0) {
      const scale = anchoredDin / sampledDin;
      for (let index = 0; index < steps.length; index += 1) {
        steps[index] = (steps[index] ?? 0) * scale;
      }
    }
  }
  return steps;
}

/**
 * Hiking time along a route. Breaks follow unadjusted moving time, so the pace factor
 * changes only walking; the hiker rests in place during lunch.
 */
export function estimateHikingTime(
  points: readonly HikingTimePoint[],
  parameters: HikingTimeParameters,
  adjustments: HikingTimeAdjustments,
  totals: HikingTimeRouteTotals = {},
): HikingTimeEstimate {
  const steps = movingStepSeconds(points, parameters, totals);
  const movingElapsedSeconds: number[] = [];
  let baseMoving = 0;
  for (const step of steps) {
    baseMoving += step;
    movingElapsedSeconds.push(baseMoving * adjustments.paceFactor);
  }
  const movingSeconds = baseMoving * adjustments.paceFactor;
  const breakSeconds =
    (baseMoving / 3_600) *
    parameters.breakMinutesPerMovingHour *
    60 *
    adjustments.stopFactor;

  const dayCount = Math.max(
    1,
    Math.ceil(baseMoving / 3_600 / parameters.movingHoursPerDay),
  );
  const lunchCount =
    parameters.lunchMinutes > 0 &&
    baseMoving / dayCount >= parameters.lunchMinimumMovingHours * 3_600
      ? dayCount
      : 0;
  const lunchDuration = parameters.lunchMinutes * 60 * adjustments.stopFactor;
  const lunchStarts = Array.from(
    { length: lunchCount },
    (_, day) => (movingSeconds * (day + 0.5)) / dayCount,
  );

  const breakRate = movingSeconds > 0 ? breakSeconds / movingSeconds : 0;
  let lunchesTaken = 0;
  const elapsedSeconds = movingElapsedSeconds.map((moving) => {
    while (
      lunchesTaken < lunchStarts.length &&
      moving > (lunchStarts[lunchesTaken] ?? 0)
    ) {
      lunchesTaken += 1;
    }
    return moving * (1 + breakRate) + lunchesTaken * lunchDuration;
  });
  const lunchSeconds = lunchCount * lunchDuration;
  return {
    elapsedSeconds,
    movingElapsedSeconds,
    movingSeconds,
    breakSeconds,
    lunchSeconds,
    lunchCount,
    totalSeconds: movingSeconds + breakSeconds + lunchSeconds,
  };
}
