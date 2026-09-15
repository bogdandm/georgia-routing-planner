import { describe, expect, it } from 'vitest';

import { resolveAppLocale } from '@/domain/localization/appLocale';

describe('resolveAppLocale', () => {
  it('uses the saved locale before browser preferences', () => {
    expect(resolveAppLocale('ru', ['en-US'])).toBe('ru');
  });

  it('uses the first supported browser language in list order', () => {
    expect(resolveAppLocale(null, ['ka-GE', 'ru-RU'])).toBe('ru');
    expect(resolveAppLocale(null, ['ka-GE', 'en-GB', 'ru-RU'])).toBe('en');
  });

  it('falls back to English for unsupported or empty browser lists', () => {
    expect(resolveAppLocale(null, ['ka-GE', 'de-DE'])).toBe('en');
    expect(resolveAppLocale(null, [])).toBe('en');
  });
});
