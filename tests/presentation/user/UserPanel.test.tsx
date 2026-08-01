import { ThemeProvider } from '@mui/material';
import { render, screen } from '@testing-library/react';
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

function createUserDataService(snapshot: UserDataSnapshot) {
  const signIn = vi.fn().mockResolvedValue(undefined);
  const service: UserDataService = {
    dispose: vi.fn(),
    getSnapshot: () => snapshot,
    signIn,
    signOut: vi.fn().mockResolvedValue(undefined),
    subscribe: () => () => undefined,
  };
  return { service, signIn };
}

function renderPanel(userData: UserDataService) {
  const services = createTestServices({ userData });
  return render(
    <RuntimeServicesProvider services={services}>
      <ThemeProvider theme={createAppTheme()}>
        <UserPanel />
      </ThemeProvider>
    </RuntimeServicesProvider>,
  );
}

describe('UserPanel', () => {
  it('renders an accessible password sign-in form for signed-out users', async () => {
    const { service: userData, signIn } = createUserDataService({
      busy: false,
      email: null,
      errorMessage: null,
      status: 'signed-out',
    });
    const user = userEvent.setup();
    renderPanel(userData);

    await user.type(
      screen.getByRole('textbox', { name: 'Email' }),
      'user@example.test',
    );
    await user.type(screen.getByLabelText(/Password/u), 'password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(signIn).toHaveBeenCalledWith('user@example.test', 'password');
  });

  it('shows the connected user and sign-out control', () => {
    renderPanel(
      createUserDataService({
        busy: false,
        email: 'user@example.test',
        errorMessage: null,
        status: 'signed-in',
      }).service,
    );

    expect(screen.getByText('user@example.test')).toBeVisible();
    expect(screen.getByText('Connected')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  it('explains the unconfigured local-only state without a form', () => {
    renderPanel(
      createUserDataService({
        busy: false,
        email: null,
        errorMessage: null,
        status: 'unconfigured',
      }).service,
    );

    expect(screen.getByText(/Account features are not configured/)).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Email' })).not.toBeInTheDocument();
  });

  it('announces busy and authentication error states', () => {
    renderPanel(
      createUserDataService({
        busy: true,
        email: null,
        errorMessage: 'Unable to sign in. Check your email and password.',
        status: 'error',
      }).service,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to sign in');
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  });
});
