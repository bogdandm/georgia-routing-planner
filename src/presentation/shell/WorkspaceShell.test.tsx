import { ThemeProvider } from '@mui/material';
import { userEvent } from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { useUiStore } from '@/presentation/shell/uiStore';
import { WorkspaceShell } from '@/presentation/shell/WorkspaceShell';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { createTestServices } from '../../../test/helpers/createTestServices';

let services: RuntimeServices;

beforeEach(async () => {
  services = createTestServices();
  await services.database.delete();
  services = createTestServices();
  useUiStore.setState({
    activeTab: 'tracks',
    developerDrawerOpen: false,
    developerMode: false,
    mapDebugOptions: { showCollisionBoxes: false, showTileBoundaries: false },
    settingsOpen: false,
  });
});

afterEach(async () => {
  services.database.close();
  await services.database.delete();
  services.queryClient.clear();
});

function renderWorkspaceShell() {
  return render(
    <RuntimeServicesProvider services={services}>
      <ThemeProvider theme={createAppTheme()}>
        <WorkspaceShell mapSurface={<div aria-label="Fake map">Local map ready</div>} />
      </ThemeProvider>
    </RuntimeServicesProvider>,
  );
}

describe('WorkspaceShell', () => {
  it('navigates the contextual feature panels without covering the map', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

    expect(screen.getByRole('heading', { name: 'Tracks', level: 1 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'No tracks loaded' })).toBeVisible();
    expect(screen.getByLabelText('Fake map')).toHaveTextContent('Local map ready');

    expect(screen.queryByRole('tab', { name: 'Plan' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Markers' }));
    expect(screen.getByRole('heading', { name: 'No saved markers' })).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Layers' }));
    expect(
      screen.getByRole('heading', { name: 'Layer controls are not available yet' }),
    ).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    expect(
      screen.getByRole('heading', { name: 'Satellite imagery', level: 1 }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Imagery search is not available yet' }),
    ).toBeVisible();
    const searchAreaSource = screen.getByRole('combobox', {
      name: 'Search area source',
    });
    expect(searchAreaSource).toHaveTextContent('Viewport');
    expect(searchAreaSource).toHaveTextContent('42.1000, 43.4000');
    await user.click(searchAreaSource);
    expect(screen.getByRole('option', { name: 'Viewport' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Marker' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByTestId('elevation-panel')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Imported tracks will stay in this browser/u),
    ).not.toBeInTheDocument();
  });

  it('persists developer mode and opens the diagnostics drawer', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

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
