export function selectNearestForecastTimeIndex(
  validTimes: readonly string[],
  requestedTime: Date,
): number {
  if (validTimes.length === 0 || !Number.isFinite(requestedTime.getTime())) return -1;

  const requestedTimestamp = requestedTime.getTime();
  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const [index, validTime] of validTimes.entries()) {
    const timestamp = Date.parse(validTime);
    if (!Number.isFinite(timestamp)) continue;
    const distance = Math.abs(timestamp - requestedTimestamp);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }

  return nearestIndex;
}
