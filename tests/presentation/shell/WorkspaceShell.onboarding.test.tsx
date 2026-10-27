import type { UserEvent } from '@testing-library/user-event';

import {
  screen,
  within,
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
    name: /Map and controls|Help|Tracks|Track details/,
  });
}

async function startTourFromHelp(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Help' }));
  await user.click(screen.getByRole('button', { name: 'Take a tour!' }));
}

describe('WorkspaceShell onboarding tour', () => {
  setupWorkspaceShellTest();

  it('opens on the first desktop visit and is remembered once skipped', async () => {
    useUiStore.setState({ onboardingCompleted: false });
    const user = userEvent.setup();
    renderWorkspaceShell();

    expect(screen.getByRole('dialog', { name: 'Map and controls' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const help = screen.getByRole('dialog', { name: 'Help' });
    expect(within(help).getByRole('heading', { name: 'Map legend' })).toBeVisible();
    expect(
      within(help).getByRole('heading', { name: 'Keyboard shortcuts' }),
    ).toBeVisible();
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

  it('opens help from the rail, and its tour button starts the tour', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();
    expect(tourDialog()).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Help' }));
    const help = screen.getByRole('dialog', { name: 'Help' });
    expect(within(help).getByRole('heading', { name: 'Map legend' })).toBeVisible();
    const shortcuts = within(help).getByRole('region', { name: 'Keyboard shortcuts' });
    expect(within(shortcuts).getByText('Save the track').nextSibling).toHaveTextContent(
      'CtrlS',
    );

    await user.click(within(help).getByRole('button', { name: 'Take a tour!' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Help' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('dialog', { name: 'Map and controls' })).toBeVisible();
  });

  it('keeps help on touch phones, without keyboard shortcuts or the tour', async () => {
    useUiStore.setState({ onboardingCompleted: false });
    mockViewportWidth(899, { touch: true });
    const user = userEvent.setup();
    renderWorkspaceShell();
    expect(tourDialog()).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    await user.click(screen.getByRole('button', { name: 'Help' }));

    const help = screen.getByRole('dialog', { name: 'Help' });
    expect(within(help).getByRole('heading', { name: 'Map legend' })).toBeVisible();
    expect(within(help).queryByText('Keyboard shortcuts')).not.toBeInTheDocument();
    expect(
      within(help).queryByRole('button', { name: 'Take a tour!' }),
    ).not.toBeInTheDocument();
  });

  it('never opens by itself from shared-track links, which never get the example', async () => {
    window.history.replaceState(null, '', `/#tracks/share/1.${'A'.repeat(43)}`);
    useUiStore.setState({ onboardingCompleted: false });
    const user = userEvent.setup();
    renderWorkspaceShell();
    expect(tourDialog()).not.toBeInTheDocument();

    await startTourFromHelp(user);
    expect(screen.getByText('1 of 8')).toBeVisible();
  });

  it('shows the example track as an unsaved preview and discards it on close', async () => {
    const fetchExample = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(gpxFile()) }),
    );
    vi.stubGlobal('fetch', fetchExample);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await startTourFromHelp(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
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
