import { describe, expect, it } from 'vitest';

import { formatPlaceSearchCategory } from '@/presentation/shell/formatPlaceSearchCategory';

describe('formatPlaceSearchCategory', () => {
  it.each([
    ['place:city', 'City'],
    ['natural:mountain_range', 'Mountain range'],
    ['waterway:river', 'River'],
    ['place:square', 'Square'],
    ['highway:residential', 'Residential'],
  ])('formats %s as readable UI copy', (category, expected) => {
    expect(formatPlaceSearchCategory(category)).toBe(expected);
  });
});
