/** Allocation-conscious median helpers for bounded elevation windows. */
export function medianInPlace(values: Float64Array, count: number): number {
  if (!Number.isInteger(count) || count < 1 || count > values.length) {
    throw new RangeError('Median count must select populated values.');
  }
  for (let index = 1; index < count; index += 1) {
    const value = Number(values[index]);
    let insertionIndex = index - 1;
    while (insertionIndex >= 0 && Number(values[insertionIndex]) > value) {
      values[insertionIndex + 1] = Number(values[insertionIndex]);
      insertionIndex -= 1;
    }
    values[insertionIndex + 1] = value;
  }
  const middle = Math.floor(count / 2);
  const upper = Number(values[middle]);
  if (count % 2 === 1) return upper;
  return (Number(values[middle - 1]) + upper) / 2;
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
      Number(values[end]) - Number(values[start]) > maximumDeviation * 2
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
  const upper = Number(values[middle]);
  if (bestCount % 2 === 1) return upper;
  return (Number(values[middle - 1]) + upper) / 2;
}
