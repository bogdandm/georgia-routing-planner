import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';

import {
  GRADE_BANDS_ASCENDING,
  GRADE_BAND_THRESHOLDS_PCT,
  type ElevationProfile,
} from '@/domain/tracks/elevationProfile';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import { MapWorkspace } from '@/presentation/map/MapWorkspace';
import { mapLayerStore, resetMapLayerStore } from '@/presentation/map/mapLayerStore';
import {
  mapInteractionStore,
  requestMapFitBounds,
  requestMapNavigation,
  resetMapInteractionStore,
} from '@/presentation/map/mapInteractionStore';
import { appColors } from '@/presentation/theme/appColors';
import { useUiStore } from '@/presentation/shell/uiStore';
import { createTestServices } from '@test/helpers/createTestServices';
import { FakeMapFacade } from '@test/helpers/FakeMapFacade';

vi.mock('react-map-gl/maplibre', () => ({
  default: ({
    boxZoom,
    dragRotate,
  }: {
    readonly boxZoom?: boolean;
    readonly dragRotate?: boolean;
  }) => (
    <div
      data-box-zoom={String(boxZoom)}
      data-drag-rotate={String(dragRotate)}
      data-testid="native-map"
    />
  ),
  GeolocateControl: () => null,
  NavigationControl: () => null,
}));

const tracksWorkspaceMock = vi.hoisted(() => ({
  activeProfile: null as ElevationProfile | null,
}));

vi.mock('@/presentation/tracks/TracksWorkspace', () => ({
  useOptionalTracksWorkspace: () =>
    tracksWorkspaceMock.activeProfile === null
      ? null
      : { activeProfile: tracksWorkspaceMock.activeProfile },
}));
const sharedScene: SatelliteScene = {
  id: 'shared-scene',
  collection: 'sentinel-2-l2a',
  platform: 'sentinel-2a',
  productLevel: 'L2A',
  acquiredAt: '2026-07-20T10:12:00.000Z',
  cloudCoverPercent: 4,
  footprint: {
    type: 'Polygon',
    coordinates: [
      [
        [44, 42],
        [45, 42],
        [45, 43],
        [44, 42],
      ],
    ],
  },
  tileId: '38TMN',
  orbit: 'R036',
  productId: 'S2A_SHARED',
  thumbnailHref: null,
  visualAsset: { kind: 'unavailable' },
  attribution: 'Synthetic test data',
};

const gradeProfile: ElevationProfile = {
  points: [],
  segments: [
    {
      startSampleIndex: 0,
      endSampleIndex: 1,
      startDistanceMeters: 0,
      endDistanceMeters: 1_000,
      type: 'climb',
      distanceMeters: 1_000,
      netElevationChangeMeters: 80,
      ascentMeters: 80,
      descentMeters: 0,
      averageGradePct: 8,
      gradeSubsegments: [
        {
          startSampleIndex: 0,
          endSampleIndex: 1,
          startDistanceMeters: 0,
          endDistanceMeters: 1_000,
          distanceMeters: 1_000,
          averageGradePct: 8,
          band: 'climb',
        },
      ],
    },
  ],
  gradeSubsegments: [
    {
      startSampleIndex: 0,
      endSampleIndex: 1,
      startDistanceMeters: 0,
      endDistanceMeters: 1_000,
      distanceMeters: 1_000,
      averageGradePct: 8,
      band: 'climb',
    },
  ],
  minimumMeters: 1_000,
  maximumMeters: 1_080,
  algorithmVersion: 3,
};

