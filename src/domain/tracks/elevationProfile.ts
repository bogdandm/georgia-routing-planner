import { medianInPlace } from '@/domain/elevation/robustElevationStatistics';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import { geodesicDistanceMeters } from '@/domain/tracks/trackCalculations';

export const ELEVATION_ALGORITHM_VERSION = 2;

export interface ElevationAnalysisOptions {
  readonly sampleIntervalM: number;
  readonly medianWindowSamples: number;
  readonly recordedSpikeThresholdM: number;
  readonly trendWindowM: number;
  readonly localGradeWindowM: number;
  readonly reversalElevationM: number;
  readonly reversalDistanceM: number;
  readonly minSegmentDistanceM: number;
  readonly minNetElevationM: number;
  readonly interruptionMaxDistanceM: number;
  readonly interruptionMaxElevationM: number;
  readonly minGradeSubsegmentDistanceM: number;
}

export const DEFAULT_ELEVATION_ANALYSIS_OPTIONS: ElevationAnalysisOptions = {
  sampleIntervalM: 10,
  medianWindowSamples: 3,
  recordedSpikeThresholdM: 30,
  trendWindowM: 200,
  localGradeWindowM: 120,
  reversalElevationM: 30,
  reversalDistanceM: 250,
  minSegmentDistanceM: 1_000,
  minNetElevationM: 100,
  interruptionMaxDistanceM: 400,
  interruptionMaxElevationM: 30,
  minGradeSubsegmentDistanceM: 50,
};

export interface ElevationProfileInputPoint {
  readonly coordinate: TrackCoordinate;
  readonly recordedAt?: string;
  readonly rawElevationMeters: number;
  readonly elevationMeters: number;
  readonly sourceSegmentIndex: number;
}

export interface ElevationSampleInput {
  readonly coordinate: TrackCoordinate;
  readonly recordedAt?: string;
  readonly elevationMeters: number;
  readonly sourceSegmentIndex: number;
}

export interface ElevationProfilePoint extends ElevationProfileInputPoint {
  readonly sampleIndex: number;
  readonly distanceMeters: number;
  readonly trendElevationMeters: number;
  readonly localGradePct: number;
}

export type MacroElevationSegmentType = 'climb' | 'descent' | 'flat';

export type GradeBand =
  | 'steep-descent'
  | 'descent'
  | 'flat'
  | 'climb'
  | 'hard-climb'
  | 'steep-climb'
  | 'extreme-climb';

export interface GradeSubsegment {
  readonly startSampleIndex: number;
  readonly endSampleIndex: number;
  readonly startDistanceMeters: number;
  readonly endDistanceMeters: number;
  readonly distanceMeters: number;
  readonly averageGradePct: number;
  readonly band: GradeBand;
}

export interface MacroElevationSegment {
  readonly startSampleIndex: number;
  readonly endSampleIndex: number;
  readonly startDistanceMeters: number;
  readonly endDistanceMeters: number;
  readonly type: MacroElevationSegmentType;
  readonly distanceMeters: number;
  readonly netElevationChangeMeters: number;
  readonly ascentMeters: number;
  readonly descentMeters: number;
  readonly averageGradePct: number;
  readonly gradeSubsegments: readonly GradeSubsegment[];
}

export interface ElevationProfile {
  readonly points: readonly ElevationProfilePoint[];
  readonly segments: readonly MacroElevationSegment[];
  readonly minimumMeters: number;
  readonly maximumMeters: number;
  readonly algorithmVersion: number;
}
export function elevationSegmentIndexForSample(
  profile: ElevationProfile,
  sampleIndex: number,
): number | null {
  const segmentIndex = profile.segments.findIndex(
    (segment, index) =>
      sampleIndex >= segment.startSampleIndex &&
      (sampleIndex < segment.endSampleIndex ||
        (index === profile.segments.length - 1 &&
          sampleIndex <= segment.endSampleIndex)),
  );
  return segmentIndex < 0 ? null : segmentIndex;
}

