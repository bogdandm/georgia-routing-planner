import {
  screen,
  waitFor,
  userEvent,
  describe,
  expect,
  it,
  vi,
  useUiStore,
  services,
  setupWorkspaceShellTest,
  renderWorkspaceShell,
  mockViewportWidth,
  gpxFile,
} from '@test/helpers/workspaceShellTestSupport';

function tourDialog() {
  return screen.queryByRole('dialog', {
    name: /Map and controls|Tracks|Track details/,
  });
}

describe('WorkspaceShell onboarding tour', () => {
  setupWorkspaceShellTest();

  it('opens on the first desktop visit and is remembered once skipped', async () => {
    useUiStore.setState({ onboardingCompleted: false });
    const user = userEvent.setup();
    renderWorkspaceShell();

    expect(screen.getByRole('dialog', { name: 'Map and controls' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'Tracks' })).toBeVisible();
    expect(useUiStore.getState().activeTab).toBe('tracks');

    await user.click(screen.getByRole('button', { name: 'Skip tour' }));

    expect(tourDialog()).not.toBeInTheDocument();
    expect(useUiStore.getState().activeTab).toBe('satellite');
    await waitFor(async () => {
      await expect(services.database.loadUiPreferences()).resolves.toMatchObject({
        onboardingCompleted: true,
      });
    });
  });

  it('reopens from the rail after it was completed', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();
    expect(tourDialog()).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show tour' }));

    expect(screen.getByRole('dialog', { name: 'Map and controls' })).toBeVisible();
  });

  it('stays closed on smartphones and shared-track links, which never get the example', async () => {
    useUiStore.setState({ onboardingCompleted: false });
    mockViewportWidth(899);
    const { unmount } = renderWorkspaceShell();
    expect(tourDialog()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show tour' })).not.toBeInTheDocument();
    unmount();

    mockViewportWidth(1920);
    window.history.replaceState(null, '', `/#tracks/share/1.${'A'.repeat(43)}`);
    renderWorkspaceShell();
    expect(tourDialog()).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Show tour' }));
    expect(screen.getByText('1 of 7')).toBeVisible();
  });

  it('shows the example track as an unsaved preview and discards it on close', async () => {
    const fetchExample = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(gpxFile()) }),
    );
    vi.stubGlobal('fetch', fetchExample);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Show tour' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('dialog', { name: 'Track details' })).toBeVisible();
    expect(fetchExample).toHaveBeenCalledWith(
      expect.stringMatching(/onboarding\/sakhizare-from-above\.gpx$/),
    );
    expect(
      await screen.findByRole('heading', { name: 'New track', hidden: true }),
    ).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'New track', hidden: true }),
      ).not.toBeInTheDocument();
    });
    await expect(services.database.localTracks.count()).resolves.toBe(0);
  });
});
