import { ThemeProvider } from '@mui/material';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import {
  SAVED_MARKER_SCHEMA_VERSION,
  type MarkerIconKey,
  type MarkerSort,
  type SavedMarker,
} from '@/domain/markers/savedMarker';
import {
  mapInteractionStore,
  requestMarkerCreationAt,
  resetMapInteractionStore,
} from '@/presentation/map/mapInteractionStore';
import {
  MarkersPanel,
  MarkerSortControl,
  MarkersWorkspaceProvider,
  useMarkersWorkspace,
} from '@/presentation/markers/MarkersWorkspace';
import { useUiStore } from '@/presentation/shell/uiStore';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { createTestServices } from '@test/helpers/createTestServices';

const viewport = {
  bounds: { west: 44, south: 41, east: 45, north: 42 },
  center: { longitude: 44.8, latitude: 41.7 },
};

let services: ReturnType<typeof createTestServices>;

function marker(
  id: string,
  name: string,
  createdAt: string,
  coordinate: readonly [number, number],
  colorKey: SavedMarker['colorKey'] = 'blue',
  iconKey: MarkerIconKey = 'place',
): SavedMarker {
  return {
    schemaVersion: SAVED_MARKER_SCHEMA_VERSION,
    id,
    name,
    normalizedName: name.toLocaleLowerCase('en'),
    coordinate,
    elevationMeters: null,
    iconKey,
    colorKey,
    createdAt,
    updatedAt: createdAt,
  };
}

function WeatherSettingsControl() {
  const { openWeatherSettings } = useMarkersWorkspace();
  return (
    <button type="button" onClick={openWeatherSettings}>
      Configure marker weather
    </button>
  );
}
function renderMarkers(onMarkerSortChange?: (sort: MarkerSort) => Promise<boolean>) {
  const saveSort =
    onMarkerSortChange ??
    ((sort: MarkerSort) => {
      useUiStore.getState().setMarkerSort(sort);
      return Promise.resolve(true);
    });
  return render(
    <RuntimeServicesProvider services={services}>
      <ThemeProvider theme={createAppTheme()}>
        <MarkersWorkspaceProvider>
          <MarkerSortControl onMarkerSortChange={saveSort} />
          <WeatherSettingsControl />
          <MarkersPanel />
        </MarkersWorkspaceProvider>
      </ThemeProvider>
    </RuntimeServicesProvider>,
  );
}

beforeEach(async () => {
  resetMapInteractionStore();
  services = createTestServices();
  await services.database.delete();
  services = createTestServices();
  services.mapViewport.update(viewport);
  useUiStore.setState({ markerSort: 'created' });
});

afterEach(async () => {
  services.database.close();
  await services.database.delete();
  vi.restoreAllMocks();
});