/** Caps chart work without dropping macro or grade-band boundaries. */
export function sampleElevationProfilePoints(
  profile: ElevationProfile,
  maximum = 1_200,
): readonly ElevationProfilePoint[] {
  const { points } = profile;
  if (points.length <= maximum) return points;
  const required = new Uint8Array(points.length);
  required[0] = 1;
  required[points.length - 1] = 1;
  for (const segment of profile.segments) {
    required[segment.startSampleIndex] = 1;
    required[segment.endSampleIndex] = 1;
    for (const gradeSegment of segment.gradeSubsegments) {
      required[gradeSegment.startSampleIndex] = 1;
      required[gradeSegment.endSampleIndex] = 1;
    }
  }
  let requiredCount = 0;
  for (const isRequired of required) requiredCount += isRequired;
  if (requiredCount < maximum) {
    const optionalCount = maximum - requiredCount;
    for (let index = 1; index <= optionalCount; index += 1) {
      const pointIndex = Math.round(
        (index / (optionalCount + 1)) * (points.length - 1),
      );
      required[pointIndex] = 1;
    }
  }
  const sampled: ElevationProfilePoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (required[index] !== 1) continue;
    const point = points[index];
    if (point !== undefined) sampled.push(point);
  }
  return sampled;
}

interface Range {
  readonly start: number;
  readonly end: number;
  readonly type: MacroElevationSegmentType;
  readonly preventsAbsorption?: boolean;
}

interface GradeRange {
  start: number;
  end: number;
  distanceMeters: number;
  weightedGradeSum: number;
  averageGradePct: number;
  band: GradeBand;
}

function requiredValue<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError('Profile data is incomplete.');
  return value;
}

function numericValue(values: Float64Array, index: number): number {
  return values[index] ?? 0;
}

/** Applies one three-sample median pass independently to each completed source segment. */
export function medianFilterElevationSamples(
  segments: readonly (readonly ElevationSampleInput[])[],
): readonly (readonly ElevationProfileInputPoint[])[] {
  return segments.map((segment) => {
    const window = new Float64Array(3);
    return segment.map((point, index) => {
      let elevationMeters = point.elevationMeters;
      if (index > 0 && index < segment.length - 1) {
        window[0] = requiredValue(segment, index - 1).elevationMeters;
        window[1] = point.elevationMeters;
        window[2] = requiredValue(segment, index + 1).elevationMeters;
        elevationMeters = medianInPlace(window, window.length);
      }
      const filtered: ElevationProfileInputPoint = {
        coordinate: point.coordinate,
        rawElevationMeters: point.elevationMeters,
        elevationMeters,
        sourceSegmentIndex: point.sourceSegmentIndex,
        ...(point.recordedAt === undefined ? {} : { recordedAt: point.recordedAt }),
      };
      return filtered;
    });
  });
}

export function gradeBandForGrade(gradePct: number): GradeBand {
  if (gradePct <= -10) return 'steep-descent';
  if (gradePct < -3) return 'descent';
  if (gradePct <= 3) return 'flat';
  if (gradePct < 10) return 'climb';
  if (gradePct < 20) return 'hard-climb';
  if (gradePct < 30) return 'steep-climb';
  return 'extreme-climb';
}

