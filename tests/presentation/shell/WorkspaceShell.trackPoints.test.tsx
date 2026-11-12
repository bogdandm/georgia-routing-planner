import { vi } from 'vitest';
import {
  fireEvent,
  act,
  screen,
  waitFor,
  within,
  userEvent,
  describe,
  expect,
  it,
  MapWorkspace,
  useUiStore,
  FakeMapFacade,
  services,
  setupWorkspaceShellTest,
  renderWorkspaceShell,
  savedTrackSummary,
  type ReactNode,
} from '@test/helpers/workspaceShellTestSupport';

import { LOCAL_TRACK_SCHEMA_VERSION } from '@/domain/tracks/localTrack';

const points = [
  { coordinate: [44, 42] as const, elevationMeters: 1_000 },
  { coordinate: [44.01, 42.01] as const, elevationMeters: 1_100 },
  { coordinate: [44.02, 42.02] as const, elevationMeters: 1_200 },
  { coordinate: [44.03, 42.03] as const, elevationMeters: 1_150 },
];

vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: { readonly children?: ReactNode }) => (
    <div aria-label="Track editing map">{children}</div>
  ),
  Marker: ({
    children,
    longitude,
    latitude,
  }: {
    readonly children?: ReactNode;
    readonly longitude: number;
    readonly latitude: number;
  }) => (
    <div data-longitude={longitude} data-latitude={latitude}>
      {children}
    </div>
  ),
  GeolocateControl: () => null,
  NavigationControl: () => null,
  useControl: (createControl: () => unknown) => createControl(),
}));

