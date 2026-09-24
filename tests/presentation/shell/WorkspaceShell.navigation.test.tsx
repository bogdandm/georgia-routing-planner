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
  mapLayerStore,
  mapInteractionStore,
  requestWeatherForecast,
  useUiStore,
  FakeMapFacade,
  services,
  setServices,
  setupWorkspaceShellTest,
  renderWorkspaceShell,
  testViewport,
  syntheticSatelliteScene,
  deferred,
  type SatelliteMosaicResult,
} from '@test/helpers/workspaceShellTestSupport';

describe('WorkspaceShell', () => {
  setupWorkspaceShellTest();

  it('aligns the labeled sharing action with primary rail tabs', () => {
    renderWorkspaceShell();

    const navigation = screen.getByRole('navigation', {
      name: 'Workspace navigation',
    });
    const tabs = within(navigation).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Tracks',
      'Markers',
      'Layers',
      'Satellite',
      'Weather',
    ]);

    const satellite = within(navigation).getByRole('tab', { name: 'Satellite' });
    const share = within(navigation).getByRole('button', {
      name: 'Share map view',
    });
    expect(share).toHaveTextContent('Share');
    expect(share).toHaveStyle({ minWidth: '52px', minHeight: '58px' });
    expect(
      satellite.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

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

  it('opens public site information from the rail action below Settings', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

    const settingsButton = screen.getByRole('button', { name: 'Open settings' });
    const aboutButton = screen.getByRole('button', { name: 'About this site' });
    expect(
      settingsButton.compareDocumentPosition(aboutButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(aboutButton);

    const about = screen.getByRole('dialog', {
      name: 'About Trail Planner',
    });
    expect(about).toBeVisible();
    expect(within(about).getByText('Bogdan Kalashnikov')).toBeVisible();
    expect(
      within(about).getByRole('link', { name: 'GitHub repository' }),
    ).toHaveAttribute('href', 'https://github.com/bogdandm/georgia-routing-planner');
    expect(
      within(about).getByRole('link', { name: 'nominatim.openstreetmap.org' }),
    ).toBeVisible();
    expect(
      within(about).getByText(
        'OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors',
      ),
    ).toBeVisible();
    expect(
      within(about).getByText('Copernicus Sentinel data · Earth Search / Element 84'),
    ).toBeVisible();
    expect(
      within(about).getByRole('link', { name: 'Google satellite imagery' }),
    ).toHaveAttribute('href', 'https://mt0.google.com');
    expect(
      within(about).getByRole('link', { name: 'Bing aerial imagery' }),
    ).toHaveAttribute('href', 'https://ecn.t0.tiles.virtualearth.net');
    expect(
      within(about).getByRole('link', { name: 'Esri World Imagery' }),
    ).toHaveAttribute('href', 'https://server.arcgisonline.com');
    expect(
      within(about).getByRole('link', { name: 'NAPR orthophoto mosaic' }),
    ).toHaveAttribute('href', 'https://nt0.napr.gov.ge');
    expect(within(about).getByText('© Google')).toBeVisible();
    expect(
      within(about).getByText(
        'Imagery: National Agency of Public Registry (NAPR), orthophotos 2016–2017, 2020, and 2025',
      ),
    ).toBeVisible();
    expect(
      within(about).getByRole('link', { name: 'api.open-meteo.com' }),
    ).toHaveAttribute('href', 'https://api.open-meteo.com/v1/forecast');
    expect(within(about).getByText('Point weather forecast.')).toBeVisible();
    expect(
      within(about).getByRole('link', { name: 'ECMWF IFS via Open-Meteo' }),
    ).toHaveAttribute('href', 'https://open-meteo.com/');
    expect(
      within(about).getByText(
        'Deterministic 9 km model forecast; not a measured weather-station observation.',
      ),
    ).toBeVisible();
    expect(within(about).getByRole('link', { name: 'Data licence' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/',
    );
    expect(about).not.toHaveTextContent('@');
    expect(about).toHaveStyle({
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    });
    const aboutStyle = window.getComputedStyle(about);
    expect(aboutStyle.maxWidth).toBe('calc(100% - 32px)');
    const aboutTitle = within(about).getByRole('heading', {
      name: 'About Trail Planner',
    });
    const aboutTitleStyle = window.getComputedStyle(aboutTitle);
    expect(aboutTitleStyle.paddingLeft).toBe('16px');
    expect(aboutTitleStyle.paddingTop).toBe('12px');
    expect(aboutTitleStyle.paddingBottom).toBe('12px');
    expect(aboutTitleStyle.paddingRight).toBe('48px');

    const aboutContent = aboutTitle.nextElementSibling;
    expect(aboutContent).not.toBeNull();
    if (aboutContent === null) {
      throw new Error('Expected About content to follow its title.');
    }
    const aboutContentStyle = window.getComputedStyle(aboutContent);
    expect(aboutContentStyle.paddingLeft).toBe('16px');
    expect(aboutContentStyle.paddingTop).toBe('0px');
    expect(aboutContentStyle.paddingBottom).toBe('12px');
    expect(aboutContentStyle.paddingRight).toBe('16px');

    expect(
      within(about).getByRole('button', { name: 'Close site information' }),
    ).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(about).not.toBeInTheDocument();
    await waitFor(() => {
      expect(aboutButton).toHaveFocus();
    });
  });
  it('deduplicates a custom vector attribution that already credits OpenStreetMap', async () => {
    const configuredMapProviders = services.mapProviderConfiguration;
    if (configuredMapProviders.status !== 'valid') {
      throw new Error('Expected configured map providers');
    }
    setServices({
      ...services,
      mapProviderConfiguration: {
        status: 'valid',
        value: {
          ...configuredMapProviders.value,
          vector: {
            ...configuredMapProviders.value.vector,
            attribution:
              '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
          },
        },
      },
    });
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'About this site' }));

    const about = screen.getByRole('dialog', {
      name: 'About Trail Planner',
    });
    expect(
      within(about).getByText(
        'OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors',
      ),
    ).toBeVisible();
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
    ).toEqual(['Tracks', 'Markers', 'Layers', 'Satellite', 'Weather']);
    expect(screen.getByRole('button', { name: 'User' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Tracks' })).not.toHaveAttribute(
      'aria-disabled',
    );
    expect(screen.getByRole('tab', { name: 'Markers' })).not.toHaveAttribute(
      'aria-disabled',
    );
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    expect(screen.getByRole('heading', { name: 'Tracks', level: 1 })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Browse track file' })).toBeEnabled();
    expect(screen.getByText('Drop GPX, FIT, or KML here')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Create GPX' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Markers' }));
    expect(await screen.findByRole('heading', { name: 'Markers' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Sort markers. Current: Newest' }),
    ).toBeVisible();
    const markerWeatherSettings = await screen.findByRole('button', {
      name: 'Marker weather settings. Forecast days: Sat, Sun',
    });
    expect(markerWeatherSettings).toHaveTextContent('Sat, Sun');
    await user.click(markerWeatherSettings);
    expect(screen.getByRole('heading', { name: 'Marker weather' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Marker weather' })).toBeNull();
    });
    await user.click(screen.getByRole('tab', { name: 'Layers' }));
    expect(
      screen.queryByRole('heading', { name: 'Map visibility' }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('complementary', { name: 'Layers tools' })).getAllByRole(
        'separator',
      ),
    ).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Satellites', level: 3 })).toBeVisible();
    expect(
      screen.getByRole('heading', {
        name: 'Copernicus Sentinel-2 via Earth Search',
        level: 4,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', {
        name: 'OpenStreetMap via OpenFreeMap + OSM Shortbread',
      }),
    ).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Natural features' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Restricted areas' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'OSM detail' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Hiking paths' })).toBeChecked();
    expect(screen.getByRole('slider', { name: 'Opacity' })).toHaveValue('100');
    expect(screen.getByRole('slider', { name: 'Opacity' })).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: 'Google satellite imagery' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('checkbox', { name: 'Google satellite imagery' }),
    ).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'NAPR Orthophoto' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'NAPR Orthophoto' })).not.toBeChecked();
    expect(
      screen.getByText(
        'Newest available NAPR orthophoto: 2025, then 2020, then 2016–2017.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Satellite imagery' })).toBeDisabled();
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
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('tab', { name: 'Weather' }));
    expect(window.location.hash).toBe('#weather');
    expect(screen.getByRole('heading', { name: 'Weather', level: 1 })).toBeVisible();
    expect(screen.getByText('Select a forecast point')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Select forecast point' })).toBeVisible();
    expect(mapInteractionStore.getState().weatherPointSelectionActive).toBe(false);
    expect(mapInteractionStore.getState().weatherForecastRequest).toBeNull();
  }, 10_000);
  it('retains the loaded Weather forecast across workspace navigation', async () => {
    const user = userEvent.setup();
    const execute = vi.spyOn(services.pointWeatherForecast, 'execute');
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Weather' }));
    act(() => {
      requestWeatherForecast({ longitude: 44.8271, latitude: 41.7151 });
    });
    const location = await screen.findByRole('button', {
      name: 'Center map on forecast location',
    });
    expect(within(location).getByText('41.71510, 44.82710')).toBeVisible();
    expect(within(location).getByText('1,234 m')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    expect(
      screen.getByRole('heading', { name: 'Satellite imagery', level: 1 }),
    ).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Weather' }));

    const retainedLocation = screen.getByRole('button', {
      name: 'Center map on forecast location',
    });
    expect(within(retainedLocation).getByText('41.71510, 44.82710')).toBeVisible();
    expect(within(retainedLocation).getByText('1,234 m')).toBeVisible();
    expect(execute).toHaveBeenCalledOnce();
  });
  it('links the selected Weather point to Meteoblue and Windy forecasts', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Weather' }));
    const selectPointButton = screen.getByRole('button', {
      name: 'Select forecast point',
    });
    const forecastLinksButton = screen.getByRole('button', {
      name: 'More weather actions',
    });
    expect(forecastLinksButton).toBeDisabled();
    expect(
      selectPointButton.compareDocumentPosition(forecastLinksButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    act(() => {
      requestWeatherForecast({ longitude: 44.8271, latitude: 41.7151 });
    });
    await screen.findByRole('button', {
      name: 'Center map on forecast location',
    });

    expect(forecastLinksButton).toBeEnabled();
    await user.click(forecastLinksButton);

    const meteoblueLink = screen.getByRole('menuitem', {
      name: 'Open meteoblue.com',
    });
    const windyLink = screen.getByRole('menuitem', {
      name: 'Open windy.com',
    });
    expect(meteoblueLink).toHaveAttribute(
      'href',
      'https://www.meteoblue.com/en/weather/week/41.7151N44.8271E',
    );
    expect(windyLink).toHaveAttribute('href', 'https://www.windy.com/41.7151/44.8271');
    expect(meteoblueLink.querySelector('svg')).not.toBeNull();
    expect(windyLink.querySelector('svg')).not.toBeNull();
    for (const link of screen.getAllByRole('menuitem')) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });
  it('shows a nearby POI in the Weather header and centers the map from it', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Weather' }));
    act(() => {
      requestWeatherForecast(
        { longitude: 44.8073, latitude: 41.6918 },
        'Narikala Fortress',
      );
    });

    const location = await screen.findByRole('button', {
      name: 'Center map on forecast location',
    });
    expect(within(location).getByText('Narikala Fortress')).toBeVisible();
    expect(within(location).queryByText('41.69180, 44.80730')).not.toBeInTheDocument();
    expect(within(location).getByText('1,234 m')).toBeVisible();

    await user.click(location);
    expect(mapInteractionStore.getState().navigationCommand).toMatchObject({
      target: { longitude: 44.8073, latitude: 41.6918 },
    });
  });
  function setupMosaic() {
    const mapLayers = services.mapLayers;
    const searchSatelliteMosaic = services.searchSatelliteMosaic;
    expect(mapLayers).not.toBeNull();
    expect(searchSatelliteMosaic).not.toBeNull();
    if (mapLayers === null || searchSatelliteMosaic === null)
      throw new Error('Expected Mosaic services.');
    const scene = syntheticSatelliteScene('mosaic-scene', '2026-07-17T10:12:00.000Z');
    const result: SatelliteMosaicResult = {
      scenes: [scene],
      coveragePercent: 100,
      oldestAcquisitionDate: '2026-07-17',
      archiveExhausted: false,
    };
    services.mapViewport.settle(testViewport);
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      lifecycle: 'ready',
      terrainMode: 'flat',
    });
    const clearMosaic = vi.spyOn(mapLayers, 'clearMosaic').mockImplementation(() => {
      mapLayerStore.setState({ appliedMosaic: { status: 'empty' } });
      return { status: 'success' };
    });
    vi.spyOn(mapLayers, 'clearScene').mockReturnValue({ status: 'success' });
    vi.spyOn(mapLayers, 'beginMosaic').mockImplementation((selectedDate) => {
      mapLayerStore.setState({
        appliedMosaic: {
          status: 'loading',
          selectedDate,
          sceneKeys: [],
          coveragePercent: 0,
          oldestAcquisitionDate: null,
          renderProgress: null,
        },
      });
      return { status: 'success' };
    });
    const applyMosaic = vi
      .spyOn(mapLayers, 'applyMosaic')
      .mockImplementation((_scenes, _viewport, selectedDate) => {
        mapLayerStore.setState({
          appliedMosaic: {
            status: 'ready',
            selectedDate,
            sceneKeys: ['sentinel-2-l2a:mosaic-scene'],
            coveragePercent: 100,
            oldestAcquisitionDate: '2026-07-17',
          },
        });
        return Promise.resolve({ status: 'success' });
      });
    const firstSearch = deferred<SatelliteMosaicResult>();
    const search = vi
      .spyOn(searchSatelliteMosaic, 'execute')
      .mockImplementationOnce(() => firstSearch.promise)
      .mockResolvedValue(result);
    return { applyMosaic, clearMosaic, firstSearch, result, search, scene };
  }

  async function renderReadyMosaic(selectedDate = '17 Jul 2026') {
    const setup = setupMosaic();
    const user = userEvent.setup();
    renderWorkspaceShell();
    await user.click(screen.getByRole('button', { name: 'Mosaic' }));
    await user.click(screen.getByRole('gridcell', { name: selectedDate }));
    await user.click(screen.getByRole('button', { name: 'Show mosaic' }));
    await waitFor(() => {
      expect(setup.search).toHaveBeenCalledTimes(1);
    });
    setup.firstSearch.resolve(setup.result);
    await waitFor(() => {
      expect(setup.applyMosaic).toHaveBeenCalledTimes(1);
    });
    return { ...setup, user };
  }

  it('enters Mosaic and cancels a superseded date search', async () => {
    const { clearMosaic, search, scene } = setupMosaic();
    const user = userEvent.setup();
    renderWorkspaceShell();
    await user.click(screen.getByRole('button', { name: 'Mosaic' }));
    await user.click(screen.getByRole('gridcell', { name: '17 Jul 2026' }));
    await user.click(screen.getByRole('button', { name: 'Show mosaic' }));
    await waitFor(() => {
      expect(search).toHaveBeenCalledTimes(1);
    });
    const firstSignal = search.mock.calls[0]?.[1];
    expect(screen.getByText('Searching Sentinel archive…')).toBeVisible();
    await user.click(screen.getByRole('gridcell', { name: '18 Jul 2026' }));
    expect(firstSignal?.aborted).toBe(true);
    expect(clearMosaic).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Show mosaic' }));
    await waitFor(() => {
      expect(search).toHaveBeenCalledTimes(2);
      expect(search).toHaveBeenLastCalledWith(
        { viewport: testViewport, selectedDate: '2026-07-18', productLevel: 'L2A' },
        expect.any(AbortSignal),
      );
    });
    await waitFor(() => {
      expect(mapLayerStore.getState().appliedMosaic).toMatchObject({
        status: 'ready',
        selectedDate: '2026-07-18',
        sceneKeys: ['sentinel-2-l2a:' + scene.id],
      });
    });
  });

  it('refreshes a ready Mosaic after an off-pane viewport change', async () => {
    const { applyMosaic, search, user } = await renderReadyMosaic('18 Jul 2026');
    const refreshedViewport = {
      bounds: { west: 44.2, south: 42.1, east: 44.8, north: 42.7 },
      center: { longitude: 44.5, latitude: 42.4 },
    } as const;
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    act(() => {
      services.mapViewport.markMoving();
    });
    act(() => {
      services.mapViewport.settle(refreshedViewport);
    });
    await waitFor(() => {
      expect(search).toHaveBeenCalledTimes(2);
      expect(applyMosaic).toHaveBeenLastCalledWith(
        expect.any(Array),
        refreshedViewport,
        '2026-07-18',
        expect.any(AbortSignal),
      );
    });
    await user.click(screen.getByRole('tab', { name: 'Layers' }));
    expect(screen.getByRole('checkbox', { name: 'Satellite imagery' })).toBeChecked();
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    expect(screen.getByText('Coverage: 100.0%')).toBeVisible();
    expect(screen.getByText('Rendered images: 1')).toBeVisible();
    expect(screen.getByText('Date range: 17 Jul 2026 to 18 Jul 2026')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mosaic' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('clears Mosaic before starting a new date range', async () => {
    const { clearMosaic, user } = await renderReadyMosaic();
    await user.click(screen.getByRole('button', { name: 'Mosaic' }));
    expect(clearMosaic).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Mosaic' }));
    expect(screen.getByRole('button', { name: 'Show mosaic' })).toBeDisabled();
    expect(screen.getByRole('gridcell', { name: '17 Jul 2026' })).not.toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(mapLayerStore.getState().appliedMosaic).toMatchObject({ status: 'empty' });
  });
});