function calculateRunPoints(
  inputs: readonly ElevationProfileInputPoint[],
  profile: ElevationProfilePoint[],
  totalDistance: number,
  options: ElevationAnalysisOptions,
): {
  readonly start: number;
  readonly end: number;
  readonly totalDistance: number;
} | null {
  if (inputs.length < 2) return null;
  const start = profile.length;
  let distanceMeters = totalDistance;
  for (let index = 0; index < inputs.length; index += 1) {
    const input = requiredValue(inputs, index);
    if (index > 0) {
      distanceMeters += geodesicDistanceMeters(
        requiredValue(inputs, index - 1).coordinate,
        input.coordinate,
      );
    }
    profile.push({
      ...input,
      sampleIndex: profile.length,
      distanceMeters,
      trendElevationMeters: input.elevationMeters,
      localGradePct: 0,
    });
  }
  const end = profile.length - 1;
  const count = end - start + 1;
  const trends = new Float64Array(count);
  const grades = new Float64Array(count);
  const halfTrendWindow = options.trendWindowM / 2;
  let windowStart = start;
  let windowEnd = start;
  let elevationSum = 0;
  for (let index = start; index <= end; index += 1) {
    const point = requiredValue(profile, index);
    while (
      windowEnd <= end &&
      requiredValue(profile, windowEnd).distanceMeters <=
        point.distanceMeters + halfTrendWindow
    ) {
      elevationSum += requiredValue(profile, windowEnd).elevationMeters;
      windowEnd += 1;
    }
    while (
      windowStart < windowEnd &&
      requiredValue(profile, windowStart).distanceMeters <
        point.distanceMeters - halfTrendWindow
    ) {
      elevationSum -= requiredValue(profile, windowStart).elevationMeters;
      windowStart += 1;
    }
    trends[index - start] = elevationSum / (windowEnd - windowStart);
  }
  const firstDistance = requiredValue(profile, start).distanceMeters;
  const lastDistance = requiredValue(profile, end).distanceMeters;
  const halfLocalWindow = options.localGradeWindowM / 2;
  let leftBracket = start;
  let rightBracket = start;
  const elevationAt = (
    targetDistance: number,
    bracket: number,
  ): { elevation: number; bracket: number } => {
    while (
      bracket < end &&
      requiredValue(profile, bracket + 1).distanceMeters < targetDistance
    ) {
      bracket += 1;
    }
    const left = requiredValue(profile, bracket);
    const right = requiredValue(profile, Math.min(bracket + 1, end));
    const leftTrend = numericValue(trends, bracket - start);
    const rightTrend = numericValue(trends, Math.min(bracket + 1, end) - start);
    if (right.distanceMeters === left.distanceMeters) {
      return { elevation: leftTrend, bracket };
    }
    const fraction =
      (targetDistance - left.distanceMeters) /
      (right.distanceMeters - left.distanceMeters);
    return {
      elevation: leftTrend + (rightTrend - leftTrend) * fraction,
      bracket,
    };
  };
  for (let index = start; index <= end; index += 1) {
    const point = requiredValue(profile, index);
    const localStart = Math.max(firstDistance, point.distanceMeters - halfLocalWindow);
    const localEnd = Math.min(lastDistance, point.distanceMeters + halfLocalWindow);
    const leftSample = elevationAt(localStart, leftBracket);
    leftBracket = leftSample.bracket;
    const rightSample = elevationAt(localEnd, rightBracket);
    rightBracket = rightSample.bracket;
    const horizontalDistance = localEnd - localStart;
    grades[index - start] =
      horizontalDistance === 0
        ? 0
        : (100 * (rightSample.elevation - leftSample.elevation)) / horizontalDistance;
  }
  for (let index = start; index <= end; index += 1) {
    const point = requiredValue(profile, index);
    profile[index] = {
      ...point,
      trendElevationMeters: numericValue(trends, index - start),
      localGradePct: numericValue(grades, index - start),
    };
  }
  return { start, end, totalDistance: distanceMeters };
}

