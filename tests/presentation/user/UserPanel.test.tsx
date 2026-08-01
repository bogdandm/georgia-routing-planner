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
  return { busy: false, email: null, errorMessage: null, noticeMessage: null, status };
}

function createService(initial: UserDataSnapshot) {
  let current = initial;
  const listeners = new Set<() => void>();
  const signIn = vi.fn().mockResolvedValue(undefined);
  const signUp = vi.fn().mockResolvedValue(undefined);
  const service: UserDataService = {
    dispose: vi.fn(),
    getSnapshot: () => current,
    signIn,
    signOut: vi.fn().mockResolvedValue(undefined),
    signUp,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    service,
    signIn,
    signUp,
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
        busy: true,
        email: null,
        errorMessage: 'Unable to create an account. Try again.',
        noticeMessage: null,
        status: 'error',
      }).service,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to create an account');
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  });

  it('explains the unconfigured local-only state', () => {
    renderPanel(createService(snapshot('unconfigured')).service);
    expect(screen.getByText(/Account features are not configured/)).toBeVisible();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });
});
