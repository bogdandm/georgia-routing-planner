import { ThemeProvider } from '@mui/material';
import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type {
  UserDataService,
  UserDataSnapshot,
} from '@/application/user/UserDataService';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { UserPanel } from '@/presentation/user/UserPanel';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { createTestServices } from '@test/helpers/createTestServices';

function snapshot(status: UserDataSnapshot['status']): UserDataSnapshot {
  return {
    busy: false,
    email: null,
    userId: null,
    errorMessage: null,
    noticeMessage: null,
    status,
    syncEnabled: false,
    syncStatus: 'idle',
    syncProgress: null,
    syncUsage: { usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 },
    remoteTrackDeletions: [],
  };
}

function createService(initial: UserDataSnapshot) {
  let current = initial;
  const listeners = new Set<() => void>();
  const signIn = vi.fn().mockResolvedValue(undefined);
  const signUp = vi.fn().mockResolvedValue(undefined);
  const setSyncEnabled = vi.fn().mockResolvedValue(undefined);
  const synchronizeNow = vi.fn().mockResolvedValue(undefined);
  const service: UserDataService = {
    dispose: vi.fn(),
    getSnapshot: () => current,
    signIn,
    signOut: vi.fn().mockResolvedValue(undefined),
    signUp,
    setSyncEnabled,
    subscribeTracksChanged: () => () => undefined,
    resolveRemoteTrackDeletions: vi.fn().mockResolvedValue(undefined),
    synchronizeNow,
    trackDeleted: vi.fn().mockResolvedValue(undefined),
    trackMetadataChanged: vi.fn().mockResolvedValue(undefined),
    trackSaved: vi.fn().mockResolvedValue(undefined),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    service,
    signIn,
    signUp,
    setSyncEnabled,
    synchronizeNow,
    set(next: UserDataSnapshot) {
      current = next;
      for (const listener of listeners) listener();
    },
  };
}

function renderPanel(userData: UserDataService) {
  return render(
    <RuntimeServicesProvider services={createTestServices({ userData })}>
      <ThemeProvider theme={createAppTheme()}>
        <UserPanel />
      </ThemeProvider>
    </RuntimeServicesProvider>,
  );
}

function accountButton(name: 'Create account' | 'Sign in', index: number) {
  const button = screen.getAllByRole('button', { name })[index];
  if (button === undefined) throw new Error(`Missing ${name} button.`);
  return button;
}