function detectDirectionalRanges(
  points: readonly ElevationProfilePoint[],
  start: number,
  end: number,
  options: ElevationAnalysisOptions,
): Range[] {
  let mode: MacroElevationSegmentType | 'unknown' = 'unknown';
  let rangeStart = start;
  let candidateLow = start;
  let candidateHigh = start;
  const ranges: Range[] = [];
  const push = (
    rangeStartIndex: number,
    rangeEndIndex: number,
    type: MacroElevationSegmentType,
  ) => {
    if (rangeEndIndex >= rangeStartIndex)
      ranges.push({ start: rangeStartIndex, end: rangeEndIndex, type });
  };
  for (let index = start + 1; index <= end; index += 1) {
    const point = points[index];
    const low = points[candidateLow];
    const high = points[candidateHigh];
    if (point === undefined || low === undefined || high === undefined) continue;
    if (mode === 'unknown') {
      const climbChange = point.trendElevationMeters - low.trendElevationMeters;
      const descentChange = high.trendElevationMeters - point.trendElevationMeters;
      const climbEligible =
        climbChange >= options.reversalElevationM &&
        point.distanceMeters - low.distanceMeters >= options.reversalDistanceM;
      const descentEligible =
        descentChange >= options.reversalElevationM &&
        point.distanceMeters - high.distanceMeters >= options.reversalDistanceM;
      if (climbEligible !== descentEligible) {
        if (climbEligible) {
          push(start, candidateLow, 'flat');
          mode = 'climb';
          rangeStart = candidateLow;
          candidateHigh = index;
        } else {
          push(start, candidateHigh, 'flat');
          mode = 'descent';
          rangeStart = candidateHigh;
          candidateLow = index;
        }
      } else if (climbEligible && descentEligible) {
        if (climbChange > descentChange) {
          push(start, candidateLow, 'flat');
          mode = 'climb';
          rangeStart = candidateLow;
          candidateHigh = index;
        } else if (descentChange > climbChange) {
          push(start, candidateHigh, 'flat');
          mode = 'descent';
          rangeStart = candidateHigh;
          candidateLow = index;
        }
      }
      if (
        point.trendElevationMeters <
        (points[candidateLow]?.trendElevationMeters ?? Infinity)
      ) {
        candidateLow = index;
      }
      if (
        point.trendElevationMeters >
        (points[candidateHigh]?.trendElevationMeters ?? -Infinity)
      ) {
        candidateHigh = index;
      }
      continue;
    }
    if (mode === 'climb') {
      const highPoint = points[candidateHigh];
      if (
        highPoint !== undefined &&
        point.trendElevationMeters > highPoint.trendElevationMeters
      ) {
        candidateHigh = index;
      } else if (
        highPoint !== undefined &&
        highPoint.trendElevationMeters - point.trendElevationMeters >=
          options.reversalElevationM &&
        point.distanceMeters - highPoint.distanceMeters >= options.reversalDistanceM
      ) {
        push(rangeStart, candidateHigh, 'climb');
        mode = 'descent';
        rangeStart = candidateHigh;
        candidateLow = index;
      }
      continue;
    }
    const lowPoint = points[candidateLow];
    if (
      lowPoint !== undefined &&
      point.trendElevationMeters < lowPoint.trendElevationMeters
    ) {
      candidateLow = index;
    } else if (
      lowPoint !== undefined &&
      point.trendElevationMeters - lowPoint.trendElevationMeters >=
        options.reversalElevationM &&
      point.distanceMeters - lowPoint.distanceMeters >= options.reversalDistanceM
    ) {
      push(rangeStart, candidateLow, 'descent');
      mode = 'climb';
      rangeStart = candidateLow;
      candidateHigh = index;
    }
  }
  if (mode === 'unknown') return [{ start, end, type: 'flat' }];
  push(rangeStart, end, mode);
  return ranges;
}

function rangeMetrics(
  range: Range,
  points: readonly ElevationProfilePoint[],
): Omit<MacroElevationSegment, 'type' | 'gradeSubsegments'> {
  const first = points[range.start];
  const last = points[range.end];
  if (first === undefined || last === undefined)
    throw new RangeError('Profile range is incomplete.');
  let ascentMeters = 0;
  let descentMeters = 0;
  for (let index = range.start + 1; index <= range.end; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) continue;
    const change = current.elevationMeters - previous.elevationMeters;
    if (change > 0) ascentMeters += change;
    if (change < 0) descentMeters -= change;
  }
  const distanceMeters = last.distanceMeters - first.distanceMeters;
  const netElevationChangeMeters = last.elevationMeters - first.elevationMeters;
  return {
    startSampleIndex: range.start,
    endSampleIndex: range.end,
    startDistanceMeters: first.distanceMeters,
    endDistanceMeters: last.distanceMeters,
    distanceMeters,
    netElevationChangeMeters,
    ascentMeters,
    descentMeters,
    averageGradePct:
      distanceMeters === 0 ? 0 : (100 * netElevationChangeMeters) / distanceMeters,
  };
}

