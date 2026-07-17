import { ThemeProvider } from '@mui/material';
import { userEvent } from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from '@/app/App';
import { ApplicationServicesProvider } from '@/app/bootstrap/ApplicationServicesProvider';
import type { ApplicationServices } from '@/app/bootstrap/createApplicationServices';
import { createAppTheme } from '@/app/theme/createAppTheme';
import { useUiStore } from '@/features/app-shell/uiStore';
import { createTestServices } from '../../test/helpers/createTestServices';

let services: ApplicationServices;

beforeEach(async () => {
  services = createTestServices();
  await services.database.delete();
  services = createTestServices();
  useUiStore.setState({
    activeTab: 'tracks',
    developerDrawerOpen: false,
    developerMode: false,
    elevationExpanded: true,
    settingsOpen: false,
  });
});

afterEach(async () => {
  services.database.close();
  await services.database.delete();
  services.queryClient.clear();
});

function renderApp() {
  return render(
    <ApplicationServicesProvider services={services}>
      <ThemeProvider theme={createAppTheme()}>
        <App mapSurface={<div aria-label="Fake map">Local map ready</div>} />
      </ThemeProvider>
    </ApplicationServicesProvider>,
  );
}

describe('App', () => {
  it('navigates intentional empty states and toggles the elevation panel', async () => {
    const user = userEvent.setup();
    renderApp();

    expect(
      screen.getByRole('heading', { name: 'Georgia Routing Planner' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'No tracks loaded' })).toBeVisible();
    expect(screen.getByLabelText('Fake map')).toHaveTextContent('Local map ready');

    await user.click(screen.getByRole('tab', { name: 'Plan' }));
    expect(screen.getByRole('heading', { name: 'No active plan' })).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    expect(screen.getByRole('heading', { name: 'No satellite layer' })).toBeVisible();

    const collapse = screen.getByRole('button', { name: 'Collapse elevation profile' });
    await user.click(collapse);
    expect(
      screen.getByRole('button', { name: 'Expand elevation profile' }),
    ).toBeVisible();
  });

  it('persists developer mode and opens the diagnostics drawer', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    await user.click(
      screen.getByRole('switch', { name: 'Enable developer diagnostics' }),
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));

    const developerButton = await screen.findByRole('button', {
      name: 'Developer diagnostics',
    });
    await user.click(developerButton);
    expect(
      screen.getByRole('heading', { name: 'Developer diagnostics' }),
    ).toBeVisible();

    await waitFor(async () => {
      await expect(services.database.loadUiPreferences()).resolves.toEqual({
        developerMode: true,
      });
    });
  });
});
