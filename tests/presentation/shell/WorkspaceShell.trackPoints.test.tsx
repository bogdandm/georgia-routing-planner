import {
  act,
  screen,
  waitFor,
  within,
  userEvent,
  describe,
  expect,
  it,
  vi,
  MapWorkspace,
  useUiStore,
  FakeMapFacade,
  services,
  setupWorkspaceShellTest,
  renderWorkspaceShell,
  savedTrackSummary,
} from '@test/helpers/workspaceShellTestSupport';

import { LOCAL_TRACK_SCHEMA_VERSION } from '@/domain/tracks/localTrack';

const points = [
  { coordinate: [44, 42] as const, elevationMeters: 1_000 },
  { coordinate: [44.01, 42.01] as const, elevationMeters: 1_100 },
  { coordinate: [44.02, 42.02] as const, elevationMeters: 1_200 },
  { coordinate: [44.03, 42.03] as const, elevationMeters: 1_150 },
];

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
    renderWorkspaceShell(
      <MapWorkspace facade={facade} mapCanvas={<div>Track editing map</div>} />,
    );
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
    act(() => {
      facade.emitTrackPointClick({
        coordinate: { longitude: 44.01, latitude: 42.01 },
        toleranceMeters: 50,
        shiftKey: true,
      });
    });
    expect(await within(details).findByText('2 points selected')).toBeVisible();
    await user.click(within(details).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(within(details).getByRole('button', { name: 'Save' })).toBeEnabled();
    });
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
});
