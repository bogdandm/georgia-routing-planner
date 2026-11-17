import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activateAppLocale } from '@/presentation/localization/appI18n';
import {
  externalMapViewUrl,
  wikilocMapUrl,
} from '@/presentation/map/externalMapViewUrl';
import {
  MapPointActionList,
  MapPointInspectorContent,
} from '@/presentation/map/MapPointInspectorContent';
import { renderWithI18n } from '@test/helpers/renderWithI18n';

const coordinate = { longitude: 44.801234, latitude: 41.712345 };

describe('external map view zoom', () => {
  it.each([
    [2, 3, 3],
    [11.2, 12, 12],
    [11.8, 13, 13],
    [20, 21, 19],
  ])('converts MapLibre zoom %s to Google %s and Yandex %s', (zoom, google, yandex) => {
    const camera = { ...coordinate, zoom, bearing: 28, pitch: 45 };
    const googleUrl = new URL(externalMapViewUrl('open-google-maps', camera, null));
    const yandexUrl = new URL(externalMapViewUrl('open-yandex-maps', camera, null));
    expect(googleUrl.searchParams.get('zoom')).toBe(String(google));
    expect(yandexUrl.searchParams.get('z')).toBe(String(yandex));
    expect(yandexUrl.searchParams.has('pt')).toBe(false);
  });
});

function wikilocBox(href: string) {
  const url = new URL(href);
  const [south, west] = (url.searchParams.get('sw') ?? '').split(',').map(Number);
  const [north, east] = (url.searchParams.get('ne') ?? '').split(',').map(Number);
  if (
    south === undefined ||
    west === undefined ||
    north === undefined ||
    east === undefined
  ) {
    throw new Error('Wikiloc URL has no bounding box.');
  }
  return { url, south, west, north, east };
}

const mercatorY = (latitude: number) =>
  Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));

describe('Wikiloc map URL', () => {
  it.each([
    [8, 41.712345],
    [13.4, 41.712345],
    [13.4, -70],
  ])('centers the zoom %s box on latitude %s in Web Mercator', (zoom, latitude) => {
    const box = wikilocBox(
      wikilocMapUrl(zoom, { longitude: 44.801234, latitude }, 'ru'),
    );
    expect(box.url.origin + box.url.pathname).toBe(
      'https://ru.wikiloc.com/wikiloc/map.do',
    );
    expect(box.url.searchParams.get('page')).toBe('1');
    expect((box.west + box.east) / 2).toBeCloseTo(44.801234, 9);
    expect((mercatorY(box.south) + mercatorY(box.north)) / 2).toBeCloseTo(
      mercatorY(latitude),
      9,
    );
    // 640 px of a 512 * 2^zoom px world.
    expect(box.east - box.west).toBeCloseTo((640 / (512 * 2 ** zoom)) * 360, 9);
    expect(box.south).toBeLessThan(latitude);
    expect(box.north).toBeGreaterThan(latitude);
  });

  it('uses the international host outside the Russian interface', () => {
    expect(new URL(wikilocMapUrl(10, coordinate, 'en')).host).toBe('www.wikiloc.com');
  });
});

describe('MapPointActionList', () => {
  beforeEach(() => {
    activateAppLocale('en');
  });

  it.each([
    ['Google Maps', 'center', '43.75,45.25', 'zoom'],
    ['Yandex Maps', 'll', '45.25,43.75', 'z'],
  ])(
    'uses the live camera when activating %s after the menu opens',
    (label, centerKey, center, zoomKey) => {
      let camera = { ...coordinate, zoom: 8, bearing: 0, pitch: 0 };
      renderWithI18n(
        <MapPointActionList
          coordinate={coordinate}
          getCamera={() => camera}
          touch={false}
          onSelect={() => undefined}
        />,
      );
      const link = screen.getByRole('menuitem', { name: label });
      camera = {
        longitude: 45.25,
        latitude: 43.75,
        zoom: 14.8,
        bearing: 28,
        pitch: 45,
      };
      fireEvent.click(link);

      const url = new URL(link.getAttribute('href') ?? '');
      expect(url.searchParams.get(centerKey)).toBe(center);
      expect(url.searchParams.get(zoomKey)).toBe('16');
      expect(url.searchParams.get('pt')).toBe(
        label === 'Yandex Maps' ? '44.801234,41.712345' : null,
      );
    },
  );

  it('builds the Wikiloc box from the live zoom when activated', () => {
    let camera = { ...coordinate, zoom: 8, bearing: 0, pitch: 0 };
    renderWithI18n(
      <MapPointActionList
        coordinate={coordinate}
        getCamera={() => camera}
        touch={false}
        onSelect={() => undefined}
      />,
    );
    const link = screen.getByRole('menuitem', { name: 'Open in Wikiloc' });
    const initial = wikilocBox(link.getAttribute('href') ?? '');
    camera = { longitude: 45.25, latitude: 43.75, zoom: 10, bearing: 28, pitch: 45 };
    fireEvent.click(link);

    const box = wikilocBox(link.getAttribute('href') ?? '');
    expect(box.url.host).toBe('www.wikiloc.com');
    expect(box.east - box.west).toBeCloseTo((initial.east - initial.west) / 4, 9);
    expect((box.west + box.east) / 2).toBeCloseTo(coordinate.longitude, 9);
  });
});

