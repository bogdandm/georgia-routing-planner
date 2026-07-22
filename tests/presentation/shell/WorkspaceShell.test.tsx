import { ThemeProvider } from '@mui/material';
import { userEvent } from '@testing-library/user-event';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SatelliteCatalogError,
  type SatelliteCatalogGateway,
  type SatelliteCatalogResult,
} from '@/application/ports/SatelliteCatalogGateway';
import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import { mapLayerStore, resetMapLayerStore } from '@/presentation/map/mapLayerStore';
import {
  resetMapInteractionStore,
  setSatelliteSearchAnchor,
} from '@/presentation/map/mapInteractionStore';
import { resetSatelliteRequestStatus } from '@/presentation/satellite-browser/satelliteRequestStatusStore';
import { OperationalStatus } from '@/presentation/shell/OperationalStatus';
import { useUiStore } from '@/presentation/shell/uiStore';
import { WorkspaceShell } from '@/presentation/shell/WorkspaceShell';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { FakeMapFacade } from '@test/helpers/FakeMapFacade';
import { createTestServices } from '@test/helpers/createTestServices';

let services: RuntimeServices;

beforeEach(async () => {
  window.history.replaceState(null, '', '/');
  resetMapLayerStore();
  resetMapInteractionStore();
  resetSatelliteRequestStatus();
  services = createTestServices();
  await services.database.delete();
  services = createTestServices();
  useUiStore.setState({
    activeTab: 'satellite',
    developerDrawerOpen: false,
    developerMode: false,
    mapDebugOptions: { showCollisionBoxes: false, showTileBoundaries: false },
    navigationCollapsed: false,
    settingsOpen: false,
  });
});

afterEach(async () => {
  services.database.close();
  await services.database.delete();
});

function renderWorkspaceShell() {
  return render(
    <RuntimeServicesProvider services={services}>
      <ThemeProvider theme={createAppTheme()}>
        <WorkspaceShell mapSurface={<div aria-label="Fake map">Local map ready</div>} />
      </ThemeProvider>
    </RuntimeServicesProvider>,
  );
}

const testViewport = {
  bounds: { west: 44.1, south: 42.1, east: 44.9, north: 42.9 },
  center: { longitude: 44.5, latitude: 42.5 },
} as const;

function catalogGatewayReturning(
  result: SatelliteCatalogResult,
): SatelliteCatalogGateway {
  return {
    search: () => Promise.resolve(result),
  };
}

function catalogGatewayFailing(error: SatelliteCatalogError): SatelliteCatalogGateway {
  return {
    search: () => Promise.reject(error),
  };
}

function syntheticSatelliteScene(id: string, acquiredAt: string): SatelliteScene {
  return {
    id,
    collection: 'sentinel-2-l2a',
    platform: 'sentinel-2a',
    productLevel: 'L2A',
    acquiredAt,
    cloudCoverPercent: 4,
    footprint: {
      type: 'Polygon',
      coordinates: [
        [
          [44, 42],
          [45, 42],
          [45, 43],
          [44, 43],
          [44, 42],
        ],
      ],
    },
    tileId: '38TMN',
    orbit: 'R036',
    productId: `S2A_${id}`,
    thumbnailHref: null,
    visualAsset: { kind: 'unavailable' },
    attribution: 'Synthetic test data',
  };
}

