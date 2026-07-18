import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { MapWorkspace } from '@/presentation/map/MapWorkspace';
import { createTestServices } from '../../../test/helpers/createTestServices';
import { FakeMapFacade } from '../../../test/helpers/FakeMapFacade';

describe('MapWorkspace', () => {
  it('renders lifecycle feedback from a serializable facade snapshot', () => {
    const facade = new FakeMapFacade();
    const services = createTestServices();
    const { unmount } = render(
      <RuntimeServicesProvider services={services}>
        <MapWorkspace facade={facade} mapCanvas={<div>Controlled map canvas</div>} />
      </RuntimeServicesProvider>,
    );

    expect(screen.getByRole('status', { name: 'Loading map workspace' })).toBeVisible();

    act(() => {
      facade.setSnapshot({
        lifecycle: 'fatal',
        message: 'WebGL is unavailable for this browser.',
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'WebGL is unavailable for this browser.',
    );

    unmount();
    expect(facade.destroyed).toBe(true);
  });

  it('fails safely before mounting MapLibre when provider configuration is invalid', () => {
    const facade = new FakeMapFacade();
    const services = {
      ...createTestServices(),
      mapProviderConfiguration: {
        status: 'invalid' as const,
        message: 'Map provider configuration is invalid (1 validation issue).',
      },
    };

    render(
      <RuntimeServicesProvider services={services}>
        <MapWorkspace facade={facade} mapCanvas={<div>Must not mount</div>} />
      </RuntimeServicesProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('The basemap was not started');
    expect(screen.queryByText('Must not mount')).not.toBeInTheDocument();
    expect(screen.getByTestId('map-workspace')).toHaveAttribute(
      'data-map-state',
      'fatal',
    );
  });

  it('restores the camera before mounting the map canvas', async () => {
    const restoredCamera = {
      longitude: 45.2,
      latitude: 42.4,
      zoom: 10,
      bearing: 18,
      pitch: 25,
    };
    const services = {
      ...createTestServices(),
      mapCameraRepository: {
        load: () => Promise.resolve(restoredCamera),
        save: () => Promise.resolve(),
      },
    };

    render(
      <RuntimeServicesProvider services={services}>
        <MapWorkspace
          facade={new FakeMapFacade()}
          mapCanvas={(initialCamera) => (
            <div>Restored zoom {String(initialCamera.zoom)}</div>
          )}
        />
      </RuntimeServicesProvider>,
    );

    expect(screen.queryByText('Restored zoom 10')).not.toBeInTheDocument();
    await expect(screen.findByText('Restored zoom 10')).resolves.toBeVisible();
  });

  it('keeps 2D usable after terrain failure and retries explicitly', async () => {
    const user = userEvent.setup();
    const facade = new FakeMapFacade();
    let attempts = 0;
    facade.terrainTransition = (mode) => {
      attempts += 1;
      return Promise.resolve(
        attempts === 1
          ? { status: 'failed', reason: 'Fixture terrain is unavailable.' }
          : { status: 'success', mode },
      );
    };

    render(
      <RuntimeServicesProvider services={createTestServices()}>
        <MapWorkspace facade={facade} mapCanvas={<div>Usable 2D map</div>} />
      </RuntimeServicesProvider>,
    );

    await screen.findByText('Usable 2D map');
    await user.click(screen.getByRole('button', { name: 'Show 3D terrain map' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Fixture terrain is unavailable. The 2D basemap is still available.',
    );
    expect(screen.getByText('Usable 2D map')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Retry 3D' }));
    expect(
      screen.queryByText('Fixture terrain is unavailable.'),
    ).not.toBeInTheDocument();
    expect(facade.terrainModeRequests).toEqual(['terrain', 'terrain']);
  });
});
