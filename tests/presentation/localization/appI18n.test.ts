import { beforeEach, describe, expect, it } from 'vitest';

import { activateAppLocale } from '@/presentation/localization/appI18n';

describe('activateAppLocale', () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta name="description" content="">';
    activateAppLocale('en');
  });

  it('updates document language and translated metadata for each activation', () => {
    activateAppLocale('ru');

    expect(document.documentElement.lang).toBe('ru');
    expect(document.title).toBe('Trail Planner');
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      'Планируйте пешие маршруты и изучайте карты, 3D-рельеф, спутниковые снимки и погоду.',
    );

    activateAppLocale('en');

    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      'Plan hiking routes and explore maps, 3D terrain, satellite imagery, and weather.',
    );
  });
});