describe('WorkspaceShell', () => {
  it('creates a share link only after the explicit rail action', async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      camera: {
        longitude: 44.80123,
        latitude: 41.71234,
        zoom: 12.35,
        bearing: 18,
        pitch: 35,
      },
    });
    renderWorkspaceShell();

    expect(window.location.search).toBe('');
    await user.click(screen.getByRole('button', { name: 'Share map view' }));
    expect(screen.getByRole('dialog', { name: 'Share this map view' })).toBeVisible();
    const link = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: '2D share link',
    });
    expect(link.value).toContain('map=2');
    expect(link.value).toContain('lat=41.71234');
    expect(link.value).toContain('view=2d');
    expect(link.value).not.toContain('bearing=');
    expect(screen.getByRole('button', { name: 'Copy 3D link' })).toBeDisabled();
    expect(window.location.search).toBe('');
    await user.click(screen.getByRole('button', { name: 'Copy 2D link' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('z=12.35'));
    expect(await screen.findByText('2D share link copied')).toBeVisible();
  });

  it('enables 3D sharing only in terrain mode and uses the selected scene', async () => {
    const user = userEvent.setup();
    const selectedScene = syntheticSatelliteScene(
      'selected-while-rendering',
      '2026-07-20T10:12:00.000Z',
    );
    mapLayerStore.setState({
      selectedScene,
      appliedImagery: {
        status: 'loading',
        sceneKey: 'sentinel-2-l2a:selected-while-rendering',
        previousSceneKey: 'sentinel-2-l2a:previously-rendered',
        stage: 'rendering',
        message: 'Rendering selected scene',
        startedAt: 1,
      },
    });
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      terrainMode: 'terrain',
      camera: {
        longitude: 44.8,
        latitude: 41.7,
        zoom: 12.35,
        bearing: 18.12,
        pitch: 35.56,
      },
    });
    renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Share map view' }));

    const link2d = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: '2D share link',
    });
    const link3d = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: '3D share link',
    });
    const includeSatellite = screen.getByRole('checkbox', {
      name: 'Include selected satellite image',
    });
    expect(includeSatellite).toBeChecked();
    expect(link2d.value).toContain('scene=sentinel-2-l2a%3Aselected-while-rendering');
    expect(link2d.value).not.toContain('bearing=');
    expect(link3d.value).toContain('bearing=18.12');
    expect(link3d.value).toContain('pitch=35.56');
    expect(screen.getByRole('button', { name: 'Copy 3D link' })).toBeEnabled();

    await user.click(includeSatellite);
    expect(link2d.value).not.toContain('scene=');
    expect(link3d.value).not.toContain('scene=');
  });

  it('shows a shared selected-scene card before the map viewport or raster is ready', async () => {
    window.history.replaceState(null, '', '/#satellite');
    const selectedScene = syntheticSatelliteScene(
      'shared-before-raster',
      '2026-07-20T10:12:00.000Z',
    );
    mapLayerStore.setState({
      selectedScene,
      appliedImagery: {
        status: 'loading',
        sceneKey: 'sentinel-2-l2a:shared-before-raster',
        previousSceneKey: null,
        stage: 'preparing',
        message: 'Preparing the selected scene',
        startedAt: 1,
      },
    });
    useUiStore.setState({ activeTab: 'satellite' });

    renderWorkspaceShell();

    expect(await screen.findByText('Product S2A_shared-before-raster')).toBeVisible();
    expect(screen.getByText(/Applying true-color imagery/)).toBeVisible();
  });

  it('navigates the contextual feature panels without covering the map', async () => {
    const user = userEvent.setup();
    services.mapViewport.update(testViewport);
    renderWorkspaceShell();

    expect(
      screen.getByRole('heading', { name: 'Satellite imagery', level: 1 }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Search images' })).toBeEnabled();
    expect(screen.getByLabelText('Fake map')).toHaveTextContent('Local map ready');

    expect(screen.queryByRole('tab', { name: 'Plan' })).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole('tab')
        .map((tab) => tab.getAttribute('aria-label') ?? tab.textContent),
    ).toEqual(['Satellite', 'Layers', 'Markers', 'Tracks']);
    expect(screen.getByRole('tab', { name: 'Tracks' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Markers' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Tracks' })).toHaveAttribute(
      'aria-description',
      'Track tools are not available yet',
    );
    expect(screen.getByRole('tab', { name: 'Markers' })).toHaveAttribute(
      'aria-description',
      'Saved markers are not available yet',
    );
    await user.hover(screen.getByRole('tab', { name: 'Tracks' }));
    expect(
      await screen.findByRole('tooltip', {
        name: 'Track tools are not available yet',
      }),
    ).toBeVisible();
    await user.unhover(screen.getByRole('tab', { name: 'Tracks' }));
    await user.hover(screen.getByRole('tab', { name: 'Markers' }));
    expect(
      await screen.findByRole('tooltip', {
        name: 'Saved markers are not available yet',
      }),
    ).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Layers' }));
    expect(screen.getByRole('heading', { name: 'Map visibility' })).toBeVisible();
    expect(
      screen.getByRole('heading', {
        name: 'Copernicus Sentinel-2 via Earth Search',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'OpenStreetMap via OpenFreeMap' }),
    ).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Natural features' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Restricted areas' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Hiking paths' })).toBeChecked();
    expect(screen.getByRole('slider', { name: 'Opacity' })).toHaveValue('100');
    expect(screen.getByRole('slider', { name: 'Opacity' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Relief shading' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Elevation isolines' })).toBeChecked();
    expect(screen.queryByText(/<a href=/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    expect(window.location.hash).toBe('#satellite');
    expect(
      screen.getByRole('heading', { name: 'Satellite imagery', level: 1 }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Search images' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'L1C' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'L2A' })).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Maximum cloud' })).toHaveValue('50');
    expect(screen.getByLabelText('Sentinel acquisition calendar')).toBeVisible();
    const acquisitionCalendar = screen.getByRole('grid', { name: 'July 2026' });
    expect(within(acquisitionCalendar).getAllByRole('columnheader')).toHaveLength(7);
    expect(within(acquisitionCalendar).getAllByRole('gridcell')).toHaveLength(31);
    expect(
      screen.getByRole('gridcell', { name: '1 Jul 2026, no loaded imagery' }),
    ).toHaveStyle({ height: '34px' });
    const searchAreaSource = screen.getByRole('combobox', {
      name: 'Search area source',
    });
    expect(searchAreaSource).toHaveTextContent('Point');
    expect(searchAreaSource).toHaveTextContent('42.5000, 44.5000');
    await user.click(searchAreaSource);
    expect(screen.getByRole('option', { name: 'Point' })).toBeVisible();
    expect(screen.queryByRole('option', { name: 'Custom' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Marker' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByTestId('elevation-panel')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Imported tracks will stay in this browser/u),
    ).not.toBeInTheDocument();
  });

  it('keeps a context-menu search custom until the user selects Point', async () => {
    const user = userEvent.setup();
    setSatelliteSearchAnchor({ latitude: 42.1, longitude: 43.4 });
    renderWorkspaceShell();

    const searchAreaSource = screen.getByRole('combobox', {
      name: 'Search area source',
    });
    expect(searchAreaSource).toHaveTextContent('Custom');
    expect(searchAreaSource).toHaveTextContent('42.1000, 43.4000');

    await user.click(searchAreaSource);
    expect(screen.queryByRole('option', { name: 'Custom' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Marker' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.click(screen.getByRole('option', { name: 'Point' }));

    expect(searchAreaSource).toHaveTextContent('Point');
  });

  it('restores the persisted maximum cloud cover after remounting', async () => {
    const user = userEvent.setup();
    const firstRender = renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    const slider = screen.getByRole('slider', { name: 'Maximum cloud' });
    await waitFor(() => {
      expect(slider).toHaveValue('50');
    });
    fireEvent.change(slider, { target: { value: '75' } });
    fireEvent.mouseUp(slider);
    await waitFor(async () => {
      await expect(services.database.loadMaximumCloudCoverPercent()).resolves.toBe(75);
    });

    firstRender.unmount();
    renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await waitFor(() => {
      expect(screen.getByRole('slider', { name: 'Maximum cloud' })).toHaveValue('75');
    });
  });

  it('restores every workspace tab from its URL anchor', async () => {
    window.history.replaceState(null, '', '/#markers');
    renderWorkspaceShell();

    expect(
      await screen.findByRole('heading', { name: 'No saved markers' }),
    ).toBeVisible();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Layers' }));
    expect(window.location.hash).toBe('#layers');
    expect(screen.getByRole('heading', { name: 'Map visibility' })).toBeVisible();
  });

  it('sends one shared OpenStreetMap opacity command from Layers', async () => {
    const mapLayers = services.mapLayers;
    if (mapLayers === null) return;
    const setOpacity = vi
      .spyOn(mapLayers, 'setOpenStreetMapOpacity')
      .mockReturnValue({ status: 'success' });
    mapLayerStore.setState({
      appliedImagery: {
        status: 'ready',
        sceneKey: 'test-scene-key',
        sceneId: 'test-scene',
        visible: true,
      },
    });
    renderWorkspaceShell();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Layers' }));

    fireEvent.change(screen.getByRole('slider', { name: 'Opacity' }), {
      target: { value: '60' },
    });

    expect(setOpacity).toHaveBeenLastCalledWith(0.6);
  });

  it('searches the captured viewport and renders grouped Sentinel scenes', async () => {
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: catalogGatewayReturning({
        totalMatched: 1,
        scenes: [
          {
            id: 'synthetic-scene',
            collection: 'sentinel-2-l2a',
            platform: 'sentinel-2a',
            productLevel: 'L2A',
            acquiredAt: '2026-07-12T10:12:00.000Z',
            cloudCoverPercent: 4,
            footprint: {
              type: 'Polygon',
              coordinates: [
                [
                  [44, 42],
                  [45, 42],
                  [45, 43],
                  [44, 43],
                  [44, 42],
                ],
              ],
            },
            tileId: '38TMN',
            orbit: 'R036',
            productId: 'S2A_SYNTHETIC',
            thumbnailHref: null,
            visualAsset: { kind: 'unavailable' },
            attribution: 'Synthetic test data',
          },
        ],
      }),
    });
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(screen.getByRole('button', { name: 'Search images' }));

    expect(
      await screen.findByRole('heading', {
        name: 'Images near 42.5000, 44.5000',
      }),
    ).toBeVisible();
    expect(screen.getByText(/12 Jul 2026 · 14:12 GMT\+4/u)).toBeVisible();
    expect(screen.queryByText('Sentinel-2a')).not.toBeInTheDocument();
    expect(screen.getByText('100% coverage')).toBeVisible();
    expect(screen.queryByLabelText(/Low viewport coverage/u)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/High cloud cover/u)).not.toBeInTheDocument();
    expect(screen.queryByText('38TMN')).not.toBeInTheDocument();
    expect(screen.queryByText('R036')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Apply imagery' }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('gridcell', {
        name: /12 Jul 2026, imagery available/u,
      }),
    );
    expect(screen.getByText('Image failed to apply')).toBeVisible();
    expect(services.sentinelQueryDiagnostics.getSnapshot().status).toBe('success');
    await user.click(screen.getByRole('tab', { name: 'Layers' }));
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    expect(
      screen.getByRole('heading', { name: 'Images near 42.5000, 44.5000' }),
    ).toBeVisible();
    expect(screen.getByText('Image failed to apply')).toBeVisible();
  });

  it('loads preceding months through the same persistent load-more action', async () => {
    const requestedStarts: string[] = [];
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: {
        search: ({ criteria }) => {
          requestedStarts.push(criteria.startDate);
          const isCurrentMonth = criteria.startDate === '2026-07-01';
          return Promise.resolve({
            totalMatched: 1,
            scenes: [
              syntheticSatelliteScene(
                isCurrentMonth ? 'july-scene' : 'june-scene',
                isCurrentMonth
                  ? '2026-07-12T10:12:00.000Z'
                  : '2026-06-18T10:12:00.000Z',
              ),
            ],
          });
        },
      },
    });
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(screen.getByRole('button', { name: 'Search images' }));
    expect(await screen.findByText(/12 Jul 2026 · 14:12 GMT\+4/u)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Load more images' }));

    expect(await screen.findByText(/18 Jun 2026 · 14:12 GMT\+4/u)).toBeVisible();
    expect(requestedStarts).toEqual(['2026-07-01', '2026-06-01']);
    expect(screen.getByRole('button', { name: 'Load more images' })).toBeVisible();
  });

  it('shows a selected applied scene as one removable image', async () => {
    const restoredScene = syntheticSatelliteScene(
      'restored-scene',
      '2026-06-18T10:12:00.000Z',
    );
    const mapLayers = services.mapLayers;
    if (mapLayers === null) return;
    services.mapViewport.update(testViewport);
    const clearScene = vi.spyOn(mapLayers, 'clearScene').mockImplementation(() => {
      mapLayerStore.setState({
        appliedImagery: { status: 'empty' },
        selectedScene: null,
      });
      return { status: 'success' };
    });
    mapLayerStore.setState({
      selectedScene: restoredScene,
      appliedImagery: {
        status: 'ready',
        sceneKey: 'sentinel-2-l2a:restored-scene',
        sceneId: 'restored-scene',
        visible: true,
      },
    });
    window.history.replaceState(null, '', '/#satellite');
    const user = userEvent.setup();

    renderWorkspaceShell();

    expect(await screen.findByText('1 image · 1 acquisition day')).toBeVisible();
    const restoredCard = screen.getByRole('button', {
      name: 'Remove 18 Jun 2026 imagery from map',
    });
    expect(restoredCard).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByText('Product S2A_restored-scene'));

    expect(clearScene).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Apply 18 Jun 2026 imagery' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('searches May, loads June and July on navigation, and reuses complete months', async () => {
    const requests: { readonly startDate: string; readonly endDate: string }[] = [];
    const scenesByMonth = new Map([
      ['2026-05', syntheticSatelliteScene('may-scene', '2026-05-14T10:12:00.000Z')],
      ['2026-06', syntheticSatelliteScene('june-scene', '2026-06-18T10:12:00.000Z')],
      ['2026-07', syntheticSatelliteScene('july-scene', '2026-07-12T10:12:00.000Z')],
    ]);
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: {
        search: ({ criteria }) => {
          requests.push({
            startDate: criteria.startDate,
            endDate: criteria.endDate,
          });
          const scene = scenesByMonth.get(criteria.startDate.slice(0, 7));
          return Promise.resolve({
            totalMatched: scene === undefined ? 0 : 1,
            scenes: scene === undefined ? [] : [scene],
          });
        },
      },
    });
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(
      screen.getByRole('button', { name: 'Previous acquisition month' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Previous acquisition month' }),
    );
    expect(screen.getByRole('grid', { name: 'May 2026' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Search images' }));
    expect(await screen.findByText(/14 May 2026.*14:12 GMT\+4/u)).toBeVisible();
    expect(screen.getByRole('grid', { name: 'May 2026' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Next acquisition month' }));
    expect(await screen.findByText(/18 Jun 2026.*14:12 GMT\+4/u)).toBeVisible();
    expect(screen.getByRole('grid', { name: 'June 2026' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Next acquisition month' }));
    expect(await screen.findByText(/12 Jul 2026.*14:12 GMT\+4/u)).toBeVisible();
    expect(screen.getByRole('grid', { name: 'July 2026' })).toBeVisible();

    expect(screen.getByText(/14 May 2026.*14:12 GMT\+4/u)).toBeVisible();
    expect(screen.getByText(/18 Jun 2026.*14:12 GMT\+4/u)).toBeVisible();
    expect(requests).toEqual([
      { startDate: '2026-05-01', endDate: '2026-05-31' },
      { startDate: '2026-06-01', endDate: '2026-06-30' },
      { startDate: '2026-07-01', endDate: '2026-07-18' },
    ]);

    await user.click(
      screen.getByRole('button', { name: 'Previous acquisition month' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Previous acquisition month' }),
    );
    expect(screen.getByRole('grid', { name: 'May 2026' })).toBeVisible();
    expect(requests).toHaveLength(3);
  });

  it('uses a calendar date as a best-coverage card shortcut without reopening the pane', async () => {
    const lowCoverageScene = syntheticSatelliteScene(
      'later-low-coverage',
      '2026-07-12T11:12:00.000Z',
    );
    const bestCoverageScene = syntheticSatelliteScene(
      'earlier-best-coverage',
      '2026-07-12T10:12:00.000Z',
    );
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: catalogGatewayReturning({
        totalMatched: 2,
        scenes: [
          {
            ...lowCoverageScene,
            attribution: 'Low coverage scene',
            footprint: {
              type: 'Polygon',
              coordinates: [
                [
                  [44.1, 42.1],
                  [44.3, 42.1],
                  [44.3, 42.9],
                  [44.1, 42.9],
                  [44.1, 42.1],
                ],
              ],
            },
          },
          { ...bestCoverageScene, attribution: 'Best coverage scene' },
        ],
      }),
    });
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(screen.getByRole('button', { name: 'Search images' }));
    const dateShortcut = await screen.findByRole('gridcell', {
      name: /12 Jul 2026, imagery available/u,
    });
    await user.click(dateShortcut);
    expect(screen.getByText('Best coverage scene')).toBeVisible();
    expect(screen.queryByText('Low coverage scene')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close imagery results' }));
    await user.click(dateShortcut);
    expect(
      screen.queryByRole('heading', { name: 'Images near 42.5000, 44.5000' }),
    ).not.toBeInTheDocument();
  });

  it('keeps all dates but filters scene cards by cloud cover client-side', async () => {
    const highCloudScene = syntheticSatelliteScene(
      'threshold-scene',
      '2026-07-12T10:12:00.000Z',
    );
    const lowCloudScene = syntheticSatelliteScene(
      'matching-scene',
      '2026-07-09T10:12:00.000Z',
    );
    const search = vi.fn<SatelliteCatalogGateway['search']>(() =>
      Promise.resolve({
        totalMatched: 2,
        scenes: [
          {
            ...highCloudScene,
            cloudCoverPercent: 70,
            footprint: {
              type: 'Polygon',
              coordinates: [
                [
                  [44.1, 42.1],
                  [44.42, 42.1],
                  [44.42, 42.9],
                  [44.1, 42.9],
                  [44.1, 42.1],
                ],
              ],
            },
          },
          { ...lowCloudScene, cloudCoverPercent: 10 },
        ],
      }),
    );
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: { search },
    });
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(screen.getByRole('button', { name: 'Search images' }));

    expect(search).toHaveBeenCalledOnce();
    expect(search.mock.calls[0]?.[0].criteria.maxCloudCoverPercent).toBe(100);
    expect(
      await screen.findByRole('button', { name: 'Apply 9 Jul 2026 imagery' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Apply 12 Jul 2026 imagery' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('gridcell', {
        name: /12 Jul 2026, imagery available, 70 percent weighted cloud, exceeds/u,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('gridcell', {
        name: /9 Jul 2026, imagery available, 10 percent weighted cloud, matches/u,
      }),
    ).toBeVisible();
    await user.click(
      screen.getByRole('gridcell', {
        name: /12 Jul 2026, imagery available, 70 percent weighted cloud, exceeds/u,
      }),
    );
    expect(
      screen.getByRole('button', { name: 'Apply 12 Jul 2026 imagery' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Apply 9 Jul 2026 imagery' }));
    expect(
      screen.queryByRole('button', { name: 'Apply 12 Jul 2026 imagery' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: 'Maximum cloud' }), {
      target: { value: '100' },
    });
    expect(
      screen.getByRole('button', { name: 'Apply 12 Jul 2026 imagery' }),
    ).toBeVisible();
    expect(screen.getByLabelText('High cloud cover: 70%')).toBeVisible();
    expect(screen.getByLabelText(/Low viewport coverage: 40%/u)).toBeVisible();
    expect(
      screen.getByRole('gridcell', {
        name: /12 Jul 2026, imagery available, 70 percent weighted cloud, matches/u,
      }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Search images' }));
    expect(search).toHaveBeenCalledOnce();
  });

  it('shows the safe provider error without removing the search controls', async () => {
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: catalogGatewayFailing(
        new SatelliteCatalogError(
          'provider-rate-limited',
          'Earth Search is rate limiting requests. Wait and try again.',
        ),
      ),
    });
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(screen.getByRole('button', { name: 'Search images' }));

    expect(
      await screen.findAllByText(
        'Earth Search is rate limiting requests. Wait and try again.',
      ),
    ).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Search images' })).toBeEnabled();
  });

  it('persists developer mode and opens the diagnostics drawer', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    await user.click(
      screen.getByRole('switch', { name: 'Enable developer diagnostics' }),
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));

    const developerButton = await screen.findByRole('button', {
      name: 'Developer diagnostics',
    });
    await user.click(developerButton);
    expect(
      screen.getByRole('heading', { name: 'Developer diagnostics' }),
    ).toBeVisible();
    expect(developerButton).toHaveAttribute('aria-pressed', 'true');

    await user.click(developerButton);
    expect(useUiStore.getState().developerDrawerOpen).toBe(false);
    expect(developerButton).toHaveAttribute('aria-pressed', 'false');

    await waitFor(async () => {
      await expect(services.database.loadUiPreferences()).resolves.toEqual({
        developerMode: true,
        navigationCollapsed: false,
      });
    });
  });

  it('keeps the logo fixed and restores from its attached chevron', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

    const navigation = screen.getByRole('navigation');
    const projectLogo = screen.getByRole('button', {
      name: 'Hide navigation from GR logo',
    });
    expect(navigation).toHaveStyle({ width: '64px' });
    expect(projectLogo).toHaveStyle({
      width: '44px',
      height: '36px',
      marginTop: '12px',
      marginLeft: '10px',
      flexShrink: '0',
    });
    await user.hover(projectLogo);
    expect(
      await screen.findByRole('tooltip', { name: 'Georgia Routing Planner' }),
    ).toBeVisible();
    await user.unhover(projectLogo);

    const collapseToggle = screen.getByTestId('navigation-collapse-toggle');
    expect(collapseToggle).toHaveStyle({
      width: '36px',
      height: '36px',
      right: '-28px',
    });
    await user.click(projectLogo);

    const showNavigation = screen.getByRole('button', { name: 'Show navigation' });
    expect(navigation).toBeVisible();
    expect(navigation).toHaveStyle({ width: '64px' });
    expect(projectLogo).toHaveStyle({
      width: '44px',
      height: '36px',
      marginTop: '12px',
      marginLeft: '10px',
      borderRadius: '5px 0 0 5px',
    });
    expect(showNavigation).toBe(collapseToggle);
    expect(showNavigation).toHaveStyle({
      width: '80px',
      height: '36px',
      right: '-26px',
      borderWidth: '0px',
      borderRadius: '5px 8px 8px 5px',
      boxShadow: 'none',
    });
    await user.hover(screen.getByTestId('collapsed-project-tooltip-target'));
    expect(
      await screen.findByRole('tooltip', { name: 'Georgia Routing Planner' }),
    ).toBeVisible();
    await user.unhover(screen.getByTestId('collapsed-project-tooltip-target'));
    await user.hover(screen.getByTestId('collapsed-show-navigation-tooltip-target'));
    expect(
      await screen.findByRole('tooltip', { name: 'Show navigation' }),
    ).toBeVisible();
    expect(screen.getByRole('complementary', { hidden: true })).not.toBeVisible();
    await user.click(showNavigation);
    expect(screen.getByRole('navigation')).toBeVisible();
    expect(screen.getByRole('complementary')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    const settings = screen.getByRole('dialog', { name: 'Settings' });
    expect(
      screen.queryByRole('switch', { name: 'Collapse left navigation' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Rendering' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Storage' })).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Sentinel imagery stretch' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Rendering' }));
    expect(
      screen.getByRole('heading', { name: 'Sentinel imagery stretch' }),
    ).toBeVisible();
    const satelliteRender = within(settings).getByRole('combobox', {
      name: 'Satellite render',
    });
    expect(satelliteRender).toHaveTextContent('Auto');
    await user.click(satelliteRender);
    await user.click(screen.getByRole('option', { name: 'Direct' }));
    await waitFor(() => {
      expect(services.mapLayers?.getRenderingMode()).toBe('direct');
    });
    await waitFor(async () => {
      await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
        satelliteRenderingMode: 'direct',
      });
    });
    expect(document.querySelector('.MuiBackdrop-root')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Layers' }));
    expect(settings).toBeVisible();
    const ceiling = screen.getByRole('slider', {
      name: 'Sentinel reflectance ceiling',
    });
    fireEvent.keyDown(ceiling, { key: 'Home' });
    fireEvent.keyUp(ceiling, { key: 'Home' });
    await waitFor(() => {
      expect(services.mapLayers?.getRenderingTuning().reflectanceMax).toBe(3_000);
    });
    await waitFor(async () => {
      await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
        renderingTuning: { reflectanceMax: 3_000 },
      });
    });
    const saturation = screen.getByRole('slider', { name: 'Sentinel saturation' });
    fireEvent.keyDown(saturation, { key: 'End' });
    fireEvent.keyUp(saturation, { key: 'End' });
    await waitFor(() => {
      expect(services.mapLayers?.getRenderingTuning().saturation).toBe(5);
    });
    expect(screen.getByRole('tab', { name: 'Rendering' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.click(screen.getByRole('tab', { name: 'Storage' }));
    expect(await screen.findByText('Local database (IndexedDB)')).toBeVisible();
    expect(screen.getByText('Cache Storage')).toBeVisible();
    expect(screen.getByText('3.00 MB')).toBeVisible();
    expect(screen.getByText('4.00 MB')).toBeVisible();
    expect(screen.getByText('48.00 MB')).toBeVisible();
    expect(screen.getByText(/HTTP and MapLibre tile caches/i)).toBeVisible();
  });

  it('opens the complete current map error from the lightweight status line', async () => {
    const user = userEvent.setup();
    mapLayerStore.setState({
      errorMessage:
        'The imagery renderer rejected these stretch values. Reset the imagery stretch or try less extreme values.',
    });
    render(
      <RuntimeServicesProvider services={services}>
        <ThemeProvider theme={createAppTheme()}>
          <OperationalStatus />
        </ThemeProvider>
      </RuntimeServicesProvider>,
    );

    const statusButton = await screen.findByRole('button', {
      name: 'Show current error details',
    });
    await user.hover(
      screen.getByLabelText(
        'The imagery renderer rejected these stretch values. Reset the imagery stretch or try less extreme values.',
      ),
    );
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'The imagery renderer rejected these stretch values. Reset the imagery stretch or try less extreme values.',
    );
    expect(screen.getByRole('status')).toHaveStyle({
      backgroundColor: 'rgba(255, 255, 255, 0.42)',
    });
    await user.click(statusButton);

    expect(screen.getByText('Current map error')).toBeVisible();
    expect(
      screen.getAllByText(/renderer rejected these stretch values/i).at(-1),
    ).toBeVisible();
  });

  it('UI-wires accessible terrain overlay settings and persists all choices', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    await user.click(screen.getByRole('tab', { name: 'Rendering' }));

    expect(screen.getByRole('heading', { name: 'Terrain overlays' })).toBeVisible();
    const contourDistance = screen.getByRole('combobox', {
      name: 'Contour distance',
    });
    expect(contourDistance).toHaveTextContent('50 m');
    expect(
      screen.getByText(/Emphasized, labeled index contours remain every 200 m/u),
    ).toBeVisible();
    const demFilter = screen.getByRole('switch', {
      name: 'Repair invalid DEM elevation pixels',
    });
    expect(demFilter).toBeChecked();

    await user.click(contourDistance);
    await user.click(screen.getByRole('option', { name: '25 m' }));
    await user.click(demFilter);
    await user.click(
      screen.getByRole('switch', {
        name: 'Show relief shading above satellite imagery',
      }),
    );

    expect(services.mapLayers?.getTerrainOverlayPreferences()).toEqual({
      contourIntervalMeters: 25,
      filterInvalidDemPixels: false,
      shadeAboveSatellite: true,
    });
    await waitFor(async () => {
      await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
        terrainOverlays: {
          contourIntervalMeters: 25,
          filterInvalidDemPixels: false,
          shadeAboveSatellite: true,
        },
      });
    });
  });

  it('mirrors the persisted satellite rendering mode in Satellite and Settings', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    const satelliteTools = screen.getByRole('complementary', {
      name: 'Satellite imagery tools',
    });
    const sidebarMode = within(satelliteTools).getByRole('combobox', {
      name: 'Satellite render',
    });
    expect(sidebarMode).toHaveTextContent('Auto');
    act(() => {
      mapLayerStore.setState({
        appliedImagery: {
          status: 'loading',
          sceneKey: 'sentinel-2-l2a:in-flight',
          previousSceneKey: null,
          stage: 'rendering',
          message: 'Rendering in progress',
          startedAt: Date.now(),
        },
      });
    });
    expect(sidebarMode).toBeEnabled();
    await user.click(sidebarMode);
    await user.click(screen.getByRole('option', { name: 'Server' }));
    await waitFor(() => {
      expect(services.mapLayers?.getRenderingMode()).toBe('server');
    });

    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    const settings = screen.getByRole('dialog', { name: 'Settings' });
    await user.click(within(settings).getByRole('tab', { name: 'Rendering' }));
    expect(
      within(settings).getByRole('combobox', { name: 'Satellite render' }),
    ).toHaveTextContent('Server');
    await waitFor(async () => {
      await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
        satelliteRenderingMode: 'server',
      });
    });
  });

  it('shows compatibility mode only while terrain compute uses the inline backend', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    await user.click(screen.getByRole('tab', { name: 'Rendering' }));

    expect(
      screen.queryByText(/Terrain processing is running/u),
    ).not.toBeInTheDocument();
    act(() => {
      mapLayerStore.setState({ terrainComputeStatus: 'inline' });
    });
    expect(
      screen.getByText(/Terrain processing is running in compatibility mode/u),
    ).toBeVisible();

    act(() => {
      mapLayerStore.setState({ terrainComputeStatus: 'worker' });
    });
    expect(
      screen.queryByText(/Terrain processing is running/u),
    ).not.toBeInTheDocument();
  });

  it('shows the live bounded terrain queue beneath Ready', () => {
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      lifecycle: 'ready',
    });
    render(
      <RuntimeServicesProvider services={services}>
        <ThemeProvider theme={createAppTheme()}>
          <OperationalStatus />
        </ThemeProvider>
      </RuntimeServicesProvider>,
    );

    expect(screen.getByText('Ready')).toBeVisible();
    expect(
      screen.queryByLabelText('Terrain compute queue state'),
    ).not.toBeInTheDocument();

    act(() => {
      mapLayerStore.setState({
        terrainComputeQueue: {
          executionMode: 'worker',
          activeCount: 1,
          queuedContourCount: 4,
          queueCapacity: 32,
        },
      });
    });
    expect(screen.getByLabelText('Terrain compute queue state')).toHaveTextContent(
      'Terrain worker · queue 4/32 · 1 active',
    );
  });

  it('replaces Ready with a warning after automatic provider fallback', () => {
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      lifecycle: 'ready',
    });
    mapLayerStore.setState({ automaticAlternativeProviderState: 'active' });
    render(
      <RuntimeServicesProvider services={services}>
        <ThemeProvider theme={createAppTheme()}>
          <OperationalStatus />
        </ThemeProvider>
      </RuntimeServicesProvider>,
    );

    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'TiTiler is unavailable. Direct pre-rendered Sentinel imagery is active.',
    );
  });

  it('prioritizes the provider-switch warning over the transient map error', () => {
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      lifecycle: 'degraded',
      message: 'The satellite imagery renderer is rate-limiting requests.',
    });
    mapLayerStore.setState({ automaticAlternativeProviderState: 'switching' });
    render(
      <RuntimeServicesProvider services={services}>
        <ThemeProvider theme={createAppTheme()}>
          <OperationalStatus />
        </ThemeProvider>
      </RuntimeServicesProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'TiTiler is unavailable. Switching to direct pre-rendered Sentinel imagery.',
    );
    expect(
      screen.queryByText('The satellite imagery renderer is rate-limiting requests.'),
    ).not.toBeInTheDocument();
  });

  it('announces fatal map failures assertively', () => {
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      lifecycle: 'fatal',
      message: 'The browser lost the WebGL context.',
    });
    render(
      <RuntimeServicesProvider services={services}>
        <ThemeProvider theme={createAppTheme()}>
          <OperationalStatus />
        </ThemeProvider>
      </RuntimeServicesProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The browser lost the WebGL context.',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