function mockViewportWidth(width: number): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(width < 900px)' && width < 900,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('MapWorkspace', () => {
  beforeEach(() => {
    resetMapInteractionStore();
    resetMapLayerStore();
    window.history.replaceState(null, '', '/');
    tracksWorkspaceMock.activeProfile = null;
    mockViewportWidth(900);
    useUiStore.setState({
      activeTab: 'satellite',
      mobileWorkspaceOpen: false,
      navigationCollapsed: false,
    });
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

  it('starts shared 3D terrain after the base map becomes ready', async () => {
    window.history.replaceState(
      null,
      '',
      '/?map=2&lat=41.7&lon=44.8&z=13.25&view=3d&bearing=18.5&pitch=35.5',
    );
    const facade = new FakeMapFacade();
    render(
      <RuntimeServicesProvider services={createTestServices()}>
        <MapWorkspace
          facade={facade}
          mapCanvas={(initialCamera) => (
            <div>
              Shared 3D camera {initialCamera.bearing}/{initialCamera.pitch}
            </div>
          )}
        />
      </RuntimeServicesProvider>,
    );

    await screen.findByText('Shared 3D camera 18.5/35.5');
    expect(screen.getByRole('button', { name: 'Show 3D terrain map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(facade.terrainModeRequests).toEqual([]);
    act(() => {
      facade.setSnapshot({
        lifecycle: 'ready',
        terrainMode: 'flat',
        camera: {
          longitude: 44.8,
          latitude: 41.7,
          zoom: 13.25,
          bearing: 18.5,
          pitch: 35.5,
        },
      });
    });
    await waitFor(() => {
      expect(facade.terrainModeRequests).toEqual(['terrain']);
    });
    expect(screen.getByRole('button', { name: 'Show 3D terrain map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('keeps an early 2D choice from a shared 3D URL after map readiness', async () => {
    window.history.replaceState(
      null,
      '',
      '/?map=2&lat=41.7&lon=44.8&z=13.25&view=3d&bearing=18.5&pitch=35.5#satellite',
    );
    const user = userEvent.setup();
    const facade = new FakeMapFacade();
    render(
      <RuntimeServicesProvider services={createTestServices()}>
        <MapWorkspace facade={facade} mapCanvas={<div>Shared 3D map</div>} />
      </RuntimeServicesProvider>,
    );

    await screen.findByText('Shared 3D map');
    const flatButton = screen.getByRole('button', { name: 'Show flat 2D map' });
    expect(screen.getByRole('button', { name: 'Show 3D terrain map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(flatButton);

    expect(facade.terrainModeRequests).toEqual(['flat']);
    expect(flatButton).toHaveAttribute('aria-pressed', 'true');
    act(() => {
      facade.setSnapshot({ lifecycle: 'ready', terrainMode: 'flat' });
    });
    expect(flatButton).toHaveAttribute('aria-pressed', 'true');
    expect(facade.terrainModeRequests).toEqual(['flat']);
  });

  it('starts shared satellite and terrain restoration from the same ready state', async () => {
    window.history.replaceState(
      null,
      '',
      '/?map=2&lat=41.7&lon=44.8&z=13.25&view=3d&bearing=18&pitch=35&scene=sentinel-2-l2a%3Ashared-scene#tracks',
    );
    const services = createTestServices({
      satelliteCatalogGateway: {
        search: () => Promise.resolve({ scenes: [], totalMatched: 0 }),
        getScene: () => Promise.resolve(sharedScene),
      },
    });
    const mapLayers = services.mapLayers;
    if (mapLayers === null) return;
    const selectScene = vi.spyOn(mapLayers, 'selectScene');
    const applyScene = vi
      .spyOn(mapLayers, 'applyScene')
      .mockResolvedValue({ status: 'success' });
    const facade = new FakeMapFacade();

    render(
      <RuntimeServicesProvider services={services}>
        <MapWorkspace facade={facade} mapCanvas={<div>Shared scene map</div>} />
      </RuntimeServicesProvider>,
    );

    await waitFor(() => {
      expect(selectScene).toHaveBeenCalledWith(sharedScene);
    });
    expect(useUiStore.getState().activeTab).toBe('satellite');
    expect(mapLayerStore.getState().selectedScene).toEqual(sharedScene);
    expect(applyScene).not.toHaveBeenCalled();
    expect(facade.terrainModeRequests).toEqual([]);

    act(() => {
      facade.setSnapshot({ lifecycle: 'ready' });
    });
    await waitFor(() => {
      expect(applyScene).toHaveBeenCalledWith(sharedScene, expect.any(AbortSignal));
      expect(facade.terrainModeRequests).toEqual(['terrain']);
    });
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

  it('applies visible-area padding to point navigation and unpadded bounds', async () => {
    const facade = new FakeMapFacade();
    const getNavigationPadding = vi.fn(() => ({
      top: 56,
      right: 56,
      bottom: 56,
      left: 536,
    }));
    render(
      <RuntimeServicesProvider services={createTestServices()}>
        <MapWorkspace
          facade={facade}
          mapCanvas={<div>Visible map command canvas</div>}
          getNavigationPadding={getNavigationPadding}
        />
      </RuntimeServicesProvider>,
    );
    await screen.findByText('Visible map command canvas');

    act(() => {
      requestMapNavigation({ latitude: 41.7, longitude: 44.8, zoom: 13 });
      requestMapFitBounds({ west: 43.1, south: 41.6, east: 44.2, north: 42.4 }, 15);
      facade.setSnapshot({ lifecycle: 'ready' });
    });

    expect(facade.navigationRequests).toEqual([
      { latitude: 41.7, longitude: 44.8, zoom: 13 },
    ]);
    expect(facade.navigationPaddingRequests).toEqual([
      { top: 56, right: 56, bottom: 56, left: 536 },
    ]);
    await waitFor(() => {
      expect(facade.fitBoundsRequests).toEqual([
        {
          bounds: { west: 43.1, south: 41.6, east: 44.2, north: 42.4 },
          maxZoom: 15,
          padding: { top: 56, right: 56, bottom: 56, left: 536 },
        },
      ]);
    });
  });
  it('holds fit-to-track commands until the map is ready', async () => {
    const facade = new FakeMapFacade();
    render(
      <RuntimeServicesProvider services={createTestServices()}>
        <MapWorkspace facade={facade} mapCanvas={<div>Fit command canvas</div>} />
      </RuntimeServicesProvider>,
    );
    await screen.findByText('Fit command canvas');

    act(() => {
      requestMapFitBounds({ west: 43.1, south: 41.6, east: 44.2, north: 42.4 }, 15, {
        top: 56,
        right: 56,
        bottom: 56,
        left: 840,
      });
    });
    expect(facade.fitBoundsRequests).toEqual([]);
    expect(mapInteractionStore.getState().fitBoundsCommand).not.toBeNull();

    act(() => {
      facade.setSnapshot({ lifecycle: 'ready' });
    });
    await waitFor(() => {
      expect(facade.fitBoundsRequests).toEqual([
        {
          bounds: { west: 43.1, south: 41.6, east: 44.2, north: 42.4 },
          maxZoom: 15,
          padding: { top: 56, right: 56, bottom: 56, left: 840 },
        },
      ]);
    });
    expect(mapInteractionStore.getState().fitBoundsCommand).toBeNull();
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

  it('always restores a persisted camera in 2D', async () => {
    const facade = new FakeMapFacade();
    const services = {
      ...createTestServices(),
      mapCameraRepository: {
        load: () =>
          Promise.resolve({
            longitude: 45.2,
            latitude: 42.4,
            zoom: 10,
            bearing: 18,
            pitch: 25,
          }),
        save: () => Promise.resolve(),
      },
    };

    render(
      <RuntimeServicesProvider services={services}>
        <MapWorkspace
          facade={facade}
          mapCanvas={(initialCamera) => (
            <div>
              Restored flat map {String(initialCamera.bearing)}/
              {String(initialCamera.pitch)}
            </div>
          )}
        />
      </RuntimeServicesProvider>,
    );

    await screen.findByText('Restored flat map 0/0');
    expect(facade.terrainModeRequests).toEqual([]);
    act(() => {
      facade.setSnapshot({ lifecycle: 'ready' });
    });
    expect(facade.terrainModeRequests).toEqual([]);
    expect(screen.getByRole('button', { name: 'Show flat 2D map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('disables native box zoom and right-button camera drag in both map modes', async () => {
    const facade = new FakeMapFacade();
    render(
      <RuntimeServicesProvider services={createTestServices()}>
        <MapWorkspace facade={facade} />
      </RuntimeServicesProvider>,
    );

    const map = await screen.findByTestId('native-map');
    expect(map).toHaveAttribute('data-box-zoom', 'false');
    expect(map).toHaveAttribute('data-drag-rotate', 'false');

    act(() => {
      facade.setSnapshot({ terrainMode: 'terrain' });
    });
    expect(map).toHaveAttribute('data-box-zoom', 'false');
    expect(map).toHaveAttribute('data-drag-rotate', 'false');
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

  it('shows the legend only while the desktop grade overlay is visible', async () => {
    tracksWorkspaceMock.activeProfile = gradeProfile;
    render(
      <RuntimeServicesProvider services={createTestServices()}>
        <MapWorkspace
          facade={new FakeMapFacade()}
          mapCanvas={<div>Gradient map</div>}
        />
      </RuntimeServicesProvider>,
    );

    const legend = await screen.findByRole('region', {
      name: 'Elevation grade legend',
    });
    const legendImage = within(legend).getByRole('img', {
      name: 'Track grade color thresholds',
    });

    const visibleThresholds = GRADE_BAND_THRESHOLDS_PCT.filter((_, index) => {
      const lowerBand = GRADE_BANDS_ASCENDING[index];
      const upperBand = GRADE_BANDS_ASCENDING[index + 1];
      return (
        lowerBand !== undefined &&
        upperBand !== undefined &&
        appColors.elevationGrade[lowerBand] !== appColors.elevationGrade[upperBand]
      );
    });
    const thresholdX = (threshold: number): number => {
      const label = `${threshold < 0 ? '−' : ''}${String(Math.abs(threshold))}%`;
      const x = within(legend).getByText(label).getAttribute('x');
      expect(x).not.toBeNull();
      return Number(x);
    };

    for (const threshold of visibleThresholds) {
      expect(thresholdX(threshold)).toBeGreaterThan(0);
    }
    expect(within(legend).queryByText('30%')).not.toBeInTheDocument();
    const zeroGradeX = (thresholdX(-3) + thresholdX(3)) / 2;
    expect(thresholdX(-3) + thresholdX(3)).toBeCloseTo(
      thresholdX(-10) + thresholdX(10),
    );
    expect(
      (thresholdX(3) - thresholdX(-3)) / (thresholdX(10) - thresholdX(-10)),
    ).toBeCloseTo(6 / 20);

    const gradeCurve = legendImage.querySelector('path[fill="none"]');
    const curveCoordinates = Array.from(
      gradeCurve?.getAttribute('d')?.matchAll(/-?\d+(?:\.\d+)?/g) ?? [],
      (match) => Number(match[0]),
    );
    expect(curveCoordinates).toHaveLength(6);
    const coordinate = (index: number): number => {
      const value = curveCoordinates[index];
      expect(value).toBeDefined();
      return value ?? 0;
    };
    const startX = coordinate(0);
    const startY = coordinate(1);
    const controlX = coordinate(2);
    const controlY = coordinate(3);
    const endX = coordinate(4);
    const endY = coordinate(5);
    const startGradePct = -((controlY - startY) / (controlX - startX)) * 100;
    const endGradePct = -((endY - controlY) / (endX - controlX)) * 100;
    expect(startGradePct).toBeCloseTo(-25);
    expect(endGradePct).toBeCloseTo(35);
    expect(
      startX + ((0 - startGradePct) / (endGradePct - startGradePct)) * (endX - startX),
    ).toBeCloseTo(zeroGradeX);

    const gradientStops = Array.from(legendImage.querySelectorAll('stop'));
    expect(gradientStops).toHaveLength(GRADE_BANDS_ASCENDING.length * 2);
    for (const [index, band] of GRADE_BANDS_ASCENDING.entries()) {
      expect(
        gradientStops
          .slice(index * 2, index * 2 + 2)
          .map((stop) => stop.getAttribute('stop-color')),
      ).toEqual([appColors.elevationGrade[band], appColors.elevationGrade[band]]);
    }
    for (const threshold of visibleThresholds) {
      const thresholdIndex = GRADE_BAND_THRESHOLDS_PCT.indexOf(threshold);
      const expectedOffset = ((thresholdX(threshold) - 7) / (245 - 7)) * 100;
      expect(
        Number(
          gradientStops[thresholdIndex * 2 + 1]
            ?.getAttribute('offset')
            ?.replace('%', ''),
        ),
      ).toBeCloseTo(expectedOffset);
      expect(
        Number(
          gradientStops[thresholdIndex * 2 + 2]
            ?.getAttribute('offset')
            ?.replace('%', ''),
        ),
      ).toBeCloseTo(expectedOffset);
    }

    act(() => {
      mapLayerStore.setState((state) => ({
        visibility: {
          ...state.visibility,
          'track-elevation-gradient': false,
        },
      }));
    });
    expect(
      screen.queryByRole('region', { name: 'Elevation grade legend' }),
    ).not.toBeInTheDocument();
  });

  it('hides the legend on smartphone viewports', async () => {
    tracksWorkspaceMock.activeProfile = gradeProfile;
    mockViewportWidth(899);
    render(
      <RuntimeServicesProvider services={createTestServices()}>
        <MapWorkspace facade={new FakeMapFacade()} mapCanvas={<div>Mobile map</div>} />
      </RuntimeServicesProvider>,
    );

    await screen.findByText('Mobile map');
    expect(
      screen.queryByRole('region', { name: 'Elevation grade legend' }),
    ).not.toBeInTheDocument();
  });

  it('applies the Sentinel preset when an applied scene is hidden', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    const mapLayers = services.mapLayers;
    if (mapLayers === null) return;
    const setMapLayerPreset = vi
      .spyOn(mapLayers, 'setMapLayerPreset')
      .mockReturnValue({ status: 'success' });
    vi.spyOn(mapLayers, 'getAppliedScene').mockReturnValue(sharedScene);
    const facade = new FakeMapFacade();
    facade.setSnapshot({ lifecycle: 'ready' });
    act(() => {
      mapLayerStore.setState({
        appliedImagery: {
          status: 'hidden',
          sceneId: sharedScene.id,
          sceneKey: `${sharedScene.collection}:${sharedScene.id}`,
          visible: false,
        },
      });
    });
    render(
      <RuntimeServicesProvider services={services}>
        <MapWorkspace facade={facade} mapCanvas={<div>Hidden Sentinel map</div>} />
      </RuntimeServicesProvider>,
    );

    await screen.findByText('Hidden Sentinel map');
    await user.click(screen.getByRole('button', { name: 'Choose map layer preset' }));
    await user.click(screen.getByRole('menuitem', { name: 'Sentinel-2 Hybrid' }));

    expect(setMapLayerPreset).toHaveBeenCalledWith('sentinel-2-hybrid');
  });

  it('opens Satellite instead of applying the Sentinel preset without an applied scene', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    const mapLayers = services.mapLayers;
    if (mapLayers === null) return;
    const setMapLayerPreset = vi.spyOn(mapLayers, 'setMapLayerPreset');
    vi.spyOn(mapLayers, 'getAppliedScene').mockReturnValue(null);
    const facade = new FakeMapFacade();
    facade.setSnapshot({ lifecycle: 'ready' });
    useUiStore.setState({
      activeTab: 'layers',
      mobileWorkspaceOpen: false,
      navigationCollapsed: true,
    });
    render(
      <RuntimeServicesProvider services={services}>
        <MapWorkspace facade={facade} mapCanvas={<div>Empty Sentinel map</div>} />
      </RuntimeServicesProvider>,
    );

    await screen.findByText('Empty Sentinel map');
    await user.click(screen.getByRole('button', { name: 'Choose map layer preset' }));
    await user.click(screen.getByRole('menuitem', { name: 'Sentinel-2 Hybrid' }));

    expect(setMapLayerPreset).not.toHaveBeenCalled();
    expect(useUiStore.getState()).toMatchObject({
      activeTab: 'satellite',
      mobileWorkspaceOpen: true,
      navigationCollapsed: false,
    });
    expect(window.location.hash).toBe('#satellite');
  });

  it('shows a preset failure message without closing the chooser', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    const mapLayers = services.mapLayers;
    if (mapLayers === null) return;
    vi.spyOn(mapLayers, 'setMapLayerPreset').mockReturnValue({
      status: 'failed',
      message: 'The map is not ready yet.',
    });
    const facade = new FakeMapFacade();
    facade.setSnapshot({ lifecycle: 'ready' });
    render(
      <RuntimeServicesProvider services={services}>
        <MapWorkspace facade={facade} mapCanvas={<div>Preset failure map</div>} />
      </RuntimeServicesProvider>,
    );

    await screen.findByText('Preset failure map');
    await user.click(screen.getByRole('button', { name: 'Choose map layer preset' }));
    await user.click(screen.getByRole('menuitem', { name: 'Google Satellite' }));

    expect(screen.getByText('The map is not ready yet.')).toBeVisible();
    expect(screen.getByRole('menu')).toBeVisible();
  });
});
