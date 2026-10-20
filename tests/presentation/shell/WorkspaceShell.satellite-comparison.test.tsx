import type { UserEvent } from '@testing-library/user-event';
import { vi } from 'vitest';

import type { SatelliteCompareMapsProps } from '@/presentation/map/SatelliteCompareMaps';
import {
  describe,
  expect,
  it,
  screen,
  userEvent,
  within,
  mapInteractionStore,
  createTestServices,
  services,
  setServices,
  setupWorkspaceShellTest,
  renderWorkspaceShell,
  testViewport,
  catalogGatewayReturning,
  syntheticSatelliteScene,
  mockViewportWidth,
  type SatelliteScene,
} from '@test/helpers/workspaceShellTestSupport';

// The grid needs WebGL; the shell only decides when and with which scenes it shows.
vi.mock('@/presentation/map/SatelliteCompareMaps', () => ({
  SatelliteCompareMaps: ({ scenes }: SatelliteCompareMapsProps) => (
    <ol aria-label="Comparison grid">
      {scenes.map((scene) => (
        <li key={scene.id}>{scene.id}</li>
      ))}
    </ol>
  ),
}));

function renderableScene(id: string, acquiredAt: string): SatelliteScene {
  return {
    ...syntheticSatelliteScene(id, acquiredAt),
    visualAsset: {
      kind: 'sentinel-l2a',
      itemHref: `https://stac.example/items/${id}`,
      visualHref: `https://sentinel.example/${id}/visual.tif`,
      mediaType: 'image/tiff; application=geotiff; profile=cloud-optimized',
      projectionEpsg: 32_638,
    },
  };
}

async function showResults({ smartphone = false } = {}): Promise<UserEvent> {
  if (smartphone) mockViewportWidth(899);
  services.database.close();
  await services.database.delete();
  setServices(
    createTestServices({
      satelliteCatalogGateway: catalogGatewayReturning({
        totalMatched: 2,
        scenes: [
          renderableScene('late-scene', '2026-07-20T10:12:00.000Z'),
          renderableScene('early-scene', '2026-07-02T10:12:00.000Z'),
        ],
      }),
    }),
  );
  services.mapViewport.update(testViewport);
  const user = userEvent.setup();
  renderWorkspaceShell();
  if (smartphone) {
    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
  }
  await user.click(screen.getByRole('button', { name: 'Search images' }));
  await screen.findByRole('heading', { name: 'Images near 42.5000, 44.5000' });
  return user;
}

async function addToComparison(user: UserEvent, day: string) {
  await user.click(screen.getByRole('button', { name: `Apply ${day} imagery` }));
  await user.click(screen.getByRole('button', { name: 'Compare', pressed: false }));
}

async function openGrid(user: UserEvent) {
  await addToComparison(user, 'Jul 20, 2026');
  await addToComparison(user, 'Jul 2, 2026');
  await user.click(
    within(screen.getByRole('region', { name: 'Image comparison' })).getByRole(
      'button',
      { name: 'Compare' },
    ),
  );
}

describe('WorkspaceShell satellite comparison', () => {
  setupWorkspaceShellTest();

  it('collects scenes from cards and opens them chronologically in place of the map', async () => {
    const user = await showResults();

    await addToComparison(user, 'Jul 20, 2026');
    const tray = screen.getByRole('region', { name: 'Image comparison' });
    expect(within(tray).getByText('Comparison: 1 of 4')).toBeVisible();
    expect(within(tray).getByRole('button', { name: 'Compare' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Compared', pressed: true }),
    ).toBeVisible();

    await addToComparison(user, 'Jul 2, 2026');
    expect(within(tray).getByText('Comparison: 2 of 4')).toBeVisible();
    await user.click(within(tray).getByRole('button', { name: 'Compare' }));

    const grid = screen.getByRole('list', { name: 'Comparison grid' });
    expect(
      within(grid)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['early-scene', 'late-scene']);
    expect(screen.getByRole('heading', { name: 'Comparing 2 images' })).toBeVisible();
    expect(screen.getByLabelText('Fake map')).not.toBeVisible();
    expect(
      screen.queryByRole('complementary', { name: 'Sentinel imagery results' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mosaic' })).not.toBeInTheDocument();
  });

  it('returns to the results and the compared area when the grid closes', async () => {
    const user = await showResults();
    await openGrid(user);
    expect(screen.getByRole('list', { name: 'Comparison grid' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Back to search' }));

    expect(
      screen.queryByRole('list', { name: 'Comparison grid' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Fake map')).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Images near 42.5000, 44.5000' }),
    ).toBeVisible();
    expect(screen.getByText('Comparison: 2 of 4')).toBeVisible();
    expect(mapInteractionStore.getState().navigationCommand?.target).toMatchObject({
      longitude: expect.any(Number) as number,
      latitude: expect.any(Number) as number,
      zoom: expect.any(Number) as number,
    });
  });

  it('closes the grid when a removal leaves one scene', async () => {
    const user = await showResults();
    await openGrid(user);

    await user.click(
      screen.getByRole('button', { name: 'Remove Jul 2, 2026 from comparison' }),
    );

    expect(
      screen.queryByRole('list', { name: 'Comparison grid' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Comparison: 1 of 4')).toBeVisible();
  });

  it('copies a comparison link with the compared scenes in order', async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    const user = await showResults();
    await openGrid(user);

    await user.click(screen.getByRole('button', { name: 'Share link' }));

    expect(await screen.findByText('Comparison link copied')).toBeVisible();
    const url = new URL(String(writeText.mock.calls[0]?.[0]));
    expect(url.searchParams.get('compare')).toBe(
      'sentinel-2-l2a:early-scene,sentinel-2-l2a:late-scene',
    );
    expect(url.hash).toBe('#satellite');
  });

  it('offers no comparison on smartphones', async () => {
    const user = await showResults({ smartphone: true });

    await user.click(
      screen.getByRole('button', { name: 'Apply Jul 20, 2026 imagery' }),
    );

    expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument();
  });
});
