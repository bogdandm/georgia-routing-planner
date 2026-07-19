import { ThemeProvider } from '@mui/material';
import { userEvent } from '@testing-library/user-event';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { resetSatelliteRequestStatus } from '@/presentation/satellite-browser/satelliteRequestStatusStore';
import { OperationalStatus } from '@/presentation/shell/OperationalStatus';
import { useUiStore } from '@/presentation/shell/uiStore';
import { WorkspaceShell } from '@/presentation/shell/WorkspaceShell';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { FakeMapFacade } from '../../../test/helpers/FakeMapFacade';
import { createTestServices } from '../../../test/helpers/createTestServices';

let services: RuntimeServices;

beforeEach(async () => {
  window.history.replaceState(null, '', '/');
  resetMapLayerStore();
  resetSatelliteRequestStatus();
  services = createTestServices();
  await services.database.delete();
  services = createTestServices();
  useUiStore.setState({
    activeTab: 'tracks',
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
  services.queryClient.clear();
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
  it('navigates the contextual feature panels without covering the map', async () => {
    const user = userEvent.setup();
    services.mapViewport.update(testViewport);
    renderWorkspaceShell();

    expect(screen.getByRole('heading', { name: 'Tracks', level: 1 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'No tracks loaded' })).toBeVisible();
    expect(screen.getByLabelText('Fake map')).toHaveTextContent('Local map ready');

    expect(screen.queryByRole('tab', { name: 'Plan' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Markers' }));
    expect(screen.getByRole('heading', { name: 'No saved markers' })).toBeVisible();
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
    expect(screen.getByRole('slider', { name: 'Maximum cloud' })).toHaveValue('25');
    expect(screen.getByLabelText('Sentinel acquisition calendar')).toBeVisible();
    const searchAreaSource = screen.getByRole('combobox', {
      name: 'Search area source',
    });
    expect(searchAreaSource).toHaveTextContent('Point');
    expect(searchAreaSource).toHaveTextContent('42.5000, 44.5000');
    await user.click(searchAreaSource);
    expect(screen.getByRole('option', { name: 'Point' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Marker' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByTestId('elevation-panel')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Imported tracks will stay in this browser/u),
    ).not.toBeInTheDocument();
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

  it('shows the restored applied scene as one removable image after refresh', async () => {
    const restoredScene = syntheticSatelliteScene(
      'restored-scene',
      '2026-06-18T10:12:00.000Z',
    );
    const mapLayers = services.mapLayers;
    if (mapLayers === null) return;
    services.mapViewport.update(testViewport);
    vi.spyOn(mapLayers, 'getAppliedScene').mockReturnValue(restoredScene);
    const clearScene = vi.spyOn(mapLayers, 'clearScene').mockImplementation(() => {
      mapLayerStore.setState({ appliedImagery: { status: 'empty' } });
      return { status: 'success' };
    });
    mapLayerStore.setState({
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

    await user.click(restoredCard);

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

  it('highlights only low coverage and high cloud values', async () => {
    const scene = syntheticSatelliteScene(
      'threshold-scene',
      '2026-07-12T10:12:00.000Z',
    );
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: catalogGatewayReturning({
        totalMatched: 1,
        scenes: [
          {
            ...scene,
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
        ],
      }),
    });
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Maximum cloud' }), {
      target: { value: '100' },
    });
    await user.click(screen.getByRole('button', { name: 'Search images' }));

    expect(await screen.findByLabelText('High cloud cover: 70%')).toBeVisible();
    expect(screen.getByLabelText(/Low viewport coverage: 40%/u)).toBeVisible();
    expect(
      screen.getByRole('gridcell', {
        name: /12 Jul 2026, imagery available, 70 percent weighted cloud, matches/u,
      }),
    ).toBeVisible();
    fireEvent.change(screen.getByRole('slider', { name: 'Maximum cloud' }), {
      target: { value: '50' },
    });
    expect(
      screen.getByRole('gridcell', {
        name: /12 Jul 2026, imagery available, 70 percent weighted cloud, exceeds/u,
      }),
    ).toBeVisible();
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

  it('collapses from the GR logo and restores from the remaining logo', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

    const navigation = screen.getByRole('navigation');
    const expandedLogo = screen.getByRole('button', {
      name: 'Hide navigation from GR',
    });
    expect(navigation).toHaveStyle({ width: '64px' });
    expect(expandedLogo).toHaveStyle({
      width: '44px',
      height: '36px',
      flexShrink: '0',
      marginTop: '12px',
    });

    await user.click(expandedLogo);

    const collapsedLogo = screen.getByRole('button', { name: 'Show navigation' });
    expect(navigation).toBeVisible();
    expect(navigation).toHaveStyle({ width: '64px' });
    expect(collapsedLogo).toHaveStyle({
      width: '44px',
      height: '36px',
      flexShrink: '0',
      marginTop: '12px',
    });
    expect(screen.getByRole('complementary', { hidden: true })).not.toBeVisible();
    await user.click(collapsedLogo);
    expect(screen.getByRole('navigation')).toBeVisible();
    expect(screen.getByRole('complementary')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Open settings' }));
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
    expect(document.querySelector('.MuiBackdrop-root')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Layers' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible();
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

  it('UI-wires accessible terrain overlay settings and persists both choices', async () => {
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

    await user.click(contourDistance);
    await user.click(screen.getByRole('option', { name: '25 m' }));
    await user.click(
      screen.getByRole('switch', {
        name: 'Show relief shading above satellite imagery',
      }),
    );

    expect(services.mapLayers?.getTerrainOverlayPreferences()).toEqual({
      contourIntervalMeters: 25,
      shadeAboveSatellite: true,
    });
    await waitFor(async () => {
      await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
        terrainOverlays: {
          contourIntervalMeters: 25,
          shadeAboveSatellite: true,
        },
      });
    });
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
