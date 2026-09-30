import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activateAppLocale } from '@/presentation/localization/appI18n';
import { MapPointInspectorContent } from '@/presentation/map/MapPointInspectorContent';
import { renderWithI18n } from '@test/helpers/renderWithI18n';

const coordinate = { longitude: 44.801234, latitude: 41.712345 };

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
    expect(container.querySelector('script')).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      [
        'Wikipedia',
        'https://en.wikipedia.org/wiki/%3Cscript%3Efixture_hut%3C%2Fscript%3E',
      ],
      [
        'Google Search',
        'https://www.google.com/search?q=%3Cscript%3Efixture%20hut%3C%2Fscript%3E%20Georgia',
      ],
    ]);
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
  });
});
