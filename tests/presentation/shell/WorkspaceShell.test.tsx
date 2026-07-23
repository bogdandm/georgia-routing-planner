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
  mapInteractionStore,
  resetMapInteractionStore,
  setSatelliteSearchAnchor,
} from '@/presentation/map/mapInteractionStore';
import { resetSatelliteRequestStatus } from '@/presentation/satellite-browser/satelliteRequestStatusStore';
import { OperationalStatus } from '@/presentation/shell/OperationalStatus';
import { useUiStore } from '@/presentation/shell/uiStore';
import { WorkspaceShell } from '@/presentation/shell/WorkspaceShell';
import { appColors } from '@/presentation/theme/appColors';
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

function gpxFile(name = 'Fixture track.gpx'): File {
  const xml = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Fixture trail</name><trkseg><trkpt lat="42" lon="44"><ele>1000</ele></trkpt><trkpt lat="42.01" lon="44.01"><ele>1120</ele></trkpt></trkseg></trk></gpx>`;
  const file = new File([xml], name, { type: 'application/gpx+xml' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(xml) });
  return file;
}

function gpxFileWithCompanionRoute(): File {
  const xml = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Detailed track</name><trkseg><trkpt lat="42" lon="44"><time>2026-07-13T08:00:00Z</time></trkpt><trkpt lat="42.01" lon="44.01"><time>2026-07-13T08:02:00Z</time></trkpt></trkseg></trk><rte><name>Companion route</name><rtept lat="42" lon="44"/><rtept lat="42.01" lon="44.01"/></rte></gpx>`;
  const file = new File([xml], 'Track and route.gpx', {
    type: 'application/gpx+xml',
  });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(xml) });
  return file;
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
    expect(
      link3d.compareDocumentPosition(includeSatellite) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
    expect(
      screen.queryByRole('button', { name: 'More satellite actions' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search images' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Settings', level: 3 })).toBeVisible();
    expect(screen.getByLabelText('Fake map')).toHaveTextContent('Local map ready');

    expect(screen.queryByRole('tab', { name: 'Plan' })).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole('tab')
        .map((tab) => tab.getAttribute('aria-label') ?? tab.textContent),
    ).toEqual(['Satellite', 'Layers', 'Markers', 'Tracks']);
    expect(screen.getByRole('tab', { name: 'Tracks' })).not.toHaveAttribute(
      'aria-disabled',
    );
    expect(screen.getByRole('tab', { name: 'Markers' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Markers' })).toHaveAttribute(
      'aria-description',
      'Saved markers are not available yet',
    );
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    expect(screen.getByRole('heading', { name: 'Tracks', level: 1 })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Browse GPX file' })).toBeEnabled();
    expect(screen.getByText('Drop GPX here')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Create GPX' }),
    ).not.toBeInTheDocument();
    await user.hover(screen.getByRole('tab', { name: 'Markers' }));
    expect(
      await screen.findByRole('tooltip', {
        name: 'Saved markers are not available yet',
      }),
    ).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Layers' }));
    expect(
      screen.queryByRole('heading', { name: 'Map visibility' }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('complementary', { name: 'Layers tools' })).getAllByRole(
        'separator',
      ),
    ).toHaveLength(3);
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
    ).toHaveStyle({ height: '40px' });
    const searchAreaSource = screen.getByRole('combobox', {
      name: 'Search area source',
    });
    expect(searchAreaSource).toHaveTextContent('Point');
    expect(searchAreaSource).toHaveTextContent('42.5000, 44.5000');
    const satelliteRender = screen.getByRole('combobox', {
      name: 'Satellite render',
    });
    expect(
      searchAreaSource.compareDocumentPosition(satelliteRender) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
  }, 10_000);

  it('imports, saves, closes, reopens, renames, and deletes a local GPX track', async () => {
    const user = userEvent.setup();
    vi.spyOn(services.database, 'loadLocalTrackContent').mockResolvedValue({
      schemaVersion: 1,
      trackId: 'local:test-1',
      originalGpx: gpxFile(),
      segments: [
        [
          [44, 42],
          [44.01, 42.01],
        ],
      ],
    });
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile());
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    const trackNameInput = screen.getByRole('textbox', { name: 'Track name' });
    expect(trackNameInput).toHaveValue('Fixture trail');
    expect(screen.getByText('Fixture track.gpx')).toBeVisible();
    expect(screen.queryByText('Recorded time')).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    const details = screen.getByRole('complementary', { name: 'Track details' });
    const elevationGain = within(details).getByLabelText('Elevation gain: 120 m');
    expect(elevationGain).toBeVisible();
    const elevationGainIcon = elevationGain.querySelector('svg');
    expect(elevationGainIcon).not.toBeNull();
    if (elevationGainIcon !== null) {
      await user.hover(elevationGainIcon);
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Elevation gain');
      await user.unhover(elevationGainIcon);
    }
    expect(
      within(details).queryByLabelText(/^Average speed:/u),
    ).not.toBeInTheDocument();
    expect(within(details).getByText('2 points · 1 segment')).toBeVisible();
    const discard = screen.getByRole('button', { name: 'Discard' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(
      discard.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(mapInteractionStore.getState().fitBoundsCommand).toMatchObject({
      bounds: { west: 44, south: 42, east: 44.01, north: 42.01 },
      padding: { top: 56, right: 56, bottom: 56, left: 840 },
    });
    const leaveEvent = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(leaveEvent)).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.getByText('1 saved track')).toBeVisible();
    });
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Saved tracks' })).getByLabelText(
        'Elevation gain: 120 m',
      ),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Selected track' })).toBeVisible();
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(
      true,
    );

    await user.click(screen.getByRole('button', { name: 'Close track' }));
    expect(
      screen.queryByRole('heading', { name: 'Selected track' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Fixture trail/ }));
    const nameInput = await screen.findByRole('textbox', { name: 'Track name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed trail');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(await screen.findByText('Renamed trail')).toBeVisible();

    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(screen.getByText('0 saved tracks')).toBeVisible();
    });
  }, 10_000);

  it('explains GPX validation warnings with their parser code and message', async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFileWithCompanionRoute());

    expect(await screen.findByText('track-preferred-over-route')).toBeVisible();
    expect(
      screen.getByText(
        /Detailed track geometry was used instead of companion route geometry\./u,
      ),
    ).toBeVisible();
    expect(screen.getByText('Track and route.gpx')).toBeVisible();
    expect(screen.getByLabelText(/^Average speed:/u)).toBeVisible();
  }, 10_000);

  it('keeps import errors inside the drop zone and dismisses them', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderWorkspaceShell();
      fireEvent.click(screen.getByRole('tab', { name: 'Tracks' }));
      const input = container.querySelector<HTMLInputElement>('input[type="file"]');
      expect(input).not.toBeNull();
      if (input === null) return;

      fireEvent.change(input, {
        target: { files: [new File(['not gpx'], 'notes.txt')] },
      });

      const importZone = screen.getByRole('region', { name: 'Import GPX file' });
      expect(within(importZone).getByRole('alert')).toHaveTextContent(
        'Choose a file with the .gpx extension.',
      );
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(within(importZone).queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('accepts a GPX drop only inside the import zone and exposes discard confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = renderWorkspaceShell();
    const workspace = container.firstElementChild;
    expect(workspace).not.toBeNull();
    if (workspace === null) return;
    const file = gpxFile('Dropped.gpx');

    fireEvent.drop(workspace, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(
      screen.queryByRole('heading', { name: 'New track' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Satellite imagery', level: 1 }),
    ).toBeVisible();

    await userEvent.click(screen.getByRole('tab', { name: 'Tracks' }));
    const importZone = screen.getByRole('region', { name: 'Import GPX file' });
    fireEvent.dragEnter(workspace, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(screen.getByText('Drop one GPX file to import')).toBeVisible();
    fireEvent.drop(workspace, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(
      screen.queryByRole('heading', { name: 'New track' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Drop GPX here')).toBeVisible();

    fireEvent.dragEnter(importZone, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(screen.getByText('Drop one GPX file to import')).toBeVisible();
    fireEvent.drop(importZone, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Tracks', level: 1 })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Close track' }));
    expect(confirm).toHaveBeenCalledWith('Discard this unsaved track?');
    expect(
      screen.queryByRole('heading', { name: 'New track' }),
    ).not.toBeInTheDocument();
  });

  it('offers calendar navigation tooltips, current-month return, and month-year selection', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    const previousMonth = screen.getByRole('button', {
      name: 'Previous acquisition month',
    });
    const nextMonth = screen.getByRole('button', { name: 'Next acquisition month' });
    const currentMonth = screen.getByRole('button', {
      name: 'Return to current acquisition month',
    });
    expect(currentMonth).toBeDisabled();

    await user.click(previousMonth);
    expect(screen.getByRole('grid', { name: 'June 2026' })).toBeVisible();
    expect(currentMonth).toBeEnabled();

    for (const [control, tooltip] of [
      [previousMonth, 'Previous month'],
      [nextMonth, 'Next month'],
      [currentMonth, 'Return to current month'],
    ] as const) {
      await user.hover(control);
      expect(await screen.findByRole('tooltip', { name: tooltip })).toBeVisible();
      await user.unhover(control);
    }

    await user.click(currentMonth);
    expect(screen.getByRole('grid', { name: 'July 2026' })).toBeVisible();

    const monthYearTrigger = screen.getByRole('button', {
      name: 'Choose acquisition month and year, July 2026',
    });
    expect(within(monthYearTrigger).getByTestId('KeyboardArrowDownIcon')).toBeVisible();
    await user.hover(monthYearTrigger);
    expect(
      await screen.findByRole('tooltip', { name: 'Choose month and year' }),
    ).toBeVisible();
    await user.unhover(monthYearTrigger);
    await user.click(monthYearTrigger);

    const acquisitionCalendar = screen.getByLabelText('Sentinel acquisition calendar');
    expect(
      within(acquisitionCalendar).queryByRole('group', {
        name: 'Choose acquisition month and year',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Choose acquisition month and year' }),
    ).toBeVisible();
    const yearSelect = screen.getByRole('combobox', { name: 'Acquisition year' });
    await user.click(yearSelect);
    await user.click(screen.getByRole('option', { name: '2025' }));
    expect(
      screen.getByRole('button', { name: 'Choose Jul 2025', pressed: true }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Choose Dec 2025' }));
    expect(screen.getByRole('grid', { name: 'December 2025' })).toBeVisible();

    await user.click(currentMonth);
    expect(screen.getByRole('grid', { name: 'July 2026' })).toBeVisible();

    await user.click(monthYearTrigger);
    expect(
      screen.getByRole('group', { name: 'Choose acquisition month and year' }),
    ).toBeVisible();
    await user.click(previousMonth);
    expect(
      screen.queryByRole('group', { name: 'Choose acquisition month and year' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'June 2026' })).toBeVisible();
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
    expect(
      screen.queryByRole('heading', { name: 'Map visibility' }),
    ).not.toBeInTheDocument();
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

  it('controls all imported tracks through one Layers visibility and opacity pair', async () => {
    const mapLayers = services.mapLayers;
    if (mapLayers === null) return;
    const setVisibility = vi
      .spyOn(mapLayers, 'setLayerVisibility')
      .mockReturnValue({ status: 'success' });
    const setOpacity = vi
      .spyOn(mapLayers, 'setImportedTrackOpacity')
      .mockReturnValue({ status: 'success' });
    renderWorkspaceShell();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Layers' }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Imported tracks' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Track opacity' }), {
      target: { value: '35' },
    });

    expect(setVisibility).toHaveBeenLastCalledWith('imported-tracks', false);
    expect(setOpacity).toHaveBeenLastCalledWith(0.35);
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

  it('shares and removes a selected applied scene with distinct actions', async () => {
    const restoredScene = syntheticSatelliteScene(
      'restored-scene',
      '2026-06-18T10:12:00.000Z',
    );
    const mapLayers = services.mapLayers;
    if (mapLayers === null) return;
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    services.mapViewport.update(testViewport);
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      camera: {
        longitude: 44.5,
        latitude: 42.5,
        zoom: 10,
        bearing: 0,
        pitch: 0,
      },
    });
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

    renderWorkspaceShell();

    expect(await screen.findByText('1 image · 1 acquisition day')).toBeVisible();
    const restoredCard = screen.getByRole('button', {
      name: 'Remove 18 Jun 2026 imagery from map',
    });
    expect(restoredCard).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.queryByRole('button', { name: 'Hide imagery' }),
    ).not.toBeInTheDocument();
    const productMetadata = screen.getByText('Product S2A_restored-scene');
    expect(productMetadata).toHaveStyle({ wordBreak: 'break-all' });

    await user.click(screen.getByRole('button', { name: 'Share link' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('scene=sentinel-2-l2a%3Arestored-scene'),
    );
    expect(await screen.findByText('Scene link copied')).toBeVisible();
    expect(clearScene).not.toHaveBeenCalled();

    await user.click(productMetadata);

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

  it('keeps calendar navigation responsive and skips superseded month loads', async () => {
    const requestedMonths: string[] = [];
    let resolveJune!: (result: SatelliteCatalogResult) => void;
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: {
        search: ({ criteria }) => {
          const month = criteria.startDate.slice(0, 7);
          requestedMonths.push(month);
          if (month === '2026-06') {
            return new Promise<SatelliteCatalogResult>((resolve) => {
              resolveJune = resolve;
            });
          }
          return Promise.resolve({ totalMatched: 0, scenes: [] });
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
    await user.click(screen.getByRole('button', { name: 'Search images' }));
    await waitFor(() => {
      expect(requestedMonths).toEqual(['2026-05']);
    });

    await user.click(screen.getByRole('button', { name: 'Next acquisition month' }));
    await waitFor(() => {
      expect(requestedMonths).toEqual(['2026-05', '2026-06']);
    });
    expect(screen.getByLabelText('Loading June 2026 imagery')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Next acquisition month' }),
    ).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Next acquisition month' }));
    expect(screen.getByRole('grid', { name: 'July 2026' })).toBeVisible();
    resolveJune({ totalMatched: 0, scenes: [] });
    await waitFor(() => {
      expect(requestedMonths).toEqual(['2026-05', '2026-06', '2026-07']);
    });
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
      screen.getByRole('checkbox', { name: 'Enable developer diagnostics' }),
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
      width: '52px',
      height: '52px',
      marginTop: '6px',
      marginLeft: '6px',
      flexShrink: '0',
    });
    expect(screen.getByTestId('project-logo-image')).toHaveAttribute(
      'src',
      '/favicon.png',
    );
    expect(screen.getByTestId('project-logo-image')).toHaveStyle({
      width: '52px',
      height: '52px',
    });
    await user.hover(projectLogo);
    expect(
      await screen.findByRole('tooltip', { name: 'Georgia Routing Planner' }),
    ).toBeVisible();
    await user.unhover(projectLogo);

    const collapseToggle = screen.getByTestId('navigation-collapse-toggle');
    expect(collapseToggle).toHaveStyle({
      width: '36px',
      height: '64px',
      top: '0px',
      right: '-35px',
      borderLeftWidth: '0px',
      borderBottomWidth: '1px',
      borderRadius: '0 8px 8px 0',
      backgroundColor: appColors.surface.subtle,
    });
    await user.click(projectLogo);

    const showNavigation = screen.getByRole('button', { name: 'Show navigation' });
    expect(navigation).toBeVisible();
    expect(navigation).toHaveStyle({ width: '64px' });
    expect(projectLogo).toHaveStyle({
      width: '52px',
      height: '52px',
      marginTop: '6px',
      marginLeft: '6px',
      borderRadius: '10px 0 0 10px',
      backgroundColor: appColors.brand.deepSpace,
    });
    expect(showNavigation).toBe(collapseToggle);
    expect(showNavigation).toHaveStyle({
      width: '88px',
      height: '52px',
      top: '6px',
      right: '-30px',
      borderWidth: '0px',
      borderRadius: '10px',
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
    expect(screen.getByRole('tab', { name: 'Storage' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Rendering' })).not.toBeInTheDocument();
    expect(
      within(settings).queryByRole('heading', { name: 'Sentinel imagery stretch' }),
    ).not.toBeInTheDocument();
    expect(
      within(settings).queryByRole('combobox', { name: 'Satellite render' }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('.MuiBackdrop-root')).not.toBeInTheDocument();

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
    await act(async () => {
      await services.mapLayers?.restorePersistedState();
    });

    await user.click(screen.getByRole('tab', { name: 'Layers' }));

    expect(
      screen.getByRole('heading', { name: 'AWS Open Data Terrain Tiles' }),
    ).toBeVisible();
    const isolines = screen.getByRole('checkbox', { name: 'Elevation isolines' });
    const contourDistance = screen.getByRole('slider', {
      name: 'Isolines distance',
    });
    expect(contourDistance).toHaveAttribute('aria-valuetext', '50 metres');
    expect(
      screen.queryByText(/labeled index contours remain every 200 m/u),
    ).not.toBeInTheDocument();
    const demFilter = screen.getByRole('checkbox', {
      name: 'Repair invalid DEM elevation pixels',
    });
    expect(demFilter).toBeChecked();
    expect(
      isolines.compareDocumentPosition(contourDistance) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      contourDistance.compareDocumentPosition(demFilter) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.change(contourDistance, { target: { value: '1' } });
    await waitFor(() => {
      expect(
        services.mapLayers?.getTerrainOverlayPreferences().contourIntervalMeters,
      ).toBe(25);
    });
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Repair invalid DEM elevation pixels',
      }),
    );
    await waitFor(() => {
      expect(services.mapLayers?.getTerrainOverlayPreferences()).toMatchObject({
        contourIntervalMeters: 25,
        filterInvalidDemPixels: false,
      });
    });
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Show relief shading above satellite imagery',
      }),
    );
    await waitFor(() => {
      expect(services.mapLayers?.getTerrainOverlayPreferences()).toMatchObject({
        contourIntervalMeters: 25,
        shadeAboveSatellite: true,
      });
    });

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

  it('persists the satellite rendering mode only from Satellite', async () => {
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
    expect(
      within(settings).queryByRole('combobox', { name: 'Satellite render' }),
    ).not.toBeInTheDocument();
    expect(
      within(settings).queryByRole('tab', { name: 'Rendering' }),
    ).not.toBeInTheDocument();
    await waitFor(async () => {
      await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
        satelliteRenderingMode: 'server',
      });
    });
  });

  it('persists Sentinel stretch controls from Satellite', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));

    const stretchDisclosure = screen.getByRole('button', {
      name: 'Sentinel imagery stretch',
    });
    expect(stretchDisclosure).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('slider', { name: 'Sentinel reflectance ceiling' }),
    ).not.toBeInTheDocument();
    await user.click(stretchDisclosure);
    expect(stretchDisclosure).toHaveAttribute('aria-expanded', 'true');
    const ceiling = screen.getByRole('slider', {
      name: 'Sentinel reflectance ceiling',
    });
    expect(ceiling).toBeVisible();
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
  });

  it('shows compatibility mode only while terrain compute uses the inline backend', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Layers' }));

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