function qualifies(
  range: Range,
  points: readonly ElevationProfilePoint[],
  options: ElevationAnalysisOptions,
): boolean {
  const metrics = rangeMetrics(range, points);
  return (
    metrics.distanceMeters >= options.minSegmentDistanceM ||
    Math.abs(metrics.netElevationChangeMeters) >= options.minNetElevationM
  );
}

function qualifiesDirectional(
  range: Range,
  points: readonly ElevationProfilePoint[],
  options: ElevationAnalysisOptions,
): boolean {
  const netElevationChangeMeters = rangeMetrics(range, points).netElevationChangeMeters;
  return (
    qualifies(range, points, options) &&
    ((range.type === 'climb' && netElevationChangeMeters > 0) ||
      (range.type === 'descent' && netElevationChangeMeters < 0))
  );
}

function coalesceRanges(ranges: readonly Range[]): Range[] {
  const result: Range[] = [];
  for (const range of ranges) {
    const previous = result.at(-1);
    if (previous?.type === range.type && previous.end === range.start) {
      result[result.length - 1] = {
        ...previous,
        end: range.end,
        preventsAbsorption:
          previous.preventsAbsorption === true || range.preventsAbsorption === true,
      };
    } else {
      result.push(range);
    }
  }
  return result;
}

function mergeInterruptions(
  ranges: Range[],
  points: readonly ElevationProfilePoint[],
  options: ElevationAnalysisOptions,
): Range[] {
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 1; index < ranges.length - 1; index += 1) {
      const previous = ranges[index - 1];
      const middle = ranges[index];
      const next = ranges[index + 1];
      if (previous === undefined || middle === undefined || next === undefined)
        continue;
      if (
        previous.type !== next.type ||
        previous.type === 'flat' ||
        middle.type === 'flat'
      )
        continue;
      const middleMetrics = rangeMetrics(middle, points);
      const combined: Range = {
        start: previous.start,
        end: next.end,
        type: previous.type,
      };
      const combinedMetrics = rangeMetrics(combined, points);
      const oppositeMovement =
        previous.type === 'climb'
          ? middleMetrics.netElevationChangeMeters >= -options.interruptionMaxElevationM
          : middleMetrics.netElevationChangeMeters <= options.interruptionMaxElevationM;
      const intendedDirection =
        previous.type === 'climb'
          ? combinedMetrics.netElevationChangeMeters > 0
          : combinedMetrics.netElevationChangeMeters < 0;
      if (
        middleMetrics.distanceMeters < options.interruptionMaxDistanceM &&
        oppositeMovement &&
        intendedDirection
      ) {
        ranges.splice(index - 1, 3, combined);
        changed = true;
        break;
      }
    }
  }
  return ranges;
}

