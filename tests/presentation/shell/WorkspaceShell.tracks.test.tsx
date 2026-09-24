import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
  userEvent,
  describe,
  expect,
  it,
  vi,
  SAVED_MARKER_SCHEMA_VERSION,
  LOCAL_TRACK_SCHEMA_VERSION,
  MapWorkspace,
  completeMarkerPlacement,
  mapInteractionStore,
  requestWeatherForecast,
  useUiStore,
  appColors,
  FakeMapFacade,
  createTestServices,
  services,
  setServices,
  setupWorkspaceShellTest,
  renderWorkspaceShell,
  savedTrackSummary,
  savedTrackContent,
  testViewport,
  savedTrackNames,
  catalogGatewayReturning,
  syntheticSatelliteScene,
  gpxFile,
  elevationFreeGpxFile,
  gpxFileWithGradeBands,
  flatGpxFile,
  deferred,
  readBlob,
  requiredBlob,
  mockViewportWidth,
  TestResizeObserver,
  type ElevationCoordinate,
  type ElevationProvider,
  type ElevationSample,
  type ElevationSamplingProgressListener,
  type TrailRouter,
  type TrailRouteResult,
  type LocalTrackSummary,
} from '@test/helpers/workspaceShellTestSupport';

describe('WorkspaceShell', () => {
  setupWorkspaceShellTest();

  it('sorts saved tracks within favorite groups and persists the selected order', async () => {
    const summaries = [
      savedTrackSummary('local:zulu', 'Zulu', {
        savedAt: '2026-07-18T00:00:00.000Z',
        favorite: true,
        center: [44.9, 41.7],
      }),
      savedTrackSummary('local:alpha', 'Alpha', {
        savedAt: '2026-07-19T00:00:00.000Z',
        favorite: true,
        center: [45.8, 41.7],
      }),
      savedTrackSummary('local:mike', 'Mike', {
        savedAt: '2026-07-20T00:00:00.000Z',
        favorite: true,
        center: [44.81, 41.7],
      }),
      savedTrackSummary('local:yankee', 'Yankee', {
        savedAt: '2026-07-18T00:00:00.000Z',
        center: [44.9, 41.7],
      }),
      savedTrackSummary('local:bravo', 'Bravo', {
        savedAt: '2026-07-19T00:00:00.000Z',
        center: [45.8, 41.7],
      }),
      savedTrackSummary('local:november', 'November', {
        savedAt: '2026-07-20T00:00:00.000Z',
        center: [44.81, 41.7],
      }),
    ];
    await Promise.all(
      summaries.map(async (summary) => {
        await services.database.saveLocalTrack(summary, savedTrackContent(summary.id));
      }),
    );
    services.mapViewport.update({
      bounds: { west: 44.7, south: 41.6, east: 45.9, north: 41.8 },
      center: { longitude: 44.8, latitude: 41.7 },
    });
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Tracks' }));

    const sortButton = await screen.findByRole('button', {
      name: 'Sort tracks. Current: Newest',
    });
    expect(savedTrackNames()).toEqual([
      'Mike',
      'Alpha',
      'Zulu',
      'November',
      'Bravo',
      'Yankee',
    ]);
    await user.click(sortButton);
    const sortMenu = await screen.findByRole('menu');
    expect(
      within(sortMenu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Newest', 'Name', 'Oldest', 'Distance from map center']);
    expect(within(sortMenu).getByRole('menuitem', { name: 'Newest' })).toHaveClass(
      'Mui-selected',
    );

    await user.click(within(sortMenu).getByRole('menuitem', { name: 'Name' }));
    await waitFor(() => {
      expect(savedTrackNames()).toEqual([
        'Alpha',
        'Mike',
        'Zulu',
        'Bravo',
        'November',
        'Yankee',
      ]);
    });

    await user.click(
      screen.getByRole('button', { name: 'Sort tracks. Current: Name' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Oldest' }));
    await waitFor(() => {
      expect(savedTrackNames()).toEqual([
        'Zulu',
        'Alpha',
        'Mike',
        'Yankee',
        'Bravo',
        'November',
      ]);
    });

    await user.click(
      screen.getByRole('button', { name: 'Sort tracks. Current: Oldest' }),
    );
    await user.click(
      screen.getByRole('menuitem', { name: 'Distance from map center' }),
    );
    await waitFor(() => {
      expect(savedTrackNames()).toEqual([
        'Mike',
        'Zulu',
        'Alpha',
        'November',
        'Yankee',
        'Bravo',
      ]);
    });
  });

  it('falls back to newest tracks and reacts to live map-center updates', async () => {
    const west = savedTrackSummary('local:west', 'West', {
      savedAt: '2026-07-18T00:00:00.000Z',
      center: [44.81, 41.7],
    });
    const east = savedTrackSummary('local:east', 'East', {
      savedAt: '2026-07-20T00:00:00.000Z',
      center: [45.79, 41.7],
    });
    await services.database.saveLocalTrack(west, savedTrackContent(west.id));
    await services.database.saveLocalTrack(east, savedTrackContent(east.id));
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    await user.click(
      await screen.findByRole('button', { name: 'Sort tracks. Current: Newest' }),
    );
    await user.click(
      screen.getByRole('menuitem', { name: 'Distance from map center' }),
    );
    await waitFor(() => {
      expect(savedTrackNames()).toEqual(['East', 'West']);
    });

    act(() => {
      services.mapViewport.update({
        bounds: { west: 44.7, south: 41.6, east: 45.9, north: 41.8 },
        center: { longitude: 44.8, latitude: 41.7 },
      });
    });
    await waitFor(() => {
      expect(savedTrackNames()).toEqual(['West', 'East']);
    });

    act(() => {
      services.mapViewport.update({
        bounds: { west: 44.7, south: 41.6, east: 45.9, north: 41.8 },
        center: { longitude: 45.8, latitude: 41.7 },
      });
    });
    await waitFor(() => {
      expect(savedTrackNames()).toEqual(['East', 'West']);
    });
  });

  it('keeps the selected track order when saving its preference fails', async () => {
    const zulu = savedTrackSummary('local:zulu', 'Zulu', {
      savedAt: '2026-07-20T00:00:00.000Z',
    });
    const alpha = savedTrackSummary('local:alpha', 'Alpha', {
      savedAt: '2026-07-18T00:00:00.000Z',
    });
    await services.database.saveLocalTrack(zulu, savedTrackContent(zulu.id));
    await services.database.saveLocalTrack(alpha, savedTrackContent(alpha.id));
    vi.spyOn(services.database, 'saveUiPreferences').mockRejectedValueOnce(
      new Error('write unavailable'),
    );
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    await user.click(
      await screen.findByRole('button', { name: 'Sort tracks. Current: Newest' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Name' }));

    await waitFor(() => {
      expect(useUiStore.getState().trackSort).toBe('name');
      expect(savedTrackNames()).toEqual(['Alpha', 'Zulu']);
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(await screen.findByText('Sort preference could not be saved')).toBeVisible();
  });

  it('opens smartphone tools over the mounted map without persisting navigation state', async () => {
    mockViewportWidth(899);
    const user = userEvent.setup();
    const saveUiPreferences = vi.spyOn(services.database, 'saveUiPreferences');
    const { container } = renderWorkspaceShell();
    const map = screen.getByLabelText('Fake map');
    const openWorkspace = screen.getByRole('button', { name: 'Open workspace' });

    expect(openWorkspace).toHaveAttribute('aria-controls', 'mobile-workspace');
    expect(openWorkspace).toHaveAttribute('aria-expanded', 'false');
    expect(map).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Satellite imagery', level: 1 }),
    ).not.toBeInTheDocument();

    await user.click(openWorkspace);

    expect(openWorkspace).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('heading', { name: 'Satellite imagery', level: 1 }),
    ).toBeVisible();
    expect(
      screen
        .getByRole('button', { name: 'Show map' })
        .querySelector('[data-testid="ChevronLeftOutlinedIcon"]'),
    ).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show map' }));

    expect(screen.getByLabelText('Fake map')).toBe(map);
    expect(useUiStore.getState().navigationCollapsed).toBe(false);
    expect(saveUiPreferences).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
    expect(container.querySelector('#mobile-workspace')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
  it('keeps Weather active through the smartphone map-selection round trip', async () => {
    mockViewportWidth(899);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    await user.click(screen.getByRole('tab', { name: 'Weather' }));
    await user.click(screen.getByRole('button', { name: 'Select forecast point' }));
    expect(useUiStore.getState()).toMatchObject({
      activeTab: 'weather',
      mobileWorkspaceOpen: false,
    });
    expect(screen.getByLabelText('Fake map')).toBeVisible();
    expect(mapInteractionStore.getState().weatherPointSelectionActive).toBe(true);

    act(() => {
      requestWeatherForecast({ longitude: 44.8271, latitude: 41.7151 });
    });
    expect(mapInteractionStore.getState().weatherPointSelectionActive).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Open workspace' }));

    expect(screen.getByRole('heading', { name: 'Weather', level: 1 })).toBeVisible();
    const location = await screen.findByRole('button', {
      name: 'Center map on forecast location',
    });
    expect(within(location).getByText('41.71510, 44.82710')).toBeVisible();
    expect(within(location).getByText('1,234 m')).toBeVisible();
  });
  it('returns smartphone marker selection to the map', async () => {
    await services.database.saveSavedMarker({
      schemaVersion: SAVED_MARKER_SCHEMA_VERSION,
      id: 'mobile-marker',
      name: 'Mobile marker',
      normalizedName: 'mobile marker',
      coordinate: [44.9, 41.8],
      elevationMeters: null,
      iconKey: 'place',
      colorKey: 'blue',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    });
    useUiStore.setState({ activeTab: 'markers' });
    mockViewportWidth(899);
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(screen.getByRole('heading', { name: 'Markers', level: 1 })).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: 'Marker weather settings. Forecast days: Sat, Sun',
      }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'New marker' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Sort markers. Current: Newest' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show map' })).toBeVisible();
    await user.click(await screen.findByRole('button', { name: /^Mobile marker/ }));

    expect(mapInteractionStore.getState().navigationCommand?.target).toEqual({
      longitude: 44.9,
      latitude: 41.8,
    });
    expect(useUiStore.getState().mobileWorkspaceOpen).toBe(false);
    expect(container.querySelector('#mobile-workspace')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('returns smartphone track imports to a collapsible map disclosure', async () => {
    mockViewportWidth(899);
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm');
    const { container } = renderWorkspaceShell();
    const map = screen.getByLabelText('Fake map');

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(getComputedStyle(screen.getByRole('navigation')).borderRadius).toBe('0px');
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;
    await user.upload(input, gpxFile());

    const disclosure = await screen.findByRole('button', {
      name: 'Expand unsaved track details',
    });
    expect(screen.getByRole('textbox', { name: 'Track name' })).toHaveValue(
      'Fixture trail',
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(within(disclosure).getByLabelText('Distance: 1.4 km')).toBeVisible();
    expect(within(disclosure).getByLabelText('Elevation gain: 120 m')).toBeVisible();
    expect(within(disclosure).getByLabelText('Elevation loss: 0 m')).toBeVisible();
    expect(within(disclosure).getByTestId('compact-elevation-profile')).toBeVisible();
    expect(screen.getByLabelText('Fake map')).toBe(map);
    expect(
      screen.queryByRole('complementary', { name: 'Track details' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'New track' }),
    ).not.toBeInTheDocument();

    await user.click(disclosure);

    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    const collapse = within(details).getByRole('button', {
      name: 'Collapse track details',
    });
    const close = within(details).getByRole('button', { name: 'Close track' });
    expect(collapse).toBeVisible();
    expect(close).toBeVisible();

    await user.click(collapse);

    expect(confirm).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('complementary', { name: 'Track details' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand unsaved track details' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Fake map')).toBe(map);

    await user.click(
      screen.getByRole('button', { name: 'Expand unsaved track details' }),
    );
    confirm.mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Close track' }));
    expect(confirm).toHaveBeenCalledWith('Discard this unsaved track?');
    expect(screen.getByRole('complementary', { name: 'Track details' })).toBeVisible();

    confirm.mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Close track' }));
    expect(
      screen.queryByRole('complementary', { name: 'Track details' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Expand unsaved track details' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Fake map')).toBe(map);
  });

  it('saves a named preview from the smartphone disclosure', async () => {
    mockViewportWidth(899);
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;
    await user.upload(input, gpxFile());

    const nameInput = await screen.findByRole('textbox', { name: 'Track name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Mobile trail');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => {
      await expect(services.database.listLocalTracks()).resolves.toEqual([
        expect.objectContaining({ name: 'Mobile trail' }),
      ]);
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('textbox', { name: 'Track name' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    });
    const disclosure = screen.getByRole('button', {
      name: 'Expand track details',
    });
    expect(within(disclosure).getByLabelText('Distance: 1.4 km')).toBeVisible();
  });

  it('opens active saved track details from the smartphone track list', async () => {
    const summary = savedTrackSummary('local:mobile-active', 'Mobile active trail');
    await services.database.saveLocalTrack(summary, savedTrackContent(summary.id));
    await services.database.saveLatestOpenedTrackId(summary.id);
    useUiStore.setState({ activeTab: 'tracks' });
    mockViewportWidth(899);
    const user = userEvent.setup();
    const loadLocalTrackContent = vi.spyOn(services.database, 'loadLocalTrackContent');
    renderWorkspaceShell();

    await screen.findByRole(
      'button',
      { name: 'Expand track details' },
      { timeout: 5_000 },
    );
    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    loadLocalTrackContent.mockClear();
    await user.click(
      within(screen.getByRole('list', { name: 'Saved tracks' })).getByRole('button', {
        name: /^Mobile active trail/u,
      }),
    );

    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    expect(
      within(details).getByRole('heading', { name: 'Mobile active trail' }),
    ).toBeVisible();
    expect(loadLocalTrackContent).not.toHaveBeenCalled();
  });

  it('shows mobile track preparation in the collapsed disclosure until metrics are ready', async () => {
    mockViewportWidth(899);
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const pending = deferred<readonly ElevationSample[]>();
    vi.spyOn(provider, 'sampleMany').mockImplementation(() => pending.promise);
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Preparing.gpx'));

    const disclosure = await screen.findByRole('button', {
      name: 'Expand unsaved track details',
    });
    const status = within(disclosure).getByRole('status');
    expect(within(status).getByText('Preparing terrain and elevation…')).toBeVisible();
    expect(within(status).getByRole('progressbar')).toBeVisible();

    act(() => {
      pending.resolve([{ status: 'unavailable' }, { status: 'unavailable' }]);
    });

    await waitFor(() => {
      expect(within(disclosure).getByLabelText('Distance: 1.4 km')).toBeVisible();
    });
    expect(within(disclosure).getByLabelText('Elevation gain: 120 m')).toBeVisible();
    expect(within(disclosure).queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows route instructions and progress in the smartphone disclosure', async () => {
    mockViewportWidth(899);
    const A: [number, number] = [44.64, 42.66];
    const B: [number, number] = [44.65, 42.67];
    const C: [number, number] = [44.66, 42.68];
    const secondRoute = deferred<TrailRouteResult>();
    const secondElevation = deferred<readonly ElevationSample[]>();
    const secondElevationState: {
      coordinates: readonly ElevationCoordinate[];
      reportProgress: ElevationSamplingProgressListener | undefined;
    } = {
      coordinates: [],
      reportProgress: undefined,
    };
    const route = vi
      .fn<TrailRouter['route']>()
      .mockResolvedValueOnce({
        status: 'ready',
        geometry: { type: 'LineString', coordinates: [A, B] },
        networkDistanceMeters: 1_200,
        snappedStart: A,
        snappedDestination: B,
        loadedTileCount: 1,
        graphNodeCount: 2,
        graphEdgeCount: 1,
        expandedAreaRetryUsed: false,
      })
      .mockImplementationOnce(() => secondRoute.promise);
    const trailRouter: TrailRouter = { route, dispose: vi.fn() };
    const sampleMany = vi
      .fn<ElevationProvider['sampleMany']>()
      .mockImplementationOnce((coordinates) =>
        Promise.resolve(
          coordinates.map((_, index) => ({
            status: 'available' as const,
            meters: 1_000 + index * 100,
          })),
        ),
      )
      .mockImplementationOnce((coordinates, _signal, onProgress) => {
        secondElevationState.coordinates = coordinates;
        secondElevationState.reportProgress = onProgress;
        return secondElevation.promise;
      });
    const elevationProvider: ElevationProvider = {
      sample: vi.fn().mockResolvedValue({ status: 'unavailable' }),
      sampleMany,
    };
    setServices({
      ...createTestServices({ trailRouter }),
      elevationProvider,
    });
    const facade = new FakeMapFacade();
    const user = userEvent.setup();
    renderWorkspaceShell(
      <MapWorkspace facade={facade} mapCanvas={<div>Route planning map</div>} />,
    );

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    await user.click(screen.getByRole('button', { name: 'Plan route' }));

    const disclosure = await screen.findByRole('button', {
      name: 'Expand track details',
    });
    expect(
      within(disclosure).getByText(
        'Click the map to choose the route start and destination.',
      ),
    ).toBeVisible();
    expect(within(disclosure).queryByLabelText(/^Distance:/u)).not.toBeInTheDocument();
    expect(
      within(disclosure).queryByTestId('compact-elevation-profile'),
    ).not.toBeInTheDocument();

    act(() => {
      facade.emitPlanningClick({ longitude: A[0], latitude: A[1] });
    });
    expect(
      within(disclosure).getByText(
        'Click the map to choose the route start and destination.',
      ),
    ).toBeVisible();
    expect(within(disclosure).queryByLabelText(/^Distance:/u)).not.toBeInTheDocument();
    expect(
      within(disclosure).queryByTestId('compact-elevation-profile'),
    ).not.toBeInTheDocument();

    act(() => {
      facade.emitPlanningClick({ longitude: B[0], latitude: B[1] });
    });
    await waitFor(() => {
      expect(within(disclosure).getByLabelText(/^Distance:/u)).toBeVisible();
      expect(within(disclosure).getByTestId('compact-elevation-profile')).toBeVisible();
    });
    const firstDistance = within(disclosure)
      .getByLabelText(/^Distance:/u)
      .getAttribute('aria-label');
    expect(firstDistance).not.toBeNull();
    if (firstDistance === null) return;

    act(() => {
      facade.emitPlanningClick({ longitude: C[0], latitude: C[1] });
    });
    await waitFor(() => {
      expect(route).toHaveBeenCalledTimes(2);
    });
    const reportRouteProgress = route.mock.calls[1]?.[2];
    act(() => {
      reportRouteProgress?.({
        phase: 'loading-tiles',
        attempt: 1,
        loadedTileCount: 8,
        totalTileCount: 16,
        graphProgress: 0,
      });
    });
    const routeProgress = await within(disclosure).findByRole('progressbar', {
      name: 'Loading route tiles… 8/16',
    });
    expect(routeProgress).toHaveAttribute('aria-valuenow', '50');
    expect(within(disclosure).queryByLabelText(firstDistance)).not.toBeInTheDocument();
    expect(
      within(disclosure).queryByTestId('compact-elevation-profile'),
    ).not.toBeInTheDocument();

    act(() => {
      secondRoute.resolve({
        status: 'ready',
        geometry: { type: 'LineString', coordinates: [B, C] },
        networkDistanceMeters: 1_200,
        snappedStart: B,
        snappedDestination: C,
        loadedTileCount: 1,
        graphNodeCount: 2,
        graphEdgeCount: 1,
        expandedAreaRetryUsed: false,
      });
    });
    await waitFor(() => {
      expect(sampleMany).toHaveBeenCalledTimes(2);
      expect(secondElevationState.reportProgress).toBeDefined();
    });
    const elevationProgressReporter = secondElevationState.reportProgress;
    if (elevationProgressReporter === undefined)
      throw new Error('Expected elevation progress.');
    act(() => {
      elevationProgressReporter({
        completedTiles: 1,
        totalTiles: 2,
        indices: [],
        samples: [],
      });
    });
    const elevationProgress = await within(disclosure).findByRole('progressbar', {
      name: 'Loading elevation tiles: 1 of 2',
    });
    expect(elevationProgress).toHaveAttribute('aria-valuenow', '50');
    expect(within(disclosure).queryByLabelText(firstDistance)).not.toBeInTheDocument();
    expect(
      within(disclosure).queryByTestId('compact-elevation-profile'),
    ).not.toBeInTheDocument();

    act(() => {
      secondElevation.resolve(
        secondElevationState.coordinates.map((_, index) => ({
          status: 'available' as const,
          meters: 1_000 + index * 100,
        })),
      );
    });
    await waitFor(() => {
      expect(within(disclosure).queryByRole('progressbar')).not.toBeInTheDocument();
      expect(within(disclosure).getByLabelText(/^Distance:/u)).toBeVisible();
      expect(within(disclosure).getByTestId('compact-elevation-profile')).toBeVisible();
    });
  });

  it('overlays track details below 1900px and keeps them adjacent at 1900px and 1920px', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockViewportWidth(1899);
    let user = userEvent.setup();
    let rendered = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    let input =
      rendered.container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;
    await user.upload(input, gpxFile('Overlay track.gpx'));

    const overlayDetails = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    expect(
      within(overlayDetails).getByRole('button', { name: 'Back to tracks' }),
    ).toBeVisible();
    expect(screen.getByRole('navigation')).toBeVisible();
    expect(
      screen.queryByRole('complementary', { name: 'Tracks tools' }),
    ).not.toBeInTheDocument();
    await user.click(
      within(overlayDetails).getByRole('button', { name: 'Back to tracks' }),
    );
    expect(confirm).toHaveBeenCalledWith('Discard this unsaved track?');
    expect(screen.getByRole('region', { name: 'Import track file' })).toBeVisible();
    rendered.unmount();

    for (const width of [1900, 1920]) {
      mockViewportWidth(width);
      window.history.replaceState(null, '', '/#satellite');
      useUiStore.setState({ activeTab: 'satellite' });
      user = userEvent.setup();
      rendered = renderWorkspaceShell();
      await user.click(screen.getByRole('tab', { name: 'Tracks' }));
      input = rendered.container.querySelector<HTMLInputElement>('input[type="file"]');
      expect(input).not.toBeNull();
      if (input === null) return;
      await user.upload(input, gpxFile(`Adjacent ${String(width)}.gpx`));
      const adjacentDetails = await screen.findByRole('complementary', {
        name: 'Track details',
      });
      expect(
        within(adjacentDetails).getByRole('button', { name: 'Close track' }),
      ).toBeVisible();
      expect(screen.getByRole('complementary', { name: 'Tracks tools' })).toBeVisible();
      if (width === 1900) {
        await user.click(
          screen.getByRole('button', {
            name: 'Hide navigation from Trail Planner logo',
          }),
        );
        expect(adjacentDetails).not.toBeVisible();
        expect(
          screen.queryByRole('heading', { name: 'New track' }),
        ).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Show navigation' }));
        expect(adjacentDetails).toBeVisible();
      }
      await user.click(
        within(adjacentDetails).getByRole('button', { name: 'Close track' }),
      );
      rendered.unmount();
    }
  });

  it('overlays imagery results below 1900px and keeps them adjacent at 1900px', async () => {
    services.database.close();
    await services.database.delete();
    setServices(
      createTestServices({
        satelliteCatalogGateway: catalogGatewayReturning({
          totalMatched: 1,
          scenes: [
            syntheticSatelliteScene('responsive-scene', '2026-07-12T10:12:00.000Z'),
          ],
        }),
      }),
    );
    services.mapViewport.update(testViewport);
    mockViewportWidth(1899);
    let user = userEvent.setup();
    let rendered = renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Search images' }));
    const overlayResults = await screen.findByRole('complementary', {
      name: 'Sentinel imagery results',
    });
    expect(
      within(overlayResults).getByRole('button', {
        name: 'Back to satellite search',
      }),
    ).toBeVisible();
    expect(screen.getByRole('navigation')).toBeVisible();
    expect(
      screen.queryByRole('complementary', { name: 'Satellite imagery tools' }),
    ).not.toBeInTheDocument();
    await user.click(
      within(overlayResults).getByRole('button', {
        name: 'Back to satellite search',
      }),
    );
    expect(screen.getByRole('button', { name: 'Search images' })).toBeVisible();
    rendered.unmount();

    mockViewportWidth(1900);
    user = userEvent.setup();
    rendered = renderWorkspaceShell();
    await user.click(screen.getByRole('button', { name: 'Search images' }));
    const adjacentResults = await screen.findByRole('complementary', {
      name: 'Sentinel imagery results',
    });
    expect(
      within(adjacentResults).getByRole('button', {
        name: 'Close imagery results',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('complementary', { name: 'Satellite imagery tools' }),
    ).toBeVisible();
    await user.click(
      within(adjacentResults).getByRole('button', {
        name: 'Apply 12 Jul 2026 imagery',
      }),
    );
    expect(adjacentResults).toBeVisible();
    expect(
      screen.getByRole('complementary', { name: 'Satellite imagery tools' }),
    ).toBeVisible();
    rendered.unmount();
  });

  it('returns smartphone satellite scene selection to the map', async () => {
    services.database.close();
    await services.database.delete();
    setServices(
      createTestServices({
        satelliteCatalogGateway: catalogGatewayReturning({
          totalMatched: 1,
          scenes: [syntheticSatelliteScene('mobile-scene', '2026-07-09T10:12:00.000Z')],
        }),
      }),
    );
    services.mapViewport.update(testViewport);
    mockViewportWidth(899);
    const user = userEvent.setup();
    renderWorkspaceShell();
    const map = screen.getByLabelText('Fake map');

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    await user.click(screen.getByRole('button', { name: 'Search images' }));
    await user.click(
      await screen.findByRole('button', { name: 'Apply 9 Jul 2026 imagery' }),
    );

    expect(screen.getByLabelText('Fake map')).toBe(map);
    expect(useUiStore.getState().mobileWorkspaceOpen).toBe(false);
    expect(screen.getByRole('button', { name: 'Open workspace' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(
      screen.queryByRole('complementary', { name: 'Sentinel imagery results' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(
      screen.getByRole('complementary', { name: 'Sentinel imagery results' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Search images' }),
    ).not.toBeInTheDocument();
  });

  it('shows preparation progress and aborts on cancel and unmount', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const signals: AbortSignal[] = [];
    vi.spyOn(provider, 'sampleMany').mockImplementation(
      (_coordinates, signal, onProgress) => {
        signals.push(signal);
        onProgress?.({
          completedTiles: 0,
          totalTiles: 3,
          indices: [],
          samples: [],
        });
        onProgress?.({
          completedTiles: 1,
          totalTiles: 3,
          indices: [0],
          samples: [{ status: 'available', meters: 1_000 }],
        });
        return deferred<readonly ElevationSample[]>().promise;
      },
    );
    const user = userEvent.setup();
    const rendered = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input =
      rendered.container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Cancel.gpx'));
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    expect(
      within(screen.getByRole('complementary', { name: 'Track details' })).getByText(
        'Loading elevation tiles: 1 of 3',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('img', {
        name: 'Elevation profile loading: 1 of 3 tiles',
      }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(signals[0]?.aborted).toBe(true);
    expect(
      screen.queryByRole('heading', { name: 'New track' }),
    ).not.toBeInTheDocument();

    await user.upload(input, gpxFile('Unmount.gpx'));
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    expect(
      within(screen.getByRole('complementary', { name: 'Track details' })).getByText(
        'Preparing terrain and elevation…',
      ),
    ).toBeVisible();
    rendered.unmount();
    expect(signals[1]?.aborted).toBe(true);
  });

  it('keeps the parsed New track panel when terrain preparation fails', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const sampleMany = vi
      .spyOn(provider, 'sampleMany')
      .mockRejectedValueOnce(new Error('Terrain unavailable'))
      .mockImplementation((coordinates) =>
        Promise.resolve(coordinates.map(() => ({ status: 'unavailable' as const }))),
      );
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Terrain failure.gpx'));

    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    expect(await screen.findByText('Terrain unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Terrain failure.gpx · GPX')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Recalculate elevation' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
    expect(sampleMany).toHaveBeenCalledTimes(2);
  });

  it('promotes calculated elevation for an elevation-free import', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    let demMeters = 400;
    let elevationFreeDem = false;
    let elevationDelta = 100;
    vi.spyOn(provider, 'sampleMany').mockImplementation((coordinates) =>
      Promise.resolve(
        coordinates.map((_, index) => ({
          status: 'available' as const,
          meters:
            elevationFreeDem &&
            index >= coordinates.length / 3 &&
            index < (coordinates.length * 2) / 3
              ? demMeters + elevationDelta
              : demMeters,
        })),
      ),
    );
    const saveLocalTrack = vi.spyOn(services.database, 'saveLocalTrack');
    const replaceCalculatedTrackElevation = vi.spyOn(
      services.database,
      'replaceCalculatedTrackElevation',
    );
    const trackSaved = vi.spyOn(services.userData, 'trackSaved');
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Dual elevation.gpx'));
    let details = await screen.findByRole('complementary', { name: 'Track details' });
    expect(within(details).getByLabelText('Elevation gain: 120 m')).toBeVisible();
    expect(within(details).getByLabelText('Elevation loss: 0 m')).toBeVisible();
    const pointAndSegmentCount = within(details).getByText('2 points · 1 segment');
    const calculatedGain = within(details).getByLabelText(
      'Elevation gain (calculated): 0 m',
    );
    const calculatedLoss = within(details).getByLabelText(
      'Elevation loss (calculated): 0 m',
    );
    expect(calculatedGain).toBeVisible();
    expect(calculatedLoss).toBeVisible();
    expect(
      pointAndSegmentCount.compareDocumentPosition(calculatedGain) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(calculatedGain.querySelector('svg')).toBeNull();
    expect(calculatedLoss.querySelector('svg')).toBeNull();
    expect(
      within(details).getByRole('img', {
        name: 'Elevation profile from 1000 to 1120 metres',
      }),
    ).toBeVisible();

    await user.click(within(details).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(saveLocalTrack).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(trackSaved).toHaveBeenCalledOnce();
    });
    const savedContent = saveLocalTrack.mock.calls[0]?.[1];
    expect(savedContent?.trackPoints).toEqual([
      [
        { coordinate: [44, 42], elevationMeters: 1_000 },
        { coordinate: [44.01, 42.01], elevationMeters: 1_120 },
      ],
    ]);
    expect(
      savedContent?.calculatedTrackPoints?.[0]?.every(
        (point) => point.elevationMeters === 400,
      ),
    ).toBe(true);
    const savedTrackId = savedContent?.trackId ?? '';
    const sourceContentHash = (await services.database.localTracks.get(savedTrackId))
      ?.contentHash;
    expect(sourceContentHash).toMatch(/^[0-9a-f]{64}$/u);
    trackSaved.mockClear();
    await waitFor(
      () => {
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      },
      { timeout: 5_000 },
    );

    demMeters = 500;
    details = screen.getByRole('complementary', { name: 'Track details' });
    await user.click(
      within(details).getByRole('button', { name: 'Recalculate elevation' }),
    );
    await waitFor(() => {
      expect(replaceCalculatedTrackElevation).toHaveBeenCalledOnce();
    });
    const recalculatedContent =
      await services.database.loadLocalTrackContent(savedTrackId);
    expect(recalculatedContent.trackPoints).toEqual(savedContent?.trackPoints);
    expect(
      recalculatedContent.calculatedTrackPoints?.[0]?.every(
        (point) => point.elevationMeters === 500,
      ),
    ).toBe(true);
    expect((await services.database.localTracks.get(savedTrackId))?.contentHash).toBe(
      sourceContentHash,
    );
    expect(trackSaved).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('img', {
        name: 'Elevation profile from 1000 to 1120 metres',
      }),
    ).toBeVisible();
    details = screen.getByRole('complementary', { name: 'Track details' });

    await user.click(within(details).getByRole('button', { name: 'Close track' }));
    const nextInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(nextInput).not.toBeNull();
    if (nextInput === null) return;
    saveLocalTrack.mockClear();
    demMeters = 400;
    elevationFreeDem = true;
    await user.upload(nextInput, elevationFreeGpxFile());
    details = await screen.findByRole('complementary', { name: 'Track details' });
    const primaryGain = within(details)
      .getByLabelText(/^Elevation gain: (?!0 m)/u)
      .getAttribute('aria-label');
    const primaryLoss = within(details)
      .getByLabelText(/^Elevation loss: (?!0 m)/u)
      .getAttribute('aria-label');
    if (primaryGain === null || primaryLoss === null) {
      throw new Error('Calculated elevation totals are missing.');
    }
    expect(
      within(details).queryByLabelText(/^Elevation gain \(calculated\):/u),
    ).not.toBeInTheDocument();
    expect(
      within(details).queryByLabelText(/^Elevation loss \(calculated\):/u),
    ).not.toBeInTheDocument();
    expect(
      within(details).getByRole('img', { name: /^Elevation profile from /u }),
    ).toBeVisible();

    let captureDownload = false;
    let downloadedBlob: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((object) => {
      if (captureDownload && object instanceof Blob) downloadedBlob = object;
      return 'blob:elevation-free-track';
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      return undefined;
    });
    await user.click(within(details).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(saveLocalTrack).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(trackSaved).toHaveBeenCalledOnce();
    });
    const promotedSummary = saveLocalTrack.mock.calls[0]?.[0];
    const promotedContent = saveLocalTrack.mock.calls[0]?.[1];
    expect(promotedSummary?.metrics.elevationSource).toBe('dem-assisted');
    expect(promotedSummary?.calculatedMetrics).toBeUndefined();
    expect(promotedContent?.calculatedTrackPoints).toBeUndefined();
    expect(
      promotedContent?.trackPoints
        .flat()
        .every((point) => point.elevationMeters !== undefined),
    ).toBe(true);
    const promotedTrackId = promotedContent?.trackId ?? '';
    const promotedContentHash = (
      await services.database.localTracks.get(promotedTrackId)
    )?.contentHash;
    expect(promotedContentHash).toMatch(/^[0-9a-f]{64}$/u);

    await user.click(within(details).getByRole('button', { name: 'Close track' }));
    await user.click(
      within(screen.getByRole('list', { name: 'Saved tracks' })).getByRole('button', {
        name: /^Elevation-free trail/u,
      }),
    );
    details = await screen.findByRole('complementary', { name: 'Track details' });
    expect(within(details).getByLabelText(primaryGain)).toBeVisible();
    expect(within(details).getByLabelText(primaryLoss)).toBeVisible();
    expect(
      within(details).getByRole('img', { name: /^Elevation profile from /u }),
    ).toBeVisible();

    captureDownload = true;
    await user.click(within(details).getByRole('button', { name: 'Download GPX' }));
    captureDownload = false;
    const downloadedGpx = new TextDecoder().decode(
      await readBlob(requiredBlob(downloadedBlob)),
    );
    const exportedElevations = Array.from(
      downloadedGpx.matchAll(/<ele>([^<]+)<\/ele>/gu),
      (match) => Number(match[1]),
    );
    expect(exportedElevations).toEqual(
      promotedContent?.trackPoints.flat().map((point) => point.elevationMeters),
    );

    trackSaved.mockClear();
    demMeters = 600;
    elevationDelta = 200;
    await user.click(
      within(details).getByRole('button', { name: 'Recalculate elevation' }),
    );
    await waitFor(() => {
      expect(saveLocalTrack).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(trackSaved).toHaveBeenCalledOnce();
    });
    const promotedRecalculatedContent =
      await services.database.loadLocalTrackContent(promotedTrackId);
    const recalculatedSummary =
      await services.database.localTracks.get(promotedTrackId);
    expect(promotedRecalculatedContent.trackPoints).not.toEqual(
      promotedContent?.trackPoints,
    );
    expect(promotedRecalculatedContent.calculatedTrackPoints).toBeUndefined();
    expect(recalculatedSummary?.calculatedMetrics).toBeUndefined();
    expect(recalculatedSummary?.metrics).not.toEqual(promotedSummary?.metrics);
    expect(recalculatedSummary?.contentHash).not.toBe(promotedContentHash);
  });

  it('keeps the newest import when an older preparation completes late', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const pending: {
      readonly count: number;
      readonly resolve: (samples: readonly ElevationSample[]) => void;
    }[] = [];
    vi.spyOn(provider, 'sampleMany').mockImplementation((coordinates) => {
      const pendingResult = deferred<readonly ElevationSample[]>();
      pending.push({ count: coordinates.length, resolve: pendingResult.resolve });
      return pendingResult.promise;
    });
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('First.gpx'));
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    expect(
      within(screen.getByRole('complementary', { name: 'Track details' })).getAllByText(
        'Preparing terrain and elevation…',
      ),
    ).not.toHaveLength(0);
    await user.upload(input, gpxFile('Second.gpx'));
    expect(pending).toHaveLength(2);
    act(() => {
      const latest = pending[1];
      latest?.resolve(
        Array.from({ length: latest.count }, () => ({
          status: 'unavailable' as const,
        })),
      );
    });
    expect(await screen.findByText('Second.gpx · GPX')).toBeVisible();

    act(() => {
      const stale = pending[0];
      stale?.resolve(
        Array.from({ length: stale.count }, () => ({ status: 'unavailable' as const })),
      );
    });
    expect(screen.getByText('Second.gpx · GPX')).toBeVisible();
    expect(screen.queryByText('First.gpx · GPX')).not.toBeInTheDocument();
  });

  it('preserves a manually edited preview name through preparation', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const pending = deferred<readonly ElevationSample[]>();
    vi.spyOn(provider, 'sampleMany').mockImplementation((_coordinates) => {
      return pending.promise;
    });
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Manual name.gpx'));
    const nameInput = await screen.findByRole('textbox', { name: 'Track name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Manual trail');
    pending.resolve(
      Array.from({ length: 3 }, () => ({ status: 'unavailable' as const })),
    );

    await waitFor(() => {
      expect(nameInput).toHaveValue('Manual trail');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
  });

  it('recalculates preview and saved elevation without toggling disclosure', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const pendingRecalculations: {
      readonly count: number;
      readonly resolve: (samples: readonly ElevationSample[]) => void;
    }[] = [];
    let requestCount = 0;
    vi.spyOn(provider, 'sampleMany').mockImplementation(
      (coordinates, _signal, onProgress) => {
        requestCount += 1;
        if (requestCount === 1) {
          return Promise.resolve(
            coordinates.map(() => ({ status: 'unavailable' as const })),
          );
        }
        onProgress?.({
          completedTiles: 0,
          totalTiles: 3,
          indices: [],
          samples: [],
        });
        onProgress?.({
          completedTiles: 1,
          totalTiles: 3,
          indices: [0],
          samples: [{ status: 'available', meters: 1_000 }],
        });
        const pending = deferred<readonly ElevationSample[]>();
        pendingRecalculations.push({
          count: coordinates.length,
          resolve: pending.resolve,
        });
        return pending.promise;
      },
    );
    const saveLocalTrack = vi.spyOn(services.database, 'saveLocalTrack');
    const replaceCalculatedTrackElevation = vi.spyOn(
      services.database,
      'replaceCalculatedTrackElevation',
    );
    const trackMetadataChanged = vi.spyOn(services.userData, 'trackMetadataChanged');
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Recalculate.gpx'));
    const disclosure = await screen.findByRole('button', {
      name: 'Climbs & Descents',
    });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    const previewRecalculate = screen.getByRole('button', {
      name: 'Recalculate elevation',
    });
    await user.click(previewRecalculate);
    expect(previewRecalculate).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(previewRecalculate).toContainElement(
      within(previewRecalculate).getByRole('progressbar'),
    );
    expect(await screen.findByText('Loading elevation tiles: 1 of 3')).toBeVisible();
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    const previewPending = pendingRecalculations[0];
    expect(previewPending).toBeDefined();
    act(() => {
      previewPending?.resolve(
        Array.from({ length: previewPending.count }, () => ({
          status: 'unavailable' as const,
        })),
      );
    });
    await waitFor(() => {
      expect(previewRecalculate).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(saveLocalTrack).toHaveBeenCalledOnce();
    });
    await waitFor(
      () => {
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      },
      { timeout: 5_000 },
    );
    const savedDisclosure = screen.getByRole('button', {
      name: 'Climbs & Descents',
    });
    const savedRecalculate = screen.getByRole('button', {
      name: 'Recalculate elevation',
    });
    expect(savedDisclosure).toHaveAttribute('aria-expanded', 'true');
    await user.click(savedDisclosure);
    expect(savedDisclosure).toHaveAttribute('aria-expanded', 'false');
    await user.click(savedDisclosure);
    expect(savedDisclosure).toHaveAttribute('aria-expanded', 'true');

    await user.click(savedRecalculate);
    expect(await screen.findByText('Loading elevation tiles: 1 of 3')).toBeVisible();
    const savedPending = pendingRecalculations[1];
    expect(savedPending).toBeDefined();
    act(() => {
      savedPending?.resolve(
        Array.from({ length: savedPending.count }, () => ({
          status: 'unavailable' as const,
        })),
      );
    });
    await waitFor(() => {
      expect(replaceCalculatedTrackElevation).toHaveBeenCalledOnce();
    });
    expect(trackMetadataChanged).not.toHaveBeenCalled();
    expect(savedDisclosure).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not recalculate a preview while its save is pending', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const sampleMany = vi
      .spyOn(provider, 'sampleMany')
      .mockImplementation((coordinates) =>
        Promise.resolve(coordinates.map(() => ({ status: 'unavailable' as const }))),
      );
    const savePending = deferred<undefined>();
    const saveLocalTrack = vi
      .spyOn(services.database, 'saveLocalTrack')
      .mockImplementation(() => savePending.promise);
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Save race.gpx'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(saveLocalTrack).toHaveBeenCalledOnce();
    });

    await user.click(screen.getByRole('button', { name: 'Recalculate elevation' }));
    expect(sampleMany).toHaveBeenCalledOnce();

    act(() => {
      savePending.resolve(undefined);
    });
  });

  it('cancels saved-track recalculation before deleting that track', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    let requestCount = 0;
    vi.spyOn(provider, 'sampleMany').mockImplementation((coordinates, signal) => {
      requestCount += 1;
      if (requestCount === 1) {
        return Promise.resolve(
          coordinates.map(() => ({ status: 'unavailable' as const })),
        );
      }
      return new Promise((_, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    });
    const replaceCalculatedTrackElevation = vi.spyOn(
      services.database,
      'replaceCalculatedTrackElevation',
    );
    const deleteLocalTrack = vi.spyOn(services.database, 'deleteLocalTrack');
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Delete race.gpx'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(
      () => {
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      },
      { timeout: 5_000 },
    );
    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    await user.click(
      within(details).getByRole('button', { name: 'Recalculate elevation' }),
    );
    await waitFor(() => {
      expect(requestCount).toBe(2);
    });

    await user.click(within(details).getByRole('button', { name: 'Track actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete track' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => {
      expect(deleteLocalTrack).toHaveBeenCalledOnce();
    });
    expect(replaceCalculatedTrackElevation).not.toHaveBeenCalled();
    expect(
      screen.queryByText('Elevation could not be recalculated.'),
    ).not.toBeInTheDocument();
  });

  it('publishes whole-track grade colors for flat macro ranges', async () => {
    const mapLayers = services.mapLayers;
    expect(mapLayers).not.toBeNull();
    if (mapLayers === null) return;
    const setImportedTrackHighlight = vi.spyOn(mapLayers, 'setImportedTrackHighlight');
    const { container } = renderWorkspaceShell();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, 420, 264),
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, flatGpxFile());
    await waitFor(() => {
      const highlightedSegments = setImportedTrackHighlight.mock.lastCall?.[0];
      expect(highlightedSegments).toHaveLength(1);
      expect(highlightedSegments?.[0]?.color).toBe(appColors.elevationGrade.flat);
      expect(highlightedSegments?.[0]?.coordinates).toHaveLength(16);
      expect(highlightedSegments?.[0]?.coordinates[0]).toEqual([44, 42]);
      expect(highlightedSegments?.[0]?.coordinates.at(-1)).toEqual([44.015, 42]);
    });
  });

  it('reloads synchronized source elevation without replacing it from DEM', async () => {
    const base = savedTrackSummary('local:synchronized', 'Synchronized trail');
    const summary: LocalTrackSummary = {
      ...base,
      metrics: {
        ...base.metrics,
        minimumElevationMeters: 1_000,
        maximumElevationMeters: 1_120,
        ascentMeters: 120,
        descentMeters: 0,
        elevationSource: 'gpx',
        elevationAlgorithmVersion: 3,
      },
    };
    const sourceContent = savedTrackContent(summary.id);
    await services.database.saveLocalTrack(summary, sourceContent);
    await services.database.saveLatestOpenedTrackId(summary.id);
    useUiStore.setState({ activeTab: 'tracks' });
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const sampleMany = vi.spyOn(provider, 'sampleMany');
    const replaceCalculatedTrackElevation = vi.spyOn(
      services.database,
      'replaceCalculatedTrackElevation',
    );
    const listLocalTracks = vi.spyOn(services.database, 'listLocalTracks');
    let notifyTracksChanged: (() => void) | undefined;
    vi.spyOn(services.userData, 'subscribeTracksChanged').mockImplementation(
      (listener) => {
        notifyTracksChanged = listener;
        return () => undefined;
      },
    );
    renderWorkspaceShell();

    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    expect(
      within(details).getByRole('img', {
        name: 'Elevation profile from 1000 to 1120 metres',
      }),
    ).toBeVisible();
    await waitFor(() => {
      expect(notifyTracksChanged).toBeDefined();
    });
    const initialListCalls = listLocalTracks.mock.calls.length;
    act(() => {
      notifyTracksChanged?.();
    });
    await waitFor(() => {
      expect(listLocalTracks.mock.calls.length).toBeGreaterThan(initialListCalls);
    });

    await expect(services.database.loadLocalTrackContent(summary.id)).resolves.toEqual(
      sourceContent,
    );
    expect(
      within(
        screen.getByRole('complementary', { name: 'Track details' }),
      ).getByLabelText('Elevation gain: 120 m'),
    ).toBeVisible();
    expect(sampleMany).not.toHaveBeenCalled();
    expect(replaceCalculatedTrackElevation).not.toHaveBeenCalled();
  });

  it('does not restore a closed saved track after remount', async () => {
    const summary = savedTrackSummary('local:closed', 'Closed trail');
    await services.database.saveLocalTrack(summary, savedTrackContent(summary.id));
    await services.database.saveLatestOpenedTrackId(summary.id);
    useUiStore.setState({ activeTab: 'tracks' });
    const user = userEvent.setup();
    const firstRender = renderWorkspaceShell();

    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    expect(
      within(details).getByRole('heading', { name: 'Closed trail' }),
    ).toBeVisible();
    await user.click(within(details).getByRole('button', { name: 'Close track' }));
    await waitFor(() => {
      expect(
        screen.queryByRole('complementary', { name: 'Track details' }),
      ).not.toBeInTheDocument();
    });
    await expect(services.database.loadLatestOpenedTrackId()).resolves.toBeNull();

    firstRender.unmount();
    renderWorkspaceShell();

    const savedTracks = await screen.findByRole('list', { name: 'Saved tracks' });
    expect(
      within(savedTracks).getByRole('button', { name: /^Closed trail/u }),
    ).toBeVisible();
    expect(
      screen.queryByRole('complementary', { name: 'Track details' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a saved track open when its restoration marker cannot be cleared', async () => {
    const summary = savedTrackSummary('local:clear-failure', 'Unclosed trail');
    await services.database.saveLocalTrack(summary, savedTrackContent(summary.id));
    await services.database.saveLatestOpenedTrackId(summary.id);
    useUiStore.setState({ activeTab: 'tracks' });
    const user = userEvent.setup();
    renderWorkspaceShell();

    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    expect(
      within(details).getByRole('heading', { name: 'Unclosed trail' }),
    ).toBeVisible();
    const saveLatestOpenedTrackId = vi
      .spyOn(services.database, 'saveLatestOpenedTrackId')
      .mockRejectedValueOnce(new Error('Storage unavailable'));

    await user.click(within(details).getByRole('button', { name: 'Close track' }));

    expect(saveLatestOpenedTrackId).toHaveBeenCalledWith(null);
    expect(screen.getByRole('complementary', { name: 'Track details' })).toBeVisible();
    const tracksTools = await screen.findByRole('complementary', {
      name: 'Tracks tools',
    });
    expect(
      within(tracksTools).getByText('The track could not be closed.'),
    ).toBeVisible();
    await expect(services.database.loadLatestOpenedTrackId()).resolves.toBe(summary.id);
  });

  it('keeps a newer selection when closing the previous saved track is pending', async () => {
    const closingSummary = savedTrackSummary('local:closing', 'Closing trail');
    const replacementSummary = savedTrackSummary(
      'local:replacement',
      'Replacement trail',
    );
    await services.database.saveLocalTrack(
      closingSummary,
      savedTrackContent(closingSummary.id),
    );
    await services.database.saveLocalTrack(
      replacementSummary,
      savedTrackContent(replacementSummary.id),
    );
    await services.database.saveLatestOpenedTrackId(closingSummary.id);
    useUiStore.setState({ activeTab: 'tracks' });
    const user = userEvent.setup();
    renderWorkspaceShell();

    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    const clear = deferred<undefined>();
    const saveLatestOpenedTrackId = services.database.saveLatestOpenedTrackId.bind(
      services.database,
    );
    vi.spyOn(services.database, 'saveLatestOpenedTrackId').mockImplementation(
      (trackId) =>
        trackId === null ? clear.promise : saveLatestOpenedTrackId(trackId),
    );
    const loadLocalTrackContent = vi.spyOn(services.database, 'loadLocalTrackContent');

    await user.click(within(details).getByRole('button', { name: 'Close track' }));
    await user.click(
      within(screen.getByRole('list', { name: 'Saved tracks' })).getByRole('button', {
        name: /^Replacement trail/u,
      }),
    );
    await waitFor(() => {
      expect(loadLocalTrackContent).toHaveBeenCalledWith(replacementSummary.id);
    });

    clear.resolve(undefined);

    await waitFor(() => {
      expect(
        within(details).getByRole('heading', { name: 'Replacement trail' }),
      ).toBeVisible();
    });
    await expect(services.database.loadLatestOpenedTrackId()).resolves.toBe(
      replacementSummary.id,
    );
  });

  it('restores the open marker when a pending replacement selection fails', async () => {
    const closingSummary = savedTrackSummary('local:closing', 'Closing trail');
    const replacementSummary = savedTrackSummary(
      'local:replacement',
      'Replacement trail',
    );
    await services.database.saveLocalTrack(
      closingSummary,
      savedTrackContent(closingSummary.id),
    );
    await services.database.saveLocalTrack(
      replacementSummary,
      savedTrackContent(replacementSummary.id),
    );
    await services.database.saveLatestOpenedTrackId(closingSummary.id);
    useUiStore.setState({ activeTab: 'tracks' });
    const user = userEvent.setup();
    renderWorkspaceShell();

    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    const clear = deferred<undefined>();
    const saveLatestOpenedTrackId = services.database.saveLatestOpenedTrackId.bind(
      services.database,
    );
    vi.spyOn(services.database, 'saveLatestOpenedTrackId').mockImplementation(
      (trackId) =>
        trackId === null ? clear.promise : saveLatestOpenedTrackId(trackId),
    );
    vi.spyOn(services.database, 'loadLocalTrackContent').mockRejectedValueOnce(
      new Error('Replacement unavailable'),
    );

    await user.click(within(details).getByRole('button', { name: 'Close track' }));
    await user.click(
      within(screen.getByRole('list', { name: 'Saved tracks' })).getByRole('button', {
        name: /^Replacement trail/u,
      }),
    );
    expect(await screen.findByText('Replacement unavailable')).toBeVisible();

    clear.resolve(undefined);

    await waitFor(async () => {
      await expect(services.database.loadLatestOpenedTrackId()).resolves.toBe(
        closingSummary.id,
      );
    });
    expect(
      within(details).getByRole('heading', { name: 'Closing trail' }),
    ).toBeVisible();
  });

  it('restores the last opened track without overriding the restored camera', async () => {
    const summary = savedTrackSummary('local:restored', 'Restored trail');
    await services.database.saveLocalTrack(summary, savedTrackContent(summary.id));
    await services.database.saveLatestOpenedTrackId(summary.id);
    await services.mapCameraRepository.save({
      longitude: 45.2,
      latitude: 42.4,
      zoom: 10,
      bearing: 0,
      pitch: 0,
    });
    const mapLayers = services.mapLayers;
    expect(mapLayers).not.toBeNull();
    if (mapLayers === null) return;
    const setImportedTrackGeometry = vi.spyOn(mapLayers, 'setImportedTrackGeometry');
    const fakeFacade = new FakeMapFacade();
    const user = userEvent.setup();
    useUiStore.setState({ activeTab: 'tracks' });

    const expectedFitBoundsRequest = {
      bounds: { west: 44, south: 42, east: 44.01, north: 42.01 },
      maxZoom: 15,
      padding: undefined,
    };
    renderWorkspaceShell(
      <MapWorkspace
        facade={fakeFacade}
        mapCanvas={(initialCamera) => (
          <div>
            Restored camera {initialCamera.longitude}/{initialCamera.latitude}/
            {initialCamera.zoom}
          </div>
        )}
      />,
    );

    expect(await screen.findByText('Restored camera 45.2/42.4/10')).toBeVisible();
    expect(
      within(
        await screen.findByRole('complementary', { name: 'Track details' }),
      ).getByRole('heading', { name: 'Restored trail' }),
    ).toBeVisible();
    await waitFor(() => {
      expect(setImportedTrackGeometry).toHaveBeenCalled();
    });
    expect(mapInteractionStore.getState().fitBoundsCommand).toBeNull();

    act(() => {
      fakeFacade.setSnapshot({ lifecycle: 'ready' });
    });

    await waitFor(() => {
      expect(mapInteractionStore.getState().fitBoundsCommand).toBeNull();
      expect(fakeFacade.fitBoundsRequests).toEqual([]);
    });

    await user.click(screen.getByRole('button', { name: /^Restored trail/u }));
    expect(fakeFacade.fitBoundsRequests).toEqual([]);

    fakeFacade.fitBoundsRequests.splice(0);
    await user.click(screen.getByRole('button', { name: 'Close track' }));
    await waitFor(() => {
      expect(
        screen.queryByRole('complementary', { name: 'Track details' }),
      ).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /^Restored trail/u }));

    await waitFor(() => {
      expect(fakeFacade.fitBoundsRequests).toEqual([expectedFitBoundsRequest]);
    });
  });

  it('imports, saves, closes, reopens, renames, and deletes a local GPX track', async () => {
    const user = userEvent.setup();
    const trackSaved = vi.spyOn(services.userData, 'trackSaved');
    const trackMetadataChanged = vi.spyOn(services.userData, 'trackMetadataChanged');
    const trackDeleted = vi.spyOn(services.userData, 'trackDeleted');
    const mapLayers = services.mapLayers;
    expect(mapLayers).not.toBeNull();
    if (mapLayers === null) return;
    const setImportedTrackHighlight = vi.spyOn(mapLayers, 'setImportedTrackHighlight');
    vi.spyOn(services.database, 'loadLocalTrackContent').mockResolvedValue({
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:test-1',
      trackPoints: [
        [
          { coordinate: [44, 42], elevationMeters: 1_000 },
          { coordinate: [44.005, 42.005], elevationMeters: 1_010 },
          { coordinate: [44.008, 42.008] },
          { coordinate: [44.01, 42.01], elevationMeters: 1_110 },
          { coordinate: [44.02, 42.02], elevationMeters: 1_120 },
        ],
      ],
      markers: [],
    });
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, 420, 264),
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFileWithGradeBands());
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    const trackNameInput = screen.getByRole('textbox', { name: 'Track name' });
    expect(trackNameInput).toHaveValue('Fixture trail');
    expect(screen.getByText('Fixture track.gpx · GPX')).toBeVisible();
    expect(screen.queryByText('Recorded time')).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    let details = screen.getByRole('complementary', { name: 'Track details' });
    const markerDisclosure = within(details).getByRole('button', { name: 'Markers' });
    expect(markerDisclosure).toHaveAttribute('aria-expanded', 'false');
    await user.click(markerDisclosure);
    expect(within(details).getByText('Imported summit')).toBeVisible();

    await user.click(within(details).getByRole('button', { name: 'Add track marker' }));
    const placement = mapInteractionStore.getState().markerPlacement;
    expect(placement?.target).toMatchObject({ kind: 'track-marker' });
    act(() => {
      completeMarkerPlacement({ longitude: 44.02, latitude: 42.02 }, 'Map marker');
    });
    const markerDialog = await screen.findByRole('dialog', {
      name: 'Create track marker',
    });
    expect(
      within(markerDialog).queryByRole('group', { name: 'Marker color' }),
    ).not.toBeInTheDocument();
    await user.click(within(markerDialog).getByRole('button', { name: 'Create' }));
    expect(await within(details).findByText('Map marker')).toBeVisible();

    const importedMarkerRow = within(details)
      .getByText('Imported summit')
      .closest('li');
    expect(importedMarkerRow).not.toBeNull();
    if (importedMarkerRow === null) return;
    await user.click(within(importedMarkerRow).getByRole('button', { name: 'Rename' }));
    const markerName = within(details).getByRole('textbox', {
      name: 'Marker name',
    });
    await user.clear(markerName);
    await user.type(markerName, 'Renamed summit{Enter}');
    expect(await within(details).findByText('Renamed summit')).toBeVisible();

    const addedMarkerRow = within(details).getByText('Map marker').closest('li');
    expect(addedMarkerRow).not.toBeNull();
    if (addedMarkerRow === null) return;
    await user.click(
      within(addedMarkerRow).getByRole('button', { name: 'Delete Map marker' }),
    );
    await user.click(
      within(addedMarkerRow).getByRole('button', {
        name: 'Confirm deletion of Map marker',
      }),
    );
    await waitFor(() => {
      expect(within(details).queryByText('Map marker')).not.toBeInTheDocument();
    });
    const elevationProfile = within(details).getByRole('img', {
      name: 'Elevation profile from 1000 to 1120 metres',
    });
    expect(elevationProfile).toBeVisible();
    await waitFor(() => {
      const highlightedSegments = setImportedTrackHighlight.mock.lastCall?.[0];
      expect(highlightedSegments).not.toBeNull();
      expect(highlightedSegments?.length).toBeGreaterThan(0);
      expect(
        new Set(highlightedSegments?.map((segment) => segment.color)).size,
      ).toBeGreaterThan(1);
    });
    const highlightedSegments = setImportedTrackHighlight.mock.lastCall?.[0];
    if (highlightedSegments === undefined || highlightedSegments === null) {
      throw new Error(
        'Expected the prepared elevation profile to publish grade bands.',
      );
    }
    const highlightCallCount = setImportedTrackHighlight.mock.calls.length;
    const elevationDisclosure = within(details).getByRole('button', {
      name: 'Climbs & Descents',
    });
    expect(elevationDisclosure).toHaveAttribute('aria-expanded', 'false');
    await user.click(elevationDisclosure);
    const climb = within(details).getByRole('button', { name: /^Climb 1/u });
    await user.click(climb);
    expect(climb).toHaveAttribute('aria-pressed', 'true');
    expect(setImportedTrackHighlight).toHaveBeenCalledTimes(highlightCallCount);
    expect(setImportedTrackHighlight.mock.lastCall?.[0]).toEqual(highlightedSegments);
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    expect(setImportedTrackHighlight.mock.lastCall?.[0]).toEqual(highlightedSegments);
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    details = screen.getByRole('complementary', { name: 'Track details' });
    const elevationGain = within(details).getByLabelText(
      /^Elevation gain: (?:23[5-9]|24[0-5]) m$/u,
    );
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
    expect(within(details).getByText(/\d+ points · 1 segment/u)).toBeVisible();
    const discard = screen.getByRole('button', { name: 'Discard' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(
      discard.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const fitBoundsCommand = mapInteractionStore.getState().fitBoundsCommand;
    expect(fitBoundsCommand).toMatchObject({
      bounds: { west: 44, south: 42, east: 44.03, north: 42.03 },
    });
    expect(fitBoundsCommand?.padding).toBeUndefined();
    const leaveEvent = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(leaveEvent)).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(
        within(screen.getByRole('list', { name: 'Saved tracks' })).getByRole('button', {
          name: /^Fixture trail/u,
        }),
      ).toBeVisible();
    });
    await waitFor(() => {
      expect(trackSaved).toHaveBeenCalledOnce();
    });
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Saved tracks' })).getByLabelText(
        /^Elevation gain: (?:23[5-9]|24[0-5]) m$/u,
      ),
    ).toBeVisible();
    expect(
      within(details).getByRole('heading', { name: 'Fixture trail' }),
    ).toBeVisible();
    expect(
      within(details).getByText(/^Saved \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/u),
    ).toBeVisible();
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(
      true,
    );
    const savedMarkerDisclosure = within(details).getByRole('button', {
      name: 'Markers',
    });
    expect(savedMarkerDisclosure).toHaveAttribute('aria-expanded', 'false');
    await user.click(savedMarkerDisclosure);
    const savedMarkerRow = within(details).getByText('Renamed summit').closest('li');
    expect(savedMarkerRow).not.toBeNull();
    if (savedMarkerRow === null) return;
    await user.click(within(savedMarkerRow).getByRole('button', { name: 'Rename' }));
    const savedMarkerName = within(details).getByRole('textbox', {
      name: 'Marker name',
    });
    await user.clear(savedMarkerName);
    await user.type(savedMarkerName, 'Synchronized summit{Enter}');
    expect(await within(details).findByText('Synchronized summit')).toBeVisible();
    await waitFor(() => {
      expect(trackMetadataChanged).toHaveBeenCalledOnce();
    });

    await user.click(within(details).getByRole('button', { name: 'Track actions' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Add to favorites' }),
    ).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: 'Add to favorites' }));
    await waitFor(() => {
      expect(trackMetadataChanged).toHaveBeenCalledTimes(2);
    });
    await user.click(within(details).getByRole('button', { name: 'Track actions' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Remove from favorites' }),
    ).toBeVisible();
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('textbox', { name: 'Track name' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Use relief elevation')).not.toBeInTheDocument();
    expect(screen.queryByText('Source file')).not.toBeInTheDocument();
    expect(
      within(details).getByRole('img', {
        name: 'Elevation profile from 1000 to 1120 metres',
      }),
    ).toBeVisible();

    await user.click(within(details).getByRole('button', { name: 'Track actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const nameInput = await screen.findByRole('textbox', { name: 'Track name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Rejected trail');
    vi.spyOn(services.database, 'renameLocalTrack').mockRejectedValueOnce(
      new Error('Rename unavailable'),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm rename' }));
    expect(await screen.findByText('Rename unavailable')).toBeVisible();
    expect(nameInput).toHaveValue('Rejected trail');
    await user.clear(nameInput);
    await user.type(nameInput, 'Final trail');
    await user.keyboard('{Enter}');
    expect(
      await within(details).findByRole('heading', { name: 'Final trail' }),
    ).toBeVisible();
    await waitFor(() => {
      expect(trackMetadataChanged).toHaveBeenCalledTimes(3);
    });

    await user.click(within(details).getByRole('button', { name: 'Track actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete track' }));
    const detailConfirm = screen.getByRole('button', { name: 'Confirm delete' });
    expect(detailConfirm).toBeVisible();
    if (detailConfirm.parentElement !== null) {
      fireEvent.mouseLeave(detailConfirm.parentElement);
    }
    expect(
      within(details).getByRole('button', { name: 'Track actions' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Close track' }));
    await waitFor(() => {
      expect(
        screen.queryByRole('complementary', { name: 'Track details' }),
      ).not.toBeInTheDocument();
    });
    const savedTracks = screen.getByRole('list', { name: 'Saved tracks' });
    const deleteTrack = within(savedTracks).getByRole('button', {
      name: 'Delete Final trail',
    });
    const savedRow = deleteTrack.closest('li');
    expect(savedRow).not.toBeNull();
    if (savedRow !== null) await user.hover(savedRow);
    const deleteLocalTrack = vi.spyOn(services.database, 'deleteLocalTrack');
    fireEvent.click(deleteTrack);
    expect(deleteLocalTrack).not.toHaveBeenCalled();
    expect(
      within(savedTracks).getByRole('button', {
        name: 'Confirm deletion of Final trail',
      }),
    ).toBeVisible();

    if (savedRow !== null) fireEvent.mouseLeave(savedRow);
    expect(
      within(savedTracks).getByRole('button', { name: 'Delete Final trail' }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(savedTracks).getByRole('button', { name: 'Delete Final trail' }),
    );
    fireEvent.keyDown(
      within(savedTracks).getByRole('button', {
        name: 'Confirm deletion of Final trail',
      }),
      { key: 'Escape' },
    );
    expect(
      within(savedTracks).getByRole('button', { name: 'Delete Final trail' }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(savedTracks).getByRole('button', { name: 'Delete Final trail' }),
    );
    fireEvent.click(document.body);
    expect(
      within(savedTracks).getByRole('button', { name: 'Delete Final trail' }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(savedTracks).getByRole('button', { name: 'Delete Final trail' }),
    );
    fireEvent.click(
      within(savedTracks).getByRole('button', {
        name: 'Confirm deletion of Final trail',
      }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole('list', { name: 'Saved tracks' }),
      ).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(trackDeleted).toHaveBeenCalledOnce();
    });
  }, 30_000);
});