describe('UserPanel', () => {
  it('submits sign-in credentials and clears the password', async () => {
    const userData = createService(snapshot('signed-out'));
    const user = userEvent.setup();
    renderPanel(userData.service);
    await user.type(
      screen.getByRole('textbox', { name: 'Email' }),
      'user@example.test',
    );
    await user.type(screen.getByLabelText(/Password/u), 'password');
    await user.click(accountButton('Sign in', 1));
    expect(userData.signIn).toHaveBeenCalledWith('user@example.test', 'password');
    expect(screen.getByLabelText(/Password/u)).toHaveValue('');
  });

  it('submits create-account credentials and announces confirmation', async () => {
    const userData = createService(snapshot('signed-out'));
    const user = userEvent.setup();
    renderPanel(userData.service);
    await user.click(accountButton('Create account', 0));
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'new@example.test');
    await user.type(screen.getByLabelText(/Password/u), 'password');
    await user.click(accountButton('Create account', 1));
    expect(userData.signUp).toHaveBeenCalledWith('new@example.test', 'password');
    act(() => {
      userData.set({
        ...snapshot('signed-out'),
        noticeMessage: 'Check your email to confirm your account, then sign in.',
      });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Check your email');
  });

  it('clears credentials after external sign-in then sign-out', async () => {
    const userData = createService(snapshot('signed-out'));
    const user = userEvent.setup();
    renderPanel(userData.service);
    await user.type(
      screen.getByRole('textbox', { name: 'Email' }),
      'user@example.test',
    );
    await user.type(screen.getByLabelText(/Password/u), 'password');
    act(() => {
      userData.set({ ...snapshot('signed-in'), email: 'user@example.test' });
    });
    act(() => {
      userData.set(snapshot('signed-out'));
    });
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('');
    expect(screen.getByLabelText(/Password/u)).toHaveValue('');
  });

  it('starts with an empty password after the panel is reopened', async () => {
    const userData = createService(snapshot('signed-out'));
    const user = userEvent.setup();
    const rendered = renderPanel(userData.service);
    await user.type(screen.getByLabelText(/Password/u), 'password');
    rendered.unmount();
    renderPanel(userData.service);
    expect(screen.getByLabelText(/Password/u)).toHaveValue('');
  });

  it('shows signed-in, busy, and error states', () => {
    renderPanel(
      createService({ ...snapshot('signed-in'), email: 'user@example.test' }).service,
    );
    expect(screen.getByText('user@example.test')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  it('announces a busy registration error', () => {
    renderPanel(
      createService({
        ...snapshot('error'),
        busy: true,
        errorMessage: 'Unable to create an account. Try again.',
      }).service,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to create an account');
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  });

  it('toggles synchronization and shows reservation-aware quota errors', async () => {
    const userData = createService({
      ...snapshot('signed-in'),
      email: 'user@example.test',
      errorMessage: 'Cloud track storage is full.',
      syncEnabled: true,
      syncStatus: 'error',
      syncUsage: {
        usedBytes: 2 * 1024 * 1024,
        reservedBytes: 1024 * 1024,
        limitBytes: 8_388_608,
      },
    });
    const user = userEvent.setup();
    renderPanel(userData.service);

    expect(screen.getByLabelText('Sync across devices')).toBeChecked();
    expect(screen.getByText('2.00 MiB / 8 MiB (1.00 MiB reserved)')).toBeVisible();
    expect(
      screen.getByRole('progressbar', { name: 'Cloud track quota' }),
    ).toHaveAttribute('aria-valuenow', '37.5');
    expect(screen.getByRole('alert')).toHaveTextContent('Cloud track storage is full.');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();

    await user.click(screen.getByLabelText('Sync across devices'));
    expect(userData.setSyncEnabled).toHaveBeenCalledWith(false);
  });

  it('shows support identity and controls manual synchronization progress', async () => {
    const userData = createService({
      ...snapshot('signed-in'),
      email: 'user@example.test',
      userId: 'user-id',
      syncEnabled: true,
    });
    const user = userEvent.setup();
    renderPanel(userData.service);

    expect(screen.getByText('User ID')).toBeVisible();
    expect(screen.getByText('user-id')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(userData.synchronizeNow).toHaveBeenCalledOnce();

    act(() => {
      userData.set({
        ...snapshot('signed-in'),
        email: 'user@example.test',
        userId: 'user-id',
        syncEnabled: true,
        syncStatus: 'syncing',
        syncProgress: { completedTracks: 1, totalTracks: 10 },
      });
    });
    expect(screen.getByText('Synchronizing… 1/10')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();

    act(() => {
      userData.set({
        ...snapshot('signed-in'),
        email: 'user@example.test',
        userId: 'user-id',
      });
    });
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();

    act(() => {
      userData.set({
        ...snapshot('signed-in'),
        busy: true,
        email: 'user@example.test',
        userId: 'user-id',
        syncEnabled: true,
      });
    });
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();

    act(() => {
      userData.set({
        ...snapshot('signed-in'),
        email: 'user@example.test',
        userId: 'user-id',
        syncEnabled: true,
        syncStatus: 'needs-action',
        remoteTrackDeletions: [{ trackId: 'local:pending', name: 'Pending' }],
      });
    });
    expect(screen.getByText('Synchronization needs your decision')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    expect(screen.getByLabelText('Sync across devices')).toBeDisabled();
  });

  it('hides synchronization controls after sign-out', () => {
    const userData = createService({
      ...snapshot('signed-in'),
      email: 'user@example.test',
      syncEnabled: true,
    });
    renderPanel(userData.service);

    act(() => {
      userData.set(snapshot('signed-out'));
    });

    expect(screen.queryByLabelText('Sync across devices')).not.toBeInTheDocument();
  });

  it('explains the unconfigured local-only state', () => {
    renderPanel(createService(snapshot('unconfigured')).service);
    expect(screen.getByText(/Account features are not configured/)).toBeVisible();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });
});
