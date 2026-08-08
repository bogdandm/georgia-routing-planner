import { ThemeProvider } from '@mui/material';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import {
  SAVED_MARKER_SCHEMA_VERSION,
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
): SavedMarker {
  return {
    schemaVersion: SAVED_MARKER_SCHEMA_VERSION,
    id,
    name,
    normalizedName: name.toLocaleLowerCase('en'),
    coordinate,
    iconKey: 'place',
    colorKey,
    createdAt,
    updatedAt: createdAt,
  };
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
    await user.click(
      screen.getByRole('button', { name: 'Choose marker icon. Current: Place' }),
    );
    expect(screen.getByRole('option', { name: 'Choose Hiking icon' })).toBeVisible();
    expect(screen.getAllByRole('option').length).toBeGreaterThanOrEqual(100);

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
    expect(
      screen.queryByRole('heading', { name: 'Create marker' }),
    ).not.toBeInTheDocument();
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
    expect(list).toHaveTextContent(/^Alpha/);
    await user.click(screen.getByRole('button', { name: /^Zulu/ }));
    expect(mapInteractionStore.getState().navigationCommand?.target).toEqual({
      longitude: 44.9,
      latitude: 41.8,
    });

    await user.click(
      screen.getByRole('button', { name: 'Sort markers. Current: Newest' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Name' }));
    expect(list).toHaveTextContent(/^Alpha/);
    await user.click(
      screen.getByRole('button', { name: 'Sort markers. Current: Name' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Icon color' }));
    expect(await screen.findByText('Sort preference could not be saved')).toBeVisible();
    expect(list).toHaveTextContent(/km away/);
  });

  it('renames, changes appearance, and confirms deletion through row actions', async () => {
    await services.database.saveSavedMarker(
      marker('alpha', 'Alpha', '2026-07-20T00:00:00.000Z', [44.8, 41.7]),
    );
    const user = userEvent.setup();
    renderMarkers();
    await screen.findByRole('button', { name: /^Alpha/ });

    fireEvent.click(screen.getByRole('button', { name: 'Marker actions for Alpha' }));
    await user.click(screen.getByRole('menuitem', { name: /Rename/ }));
    const renameInput = screen.getByRole('textbox', { name: 'Marker name' });
    await user.clear(renameInput);
    await user.type(renameInput, 'Base camp');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: /^Base camp/ })).toBeVisible();

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

    fireEvent.click(screen.getByRole('button', { name: 'Delete Base camp' }));
    const confirmDelete = screen.getByRole('button', {
      name: 'Confirm deletion of Base camp',
    });
    fireEvent.click(confirmDelete);
    await screen.findByText(/No saved markers yet/);
  });
});
