/** Allocation-conscious median for bounded elevation windows. */
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