function absorbShortFlats(
  ranges: Range[],
  points: readonly ElevationProfilePoint[],
  options: ElevationAnalysisOptions,
): Range[] {
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < ranges.length; index += 1) {
      const flat = ranges[index];
      if (flat?.type !== 'flat') continue;
      if (flat.preventsAbsorption === true) continue;
      if (rangeMetrics(flat, points).distanceMeters >= options.minSegmentDistanceM)
        continue;
      const previous = ranges[index - 1];
      const next = ranges[index + 1];
      const previousCandidate =
        previous !== undefined && previous.type !== 'flat'
          ? { start: previous.start, end: flat.end, type: previous.type }
          : undefined;
      const nextCandidate =
        next !== undefined && next.type !== 'flat'
          ? { start: flat.start, end: next.end, type: next.type }
          : undefined;
      if (
        previous !== undefined &&
        next !== undefined &&
        previousCandidate !== undefined &&
        nextCandidate !== undefined &&
        previous.type === next.type &&
        qualifiesDirectional(
          { start: previous.start, end: next.end, type: previous.type },
          points,
          options,
        )
      ) {
        ranges.splice(index - 1, 3, {
          start: previous.start,
          end: next.end,
          type: previous.type,
        });
        changed = true;
        break;
      }
      const eligible: Range[] = [];
      if (
        previousCandidate !== undefined &&
        qualifiesDirectional(previousCandidate, points, options)
      ) {
        eligible.push(previousCandidate);
      }
      if (
        nextCandidate !== undefined &&
        qualifiesDirectional(nextCandidate, points, options)
      ) {
        eligible.push(nextCandidate);
      }
      if (eligible.length === 0) continue;
      const selected =
        eligible.length === 1
          ? eligible[0]
          : Math.abs(
                rangeMetrics(eligible[0] ?? flat, points).netElevationChangeMeters,
              ) >=
              Math.abs(
                rangeMetrics(eligible[1] ?? flat, points).netElevationChangeMeters,
              )
            ? eligible[0]
            : eligible[1];
      if (selected === undefined) continue;
      if (previousCandidate === selected) {
        ranges.splice(index - 1, 2, selected);
      } else {
        ranges.splice(index, 2, selected);
      }
      changed = true;
      break;
    }
  }
  return ranges;
}

function buildGradeSubsegments(
  range: Range,
  points: readonly ElevationProfilePoint[],
  options: ElevationAnalysisOptions,
): readonly GradeSubsegment[] {
  const ranges: GradeRange[] = [];
  for (let index = range.start + 1; index <= range.end; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) continue;
    const distanceMeters = current.distanceMeters - previous.distanceMeters;
    const averageGradePct = (previous.localGradePct + current.localGradePct) / 2;
    const band = gradeBandForGrade(averageGradePct);
    const last = ranges.at(-1);
    if (last?.band === band) {
      last.end = index;
      last.distanceMeters += distanceMeters;
      last.weightedGradeSum += averageGradePct * distanceMeters;
      last.averageGradePct =
        last.distanceMeters === 0 ? 0 : last.weightedGradeSum / last.distanceMeters;
    } else {
      ranges.push({
        start: index - 1,
        end: index,
        distanceMeters,
        weightedGradeSum: averageGradePct * distanceMeters,
        averageGradePct,
        band,
      });
    }
  }
  const mergeAdjacent = (): void => {
    for (let index = 1; index < ranges.length; index += 1) {
      const previous = ranges[index - 1];
      const current = ranges[index];
      if (
        previous?.band !== current?.band ||
        previous === undefined ||
        current === undefined
      )
        continue;
      previous.end = current.end;
      previous.distanceMeters += current.distanceMeters;
      previous.weightedGradeSum += current.weightedGradeSum;
      previous.averageGradePct =
        previous.distanceMeters === 0
          ? 0
          : previous.weightedGradeSum / previous.distanceMeters;
      ranges.splice(index, 1);
      index -= 1;
    }
  };
  while (ranges.length > 1) {
    const shortIndex = ranges.findIndex(
      (gradeRange) => gradeRange.distanceMeters < options.minGradeSubsegmentDistanceM,
    );
    if (shortIndex < 0) break;
    const shortRange = ranges[shortIndex];
    if (shortRange === undefined) break;
    const previous = ranges[shortIndex - 1];
    const next = ranges[shortIndex + 1];
    const choosePrevious =
      next === undefined ||
      (previous !== undefined &&
        (Math.abs(previous.averageGradePct - shortRange.averageGradePct) <
          Math.abs(next.averageGradePct - shortRange.averageGradePct) ||
          (Math.abs(previous.averageGradePct - shortRange.averageGradePct) ===
            Math.abs(next.averageGradePct - shortRange.averageGradePct) &&
            (previous.distanceMeters > next.distanceMeters ||
              previous.distanceMeters === next.distanceMeters))));
    if (choosePrevious && previous !== undefined) {
      previous.end = shortRange.end;
      previous.distanceMeters += shortRange.distanceMeters;
      previous.weightedGradeSum += shortRange.weightedGradeSum;
      previous.averageGradePct =
        previous.distanceMeters === 0
          ? 0
          : previous.weightedGradeSum / previous.distanceMeters;
      previous.band = gradeBandForGrade(previous.averageGradePct);
      ranges.splice(shortIndex, 1);
    } else if (next !== undefined) {
      next.start = shortRange.start;
      next.distanceMeters += shortRange.distanceMeters;
      next.weightedGradeSum += shortRange.weightedGradeSum;
      next.averageGradePct =
        next.distanceMeters === 0 ? 0 : next.weightedGradeSum / next.distanceMeters;
      next.band = gradeBandForGrade(next.averageGradePct);
      ranges.splice(shortIndex, 1);
    }
    mergeAdjacent();
  }
  return ranges.map((gradeRange) => {
    const start = points[gradeRange.start];
    const end = points[gradeRange.end];
    if (start === undefined || end === undefined)
      throw new RangeError('Grade range is incomplete.');
    return {
      startSampleIndex: gradeRange.start,
      endSampleIndex: gradeRange.end,
      startDistanceMeters: start.distanceMeters,
      endDistanceMeters: end.distanceMeters,
      distanceMeters: gradeRange.distanceMeters,
      averageGradePct: gradeRange.averageGradePct,
      band: gradeRange.band,
    };
  });
}