describe('MapPointInspectorContent', () => {
  beforeEach(() => {
    activateAppLocale('en');
  });

  it('renders safe formatted values and focuses the close action', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = renderWithI18n(
      <MapPointInspectorContent
        inspection={{
          status: 'open',
          coordinate,
          elevation: { status: 'available', meters: 1_234.4 },
          nearbyPoi: {
            status: 'found',
            poi: {
              name: '<script>fixture hut</script>',
              originalName: '<script>ქართული ქოხი & ტბა</script>',
              category: 'alpine_hut',
              distanceMeters: 42.2,
            },
          },
        }}
        actions={null}
        onClose={onClose}
      />,
    );

    expect(container).toHaveTextContent('41.71235, 44.80123');
    expect(container).toHaveTextContent('1,234 m');
    expect(container).toHaveTextContent(
      '<script>fixture hut</script> (alpine hut), 42 m away',
    );
    expect(container).toHaveTextContent('<script>ქართული ქოხი & ტბა</script>');
    expect(screen.queryByText('Original name')).not.toBeInTheDocument();
    const nearbyFeature = screen.getByText('Nearby map feature').parentElement;
    if (nearbyFeature === null) throw new Error('Missing nearby feature details.');
    expect(
      within(nearbyFeature).getByText('<script>ქართული ქოხი & ტბა</script>'),
    ).toBeVisible();
    expect(container.querySelector('script')).toBeNull();
    const links = screen.getAllByRole('link');
    expect(screen.queryByRole('link', { name: 'Wikipedia' })).not.toBeInTheDocument();
    const search = new URL(
      screen.getByRole('link', { name: 'Google Search' }).getAttribute('href') ?? '',
    );
    expect(search.searchParams.get('q')).toBe('<script>ქართული ქოხი & ტბა</script>');
    const englishSearch = new URL(
      screen.getByRole('link', { name: 'Google Search (En)' }).getAttribute('href') ??
        '',
    );
    expect(englishSearch.searchParams.get('q')).toBe('<script>fixture hut</script>');
    expect(screen.queryByRole('link', { name: 'Google Maps' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Yandex Maps' })).not.toBeInTheDocument();
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    const close = screen.getByRole('button', { name: 'Close map point details' });
    expect(close).toHaveFocus();
    expect(screen.getAllByRole('button')).toEqual([close]);
    await user.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('searches the available name when the provider has no original name', () => {
    renderWithI18n(
      <MapPointInspectorContent
        inspection={{
          status: 'open',
          coordinate,
          elevation: { status: 'unavailable' },
          nearbyPoi: {
            status: 'found',
            poi: {
              name: 'English-only lake',
              originalName: null,
              category: 'lake',
              distanceMeters: 0,
            },
          },
        }}
        actions={null}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByText('Original name')).not.toBeInTheDocument();
    const search = new URL(
      screen.getByRole('link', { name: 'Google Search' }).getAttribute('href') ?? '',
    );
    expect(search.searchParams.get('q')).toBe('English-only lake');
    const englishSearch = new URL(
      screen.getByRole('link', { name: 'Google Search (En)' }).getAttribute('href') ??
        '',
    );
    expect(englishSearch.searchParams.get('q')).toBe('English-only lake');
  });

  it('renders loading, missing, and provider-error states intentionally', () => {
    const { container, rerender } = renderWithI18n(
      <MapPointInspectorContent
        inspection={{
          status: 'open',
          coordinate,
          elevation: { status: 'loading' },
          nearbyPoi: { status: 'loading' },
        }}
        actions={null}
        onClose={() => undefined}
      />,
    );
    expect(container).toHaveTextContent('Loading elevation…');
    expect(container).toHaveTextContent('Checking nearby map data…');

    rerender(
      <MapPointInspectorContent
        inspection={{
          status: 'open',
          coordinate,
          elevation: { status: 'error' },
          nearbyPoi: { status: 'none' },
        }}
        actions={null}
        onClose={() => undefined}
      />,
    );
    expect(container).toHaveTextContent('Elevation could not be loaded.');
    expect(container).toHaveTextContent('No named map feature found.');
    expect(
      screen.queryByRole('link', { name: 'Google Search' }),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toEqual([]);
  });
});
