import { describe, expect, it, vi } from 'vitest';

import { renderPointInspectorContent } from '@/presentation/map/MapLibrePointInspector';

describe('renderPointInspectorContent', () => {
  it('renders safe formatted values and an accessible close action', () => {
    const container = document.createElement('div');
    const onClose = vi.fn();
    renderPointInspectorContent(
      container,
      {
        status: 'open',
        coordinate: { longitude: 44.801234, latitude: 41.712345 },
        elevation: { status: 'available', meters: 1_234.4 },
        nearbyPoi: {
          status: 'found',
          poi: {
            name: '<script>fixture hut</script>',
            category: 'alpine_hut',
            distanceMeters: 42.2,
          },
        },
      },
      onClose,
    );
    expect(container.textContent).toContain('44.80123, 41.71235');
    expect(container.textContent).toContain('1,234 m');
    expect(container.querySelector('script')).toBeNull();
    const close = container.querySelector<HTMLButtonElement>(
      '[aria-label="Close map point details"]',
    );
    close?.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders loading, missing, and provider-error states intentionally', () => {
    const container = document.createElement('div');
    const coordinate = { longitude: 44.8, latitude: 41.7 };
    renderPointInspectorContent(
      container,
      {
        status: 'open',
        coordinate,
        elevation: { status: 'loading' },
        nearbyPoi: { status: 'loading' },
      },
      () => undefined,
    );
    expect(container.textContent).toContain('Loading elevation…');
    renderPointInspectorContent(
      container,
      {
        status: 'open',
        coordinate,
        elevation: { status: 'error' },
        nearbyPoi: { status: 'none' },
      },
      () => undefined,
    );
    expect(container.textContent).toContain('Elevation could not be loaded.');
    expect(container.textContent).toContain('No point of interest within 100 m.');
  });
});