describe('MarkersWorkspace', () => {
  it('creates a named marker only after confirmation with the bounded catalog', async () => {
    const user = userEvent.setup();
    renderMarkers();
    await screen.findByText(/No saved markers yet/);

    act(() => {
      requestMarkerCreationAt({ longitude: 44.8, latitude: 41.7 }, 'Trailhead');
    });

    expect(await screen.findByRole('heading', { name: 'Create marker' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Marker name' })).toHaveValue(
      'Trailhead',
    );
    const iconButton = screen.getByRole('button', {
      name: 'Choose marker icon. Current: Place',
    });
    expect(iconButton.querySelector('svg')).toHaveAttribute('viewBox', '0 0 15 15');
    await user.click(iconButton);
    const categoryRows = screen.getAllByRole('tablist', {
      name: /Marker icon categories row/,
    });
    expect(categoryRows).toHaveLength(2);
    expect(
      within(
        screen.getByRole('tablist', { name: 'Marker icon categories row 1' }),
      ).getAllByRole('tab'),
    ).toHaveLength(4);
    expect(
      within(
        screen.getByRole('tablist', { name: 'Marker icon categories row 2' }),
      ).getAllByRole('tab'),
    ).toHaveLength(4);
    const categoryTabs = screen.getAllByRole('tab');
    expect(categoryTabs).toHaveLength(8);
    for (const tab of categoryTabs) expect(tab).toBeVisible();
    const placesStyle = getComputedStyle(screen.getByRole('tab', { name: 'Places' }));
    expect({
      backgroundColor: placesStyle.backgroundColor,
      color: placesStyle.color,
      whiteSpace: placesStyle.whiteSpace,
    }).toEqual({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      color: 'rgb(2, 48, 71)',
      whiteSpace: 'nowrap',
    });
    expect(
      getComputedStyle(screen.getByRole('tab', { name: 'Activities' })).color,
    ).toBe('rgb(84, 116, 129)');
    expect(screen.getByRole('option', { name: 'Choose Place icon' })).toBeVisible();
    expect(
      screen.queryByRole('option', { name: 'Choose Hiking icon' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Nature' }));
    for (const label of [
      'Telescope',
      'Moon',
      'Lake',
      'Viewpoint',
      'Waterfall',
      'Cave',
      'Cliff',
      'Valley',
      'Rock',
      'Bear',
      'Deer',
      'Bird',
      'Wildflowers',
      'Wetland',
    ]) {
      expect(
        screen.getByRole('option', { name: `Choose ${label} icon` }),
      ).toBeVisible();
    }
    await user.click(screen.getByRole('tab', { name: 'Activities' }));
    expect(screen.getByRole('option', { name: 'Choose Hiking icon' })).toBeVisible();
    await user.click(screen.getByRole('option', { name: 'Choose Hiking icon' }));
    expect(
      screen.getAllByRole('button', { name: /Choose .+ marker color/ }),
    ).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: 'Choose red marker color' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(async () => {
      await expect(services.database.listSavedMarkers()).resolves.toEqual([
        expect.objectContaining({
          name: 'Trailhead',
          normalizedName: 'trailhead',
          coordinate: [44.8, 41.7],
          iconKey: 'hiking',
          colorKey: 'red',
        }),
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Create marker' })).toBeNull();
    });
    await expect(services.database.loadRecentMarkerIconKeys()).resolves.toEqual([
      'hiking',
    ]);
  });

  it('shows the 21 persisted recently used icons in a three-row section', async () => {
    const recentIcons = [
      'flag',
      'forest',
      'water',
      'telescope',
      'moon',
      'lake',
      'viewpoint',
      'waterfall',
      'cave',
      'cliff',
      'valley',
      'rock',
      'bear',
      'deer',
      'bird',
      'wildflowers',
      'wetland',
      'hiking',
      'camping',
      'camera',
      'shelter',
    ] as const satisfies readonly MarkerIconKey[];
    await services.database.saveRecentMarkerIconKeys(recentIcons);
    await services.database.saveSavedMarker(
      marker('new-place', 'New place', '2026-07-20T00:00:00.000Z', [44.8, 41.7]),
    );
    const user = userEvent.setup();
    renderMarkers();
    await screen.findByRole('list', { name: 'Saved markers' });

    act(() => {
      requestMarkerCreationAt({ longitude: 44.8, latitude: 41.7 }, 'Recent icon');
    });
    await user.click(
      await screen.findByRole('button', {
        name: 'Choose marker icon. Current: Place',
      }),
    );

    expect(screen.getByRole('tab', { name: 'Recently used' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getAllByRole('option')).toHaveLength(21);
    expect(screen.getByRole('option', { name: 'Choose Shelter icon' })).toBeVisible();
    expect(
      screen.queryByRole('option', { name: 'Choose Place icon' }),
    ).not.toBeInTheDocument();
  });

  it('defers an early creation command until saved markers finish loading', async () => {
    act(() => {
      requestMarkerCreationAt({ longitude: 44.8, latitude: 41.7 }, 'Early marker');
    });

    renderMarkers();

    expect(await screen.findByRole('heading', { name: 'Create marker' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Marker name' })).toHaveValue(
      'Early marker',
    );
    expect(mapInteractionStore.getState().markerCreationCommand).toBeNull();
  });

  it('cancels an unconfirmed creation without writing a marker', async () => {
    const user = userEvent.setup();
    renderMarkers();
    await screen.findByText(/No saved markers yet/);

    act(() => {
      requestMarkerCreationAt({ longitude: 44.8, latitude: 41.7 });
    });
    await screen.findByRole('heading', { name: 'Create marker' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(services.database.listSavedMarkers()).resolves.toEqual([]);
  });

  it('sorts markers, navigates from rows, and keeps a failed sort save visible', async () => {
    await services.database.saveSavedMarker(
      marker('zulu', 'Zulu', '2026-07-18T00:00:00.000Z', [44.9, 41.8], 'red'),
    );
    await services.database.saveSavedMarker(
      marker('alpha', 'Alpha', '2026-07-20T00:00:00.000Z', [44.81, 41.7], 'blue'),
    );
    const user = userEvent.setup();
    renderMarkers((sort) => {
      useUiStore.getState().setMarkerSort(sort);
      return Promise.resolve(sort !== 'color');
    });

    const list = await screen.findByRole('list', { name: 'Saved markers' });
    const alphaRow = within(list).getByRole('button', { name: /^Alpha/ });
    const zuluRow = within(list).getByRole('button', { name: /^Zulu/ });
    expect(alphaRow.compareDocumentPosition(zuluRow)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await user.click(screen.getByRole('button', { name: /^Zulu/ }));
    expect(mapInteractionStore.getState().navigationCommand?.target).toEqual({
      longitude: 44.9,
      latitude: 41.8,
    });

    await user.click(
      screen.getByRole('button', { name: 'Sort markers. Current: Newest' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Name' }));
    expect(alphaRow.compareDocumentPosition(zuluRow)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await user.click(
      screen.getByRole('button', { name: 'Sort markers. Current: Name' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Icon color' }));
    expect(await screen.findByText('Sort preference could not be saved')).toBeVisible();
    expect(list).toHaveTextContent(/km away/);
  });

  it('groups markers by icon and orders each icon group by map distance', async () => {
    await services.database.saveSavedMarker(
      marker(
        'forest-far',
        'Forest far',
        '2026-07-20T00:00:00.000Z',
        [45.8, 41.7],
        'blue',
        'forest',
      ),
    );
    await services.database.saveSavedMarker(
      marker(
        'forest-near',
        'Forest near',
        '2026-07-18T00:00:00.000Z',
        [44.81, 41.7],
        'blue',
        'forest',
      ),
    );
    await services.database.saveSavedMarker(
      marker(
        'telescope-far',
        'Telescope far',
        '2026-07-19T00:00:00.000Z',
        [45.8, 41.7],
        'blue',
        'telescope',
      ),
    );
    await services.database.saveSavedMarker(
      marker(
        'telescope-near',
        'Telescope near',
        '2026-07-17T00:00:00.000Z',
        [44.81, 41.7],
        'blue',
        'telescope',
      ),
    );
    const user = userEvent.setup();
    renderMarkers();

    const list = await screen.findByRole('list', { name: 'Saved markers' });
    const forestNear = within(list).getByRole('button', { name: /^Forest near/ });
    const forestFar = within(list).getByRole('button', { name: /^Forest far/ });
    const telescopeNear = within(list).getByRole('button', { name: /^Telescope near/ });
    const telescopeFar = within(list).getByRole('button', { name: /^Telescope far/ });
    await user.click(
      screen.getByRole('button', { name: 'Sort markers. Current: Newest' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Icon and distance' }));

    await waitFor(() => {
      expect(forestNear.compareDocumentPosition(forestFar)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(forestFar.compareDocumentPosition(telescopeNear)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(telescopeNear.compareDocumentPosition(telescopeFar)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
  });

  it('sorts by the live map center after the viewport moves', async () => {
    await services.database.saveSavedMarker(
      marker('near', 'Near', '2026-07-18T00:00:00.000Z', [44.81, 41.7]),
    );
    await services.database.saveSavedMarker(
      marker('far', 'Far', '2026-07-20T00:00:00.000Z', [45.8, 41.7]),
    );
    const user = userEvent.setup();
    renderMarkers();

    const list = await screen.findByRole('list', { name: 'Saved markers' });
    const farRow = within(list).getByRole('button', { name: /^Far/ });
    const nearRow = within(list).getByRole('button', { name: /^Near/ });
    expect(farRow.compareDocumentPosition(nearRow)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await user.click(
      screen.getByRole('button', { name: 'Sort markers. Current: Newest' }),
    );
    await user.click(
      screen.getByRole('menuitem', { name: 'Distance from map center' }),
    );
    await waitFor(() => {
      expect(nearRow.compareDocumentPosition(farRow)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });

    act(() => {
      services.mapViewport.update({
        ...viewport,
        center: { longitude: 45.8, latitude: 41.7 },
      });
    });
    await waitFor(() => {
      expect(farRow.compareDocumentPosition(nearRow)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
  });

  it('renames, changes appearance, and confirms deletion through row actions', async () => {
    await services.database.saveSavedMarker(
      marker('alpha', 'Alpha', '2026-07-20T00:00:00.000Z', [44.8, 41.7]),
    );
    const user = userEvent.setup();
    renderMarkers();
    await screen.findByRole('button', { name: /^Alpha/ });

    const actionButton = screen.getByRole('button', {
      name: 'Marker actions for Alpha',
    });
    fireEvent.click(actionButton, { detail: 1 });
    expect(actionButton).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /Rename/ }));
    const renameInput = screen.getByRole('textbox', { name: 'Marker name' });
    await user.clear(renameInput);
    await user.type(renameInput, 'Base camp');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: /^Base camp/ })).toBeVisible();
    await expect(services.database.loadRecentMarkerIconKeys()).resolves.toEqual([]);

    fireEvent.click(
      screen.getByRole('button', { name: 'Marker actions for Base camp' }),
    );
    await user.click(screen.getByRole('menuitem', { name: /Change icon and color/ }));
    expect(
      await screen.findByRole('heading', { name: 'Marker appearance' }),
    ).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Choose marker icon. Current: Place' }),
    );
    await user.click(screen.getByRole('tab', { name: 'Activities' }));
    await user.click(screen.getByRole('option', { name: 'Choose Hiking icon' }));
    await user.click(screen.getByRole('button', { name: 'Choose teal marker color' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => {
      await expect(services.database.listSavedMarkers()).resolves.toEqual([
        expect.objectContaining({
          name: 'Base camp',
          iconKey: 'hiking',
          colorKey: 'teal',
        }),
      ]);
    });
    await expect(services.database.loadRecentMarkerIconKeys()).resolves.toEqual([
      'hiking',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Base camp' }));
    const confirmDelete = screen.getByRole('button', {
      name: 'Confirm deletion of Base camp',
    });
    fireEvent.click(confirmDelete);
    await screen.findByText(/No saved markers yet/);
  });

  it('persists weekday and map-display settings and can disable forecasts', async () => {
    const user = userEvent.setup();
    renderMarkers();
    await user.click(
      await screen.findByRole('button', { name: 'Configure marker weather' }),
    );

    expect(screen.getByRole('heading', { name: 'Marker weather' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sat' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Sun' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Sat' }));
    await user.click(screen.getByRole('button', { name: 'Mon' }));
    await user.click(screen.getByRole('switch', { name: 'Show forecasts on the map' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await expect(services.database.loadWeatherIntervalPreferences()).resolves.toEqual({
      weekdays: [0, 1],
      period: { kind: 'day' },
      showOnMap: false,
    });
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Marker weather' })).toBeNull();
    });

    await user.click(screen.getByRole('button', { name: 'Configure marker weather' }));
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Sun' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Clear forecast' }));
    await expect(services.database.loadWeatherIntervalPreferences()).resolves.toEqual({
      weekdays: [],
      period: { kind: 'day' },
      showOnMap: false,
    });
  });

  it('updates weekday weather without remounting marker rows or weather slots', async () => {
    await services.database.saveSavedMarker(
      marker('summit', 'Summit', '2026-07-20T00:00:00.000Z', [44.8271, 41.7151]),
    );
    useUiStore.setState({ activeTab: 'markers' });
    const user = userEvent.setup();
    const listSavedMarkers = vi.spyOn(services.savedMarkers, 'listSavedMarkers');
    const realExecute = services.pointWeatherForecast.execute.bind(
      services.pointWeatherForecast,
    );
    let executionCount = 0;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const execute = vi
      .spyOn(services.pointWeatherForecast, 'execute')
      .mockImplementation(async (input, signal) => {
        executionCount += 1;
        if (executionCount > 1) await refreshGate;
        return realExecute(input, signal);
      });
    renderMarkers();

    const saturday = await screen.findByRole('button', {
      name: 'Open Sat weather for Summit: 20 °C, 0 mm precipitation',
    });
    const list = screen.getByRole('list', { name: 'Saved markers' });
    const markerRow = within(list).getByRole('button', { name: /^Summit/ });
    const weatherSlot = saturday.closest('[data-marker-weather-anchor]');
    expect(weatherSlot).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Configure marker weather' }));
    await user.click(screen.getByRole('button', { name: 'Sat' }));
    await user.click(screen.getByRole('button', { name: 'Mon' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const loading = await screen.findByRole('status', {
      name: 'Loading weather for Summit',
    });
    expect(loading).toBe(weatherSlot);
    expect(screen.getByRole('list', { name: 'Saved markers' })).toBe(list);
    expect(within(list).getByRole('button', { name: /^Summit/ })).toBe(markerRow);
    expect(listSavedMarkers).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(2);
    });

    act(() => {
      releaseRefresh();
    });
    const sunday = await screen.findByRole('button', {
      name: /^Open Sun weather for Summit:/,
    });
    expect(sunday).toBeVisible();
    expect(
      screen.getByRole('group', { name: 'Marker forecast days' }),
    ).toHaveTextContent('Sun19 JulMon20 Jul');
  });

  it('shows marker interval weather, persists elevation, and opens Weather at the marker', async () => {
    const summit = marker(
      'summit',
      'Summit',
      '2026-07-20T00:00:00.000Z',
      [44.8271, 41.7151],
    );
    await services.database.saveSavedMarker(summit);
    useUiStore.setState({ activeTab: 'markers' });
    const user = userEvent.setup();
    renderMarkers();

    const saturday = await screen.findByRole('button', {
      name: 'Open Sat weather for Summit: 20 °C, 0 mm precipitation',
    });
    const sunday = screen.getByRole('button', {
      name: 'Open Sun weather for Summit: 20 °C, 0 mm precipitation',
    });
    const forecastDays = screen.getByRole('group', {
      name: 'Marker forecast days',
    });
    expect(within(forecastDays).getByText('Sat')).toBeVisible();
    expect(within(forecastDays).getByText('Sun')).toBeVisible();
    expect(within(forecastDays).getByText('18 Jul')).toBeVisible();
    expect(within(forecastDays).getByText('19 Jul')).toBeVisible();
    expect(within(saturday).queryByText('Sat')).toBeNull();
    expect(within(sunday).queryByText('Sun')).toBeNull();
    expect(saturday).toBeVisible();
    expect(sunday).toBeVisible();
    expect(saturday.compareDocumentPosition(sunday)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await waitFor(async () => {
      await expect(services.database.listSavedMarkers()).resolves.toEqual([
        expect.objectContaining({ id: 'summit', elevationMeters: 1_234 }),
      ]);
    });

    await user.click(saturday);
    const preview = await screen.findByRole('dialog', {
      name: '24-hour forecast · Day · Sat, 18 Jul',
    });
    expect(
      within(preview).getByRole('table', { name: 'Hourly forecast' }),
    ).toBeVisible();
    await user.click(within(preview).getByRole('button', { name: 'Open in Weather' }));

    expect(useUiStore.getState().activeTab).toBe('weather');
    expect(mapInteractionStore.getState().weatherForecastRequest).toMatchObject({
      coordinate: { longitude: 44.8271, latitude: 41.7151 },
      placeLabel: 'Summit',
      elevationMeters: 1_234,
    });
  });

  it('retains loaded marker forecasts across workspace navigation', async () => {
    await services.database.saveSavedMarker(
      marker('summit', 'Summit', '2026-07-20T00:00:00.000Z', [44.8271, 41.7151]),
    );
    useUiStore.setState({ activeTab: 'markers' });
    const execute = vi.spyOn(services.pointWeatherForecast, 'execute');
    renderMarkers();

    const saturdayForecast = await screen.findByRole('button', {
      name: 'Open Sat weather for Summit: 20 °C, 0 mm precipitation',
    });
    expect(saturdayForecast).toBeVisible();
    expect(execute).toHaveBeenCalledOnce();

    act(() => {
      useUiStore.getState().setActiveTab('tracks');
    });
    act(() => {
      useUiStore.getState().setActiveTab('markers');
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
      });
    });

    expect(saturdayForecast).toBeVisible();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('continues in-flight marker forecasts across workspace navigation', async () => {
    await services.database.saveSavedMarker(
      marker('summit', 'Summit', '2026-07-20T00:00:00.000Z', [44.8271, 41.7151]),
    );
    useUiStore.setState({ activeTab: 'markers' });
    const realExecute = services.pointWeatherForecast.execute.bind(
      services.pointWeatherForecast,
    );
    let releaseForecast!: () => void;
    const forecastGate = new Promise<void>((resolve) => {
      releaseForecast = resolve;
    });
    const execute = vi
      .spyOn(services.pointWeatherForecast, 'execute')
      .mockImplementation(async (input, signal) => {
        await forecastGate;
        return realExecute(input, signal);
      });
    renderMarkers();
    await waitFor(() => {
      expect(execute).toHaveBeenCalledOnce();
    });
    const loadingForecast = screen.getByRole('status', {
      name: 'Loading weather for Summit',
    });
    expect(within(loadingForecast).getAllByText('Loading')).toHaveLength(2);

    act(() => {
      useUiStore.getState().setActiveTab('tracks');
    });
    act(() => {
      useUiStore.getState().setActiveTab('markers');
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
      });
    });
    expect(execute).toHaveBeenCalledOnce();

    act(() => {
      releaseForecast();
    });
    expect(
      await screen.findByRole('button', {
        name: 'Open Sat weather for Summit: 20 °C, 0 mm precipitation',
      }),
    ).toBeVisible();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('does not restart sibling forecasts after saving marker elevation', async () => {
    await services.database.saveSavedMarker(
      marker('alpha', 'Alpha', '2026-07-20T00:00:00.000Z', [44.8, 41.7]),
    );
    await services.database.saveSavedMarker(
      marker('bravo', 'Bravo', '2026-07-19T00:00:00.000Z', [44.9, 41.8]),
    );
    useUiStore.setState({ activeTab: 'markers' });
    const realExecute = services.pointWeatherForecast.execute.bind(
      services.pointWeatherForecast,
    );
    let releaseBravo!: () => void;
    const bravoGate = new Promise<void>((resolve) => {
      releaseBravo = resolve;
    });
    const execute = vi
      .spyOn(services.pointWeatherForecast, 'execute')
      .mockImplementation(async (input, signal) => {
        if (input.coordinate.longitude === 44.9) await bravoGate;
        return realExecute(input, signal);
      });
    renderMarkers();

    expect(
      await screen.findByRole('button', {
        name: 'Open Sat weather for Alpha: 20 °C, 0 mm precipitation',
      }),
    ).toBeVisible();
    await waitFor(async () => {
      const markers = await services.database.listSavedMarkers();
      expect(markers.find(({ id }) => id === 'alpha')?.elevationMeters).toBe(1_234);
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
      });
    });
    expect(
      execute.mock.calls.filter(([input]) => input.coordinate.longitude === 44.9),
    ).toHaveLength(1);

    act(() => {
      releaseBravo();
    });
    expect(
      await screen.findByRole('button', {
        name: 'Open Sat weather for Bravo: 20 °C, 0 mm precipitation',
      }),
    ).toBeVisible();
  });
});