function finalizeRunRanges(
  initial: readonly Range[],
  points: readonly ElevationProfilePoint[],
  options: ElevationAnalysisOptions,
): readonly MacroElevationSegment[] {
  const merged = mergeInterruptions([...initial], points, options);
  const classified = merged.map((range) => {
    const qualified =
      range.type === 'flat' || qualifiesDirectional(range, points, options);
    const netElevationChangeMeters = rangeMetrics(
      range,
      points,
    ).netElevationChangeMeters;
    return {
      ...range,
      type: qualified ? range.type : 'flat',
      preventsAbsorption:
        !qualified &&
        Math.abs(netElevationChangeMeters) > options.interruptionMaxElevationM,
    };
  });
  const absorbed = absorbShortFlats(coalesceRanges(classified), points, options);
  return coalesceRanges(absorbed).map((range) => ({
    ...rangeMetrics(range, points),
    type: range.type,
    gradeSubsegments: buildGradeSubsegments(range, points, options),
  }));
}

export function calculateElevationProfile(
  segments: readonly (readonly ElevationProfileInputPoint[])[],
  options: ElevationAnalysisOptions = DEFAULT_ELEVATION_ANALYSIS_OPTIONS,
): ElevationProfile | null {
  const points: ElevationProfilePoint[] = [];
  const runs: { start: number; end: number }[] = [];
  let totalDistance = 0;
  for (const segment of segments) {
    const run = calculateRunPoints(segment, points, totalDistance, options);
    if (run !== null) {
      runs.push({ start: run.start, end: run.end });
      totalDistance = run.totalDistance;
    }
  }
  if (points.length < 2) return null;
  const segmentsResult = runs.flatMap((run) =>
    finalizeRunRanges(
      detectDirectionalRanges(points, run.start, run.end, options),
      points,
      options,
    ),
  );
  let minimumMeters = Infinity;
  let maximumMeters = -Infinity;
  for (const point of points) {
    minimumMeters = Math.min(minimumMeters, point.elevationMeters);
    maximumMeters = Math.max(maximumMeters, point.elevationMeters);
  }
  return {
    points,
    segments: segmentsResult,
    minimumMeters,
    maximumMeters,
    algorithmVersion: ELEVATION_ALGORITHM_VERSION,
  };
}
