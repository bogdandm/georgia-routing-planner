import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { MapWorkspace } from '@/presentation/map/MapWorkspace';
import { useUiStore } from '@/presentation/shell/uiStore';
import { createTestServices } from '../../../test/helpers/createTestServices';
import { FakeMapFacade } from '../../../test/helpers/FakeMapFacade';

describe('MapWorkspace', () => {
  it('publishes lifecycle state without mounting a duplicate local banner', () => {
    const facade = new FakeMapFacade();
    const services = createTestServices();
    const { unmount } = render(
      <RuntimeServicesProvider services={services}>
        <MapWorkspace facade={facade} mapCanvas={<div>Controlled map canvas</div>} />
      </RuntimeServicesProvider>,
    );

    expect(screen.getByTestId('map-workspace')).toHaveAttribute(
      'data-map-state',
      'loading',
    );

    act(() => {
      facade.setSnapshot({
        lifecycle: 'fatal',
        message: 'WebGL is unavailable for this browser.',
      });
    });
    expect(screen.getByTestId('map-workspace')).toHaveAttribute(
      'data-map-state',
      'fatal',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

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

  it('falls back to the Georgia overview when camera storage never settles', async () => {
    const services = {
      ...createTestServices(),
      mapCameraRepository: {
        load: () => new Promise<never>(() => undefined),
        save: () => Promise.resolve(),
      },
    };

    render(
      <RuntimeServicesProvider services={services}>
        <MapWorkspace
          facade={new FakeMapFacade()}
          mapCanvas={(initialCamera) => (
            <div>Fallback zoom {String(initialCamera.zoom)}</div>
          )}
          cameraRestoreTimeoutMs={0}
        />
      </RuntimeServicesProvider>,
    );

    expect(screen.queryByText(/Fallback zoom/)).not.toBeInTheDocument();
    await expect(screen.findByText('Fallback zoom 5.8')).resolves.toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The saved camera could not be restored',
    );
  });

  it('keeps 2D usable after terrain failure and retries explicitly', async () => {
    const user = userEvent.setup();
    const facade = new FakeMapFacade();
    let attempts = 0;
    facade.terrainTransition = (mode) => {
      attempts += 1;
      if (attempts > 1) facade.setSnapshot({ terrainMode: mode });
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

  it('returns the control to 2D after a late terrain source failure', async () => {
    const facade = new FakeMapFacade();
    render(
      <RuntimeServicesProvider services={createTestServices()}>
        <MapWorkspace facade={facade} mapCanvas={<div>Terrain map</div>} />
      </RuntimeServicesProvider>,
    );
    await screen.findByText('Terrain map');

    act(() => {
      facade.setSnapshot({ lifecycle: 'ready', terrainMode: 'terrain' });
    });
    expect(screen.getByRole('button', { name: 'Show 3D terrain map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    act(() => {
      facade.setSnapshot({
        lifecycle: 'degraded',
        terrainMode: 'flat',
        message: '3D terrain is unavailable. The 2D basemap remains usable.',
      });
    });

    expect(screen.getByRole('button', { name: 'Show flat 2D map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Show 3D terrain map' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('leaves recoverable map feedback to the shared status and describes offline limits', async () => {
    const facade = new FakeMapFacade();
    render(
      <RuntimeServicesProvider services={createTestServices()}>
        <MapWorkspace facade={facade} mapCanvas={<div>Available map</div>} />
      </RuntimeServicesProvider>,
    );
    await screen.findByText('Available map');

    act(() => {
      facade.setSnapshot({
        lifecycle: 'degraded',
        message: 'Some basemap tiles could not load.',
        recoverableFailures: [
          {
            category: 'base-vector',
            sourceId: 'basemap-vector',
            count: 4,
            lastOccurredAt: '2026-07-18T00:00:00.000Z',
          },
        ],
      });
    });
    expect(
      screen.queryByText('Some basemap tiles could not load.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry map data' }),
    ).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'new map data is unavailable until the connection returns',
    );
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(/new map data is unavailable/)).not.toBeInTheDocument();
  });

  it('applies developer debug flags and resets them when developer mode ends', async () => {
    const facade = new FakeMapFacade();
    useUiStore.setState({
      developerMode: true,
      mapDebugOptions: {
        showCollisionBoxes: true,
        showTileBoundaries: true,
      },
    });
    render(
      <RuntimeServicesProvider services={createTestServices()}>
        <MapWorkspace facade={facade} mapCanvas={<div>Debug map</div>} />
      </RuntimeServicesProvider>,
    );
    await screen.findByText('Debug map');
    expect(facade.debugOptions).toEqual({
      showCollisionBoxes: true,
      showTileBoundaries: true,
    });

    act(() => {
      useUiStore.setState({ developerMode: false });
    });
    expect(facade.debugOptions).toEqual({
      showCollisionBoxes: false,
      showTileBoundaries: false,
    });
  });
});
