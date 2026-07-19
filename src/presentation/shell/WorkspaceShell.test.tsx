import { ThemeProvider } from '@mui/material';
import { userEvent } from '@testing-library/user-event';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SatelliteCatalogError,
  type SatelliteCatalogGateway,
  type SatelliteCatalogResult,
} from '@/application/ports/SatelliteCatalogGateway';
import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import { useUiStore } from '@/presentation/shell/uiStore';
import { WorkspaceShell } from '@/presentation/shell/WorkspaceShell';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { createTestServices } from '../../../test/helpers/createTestServices';

let services: RuntimeServices;

beforeEach(async () => {
  window.history.replaceState(null, '', '/');
  services = createTestServices();
  await services.database.delete();
  services = createTestServices();
  useUiStore.setState({
    activeTab: 'tracks',
    developerDrawerOpen: false,
    developerMode: false,
    mapDebugOptions: { showCollisionBoxes: false, showTileBoundaries: false },
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
    expect(
      screen.getByRole('heading', { name: 'Layer controls are not available yet' }),
    ).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    expect(window.location.hash).toBe('#satelite');
    expect(
      screen.getByRole('heading', { name: 'Satellite imagery', level: 1 }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Search latest images' })).toBeEnabled();
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
    expect(
      screen.getByRole('heading', { name: 'Layer controls are not available yet' }),
    ).toBeVisible();
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
    await user.click(screen.getByRole('button', { name: 'Search latest images' }));

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
    expect(screen.getByText('Selected for imagery')).toBeVisible();
    expect(services.sentinelQueryDiagnostics.getSnapshot().status).toBe('success');
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
    await user.click(screen.getByRole('button', { name: 'Search latest images' }));
    expect(await screen.findByText(/12 Jul 2026 · 14:12 GMT\+4/u)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Load more images' }));

    expect(await screen.findByText(/18 Jun 2026 · 14:12 GMT\+4/u)).toBeVisible();
    expect(requestedStarts).toEqual(['2026-07-01', '2026-06-01']);
    expect(screen.getByRole('button', { name: 'Load more images' })).toBeVisible();
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
    await user.click(screen.getByRole('button', { name: 'Search latest images' }));
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
    await user.click(screen.getByRole('button', { name: 'Search latest images' }));

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
    await user.click(screen.getByRole('button', { name: 'Search latest images' }));

    expect(
      await screen.findByText(
        'Earth Search is rate limiting requests. Wait and try again.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Search latest images' })).toBeEnabled();
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
      });
    });
  });
});