describe('WorkspaceShell track points', () => {
  setupWorkspaceShellTest();

  it('selects points from the map while editing and saves the edited geometry in place', async () => {
    const summary = {
      ...savedTrackSummary('local:points', 'Points trail'),
      pointCount: 4,
    };
    await services.database.saveLocalTrack(summary, {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: summary.id,
      trackPoints: [points],
      markers: [],
    });
    const { mapLayers } = services;
    if (mapLayers === null) throw new Error('Expected map layer services.');
    const setTrackPointSelection = vi.spyOn(mapLayers, 'setTrackPointSelection');
    const replaceGeometry = vi.spyOn(services.database, 'replaceLocalTrackGeometry');
    useUiStore.setState({ activeTab: 'tracks' });
    const facade = new FakeMapFacade();
    const user = userEvent.setup();
    renderWorkspaceShell(<MapWorkspace facade={facade} />);
    await user.click(await screen.findByRole('button', { name: /^Points trail/u }));
    const details = await screen.findByRole('complementary', { name: 'Track details' });

    await user.click(within(details).getByRole('button', { name: 'Points' }));
    await user.click(within(details).getByRole('button', { name: /^Point 2,/u }));
    expect(setTrackPointSelection).toHaveBeenLastCalledWith({
      lines: [],
      points: [points[1]?.coordinate],
    });

    await user.click(within(details).getByRole('button', { name: 'Edit points' }));
    expect(within(details).queryByText(/^Markers/u)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(facade.interactionModes.at(-1)).toBe('track-editing');
    });

    // A click a few metres from the third point selects it instead of opening details.
    act(() => {
      facade.emitTrackPointClick({
        coordinate: { longitude: 44.0201, latitude: 42.0201 },
        toleranceMeters: 50,
        shiftKey: false,
      });
    });
    await waitFor(() => {
      expect(
        within(details).getByRole('button', { name: /^Point 3,/u }),
      ).toHaveAttribute('aria-pressed', 'true');
    });
    expect(
      screen.getAllByRole('button', { name: 'Delete selected points' }),
    ).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(details).getByRole('button', { name: /^Point 3,/u })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(
      screen.queryByRole('button', { name: 'Delete selected points' }),
    ).not.toBeInTheDocument();
    act(() => {
      facade.emitTrackPointClick({
        coordinate: { longitude: 44.02, latitude: 42.02 },
        toleranceMeters: 50,
        shiftKey: false,
      });
    });
    act(() => {
      facade.emitTrackPointClick({
        coordinate: { longitude: 44.01, latitude: 42.01 },
        toleranceMeters: 50,
        shiftKey: true,
      });
    });
    expect(await within(details).findByText('2 points selected')).toBeVisible();
    expect(
      screen.getAllByRole('button', { name: 'Delete selected points' }),
    ).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Delete selected points' }));
    await waitFor(() => {
      expect(within(details).getByRole('button', { name: 'Save' })).toBeEnabled();
    });
    // The two points that now meet stay selected, so the joined leg is easy to find.
    expect(within(details).getByRole('button', { name: /^Point 1,/u })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(details).getByRole('button', { name: /^Point 2,/u })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(details).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(replaceGeometry).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(
        within(details).getByRole('button', { name: 'Edit points' }),
      ).toBeVisible();
    });
    const content = await services.database.loadLocalTrackContent(summary.id);
    expect(content.trackPoints[0]?.map((point) => point.coordinate)).toEqual([
      points[0]?.coordinate,
      points[3]?.coordinate,
    ]);
  }, 30_000);

  it('previews drags without saving them, commits bends once, and deletes the shared selection with Delete', async () => {
    const summary = {
      ...savedTrackSummary('local:drag-points', 'Draggable trail'),
      pointCount: 4,
    };
    await services.database.saveLocalTrack(summary, {
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: summary.id,
      trackPoints: [points],
      markers: [],
    });
    useUiStore.setState({ activeTab: 'tracks' });
    const facade = new FakeMapFacade();
    const user = userEvent.setup();
    renderWorkspaceShell(<MapWorkspace facade={facade} />);
    await user.click(await screen.findByRole('button', { name: /^Draggable trail/u }));
    const details = await screen.findByRole('complementary', { name: 'Track details' });
    await user.click(within(details).getByRole('button', { name: 'Points' }));
    await user.click(within(details).getByRole('button', { name: 'Edit points' }));
    await waitFor(() => {
      expect(facade.trackPointDragHandlers).not.toBeNull();
    });
    const handlers = facade.trackPointDragHandlers;
    if (handlers === null) throw new Error('Expected track drag handlers.');
    const project = ([longitude, latitude]: readonly [number, number]) => ({
      x: longitude * 10_000,
      y: latitude * 10_000,
    });
    act(() => {
      expect(
        handlers.start({
          pointer: project([44.01, 42.01]),
          project,
        }),
      ).toBe(true);
      handlers.move({ longitude: 44.012, latitude: 42.014 });
    });
    expect(within(details).getByRole('button', { name: 'Save' })).toBeDisabled();
    // Canceling a preview neither changes the point nor adds an undo step.
    act(() => {
      handlers.end(null);
    });
    expect(within(details).getByRole('button', { name: 'Undo' })).toBeDisabled();
    act(() => {
      handlers.start({
        pointer: project([44.01, 42.01]),
        project,
      });
      handlers.move({ longitude: 44.012, latitude: 42.014 });
      handlers.end({ longitude: 44.012, latitude: 42.014 });
    });
    await waitFor(() => {
      expect(within(details).getByRole('button', { name: 'Save' })).toBeEnabled();
    });
    // One undo returns to the unedited track, not an intermediate drag frame.
    await user.click(within(details).getByRole('button', { name: 'Undo' }));
    expect(within(details).getByRole('button', { name: 'Save' })).toBeDisabled();
    act(() => {
      const current = facade.trackPointDragHandlers;
      if (current === null) throw new Error('Expected track drag handlers.');
      expect(
        current.start({
          pointer: project([44.005, 42.005]),
          project,
        }),
      ).toBe(true);
      current.move({ longitude: 44.004, latitude: 42.008 });
      current.end({ longitude: 44.004, latitude: 42.008 });
    });
    await waitFor(() => {
      expect(within(details).getByRole('button', { name: /^Point 5,/u })).toBeVisible();
    });
    await user.click(within(details).getByRole('button', { name: /^Point 4,/u }));
    const search = screen.getByRole('textbox', {
      name: 'Search places or coordinates',
    });
    fireEvent.keyDown(search, { key: 'Delete' });
    expect(within(details).getByRole('button', { name: /^Point 5,/u })).toBeVisible();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(
      within(details).queryByRole('button', { name: /^Point 5,/u }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(within(details).getByRole('button', { name: 'Save' })).toBeEnabled();
    });
    await user.click(within(details).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(
        within(details).getByRole('button', { name: 'Edit points' }),
      ).toBeVisible();
    });
    const content = await services.database.loadLocalTrackContent(summary.id);
    expect(content.trackPoints[0]?.map((point) => point.coordinate)).toEqual([
      points[0]?.coordinate,
      [44.004, 42.008],
      points[1]?.coordinate,
      points[3]?.coordinate,
    ]);
  }, 30_000);
});
