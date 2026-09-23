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
  MapWorkspace,
  useUiStore,
  FakeMapFacade,
  createTestServices,
  services,
  setServices,
  setupWorkspaceShellTest,
  renderWorkspaceShell,
  savedTrackSummary,
  savedTrackContent,
  gpxFile,
  gpxFileWithCompanionRoute,
  deferred,
  type ElevationCoordinate,
  type ElevationProvider,
  type ElevationSample,
  type TrailRouter,
  type TrailRouteResult,
} from '@test/helpers/workspaceShellTestSupport';

describe('WorkspaceShell', () => {
  setupWorkspaceShellTest();

  it('plans routed and direct track segments through the workspace', async () => {
    const routePending = deferred<TrailRouteResult>();
    const route = vi.fn<TrailRouter['route']>(() => routePending.promise);
    const trailRouter: TrailRouter = {
      route,
      dispose: vi.fn(),
    };
    setServices(createTestServices({ trailRouter }));
    const facade = new FakeMapFacade();
    const user = userEvent.setup();
    const A = [44.64, 42.66] as const;
    const B = [44.65, 42.67] as const;
    const C = [44.66, 42.68] as const;
    const snappedA = [44.6405, 42.6605] as const;
    const routedMiddle = [44.645, 42.665] as const;
    const snappedB = [44.6495, 42.6695] as const;
    renderWorkspaceShell(
      <MapWorkspace facade={facade} mapCanvas={<div>Route planning map</div>} />,
    );
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const tracksHeading = screen.getByRole('heading', { name: 'Tracks' });
    const planRouteButton = screen.getByRole('button', { name: 'Plan route' });
    expect(planRouteButton.parentElement?.parentElement).toBe(
      tracksHeading.parentElement?.parentElement,
    );
    await user.click(planRouteButton);
    const emptyDetails = screen.getByText(
      'Add at least two route points to see track details.',
    );
    expect(emptyDetails.parentElement).toHaveStyle({ minHeight: '56px' });
    const emptyElevation = screen.getByText(
      'Add at least two route points to see the elevation profile.',
    );
    expect(emptyElevation.parentElement).toHaveStyle({ height: '264px' });
    expect(screen.getByRole('heading', { name: 'Elevation profile' })).toBeVisible();

    act(() => {
      facade.emitPlanningClick({ longitude: A[0], latitude: A[1] });
    });
    expect(
      await screen.findByText('Click the map to choose the next point.'),
    ).toBeVisible();
    act(() => {
      facade.emitPlanningClick({ longitude: B[0], latitude: B[1] });
    });
    expect(await screen.findByText('Loading route tiles…')).toBeVisible();
    expect(route).toHaveBeenCalledWith(
      { start: A, destination: B },
      expect.any(AbortSignal),
      expect.any(Function),
    );
    const reportProgress = route.mock.calls[0]?.[2];
    act(() => {
      reportProgress?.({
        phase: 'loading-tiles',
        attempt: 1,
        loadedTileCount: 8,
        totalTileCount: 16,
        graphProgress: 0,
      });
    });
    expect(await screen.findByText('Loading route tiles… 8/16')).toBeVisible();
    act(() => {
      reportProgress?.({
        phase: 'building-graph',
        attempt: 1,
        loadedTileCount: 16,
        totalTileCount: 16,
        graphProgress: 0.6,
      });
    });
    expect(await screen.findByText('Building route graph… 60%')).toBeVisible();
    act(() => {
      reportProgress?.({
        phase: 'searching-route',
        attempt: 1,
        loadedTileCount: 16,
        totalTileCount: 16,
        graphProgress: 1,
      });
    });
    expect(await screen.findByText('Searching for a route…')).toBeVisible();

    routePending.resolve({
      status: 'ready',
      geometry: {
        type: 'LineString',
        coordinates: [
          [snappedA[0], snappedA[1]],
          [routedMiddle[0], routedMiddle[1]],
          [snappedB[0], snappedB[1]],
        ],
      },
      networkDistanceMeters: 1_200,
      snappedStart: snappedA,
      snappedDestination: snappedB,
      loadedTileCount: 9,
      graphNodeCount: 100,
      graphEdgeCount: 120,
      expandedAreaRetryUsed: false,
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Line' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Line' }));
    act(() => {
      facade.emitPlanningClick({ longitude: C[0], latitude: C[1] });
    });
    await waitFor(() => {
      expect(route).toHaveBeenCalledOnce();
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Line' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
    act(() => {
      facade.emitPlanningClick({ longitude: C[0], latitude: C[1] });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => {
      await expect(services.database.listLocalTracks()).resolves.toHaveLength(1);
    });
    const [summary] = await services.database.listLocalTracks();
    if (summary === undefined) throw new Error('Expected one saved planned route.');
    expect(summary.geometryKind).toBe('route');
    const content = await services.database.loadLocalTrackContent(summary.id);
    expect(content.trackPoints[0]?.map((point) => point.coordinate)).toEqual([
      A,
      snappedA,
      routedMiddle,
      snappedB,
      B,
      C,
    ]);
    expect(route).toHaveBeenCalledOnce();
  }, 30_000);

  it('keeps failed route geometry editable and confirms discard', async () => {
    const route = vi.fn<TrailRouter['route']>().mockResolvedValue({
      status: 'failed',
      reason: 'no-route',
    });
    const trailRouter: TrailRouter = {
      route,
      dispose: vi.fn(),
    };
    setServices(createTestServices({ trailRouter }));
    const facade = new FakeMapFacade();
    const user = userEvent.setup();
    renderWorkspaceShell(
      <MapWorkspace facade={facade} mapCanvas={<div>Route planning map</div>} />,
    );
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    await user.click(screen.getByRole('button', { name: 'Plan route' }));
    act(() => {
      facade.emitPlanningClick({ longitude: 44.64, latitude: 42.66 });
    });
    act(() => {
      facade.emitPlanningClick({ longitude: 44.65, latitude: 42.67 });
    });
    expect(
      await screen.findByText(
        'No connected route was found. Add a closer point or use Line for the next segment.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Line' }));
    act(() => {
      facade.emitPlanningClick({ longitude: 44.65, latitude: 42.67 });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(
      await screen.findByText('Click the map to choose the route start.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Line' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    act(() => {
      facade.emitPlanningClick({ longitude: 44.64, latitude: 42.66 });
    });
    const confirmDiscard = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(confirmDiscard).toHaveBeenCalledWith('Discard this unsaved track?');
    expect(screen.getByRole('heading', { name: 'New track' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'New track' }),
      ).not.toBeInTheDocument();
    });
  }, 30_000);

  it('plans a direct multi-point route, enriches elevation, and saves local GPX content', async () => {
    const route = vi
      .fn()
      .mockRejectedValue(new Error('Line mode must not invoke routing.'));
    const trailRouter: TrailRouter = {
      route,
      dispose: vi.fn(),
    };
    const elevationProvider: ElevationProvider = {
      sample: vi.fn().mockResolvedValue({ status: 'available', meters: 1_000 }),
      sampleMany: vi.fn((coordinates: readonly ElevationCoordinate[]) =>
        Promise.resolve(
          coordinates.map((_, index) => ({
            status: 'available' as const,
            meters: 1_000 + index,
          })),
        ),
      ),
    };
    const baseServices = createTestServices({ trailRouter });
    setServices({ ...baseServices, elevationProvider });
    const existingSummary = savedTrackSummary('local:existing', 'Existing trail');
    await services.database.saveLocalTrack(
      existingSummary,
      savedTrackContent(existingSummary.id),
    );
    const facade = new FakeMapFacade();
    const user = userEvent.setup();
    renderWorkspaceShell(
      <MapWorkspace facade={facade} mapCanvas={<div>Route planning map</div>} />,
    );
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    await user.click(screen.getByRole('button', { name: 'Plan route' }));
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Line' }));

    act(() => {
      facade.emitPlanningClick({ longitude: 44.64, latitude: 42.66 });
    });
    expect(
      await screen.findByText('Click the map to choose the next point.'),
    ).toBeVisible();
    act(() => {
      facade.emitPlanningClick({ longitude: 44.65, latitude: 42.67 });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
    const elevationProfile = await screen.findByRole('img', {
      name: /Elevation profile from \d+ to \d+ metres/u,
    });
    expect(elevationProfile).toBeVisible();
    expect(elevationProfile).toHaveStyle({ height: '264px' });
    expect(screen.getByRole('heading', { name: 'Elevation profile' })).toBeVisible();
    expect(elevationProfile.querySelectorAll('.recharts-cartesian-axis')).toHaveLength(
      2,
    );
    expect(elevationProfile.querySelector('.recharts-cartesian-grid')).not.toBeNull();
    expect(elevationProfile.querySelector('.recharts-tooltip-wrapper')).not.toBeNull();
    const nameInput = screen.getByRole('textbox', { name: 'Track name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Planned ridge');
    const savePending = deferred<undefined>();
    const saveLocalTrack = services.database.saveLocalTrack.bind(services.database);
    vi.spyOn(services.database, 'saveLocalTrack').mockImplementation(
      async (summary, content) => {
        await savePending.promise;
        await saveLocalTrack(summary, content);
      },
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saving route…')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Track name' })).toBeDisabled();
    const confirmDiscard = vi.spyOn(window, 'confirm');
    await user.click(screen.getByRole('button', { name: 'Close track' }));
    await user.click(screen.getByRole('button', { name: /^Existing trail/ }));
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'New track' })).toBeVisible();
    expect(screen.getByText('Saving route…')).toBeVisible();
    await waitFor(() => {
      expect(facade.interactionModes.at(-1)).toBe('default');
    });
    act(() => {
      facade.emitPlanningClick({ longitude: 44.66, latitude: 42.68 });
    });
    savePending.resolve(undefined);

    await waitFor(async () => {
      await expect(services.database.listLocalTracks()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'Planned ridge',
            sourceFilename: 'Planned ridge.gpx',
            sourceFormat: 'gpx',
            geometryKind: 'route',
          }),
        ]),
      );
    });
    const summary = (await services.database.listLocalTracks()).find(
      (candidate) => candidate.name === 'Planned ridge',
    );
    if (summary === undefined) throw new Error('Expected saved planned route.');
    const content = await services.database.loadLocalTrackContent(summary.id);
    expect(content.trackPoints[0]).toHaveLength(2);
    expect(
      content.trackPoints[0]?.every((point) => point.elevationMeters !== undefined),
    ).toBe(true);
    expect(route).not.toHaveBeenCalled();
  }, 30_000);

  it('saves accepted route geometry without waiting for elevation', async () => {
    const sampling = { signal: null as AbortSignal | null };
    const sampleMany = vi.fn(
      (_coordinates: readonly ElevationCoordinate[], signal: AbortSignal) => {
        sampling.signal = signal;
        return new Promise<readonly ElevationSample[]>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Elevation sampling aborted.', 'AbortError'));
            },
            { once: true },
          );
        });
      },
    );
    const elevationProvider: ElevationProvider = {
      sample: vi.fn().mockResolvedValue({ status: 'unavailable' }),
      sampleMany,
    };
    const trailRouter: TrailRouter = {
      route: vi.fn().mockRejectedValue(new Error('Line mode must not invoke routing.')),
      dispose: vi.fn(),
    };
    setServices({ ...createTestServices({ trailRouter }), elevationProvider });
    const facade = new FakeMapFacade();
    const user = userEvent.setup();
    renderWorkspaceShell(
      <MapWorkspace facade={facade} mapCanvas={<div>Route planning map</div>} />,
    );
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    await user.click(screen.getByRole('button', { name: 'Plan route' }));
    await user.click(screen.getByRole('button', { name: 'Line' }));
    act(() => {
      facade.emitPlanningClick({ longitude: 44.64, latitude: 42.66 });
    });
    expect(
      await screen.findByText('Click the map to choose the next point.'),
    ).toBeVisible();
    act(() => {
      facade.emitPlanningClick({ longitude: 44.65, latitude: 42.67 });
    });

    expect(await screen.findByText('Preparing terrain and elevation…')).toBeVisible();
    const nameInput = screen.getByRole('textbox', { name: 'Track name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Metadata edit');
    expect(sampleMany).toHaveBeenCalledOnce();
    expect(sampling.signal?.aborted).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(sampling.signal?.aborted).toBe(true);
    await waitFor(async () => {
      const tracks = await services.database.listLocalTracks();
      expect(tracks).toHaveLength(1);
    });
    const [summary] = await services.database.listLocalTracks();
    if (summary === undefined) throw new Error('Expected saved planned route.');
    const content = await services.database.loadLocalTrackContent(summary.id);
    expect(
      content.trackPoints[0]?.every((point) => point.elevationMeters === undefined),
    ).toBe(true);
  });

  it('restarts route elevation after a save failure', async () => {
    const samplingSignals: AbortSignal[] = [];
    const sampleMany = vi.fn(
      (_coordinates: readonly ElevationCoordinate[], signal: AbortSignal) => {
        samplingSignals.push(signal);
        return new Promise<readonly ElevationSample[]>(() => undefined);
      },
    );
    const elevationProvider: ElevationProvider = {
      sample: vi.fn().mockResolvedValue({ status: 'unavailable' }),
      sampleMany,
    };
    const trailRouter: TrailRouter = {
      route: vi.fn().mockRejectedValue(new Error('Line mode must not invoke routing.')),
      dispose: vi.fn(),
    };
    setServices({ ...createTestServices({ trailRouter }), elevationProvider });
    vi.spyOn(services.database, 'saveLocalTrack').mockRejectedValueOnce(
      new Error('Storage unavailable'),
    );
    const facade = new FakeMapFacade();
    const user = userEvent.setup();
    renderWorkspaceShell(
      <MapWorkspace facade={facade} mapCanvas={<div>Route planning map</div>} />,
    );
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    await user.click(screen.getByRole('button', { name: 'Plan route' }));
    await user.click(screen.getByRole('button', { name: 'Line' }));
    act(() => {
      facade.emitPlanningClick({ longitude: 44.64, latitude: 42.66 });
    });
    expect(
      await screen.findByText('Click the map to choose the next point.'),
    ).toBeVisible();
    act(() => {
      facade.emitPlanningClick({ longitude: 44.65, latitude: 42.67 });
    });

    expect(await screen.findByText('Preparing terrain and elevation…')).toBeVisible();
    expect(sampleMany).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Storage unavailable')).toBeVisible();
    await waitFor(() => {
      expect(sampleMany).toHaveBeenCalledTimes(2);
    });
    expect(samplingSignals[0]?.aborted).toBe(true);
    expect(samplingSignals[1]?.aborted).toBe(false);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

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
    expect(screen.getByText('Track and route.gpx · GPX')).toBeVisible();
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

      const importZone = screen.getByRole('region', { name: 'Import track file' });
      expect(within(importZone).getByRole('alert')).toHaveTextContent(
        'Choose a file with a .gpx, .fit, or .kml extension.',
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

  it('shows the track drop target over another tab and opens the imported track', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = renderWorkspaceShell();
    const workspace = container.firstElementChild;
    expect(workspace).not.toBeNull();
    if (workspace === null) return;
    const file = gpxFile('Dropped.gpx');

    fireEvent.dragEnter(workspace, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    const dropTarget = screen.getByRole('region', { name: 'Drop track file' });
    expect(dropTarget).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Satellite imagery', level: 1 }),
    ).toBeVisible();
    expect(screen.getByLabelText('Fake map')).toBeVisible();

    fireEvent.drop(dropTarget, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(screen.getByRole('heading', { name: 'Tracks', level: 1 })).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Close track' }));
    expect(confirm).toHaveBeenCalledWith('Discard this unsaved track?');
  });

  it('shows the track drop target while navigation is collapsed and expands for the imported track', async () => {
    useUiStore.setState({ navigationCollapsed: true });
    const { container } = renderWorkspaceShell();
    const workspace = container.firstElementChild;
    expect(workspace).not.toBeNull();
    if (workspace === null) return;
    const file = gpxFile('Collapsed.gpx');

    fireEvent.dragEnter(workspace, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    const dropTarget = screen.getByRole('region', { name: 'Drop track file' });
    expect(dropTarget).toBeVisible();

    fireEvent.drop(dropTarget, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(screen.getByRole('heading', { name: 'Tracks', level: 1 })).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Hide navigation' })).toBeVisible();
  });

  it('ignores a file drop outside the track drop target', () => {
    useUiStore.setState({ navigationCollapsed: true });
    const { container } = renderWorkspaceShell();
    const workspace = container.firstElementChild;
    expect(workspace).not.toBeNull();
    if (workspace === null) return;
    const file = gpxFile('Outside.gpx');

    fireEvent.dragEnter(workspace, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(screen.getByRole('region', { name: 'Drop track file' })).toBeVisible();

    fireEvent.drop(workspace, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(
      screen.queryByRole('region', { name: 'Drop track file' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'New track' }),
    ).not.toBeInTheDocument();
    expect(useUiStore.getState().activeTab).toBe('satellite');
    expect(useUiStore.getState().navigationCollapsed).toBe(true);
  });
});
