/** Allocation-conscious median helpers for bounded elevation windows. */
export function medianInPlace(values: Float64Array, count: number): number {
  for (let index = 1; index < count; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    let insertionIndex = index - 1;
    while (insertionIndex >= 0 && (values[insertionIndex] ?? value) > value) {
      values[insertionIndex + 1] = values[insertionIndex] ?? value;
      insertionIndex -= 1;
    }
    values[insertionIndex + 1] = value;
  }
  const middle = Math.floor(count / 2);
  const upper = values[middle];
  if (upper === undefined) throw new RangeError('Median requires at least one value.');
  if (count % 2 === 1) return upper;
  const lower = values[middle - 1];
  if (lower === undefined) throw new RangeError('Median pair is incomplete.');
  return (lower + upper) / 2;
}

export function repairMedianInPlace(
  values: Float64Array,
  count: number,
  maximumDeviation: number,
): number {
  const overallMedian = medianInPlace(values, count);
  let bestStart = 0;
  let bestCount = 1;
  let start = 0;
  let ambiguous = false;
  for (let end = 0; end < count; end += 1) {
    while (
      start < end &&
      (values[end] ?? 0) - (values[start] ?? 0) > maximumDeviation * 2
    ) {
      start += 1;
    }
    const clusterCount = end - start + 1;
    if (clusterCount > bestCount) {
      bestStart = start;
      bestCount = clusterCount;
      ambiguous = false;
    } else if (clusterCount === bestCount && start !== bestStart) {
      ambiguous = true;
    }
  }
  if (bestCount < Math.min(3, count) || ambiguous) return overallMedian;
  const middle = bestStart + Math.floor(bestCount / 2);
  const upper = values[middle] ?? overallMedian;
  if (bestCount % 2 === 1) return upper;
  return ((values[middle - 1] ?? upper) + upper) / 2;
}
