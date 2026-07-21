import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { MapWorkspace } from '@/presentation/map/MapWorkspace';
import { mapLayerStore, resetMapLayerStore } from '@/presentation/map/mapLayerStore';
import {
  requestMapNavigation,
  resetMapInteractionStore,
} from '@/presentation/map/mapInteractionStore';
import { useUiStore } from '@/presentation/shell/uiStore';
import { createTestServices } from '../../../test/helpers/createTestServices';
import { FakeMapFacade } from '../../../test/helpers/FakeMapFacade';

describe('MapWorkspace', () => {
  beforeEach(() => {
    resetMapInteractionStore();
    resetMapLayerStore();
    window.history.replaceState(null, '', '/');
  });

  it('uses a valid explicit share view over local camera persistence', async () => {
    window.history.replaceState(null, '', '/?map=1&lat=41.7&lon=44.8&z=13.25');
    const services = createTestServices();
    render(
      <RuntimeServicesProvider services={services}>
        <MapWorkspace
          facade={new FakeMapFacade()}
          mapCanvas={(initialCamera) => (
            <div>
              Shared camera {initialCamera.latitude}, {initialCamera.longitude}, zoom{' '}
              {initialCamera.zoom}
            </div>
          )}
        />
      </RuntimeServicesProvider>,
    );

    expect(
      await screen.findByText('Shared camera 41.7, 44.8, zoom 13.25'),
    ).toBeVisible();
  });

  it('delivers serializable search navigation commands through the facade', async () => {
    const facade = new FakeMapFacade();
    render(
      <RuntimeServicesProvider services={createTestServices()}>
        <MapWorkspace facade={facade} mapCanvas={<div>Map command canvas</div>} />
      </RuntimeServicesProvider>,
    );
    await screen.findByText('Map command canvas');
    act(() => {
      requestMapNavigation({ latitude: 41.7, longitude: 44.8, zoom: 14 });
    });
    expect(facade.navigationRequests).toEqual([
      { latitude: 41.7, longitude: 44.8, zoom: 14 },
    ]);
  });
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
    expect(screen.getByTestId('map-workspace')).toHaveAttribute(
      'data-terrain-compute-status',
      'worker',
    );

    act(() => {
      mapLayerStore.setState({ terrainComputeStatus: 'inline' });
    });
    expect(screen.getByTestId('map-workspace')).toHaveAttribute(
      'data-terrain-compute-status',
      'inline',
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
        load: () =>
          Promise.resolve({ camera: restoredCamera, terrainMode: 'flat' as const }),
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

  it('restores persisted 3D mode when the native map becomes ready', async () => {
    const facade = new FakeMapFacade();
    const services = {
      ...createTestServices(),
      mapCameraRepository: {
        load: () =>
          Promise.resolve({
            camera: {
              longitude: 45.2,
              latitude: 42.4,
              zoom: 10,
              bearing: 18,
              pitch: 25,
            },
            terrainMode: 'terrain' as const,
          }),
        save: () => Promise.resolve(),
      },
    };

    render(
      <RuntimeServicesProvider services={services}>
        <MapWorkspace facade={facade} mapCanvas={<div>Restored terrain map</div>} />
      </RuntimeServicesProvider>,
    );

    await screen.findByText('Restored terrain map');
    expect(facade.terrainModeRequests).toEqual([]);
    act(() => {
      facade.setSnapshot({ lifecycle: 'ready' });
    });
    await waitFor(() => {
      expect(facade.terrainModeRequests).toEqual(['terrain']);
    });
    expect(screen.getByRole('button', { name: 'Show 3D terrain map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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

  it('keeps 2D usable and retries terrain automatically without a local banner', async () => {
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
        <MapWorkspace
          facade={facade}
          mapCanvas={<div>Usable 2D map</div>}
          terrainRetryDelaysMs={[0]}
        />
      </RuntimeServicesProvider>,
    );

    await screen.findByText('Usable 2D map');
    await user.click(screen.getByRole('button', { name: 'Show 3D terrain map' }));
    await waitFor(() => {
      expect(facade.terrainModeRequests).toEqual(['terrain', 'terrain']);
    });
    expect(
      screen.queryByText('Fixture terrain is unavailable.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry 3D' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show 3D terrain map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Usable 2D map')).toBeVisible();
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
            reason: 'http-server',
            httpStatus: 503,
            count: 4,
            lastOccurredAt: '2026-07-18T00:00:00.000Z',
            recoveryState: 'scheduled',
            retryAttempt: 1,
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
