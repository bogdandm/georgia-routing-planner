import {
  strFromU8,
  unzipSync,
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
  TrackShareError,
  mapInteractionStore,
  useUiStore,
  services,
  setServices,
  setupWorkspaceShellTest,
  renderWorkspaceShell,
  savedTrackSummary,
  savedTrackContent,
  trackShareToken,
  createTrackShareService,
  renderSavedTrackForSharing,
  multiTrackSummary,
  multiTrackContent,
  saveMultiTrackPair,
  testViewport,
  gpxFile,
  deferred,
  readBlob,
  requiredBlob,
  mockViewportWidth,
  type ElevationSample,
  type LocalTrackContent,
  type LocalTrackSummary,
} from '@test/helpers/workspaceShellTestSupport';

describe('WorkspaceShell', () => {
  setupWorkspaceShellTest();

  it('renders click-ordered multi-track geometry and read-only details', async () => {
    const { alphaContent, betaContent } = await saveMultiTrackPair();
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const pendingRecalculation = deferred<readonly ElevationSample[]>();
    vi.spyOn(provider, 'sampleMany').mockImplementation(
      (_coordinates, _signal, onProgress) => {
        onProgress?.({
          completedSamples: 1,
          totalSamples: 3,
          indices: [0],
          samples: [{ status: 'available', meters: 1_000 }],
        });
        return pendingRecalculation.promise;
      },
    );
    const mapLayers = services.mapLayers;
    expect(mapLayers).not.toBeNull();
    if (mapLayers === null) return;
    const setImportedTrackGeometry = vi.spyOn(mapLayers, 'setImportedTrackGeometry');
    const setImportedTrackHighlight = vi.spyOn(mapLayers, 'setImportedTrackHighlight');
    const clearImportedTrackGeometry = vi.spyOn(
      mapLayers,
      'clearImportedTrackGeometry',
    );
    useUiStore.setState({ activeTab: 'tracks' });
    mockViewportWidth(1900);
    const user = userEvent.setup();
    renderWorkspaceShell();

    const ordinaryDetails = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    expect(
      within(ordinaryDetails).getByRole('heading', { name: 'Alpha trail' }),
    ).toBeVisible();
    await user.click(
      within(ordinaryDetails).getByRole('button', {
        name: 'Recalculate elevation',
      }),
    );
    expect(await screen.findByText('Loading elevation: 33%')).toBeVisible();
    const toggle = screen.getByRole('button', {
      name: 'Select multiple tracks',
    });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const savedTracks = screen.getByRole('list', { name: 'Saved tracks' });
    const alphaRow = within(savedTracks).getByRole('button', {
      name: /^Alpha trail/u,
    });
    const betaRow = within(savedTracks).getByRole('button', {
      name: /^Beta trail/u,
    });
    expect(alphaRow).toHaveAttribute('aria-pressed', 'true');

    await user.click(betaRow);
    const details = await screen.findByRole('complementary', {
      name: 'Multiple track details',
    });
    expect(
      within(details).getByRole('heading', { name: 'Selected tracks' }),
    ).toBeVisible();
    await waitFor(() => {
      expect(betaRow).toHaveAttribute('aria-pressed', 'true');
    });
    const alphaSection = within(details).getByLabelText('Alpha trail track details');
    const betaSection = within(details).getByLabelText('Beta trail track details');
    expect(
      alphaSection.compareDocumentPosition(betaSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const combined = within(details).getByRole('group', {
      name: 'Combined track details',
    });
    expect(within(combined).getByLabelText('Distance: 3.0 km')).toBeVisible();
    expect(within(combined).getByLabelText('Recorded time: 1h 30m')).toBeVisible();
    expect(within(combined).getByLabelText('Average speed: 2.0 km/h')).toBeVisible();
    expect(within(combined).getByLabelText('Elevation gain: 300 m')).toBeVisible();
    expect(within(combined).getByLabelText('Elevation loss: 240 m')).toBeVisible();
    expect(within(alphaSection).getByLabelText('Distance: 1.0 km')).toBeVisible();
    expect(within(betaSection).getByLabelText('Distance: 2.0 km')).toBeVisible();
    expect(
      within(alphaSection).getByRole('img', {
        name: /Elevation profile from/u,
      }),
    ).toBeVisible();
    expect(
      within(betaSection).getByRole('img', {
        name: /Elevation profile from/u,
      }),
    ).toBeVisible();
    expect(
      within(details).queryByRole('heading', { name: 'Track details' }),
    ).not.toBeInTheDocument();
    expect(
      within(details).queryByRole('heading', { name: 'Elevation profile' }),
    ).not.toBeInTheDocument();
    for (const actionName of [
      'Track actions',
      'Close track',
      'Confirm rename',
      'Save',
      'Discard',
      'Recalculate elevation',
    ]) {
      expect(
        within(details).queryByRole('button', { name: actionName }),
      ).not.toBeInTheDocument();
    }
    expect(within(details).queryByText('Climbs & descents')).not.toBeInTheDocument();
    expect(within(details).queryByText(/fixture\.gpx/u)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(setImportedTrackGeometry).toHaveBeenLastCalledWith([
        [alphaContent.trackPoints[0]?.map((point) => point.coordinate)],
        [betaContent.trackPoints[0]?.map((point) => point.coordinate)],
      ]);
    });
    await waitFor(() => {
      const highlighted = setImportedTrackHighlight.mock.calls.at(-1)?.[0];
      expect(highlighted).not.toBeNull();
      expect(
        highlighted?.some((segment) =>
          segment.coordinates.some((coordinate) => coordinate[0] === 44),
        ),
      ).toBe(true);
      expect(
        highlighted?.some((segment) =>
          segment.coordinates.some((coordinate) => coordinate[0] === 45),
        ),
      ).toBe(true);
    });

    await user.click(alphaRow);
    await waitFor(() => {
      expect(setImportedTrackGeometry).toHaveBeenLastCalledWith([
        [betaContent.trackPoints[0]?.map((point) => point.coordinate)],
      ]);
    });
    await user.click(alphaRow);
    const reorderedDetails = await screen.findByRole('complementary', {
      name: 'Multiple track details',
    });
    const reorderedBeta = within(reorderedDetails).getByLabelText(
      'Beta trail track details',
    );
    const reorderedAlpha = within(reorderedDetails).getByLabelText(
      'Alpha trail track details',
    );
    expect(
      reorderedBeta.compareDocumentPosition(reorderedAlpha) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(betaRow);
    await user.click(alphaRow);
    await waitFor(() => {
      expect(
        screen.queryByRole('complementary', {
          name: 'Multiple track details',
        }),
      ).not.toBeInTheDocument();
      expect(clearImportedTrackGeometry).toHaveBeenCalled();
    });
  });

  it('downloads a saved track from the primary header action', async () => {
    const summary = savedTrackSummary('local:download', 'Ridge / trail');
    const content = savedTrackContent(summary.id);
    await services.database.saveLocalTrack(summary, content);
    await services.database.saveLatestOpenedTrackId(summary.id);
    useUiStore.setState({ activeTab: 'tracks' });

    let captureDownload = false;
    let downloadedBlob: Blob | null = null;
    let downloadedFilename: string | null = null;
    let downloadedHref: string | null = null;
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((object) => {
        if (captureDownload && object instanceof Blob) downloadedBlob = object;
        return 'blob:track-download';
      });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        if (!captureDownload) return;
        downloadedFilename = this.download;
        downloadedHref = this.href;
      });
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL');
    const user = userEvent.setup();
    renderWorkspaceShell();

    const details = await screen.findByRole('complementary', { name: 'Track details' });
    const download = within(details).getByRole('button', { name: 'Download GPX' });
    const actions = within(details).getByRole('button', { name: 'Track actions' });
    expect(
      download.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const createObjectUrlCallCount = createObjectUrl.mock.calls.length;
    const clickCallCount = click.mock.calls.length;
    captureDownload = true;
    await user.click(download);
    captureDownload = false;

    expect(createObjectUrl.mock.calls).toHaveLength(createObjectUrlCallCount + 1);
    expect(click.mock.calls).toHaveLength(clickCallCount + 1);
    expect(downloadedFilename).toBe('Ridge - trail.gpx');
    expect(downloadedHref).toContain('blob:track-download');
    expect(revokeObjectUrl).toHaveBeenLastCalledWith('blob:track-download');
    const blob = requiredBlob(downloadedBlob);
    expect(blob.type).toBe('application/gpx+xml');
    const downloadedGpx = new TextDecoder().decode(await readBlob(blob));
    expect(downloadedGpx).toContain('<name>Ridge / trail</name>');
    expect(downloadedGpx).toContain('lat="42" lon="44"');

    await user.click(actions);
    const menu = await screen.findByRole('menu');
    expect(
      within(menu).queryByRole('menuitem', { name: 'Download GPX' }),
    ).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Download KML' })).toBeVisible();
  });

  it('downloads selected tracks in click order as ZIP', async () => {
    const { beta, betaContent } = await saveMultiTrackPair();
    await services.database.saveLatestOpenedTrackId(null);
    useUiStore.setState({ activeTab: 'tracks' });
    mockViewportWidth(1900);

    const pendingBeta = deferred<LocalTrackContent>();
    const loadLocalTrackContent = services.database.loadLocalTrackContent.bind(
      services.database,
    );
    vi.spyOn(services.database, 'loadLocalTrackContent').mockImplementation(
      (trackId) =>
        trackId === beta.id ? pendingBeta.promise : loadLocalTrackContent(trackId),
    );
    let captureDownload = false;
    let downloadedBlob: Blob | null = null;
    let downloadedFilename: string | null = null;
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((object) => {
        if (captureDownload && object instanceof Blob) downloadedBlob = object;
        return 'blob:selected-tracks';
      });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        if (!captureDownload) return;
        downloadedFilename = this.download;
      });
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL');
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Select multiple tracks' }));
    const savedTracks = await screen.findByRole('list', { name: 'Saved tracks' });
    const betaRow = within(savedTracks).getByRole('button', {
      name: /^Beta trail/u,
    });
    const alphaRow = within(savedTracks).getByRole('button', {
      name: /^Alpha trail/u,
    });
    await user.click(betaRow);

    const details = await screen.findByRole('complementary', {
      name: 'Multiple track details',
    });
    const download = within(details).getByRole('button', {
      name: 'Download selected tracks',
    });
    expect(download).toBeDisabled();

    pendingBeta.resolve(betaContent);
    await user.click(alphaRow);
    await waitFor(() => {
      expect(download).toBeEnabled();
    });
    const close = within(details).getByRole('button', {
      name: 'Close multi-track view',
    });
    expect(
      download.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const createObjectUrlCallCount = createObjectUrl.mock.calls.length;
    const clickCallCount = click.mock.calls.length;
    captureDownload = true;
    await user.click(download);
    captureDownload = false;

    expect(createObjectUrl.mock.calls).toHaveLength(createObjectUrlCallCount + 1);
    expect(click.mock.calls).toHaveLength(clickCallCount + 1);
    expect(downloadedFilename).toBe('selected-tracks.zip');
    expect(revokeObjectUrl).toHaveBeenLastCalledWith('blob:selected-tracks');
    const blob = requiredBlob(downloadedBlob);
    expect(blob.type).toBe('application/zip');
    const archive = unzipSync(await readBlob(blob));
    expect(Object.keys(archive)).toEqual(['Beta trail.gpx', 'Alpha trail.gpx']);
    expect(strFromU8(archive['Beta trail.gpx'] ?? new Uint8Array())).toContain(
      'lat="42" lon="45"',
    );
    expect(strFromU8(archive['Alpha trail.gpx'] ?? new Uint8Array())).toContain(
      'lat="42" lon="44"',
    );
    expect(strFromU8(archive['Beta trail.gpx'] ?? new Uint8Array())).toContain(
      '<name>Beta trail</name>',
    );
    expect(strFromU8(archive['Alpha trail.gpx'] ?? new Uint8Array())).toContain(
      '<name>Alpha trail</name>',
    );
  });

  it('omits partial optional totals from multi-track combined details', async () => {
    const alpha = multiTrackSummary(
      'local:complete',
      'Complete trail',
      1_000,
      1_800,
      100,
      80,
      44,
    );
    const incompleteBase = savedTrackSummary('local:incomplete', 'Incomplete trail');
    const incomplete: LocalTrackSummary = {
      ...incompleteBase,
      metrics: {
        ...incompleteBase.metrics,
        distanceMeters: 2_000,
        startCoordinate: [45, 42],
        endCoordinate: [45.01, 42.01],
        bounds: {
          west: 45,
          south: 42,
          east: 45.01,
          north: 42.01,
          crossesAntimeridian: false,
        },
        center: [45.005, 42.005],
      },
    };
    await services.database.saveLocalTrack(alpha, multiTrackContent(alpha.id, 44));
    await services.database.saveLocalTrack(
      incomplete,
      multiTrackContent(incomplete.id, 45),
    );
    await services.database.saveLatestOpenedTrackId(alpha.id);
    useUiStore.setState({ activeTab: 'tracks' });
    mockViewportWidth(1900);
    const user = userEvent.setup();
    renderWorkspaceShell();

    const ordinaryDetails = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    expect(
      within(ordinaryDetails).getByRole('heading', { name: 'Complete trail' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Select multiple tracks' }));
    await user.click(
      within(screen.getByRole('list', { name: 'Saved tracks' })).getByRole('button', {
        name: /^Incomplete trail/u,
      }),
    );
    const combined = await screen.findByRole('group', {
      name: 'Combined track details',
    });
    expect(within(combined).getByLabelText('Distance: 3.0 km')).toBeVisible();
    expect(within(combined).queryByLabelText(/Recorded time:/u)).toBeNull();
    expect(within(combined).queryByLabelText(/Average speed:/u)).toBeNull();
    expect(within(combined).queryByLabelText(/Elevation gain:/u)).toBeNull();
    expect(within(combined).queryByLabelText(/Elevation loss:/u)).toBeNull();
  });

  it('keeps multi-track transitions transient and preserves the ordinary active track', async () => {
    const { beta } = await saveMultiTrackPair();
    useUiStore.setState({ activeTab: 'tracks' });
    mockViewportWidth(1900);
    const user = userEvent.setup();
    const firstRender = renderWorkspaceShell();

    await screen.findByRole('heading', { name: 'Alpha trail' });
    const toggle = screen.getByRole('button', {
      name: 'Select multiple tracks',
    });
    await user.click(toggle);
    await user.click(
      within(screen.getByRole('list', { name: 'Saved tracks' })).getByRole('button', {
        name: /^Beta trail/u,
      }),
    );
    await screen.findByLabelText('Beta trail track details');
    await expect(services.database.loadLatestOpenedTrackId()).resolves.toBe(
      'local:alpha',
    );

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(
      within(screen.getByRole('complementary', { name: 'Track details' })).getByRole(
        'heading',
        { name: 'Alpha trail' },
      ),
    ).toBeVisible();
    await user.click(toggle);
    await user.click(
      within(screen.getByRole('list', { name: 'Saved tracks' })).getByRole('button', {
        name: /^Beta trail/u,
      }),
    );
    await screen.findByLabelText('Beta trail track details');

    firstRender.unmount();
    renderWorkspaceShell();

    const restoredToggle = await screen.findByRole('button', {
      name: 'Select multiple tracks',
    });
    expect(restoredToggle).toHaveAttribute('aria-pressed', 'false');
    const restoredDetails = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    expect(
      within(restoredDetails).getByRole('heading', { name: 'Alpha trail' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('complementary', { name: 'Multiple track details' }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Saved tracks' })).getByRole('button', {
        name: new RegExp(`^${beta.name}`, 'u'),
      }),
    ).not.toHaveAttribute('aria-pressed');
  });

  it('uses the discard confirmation before entering empty multi-track mode', async () => {
    useUiStore.setState({ activeTab: 'tracks' });
    mockViewportWidth(1900);
    const confirm = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;
    await user.upload(input, gpxFile());
    await screen.findByRole('heading', { name: 'New track' });
    const toggle = screen.getByRole('button', {
      name: 'Select multiple tracks',
    });

    confirm.mockReturnValueOnce(false);
    await user.click(toggle);
    expect(confirm).toHaveBeenCalledWith('Discard this unsaved track?');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('complementary', { name: 'Track details' })).toBeVisible();

    confirm.mockReturnValueOnce(true);
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.queryByRole('complementary', { name: 'Track details' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: 'Multiple track details' }),
    ).not.toBeInTheDocument();
  });

  it('reopens dismissed multi-track details after another selection', async () => {
    await saveMultiTrackPair();
    await services.database.saveLatestOpenedTrackId(null);
    useUiStore.setState({ activeTab: 'tracks' });
    mockViewportWidth(1200);
    const user = userEvent.setup();
    renderWorkspaceShell();

    const savedTracks = await screen.findByRole('list', {
      name: 'Saved tracks',
    });
    const toggle = screen.getByRole('button', {
      name: 'Select multiple tracks',
    });
    await user.click(toggle);
    await user.click(
      within(savedTracks).getByRole('button', { name: /^Alpha trail/u }),
    );
    const initialDetails = await screen.findByRole('complementary', {
      name: 'Multiple track details',
    });
    await user.click(
      within(initialDetails).getByRole('button', { name: 'Back to tracks' }),
    );

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const updatedSavedTracks = screen.getByRole('list', { name: 'Saved tracks' });
    expect(
      within(updatedSavedTracks).getByRole('button', { name: /^Alpha trail/u }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.queryByRole('complementary', { name: 'Multiple track details' }),
    ).not.toBeInTheDocument();

    await user.click(
      within(updatedSavedTracks).getByRole('button', { name: /^Beta trail/u }),
    );
    const reopened = await screen.findByRole('complementary', {
      name: 'Multiple track details',
    });
    expect(within(reopened).getByLabelText('Alpha trail track details')).toBeVisible();
    expect(within(reopened).getByLabelText('Beta trail track details')).toBeVisible();
  });

  it('keeps mobile multi-track row selection open until the combined disclosure is expanded', async () => {
    await saveMultiTrackPair();
    await services.database.saveLatestOpenedTrackId(null);
    useUiStore.setState({ activeTab: 'tracks', mobileWorkspaceOpen: true });
    mockViewportWidth(899);
    const user = userEvent.setup();
    renderWorkspaceShell();

    const toggle = screen.getByRole('button', {
      name: 'Select multiple tracks',
    });
    await user.click(toggle);
    const savedTracks = await screen.findByRole('list', { name: 'Saved tracks' });
    await user.click(
      within(savedTracks).getByRole('button', { name: /^Alpha trail/u }),
    );
    await user.click(within(savedTracks).getByRole('button', { name: /^Beta trail/u }));

    expect(screen.getByRole('complementary', { name: 'Tracks tools' })).toBeVisible();
    expect(
      screen.queryByRole('complementary', { name: 'Multiple track details' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show map' }));
    const disclosure = await screen.findByRole('button', {
      name: 'Expand multiple track details',
    });
    expect(within(disclosure).getByLabelText('Distance: 3.0 km')).toBeVisible();
    expect(within(disclosure).queryByTestId('compact-elevation-profile')).toBeNull();

    await user.click(disclosure);
    expect(
      await screen.findByRole('complementary', {
        name: 'Multiple track details',
      }),
    ).toBeVisible();
  });

  it('returns to the map before beginning mobile marker placement and cancels on tab change', async () => {
    mockViewportWidth(899);
    services.mapViewport.update(testViewport);
    useUiStore.setState({ activeTab: 'markers', mobileWorkspaceOpen: true });
    renderWorkspaceShell();

    const createMarker = await screen.findByRole('button', { name: 'New marker' });
    await waitFor(() => {
      expect(createMarker).toBeEnabled();
    });
    fireEvent.click(createMarker);
    expect(useUiStore.getState().mobileWorkspaceOpen).toBe(false);
    expect(mapInteractionStore.getState().markerPlacement).not.toBeNull();

    act(() => {
      useUiStore.getState().setActiveTab('satellite');
    });
    await waitFor(() => {
      expect(mapInteractionStore.getState().markerPlacement).toBeNull();
    });
  });

  it('shares the open track from the Share dialog on top of the map link', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const status = vi.fn().mockResolvedValue({ enabled: false });
    const enable = vi.fn().mockResolvedValue({
      enabled: true,
      token: trackShareToken,
    });
    const disable = vi.fn().mockResolvedValue(undefined);
    const { details, summary } = await renderSavedTrackForSharing(
      createTrackShareService({ status, enable, disable }),
    );

    await user.click(within(details).getByRole('button', { name: 'Track actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Share…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share' });
    const tracks = within(dialog).getByRole('list', { name: 'Tracks' });
    const share = await within(tracks).findByRole('switch', {
      name: 'Share Shared trail publicly',
    });
    expect(status).toHaveBeenCalledWith(summary.contentHash, expect.any(AbortSignal));
    expect(share).not.toBeChecked();
    const copyTrack = within(tracks).getByRole('button', { name: 'Copy link' });
    expect(copyTrack).toBeDisabled();
    // The map's own copy button sits above the table, outside it.
    const copyMap = within(dialog).getByRole('button', { name: 'Copy map link' });
    expect(
      copyMap.compareDocumentPosition(tracks) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(share);
    await waitFor(() => {
      expect(
        within(tracks).getByRole('switch', { name: 'Share Shared trail publicly' }),
      ).toBeChecked();
    });
    expect(enable).toHaveBeenCalledWith(summary.contentHash, expect.any(AbortSignal));
    expect(writeText).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(copyTrack).toBeEnabled();
    });
    await user.click(copyTrack);
    const mapLink = within(dialog).getByRole<HTMLInputElement>('textbox', {
      name: 'Link',
    }).value;
    const trackLink = new URL(String(writeText.mock.calls[0]?.[0]));
    expect(trackLink.hash).toBe(`#tracks/share/1.${trackShareToken}`);
    expect(trackLink.search).toBe(new URL(mapLink).search);
    expect(trackLink.searchParams.get('map')).toBe('2');
    await waitFor(() => {
      expect(copyTrack).toHaveAccessibleName('Copied');
    });

    await user.click(copyMap);
    expect(writeText).toHaveBeenLastCalledWith(mapLink);
    expect(new URL(mapLink).hash).not.toContain('share');

    await user.click(
      within(tracks).getByRole('switch', { name: 'Share Shared trail publicly' }),
    );
    await waitFor(() => {
      expect(disable).toHaveBeenCalledWith(
        summary.contentHash,
        expect.any(AbortSignal),
      );
      expect(
        within(tracks).getByRole('switch', { name: 'Share Shared trail publicly' }),
      ).not.toBeChecked();
    });
    expect(copyTrack).toBeDisabled();
  });

  it('shows a spinner instead of the track Share switch while status loads', async () => {
    const user = userEvent.setup();
    const statusResult = deferred<{ readonly enabled: false }>();
    const { details } = await renderSavedTrackForSharing(
      createTrackShareService({ status: vi.fn(() => statusResult.promise) }),
    );

    await user.click(within(details).getByRole('button', { name: 'Track actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Share…' }));
    const tracks = within(
      await screen.findByRole('dialog', { name: 'Share' }),
    ).getByRole('list', { name: 'Tracks' });
    expect(
      within(tracks).getByRole('progressbar', { name: 'Loading sharing status' }),
    ).toBeVisible();
    expect(within(tracks).queryByRole('switch')).not.toBeInTheDocument();

    statusResult.resolve({ enabled: false });
    expect(
      await within(tracks).findByRole('switch', {
        name: 'Share Shared trail publicly',
      }),
    ).toBeEnabled();
  });

  it('keeps a track shared and reports a denied track-link copy', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const { details } = await renderSavedTrackForSharing(
      createTrackShareService({
        status: vi.fn().mockResolvedValue({ enabled: true, token: trackShareToken }),
      }),
    );

    await user.click(within(details).getByRole('button', { name: 'Track actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Share…' }));
    const tracks = within(
      await screen.findByRole('dialog', { name: 'Share' }),
    ).getByRole('list', { name: 'Tracks' });
    const copyTrack = within(tracks).getByRole('button', { name: 'Copy link' });
    await waitFor(() => {
      expect(copyTrack).toBeEnabled();
    });
    await user.click(copyTrack);

    expect(
      await within(tracks).findByText('The link could not be copied. Try again.'),
    ).toBeVisible();
    expect(copyTrack).toHaveAccessibleName('Copy link');
    expect(
      within(tracks).getByRole('switch', { name: 'Share Shared trail publicly' }),
    ).toBeChecked();
  });

  it('keeps a track unshared when it is not ready on the server', async () => {
    const user = userEvent.setup();
    const enable = vi
      .fn()
      .mockRejectedValue(new TrackShareError('track-not-ready', 'Not ready'));
    const { details } = await renderSavedTrackForSharing(
      createTrackShareService({ enable }),
    );

    await user.click(within(details).getByRole('button', { name: 'Track actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Share…' }));
    const tracks = within(
      await screen.findByRole('dialog', { name: 'Share' }),
    ).getByRole('list', { name: 'Tracks' });
    await user.click(
      await within(tracks).findByRole('switch', {
        name: 'Share Shared trail publicly',
      }),
    );

    expect(
      await within(tracks).findByText('Sync this track before sharing.'),
    ).toBeVisible();
    expect(
      within(tracks).getByRole('switch', { name: 'Share Shared trail publicly' }),
    ).not.toBeChecked();
  });

  it('lists every multi-track selection and asks a signed-out user to sign in', async () => {
    await saveMultiTrackPair();
    setServices({ ...services, trackShares: createTrackShareService() });
    useUiStore.setState({ activeTab: 'tracks' });
    mockViewportWidth(1900);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await screen.findByRole('complementary', { name: 'Track details' });
    await user.click(screen.getByRole('button', { name: 'Select multiple tracks' }));
    const savedTracks = screen.getByRole('list', { name: 'Saved tracks' });
    await user.click(within(savedTracks).getByRole('button', { name: /^Beta trail/u }));
    await screen.findByRole('complementary', { name: 'Multiple track details' });

    await user.click(screen.getByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share' });
    const tracks = within(dialog).getByRole('list', { name: 'Tracks' });
    expect(within(dialog).getByText('Sign in to share tracks publicly.')).toBeVisible();
    for (const name of ['Alpha trail', 'Beta trail']) {
      expect(
        within(tracks).getByRole('switch', { name: `Share ${name} publicly` }),
      ).toBeDisabled();
    }
    for (const copy of within(tracks).getAllByRole('button', { name: 'Copy link' })) {
      expect(copy).toBeDisabled();
    }
  });

  it('opens a shared link read-only and saves an independent local copy', async () => {
    const token = 'B'.repeat(43);
    const resolve = vi.fn().mockResolvedValue({
      contentHash: 'b'.repeat(64),
      metadata: {
        name: 'Recipient trail',
        sourceFormat: 'gpx',
        geometryKind: 'track',
        updatedAt: '2026-08-29T00:00:00.000Z',
      },
      trackPoints: [
        [
          { coordinate: [44, 42], elevationMeters: 1_000 },
          { coordinate: [44.01, 42.01], elevationMeters: 1_120 },
        ],
      ],
    });
    setServices({
      ...services,
      trackShares: createTrackShareService({ resolve }),
    });
    window.history.replaceState(null, '', `/#tracks/share/1.${token}`);
    useUiStore.setState({ activeTab: 'tracks' });
    const user = userEvent.setup();
    renderWorkspaceShell();

    expect(
      await screen.findByRole('heading', { name: 'Recipient trail' }),
    ).toBeVisible();
    const sharedTrackLabel = screen.getByText('Shared track');
    expect(sharedTrackLabel).toBeVisible();
    expect(sharedTrackLabel).toHaveStyle({
      flex: '1 1 0%',
      textAlign: 'left',
    });
    expect(sharedTrackLabel.parentElement).toHaveStyle({
      width: '100%',
      alignItems: 'center',
      justifyContent: 'flex-end',
    });
    const discard = screen.getByRole('button', { name: 'Discard' });
    const saveCopy = screen.getByRole('button', { name: 'Save a copy' });
    expect(
      sharedTrackLabel.compareDocumentPosition(discard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      sharedTrackLabel.compareDocumentPosition(saveCopy) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(resolve).toHaveBeenCalledWith(token, expect.any(AbortSignal));
    expect(await services.database.listLocalTracks()).toHaveLength(0);
    expect(
      screen.queryByRole('complementary', { name: 'Multiple track details' }),
    ).not.toBeInTheDocument();
    const multiTrackToggle = screen.getByRole('button', {
      name: 'Select multiple tracks',
    });
    await user.click(multiTrackToggle);
    expect(multiTrackToggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Save a copy' }));

    await waitFor(async () => {
      expect(await services.database.listLocalTracks()).toHaveLength(1);
    });
    await waitFor(() => {
      expect(window.location.hash).toBe('#tracks');
    });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Recipient trail' }),
    ).toBeVisible();
  });

  it('opens the smartphone workspace to show an invalid shared-track link', async () => {
    window.history.replaceState(null, '', '/#tracks/share/1.invalid');
    useUiStore.setState({ activeTab: 'tracks' });
    mockViewportWidth(899);
    renderWorkspaceShell();

    expect(await screen.findByText('This track link is invalid.')).toBeVisible();
    expect(useUiStore.getState().mobileWorkspaceOpen).toBe(true);
  });
});
