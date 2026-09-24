import {
  ThemeProvider,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  userEvent,
  describe,
  expect,
  it,
  vi,
  SatelliteCatalogError,
  RuntimeServicesProvider,
  resolveAppLocale,
  mapLayerStore,
  setSatelliteSearchAnchor,
  activateAppLocale,
  OperationalStatus,
  useUiStore,
  appColors,
  createAppTheme,
  FakeMapFacade,
  createTestServices,
  services,
  setServices,
  setupWorkspaceShellTest,
  renderWorkspaceShell,
  testViewport,
  catalogGatewayReturning,
  catalogGatewayFailing,
  syntheticSatelliteScene,
  gpxFile,
  mockViewportWidth,
  type SatelliteCatalogGateway,
  type SatelliteCatalogResult,
  type UserDataService,
  type UserDataSnapshot,
} from '@test/helpers/workspaceShellTestSupport';

describe('WorkspaceShell', () => {
  setupWorkspaceShellTest();

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
    expect(screen.getByRole('option', { name: 'Custom' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('option', { name: 'Marker' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.click(screen.getByRole('option', { name: 'Point' }));

    expect(searchAreaSource).toHaveTextContent('Point');
  });

  it('resets a context-menu search point when the map viewport moves', async () => {
    services.mapViewport.update(testViewport);
    setSatelliteSearchAnchor({ latitude: 42.1, longitude: 43.4 });
    renderWorkspaceShell();

    const searchAreaSource = screen.getByRole('combobox', {
      name: 'Search area source',
    });
    expect(searchAreaSource).toHaveTextContent('Custom');

    act(() => {
      services.mapViewport.update({
        bounds: { west: 44.3, south: 42.3, east: 45.1, north: 43.1 },
        center: { longitude: 44.7, latitude: 42.7 },
      });
    });

    await waitFor(() => {
      expect(searchAreaSource).toHaveTextContent('Point');
      expect(searchAreaSource).toHaveTextContent('42.7000, 44.7000');
    });
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

    expect(await screen.findByRole('heading', { name: 'Markers' })).toBeVisible();
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

    const openStreetMapSection = screen
      .getByRole('heading', { name: 'OpenStreetMap via OpenFreeMap + OSM Shortbread' })
      .closest('section');
    expect(openStreetMapSection).not.toBeNull();
    if (openStreetMapSection === null) return;
    fireEvent.change(
      within(openStreetMapSection).getByRole('slider', { name: 'Opacity' }),
      {
        target: { value: '60' },
      },
    );

    expect(setOpacity).toHaveBeenLastCalledWith(0.6);
  });

  it('sends satellite checkbox changes and reflects mutually exclusive state', async () => {
    const mapLayers = services.mapLayers;
    if (mapLayers === null) return;
    vi.spyOn(mapLayers, 'restorePersistedState').mockResolvedValue(undefined);
    const setVisibility = vi
      .spyOn(mapLayers, 'setLayerVisibility')
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
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Layers' }));

    const google = screen.getByRole('checkbox', { name: 'Google satellite imagery' });
    await user.click(google);
    expect(setVisibility).toHaveBeenCalledWith('google-satellite', true);
    await user.click(screen.getByRole('checkbox', { name: 'Bing aerial imagery' }));
    expect(setVisibility).toHaveBeenCalledWith('bing-satellite', true);
    await user.click(screen.getByRole('checkbox', { name: 'Esri World Imagery' }));
    expect(setVisibility).toHaveBeenCalledWith('esri-satellite', true);

    act(() => {
      mapLayerStore.setState({
        visibility: {
          ...mapLayerStore.getState().visibility,
          'google-satellite': true,
          'satellite-imagery': false,
        },
      });
    });
    await waitFor(() => {
      expect(
        screen.getByRole('checkbox', { name: 'Google satellite imagery' }),
      ).toBeChecked();
    });
    expect(
      screen.getByRole('checkbox', { name: 'Satellite imagery' }),
    ).not.toBeChecked();
    const openStreetMapSection = screen
      .getByRole('heading', { name: 'OpenStreetMap via OpenFreeMap + OSM Shortbread' })
      .closest('section');
    expect(openStreetMapSection).not.toBeNull();
    if (openStreetMapSection === null) return;
    expect(
      within(openStreetMapSection).getByRole('slider', { name: 'Opacity' }),
    ).toBeEnabled();

    await user.click(screen.getByRole('checkbox', { name: 'Satellite imagery' }));
    expect(setVisibility).toHaveBeenCalledWith('satellite-imagery', true);
    act(() => {
      mapLayerStore.setState({
        visibility: {
          ...mapLayerStore.getState().visibility,
          'google-satellite': false,
          'satellite-imagery': true,
        },
      });
    });
    expect(
      screen.getByRole('checkbox', { name: 'Google satellite imagery' }),
    ).not.toBeChecked();
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Satellite imagery' })).toBeChecked();
    });
  });

  it('controls all imported tracks and their elevation gradient through Layers', async () => {
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

    const elevationGradient = screen.getByRole('checkbox', {
      name: 'Elevation gradient',
    });
    expect(elevationGradient).toBeChecked();
    fireEvent.click(elevationGradient);
    expect(setVisibility).toHaveBeenLastCalledWith('track-elevation-gradient', false);

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
    setServices(
      createTestServices({
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
      }),
    );
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
    setServices(
      createTestServices({
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
      }),
    );
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
    setServices(
      createTestServices({
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
      }),
    );
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
    setServices(
      createTestServices({
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
      }),
    );
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
    setServices(
      createTestServices({
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
      }),
    );
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
    setServices(
      createTestServices({
        satelliteCatalogGateway: { search },
      }),
    );
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
    setServices(
      createTestServices({
        satelliteCatalogGateway: catalogGatewayFailing(
          new SatelliteCatalogError(
            'provider-rate-limited',
            'Earth Search is rate limiting requests. Wait and try again.',
          ),
        ),
      }),
    );
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
        locale: 'en',
        navigationCollapsed: false,
        elevationGradeLegendDismissed: false,
        markerSort: 'created',
        trackSort: 'created',
      });
    });
  });

  it('keeps the logo fixed and restores from its attached chevron', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

    const navigation = screen.getByRole('navigation');
    const projectLogo = screen.getByRole('button', {
      name: 'Hide navigation from Trail Planner logo',
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
    expect(await screen.findByRole('tooltip', { name: 'Trail Planner' })).toBeVisible();
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
    const collapsedProjectLogo = screen.getByRole('button', {
      name: 'Show navigation from Trail Planner logo',
    });
    const collapsedLogoImage =
      within(collapsedProjectLogo).getByTestId('project-logo-image');
    expect(navigation).toBeVisible();
    expect(navigation).toHaveStyle({ width: '94px' });
    expect(
      screen.queryByRole('button', { name: 'Share map view' }),
    ).not.toBeInTheDocument();
    expect(collapsedLogoImage).toHaveStyle({
      width: '52px',
      height: '52px',
    });
    expect(collapsedProjectLogo).toHaveStyle({
      backgroundColor: appColors.brand.deepSpace,
    });
    expect(showNavigation).not.toBe(collapseToggle);
    expect(showNavigation).toHaveStyle({
      width: '36px',
      height: '52px',
    });
    expect(screen.queryByTestId('compact-elevation-profile')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Distance:/u)).not.toBeInTheDocument();
    await user.hover(collapsedProjectLogo);
    expect(await screen.findByRole('tooltip', { name: 'Trail Planner' })).toBeVisible();
    await user.unhover(collapsedProjectLogo);
    await user.hover(showNavigation);
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

  it('switches Settings to Russian without remounting the map and persists it', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell(<div aria-label="Localized map">Map identity</div>);
    const mapSurface = screen.getByLabelText('Localized map');

    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    const settings = screen.getByRole('dialog', { name: 'Settings' });
    expect(within(settings).getByRole('heading', { name: 'Settings' })).toBeVisible();
    await user.click(screen.getByRole('combobox', { name: 'Language' }));
    await user.click(screen.getByRole('option', { name: 'Русский' }));

    expect(
      await within(settings).findByRole('heading', { name: 'Настройки' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Localized map')).toBe(mapSurface);
    await waitFor(async () => {
      await expect(services.database.loadUiPreferences()).resolves.toMatchObject({
        locale: 'ru',
      });
    });
  });

  it('keeps a selected locale active when preference persistence fails', async () => {
    vi.spyOn(services.database, 'saveUiPreferences').mockRejectedValueOnce(
      new Error('write unavailable'),
    );
    const log = vi.spyOn(services.logger, 'log');
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    await user.click(screen.getByRole('combobox', { name: 'Language' }));
    await user.click(screen.getByRole('option', { name: 'Русский' }));

    expect(await screen.findByRole('heading', { name: 'Настройки' })).toBeVisible();
    await waitFor(() => {
      expect(log).toHaveBeenCalledWith({
        level: 'warn',
        name: 'storage.settings.save-failed',
      });
    });
  });

  it('starts Settings in Russian from browser languages without a saved locale', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['ka-GE', 'ru-RU']);
    const preferences = await services.database.loadUiPreferences();
    activateAppLocale(resolveAppLocale(preferences.locale, navigator.languages));
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Open settings' }));

    expect(screen.getByRole('heading', { name: 'Настройки' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Язык' })).toHaveTextContent('Русский');
  });

  it.each([900, 1900])(
    'joins the active-track summary into collapsed navigation at %i pixels',
    async (width) => {
      mockViewportWidth(width);
      const user = userEvent.setup();
      const { container } = renderWorkspaceShell();
      await user.click(screen.getByRole('tab', { name: 'Tracks' }));
      const input = container.querySelector<HTMLInputElement>('input[type="file"]');
      expect(input).not.toBeNull();
      if (input === null) return;

      await user.upload(input, gpxFile());
      await screen.findByRole('heading', { name: 'New track' });
      await user.click(screen.getByRole('button', { name: 'Hide navigation' }));

      const trackSummary = screen.getByRole('button', { name: 'Open tracks' });
      const showNavigation = screen.getByRole('button', { name: 'Show navigation' });
      const collapsedProjectLogo = screen.getByRole('button', {
        name: 'Show navigation from Trail Planner logo',
      });
      const navigation = screen.getByRole('navigation');
      const compactProfile = within(trackSummary).getByTestId(
        'compact-elevation-profile',
      );
      const logo = within(collapsedProjectLogo).getByTestId('project-logo-image');
      expect(navigation).toHaveStyle({ width: '484px' });
      expect(trackSummary).toHaveStyle({ width: '390px', height: '52px' });
      expect(showNavigation).toHaveStyle({ width: '36px', height: '52px' });
      expect(within(trackSummary).getByLabelText('Distance: 1.4 km')).toBeVisible();
      expect(
        within(trackSummary).getByLabelText('Elevation gain: 120 m'),
      ).toBeVisible();
      expect(within(trackSummary).getByLabelText('Elevation loss: 0 m')).toBeVisible();
      expect(compactProfile).toBeVisible();
      expect(logo).toHaveStyle({ width: '52px', height: '52px' });
      expect(screen.getAllByRole('button', { name: 'Show navigation' })).toHaveLength(
        1,
      );
      const tracksTools = container.querySelector<HTMLElement>(
        'aside[aria-label="Tracks tools"]',
      );
      expect(tracksTools).not.toBeNull();
      expect(tracksTools).not.toBeVisible();

      await user.click(showNavigation);
      await waitFor(() => {
        expect(
          within(navigation).queryByTestId('compact-elevation-profile'),
        ).not.toBeInTheDocument();
      });
      if (width < 1900) {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        await user.click(screen.getByRole('button', { name: 'Back to tracks' }));
      }
      await waitFor(() => {
        expect(tracksTools).toBeVisible();
      });
    },
  );

  it('opens tracks from the collapsed track summary without changing other expand controls', async () => {
    mockViewportWidth(1900);
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile());
    await screen.findByRole('heading', { name: 'New track' });
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(screen.getByRole('button', { name: 'Hide navigation' }));
    await user.click(
      screen.getByRole('button', { name: 'Show navigation from Trail Planner logo' }),
    );
    expect(screen.getByRole('tab', { name: 'Satellite' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Hide navigation' }));
    await user.click(screen.getByRole('button', { name: 'Show navigation' }));
    expect(screen.getByRole('tab', { name: 'Satellite' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Hide navigation' }));
    await user.click(screen.getByRole('button', { name: 'Open tracks' }));
    expect(screen.getByRole('tab', { name: 'Tracks' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('keeps the smartphone disclosure expandable without profile data after failure', async () => {
    mockViewportWidth(899);
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const sampleMany = vi
      .spyOn(provider, 'sampleMany')
      .mockRejectedValue(new Error('Terrain unavailable'));
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Terrain failure.gpx'));
    const disclosure = await screen.findByRole('button', {
      name: 'Expand unsaved track details',
    });
    await waitFor(() => {
      expect(sampleMany).toHaveBeenCalledOnce();
    });
    expect(
      within(disclosure).queryByTestId('compact-elevation-profile'),
    ).not.toBeInTheDocument();
    expect(within(disclosure).queryByLabelText(/^Distance:/u)).not.toBeInTheDocument();
  });

  it('omits the desktop summary when profile preparation fails', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    vi.spyOn(provider, 'sampleMany').mockRejectedValue(
      new Error('Terrain unavailable'),
    );
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Terrain failure.gpx'));
    expect(await screen.findByText('Terrain unavailable')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Hide navigation' }));

    const navigation = screen.getByRole('navigation');
    const showNavigation = screen.getByRole('button', { name: 'Show navigation' });
    expect(navigation).toHaveStyle({ width: '94px' });
    expect(showNavigation).toHaveStyle({ width: '36px', height: '52px' });
    expect(
      screen.queryByRole('button', { name: 'Open tracks' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('compact-elevation-profile')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Distance:/u)).not.toBeInTheDocument();
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

  it('shows determinate Mosaic render progress in the map Ready area', () => {
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      lifecycle: 'ready',
    });
    mapLayerStore.setState({
      appliedMosaic: {
        status: 'loading',
        selectedDate: '2026-07-20',
        sceneKeys: ['sentinel-2-l2a:first', 'sentinel-2-l2a:second'],
        coveragePercent: 25,
        oldestAcquisitionDate: '2026-07-20',
        renderProgress: { renderedSceneCount: 2, totalSceneCount: 8 },
      },
    });
    render(
      <RuntimeServicesProvider services={services}>
        <ThemeProvider theme={createAppTheme()}>
          <OperationalStatus />
        </ThemeProvider>
      </RuntimeServicesProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Rendering Mosaic images · 2/8',
    );
    expect(
      screen.getByRole('progressbar', { name: 'Rendering Mosaic images' }),
    ).toHaveAttribute('aria-valuenow', '25');
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

  it('places User before Settings and activates it without an unmatched Tabs value', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useUiStore.setState({ developerMode: true });
    renderWorkspaceShell();

    const userButton = screen.getByRole('button', { name: 'User' });
    const settingsButton = screen.getByRole('button', { name: 'Open settings' });
    expect(
      userButton.compareDocumentPosition(settingsButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const diagnosticsButton = screen.getByRole('button', {
      name: 'Developer diagnostics',
    });
    expect(
      diagnosticsButton.compareDocumentPosition(userButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(userButton);
    expect(userButton).toHaveAttribute('aria-pressed', 'true');

    expect(window.location.hash).toBe('#user');
    expect(screen.getByText(/Account features are not configured/)).toBeVisible();
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('The `value` provided to the Tabs component is invalid'),
    );
  });

  it('renders muted default rail controls and white selected controls', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ developerMode: true });
    renderWorkspaceShell();

    const userButton = screen.getByRole('button', { name: 'User' });
    const satelliteTab = screen.getByRole('tab', { name: 'Satellite' });
    const mutedControls = [
      screen.getByRole('tab', { name: 'Tracks' }),
      screen.getByRole('tab', { name: 'Layers' }),
      screen.getByRole('tab', { name: 'Markers' }),
      screen.getByRole('button', { name: 'Share map view' }),
      screen.getByRole('button', { name: 'Developer diagnostics' }),
      userButton,
      screen.getByRole('button', { name: 'Open settings' }),
      screen.getByRole('button', { name: 'About this site' }),
    ];

    for (const control of mutedControls) {
      expect(control).toHaveStyle({ color: appColors.text.inverseMuted });
    }

    expect(satelliteTab).toHaveStyle({
      backgroundColor: appColors.interaction.navigationSelectedBackground,
      color: appColors.text.inverse,
    });

    await user.click(userButton);

    expect(satelliteTab).toHaveStyle({ color: appColors.text.inverseMuted });
    expect(userButton).toHaveAttribute('aria-pressed', 'true');
    expect(userButton).toHaveStyle({
      backgroundColor: appColors.interaction.navigationSelectedBackground,
      color: appColors.text.inverse,
    });
  });

  it('shows error, active, and successful synchronization colors on User', async () => {
    let snapshot: UserDataSnapshot = {
      busy: false,
      email: 'sync@example.test',
      userId: 'user-id',
      errorMessage: 'Synchronization failed.',
      noticeMessage: null,
      status: 'signed-in',
      syncEnabled: true,
      syncStatus: 'error',
      syncProgress: null,
      syncUsage: { usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 },
      remoteTrackDeletions: [],
      remoteMarkerDeletions: [],
    };
    const listeners = new Set<() => void>();
    const userData = {
      ...services.userData,
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } satisfies UserDataService;
    setServices({ ...services, userData });
    renderWorkspaceShell();

    const expectIndicator = (label: string, color: string) => {
      const button = screen.getByRole('button', { name: label });
      const indicator = button.querySelector('.MuiBadge-badge');
      expect(indicator).not.toBeNull();
      expect(indicator).toHaveStyle({ backgroundColor: color });
    };
    const setSyncStatus = (syncStatus: UserDataSnapshot['syncStatus']) => {
      act(() => {
        snapshot = { ...snapshot, syncStatus };
        for (const listener of listeners) listener();
      });
    };

    expectIndicator('User synchronization failed', appColors.status.error);
    setSyncStatus('syncing');
    await waitFor(() => {
      expectIndicator('User synchronization in progress', appColors.brand.tigerOrange);
    });
    setSyncStatus('success');
    await waitFor(() => {
      expectIndicator('User synchronization successful', appColors.status.success);
    });
  });
});
