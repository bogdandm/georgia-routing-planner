import { beforeEach, describe, expect, it } from 'vitest';

import { activateAppLocale, appI18n } from '@/presentation/localization/appI18n';
import { formatPlaceSearchCategory } from '@/presentation/shell/formatPlaceSearchCategory';

describe('formatPlaceSearchCategory', () => {
  beforeEach(() => {
    activateAppLocale('en');
  });
  it.each([
    ['place:city', 'City'],
    ['natural:mountain_range', 'Mountain range'],
    ['waterway:river', 'River'],
    ['place:square', 'Square'],
    ['highway:residential', 'Residential'],
  ])('formats %s as readable UI copy', (category, expected) => {
    expect(formatPlaceSearchCategory(category, appI18n)).toBe(expected);
  });
});
