/** Recorded time and smoothed speed along a profile. */

/** Short tracks still average speed over several minutes of walking. */
const MINIMUM_SPEED_SIGMA_SECONDS = 90;
/** Long tracks smooth over a fixed share of their duration, keeping the curve readable. */
const SPEED_SIGMA_DURATION_FRACTION = 1 / 240;
const SPEED_CELLS_PER_SIGMA = 4;
const SPEED_KERNEL_RADIUS_CELLS = 3 * SPEED_CELLS_PER_SIGMA;

/**
 * Recorded elapsed seconds per point, or null unless every point has a valid timestamp
 * and time advances. Pauses keep the hiker in place; reversed clock jumps do not move
 * time backward.
 */
export function recordedElapsedSeconds(
  points: readonly { readonly recordedAt?: string }[],
): readonly number[] | null {
  const elapsed: number[] = [];
  let startMilliseconds: number | undefined;
  let latestSeconds = 0;
  for (const point of points) {
    const milliseconds =
      point.recordedAt === undefined ? Number.NaN : Date.parse(point.recordedAt);
    if (!Number.isFinite(milliseconds)) return null;
    startMilliseconds ??= milliseconds;
    latestSeconds = Math.max(latestSeconds, (milliseconds - startMilliseconds) / 1_000);
    elapsed.push(latestSeconds);
  }
  return latestSeconds > 0 ? elapsed : null;
}

/** Gaussian-smoothed speed on a uniform time grid; read it with `smoothedSpeedAt`. */
export interface SmoothedSpeed {
  /** Grid spacing: cell `k` covers `[k, k + 1) × cellSeconds` of elapsed time. */
  readonly cellSeconds: number;
  readonly cellMetersPerSecond: ArrayLike<number>;
}

/**
 * Speed between neighbouring GPS fixes jumps sharply, so travelled distance is first
 * resampled onto a uniform time grid: every recorded second then weighs the same however
 * densely the profile is sampled, and pauses pull the curve smoothly toward zero even
 * when the recording has no fixes during them.
 */
export function smoothSpeed(
  points: readonly { readonly distanceMeters: number }[],
  elapsedSeconds: readonly number[],
): SmoothedSpeed {
  const totalSeconds = elapsedSeconds.at(-1) ?? 0;
  if (points.length !== elapsedSeconds.length || totalSeconds <= 0) {
    throw new RangeError('Speed needs advancing time for every profile point.');
  }
  const cellSeconds =
    Math.max(
      MINIMUM_SPEED_SIGMA_SECONDS,
      totalSeconds * SPEED_SIGMA_DURATION_FRACTION,
    ) / SPEED_CELLS_PER_SIGMA;
  const cellCount = Math.ceil(totalSeconds / cellSeconds);

  // Distance at every cell boundary, linearly interpolated in time. Boundary zero keeps
  // the first fix, so distance between fixes sharing the start time lands in cell zero.
  const boundaryDistances = new Float64Array(cellCount + 1);
  boundaryDistances[0] = points[0]?.distanceMeters ?? 0;
  let pointIndex = 0;
  for (let boundary = 1; boundary <= cellCount; boundary += 1) {
    const seconds = Math.min(boundary * cellSeconds, totalSeconds);
    while (
      pointIndex < points.length - 1 &&
      (elapsedSeconds[pointIndex + 1] ?? totalSeconds) <= seconds
    ) {
      pointIndex += 1;
    }
    const start = points[pointIndex]?.distanceMeters ?? 0;
    const startSeconds = elapsedSeconds[pointIndex] ?? totalSeconds;
    const endSeconds = elapsedSeconds[pointIndex + 1];
    const end = points[pointIndex + 1]?.distanceMeters;
    boundaryDistances[boundary] =
      end === undefined || endSeconds === undefined
        ? start
        : start +
          ((end - start) * (seconds - startSeconds)) / (endSeconds - startSeconds);
  }

  // Duration-weighted Gaussian over cells; renormalized where the kernel leaves the track.
  const kernel = Array.from({ length: SPEED_KERNEL_RADIUS_CELLS + 1 }, (_, offset) =>
    Math.exp(-0.5 * (offset / SPEED_CELLS_PER_SIGMA) ** 2),
  );
  const cellDuration = (cell: number): number =>
    Math.min((cell + 1) * cellSeconds, totalSeconds) - cell * cellSeconds;
  const cellSpeeds = new Float64Array(cellCount);
  for (let cell = 0; cell < cellCount; cell += 1) {
    let distanceSum = 0;
    let durationSum = 0;
    const first = Math.max(0, cell - SPEED_KERNEL_RADIUS_CELLS);
    const last = Math.min(cellCount - 1, cell + SPEED_KERNEL_RADIUS_CELLS);
    for (let neighbour = first; neighbour <= last; neighbour += 1) {
      const weight = kernel[Math.abs(neighbour - cell)] ?? 0;
      distanceSum +=
        weight *
        ((boundaryDistances[neighbour + 1] ?? 0) - (boundaryDistances[neighbour] ?? 0));
      durationSum += weight * cellDuration(neighbour);
    }
    cellSpeeds[cell] = distanceSum / durationSum;
  }
  return { cellSeconds, cellMetersPerSecond: cellSpeeds };
}

/** Speed in metres per second at an elapsed time, linear between cell centres. */
export function smoothedSpeedAt(speed: SmoothedSpeed, elapsedSeconds: number): number {
  const cells = speed.cellMetersPerSecond;
  const position = Math.min(
    Math.max(elapsedSeconds / speed.cellSeconds - 0.5, 0),
    cells.length - 1,
  );
  const cell = Math.floor(position);
  const current = cells[cell] ?? 0;
  const next = cells[Math.min(cell + 1, cells.length - 1)] ?? current;
  return current + (next - current) * (position - cell);
}
